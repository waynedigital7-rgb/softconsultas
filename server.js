// Soft Consultas: servidor principal (Node 22, sem dependências externas nesta etapa)
import http from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, saldoCentavos, saldoComissao, lerConfig, gravarConfig, precoDe, recalcularPrecos, pastaPdfs, armazenamento, fazerBackup, listarBackups, pastaBackups, registrar, pastaAnuncios, pastaDocsLimpaNome, pastaProdutos } from './db.js';
import { writeFile, access, unlink } from 'node:fs/promises';
import * as AS from './asaas.js';
import { consultarApiFull, analisar, achatar, obterPdf, saldoApiFull, limparCacheSaldo, gerarRecargaApiFull } from './apifull.js';
import { pdfGenerico } from './pdf.js';
import { montarResumo as montarResumoRX } from './raiox-resumo.js';
import { montarDiagnostico as montarDiagnosticoRX } from './raiox-diagnostico.js';
import { gerarRelatorioPDF as gerarRaioXPDF } from './raiox-pdf.js';
import * as PA from './paginas-app.js';
import * as PD from './paginas-admin.js';
import * as SV from './paginas-servico.js';
import * as A from './auth.js';
import * as P from './paginas.js';
import { enviarEmail, emailRedefinicao, emailBoasVindas } from './email.js';
import { montarEmail, perfilDo, ETAPAS, PERFIS, CAMPANHAS, montarCampanha } from './emails-marketing.js';
import { createHmac, randomBytes, createHash, createCipheriv, createDecipheriv, scryptSync, createSign } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { TERMOS, PRIVACIDADE } from './textos.js';
import { PUBLICOS, paginaLanding } from './landings.js';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVOS = { '/icone.png': 'image/png', '/icone-branco.png': 'image/png', '/app.js': 'text/javascript; charset=utf-8' };
// Script de rastreio gerado com os IDs do Render (sem código inline, compatível com a política de segurança)
function scriptRastreio() {
  return `(function(){
  var cfg = ${JSON.stringify(RASTREIO)};
  window.scEvento = function(nome, valor, eid){
    try {
      if (cfg.meta && window.fbq) { if (eid) fbq('track', nome, valor ? { value: valor, currency: 'BRL' } : {}, { eventID: eid }); else fbq('track', nome, valor ? { value: valor, currency: 'BRL' } : {}); }
      if (cfg.google && window.gtag) {
        var mapa = { CompleteRegistration: 'sign_up', Purchase: 'purchase', Lead: 'generate_lead' };
        gtag('event', mapa[nome] || nome, valor ? { value: valor, currency: 'BRL' } : {});
        if (nome === 'CompleteRegistration' && cfg.convCadastro) gtag('event', 'conversion', { send_to: cfg.convCadastro });
        if (nome === 'Purchase' && cfg.convRecarga) gtag('event', 'conversion', { send_to: cfg.convRecarga, value: valor, currency: 'BRL' });
      }
    } catch (e) {}
  };
  if (cfg.meta) {
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', cfg.meta); fbq('track', 'PageView');
  }
  if (cfg.google) {
    var g = document.createElement('script'); g.async = true; g.src = 'https://www.googletagmanager.com/gtag/js?id=' + cfg.google; document.head.appendChild(g);
    window.dataLayer = window.dataLayer || []; window.gtag = function(){ dataLayer.push(arguments); };
    gtag('js', new Date()); gtag('config', cfg.google);
  }
  if (/[?&]bemvindo=1/.test(location.search)) window.scEvento('CompleteRegistration');
})();`;
}

// ---------- utilidades HTTP ----------
function cookies(req) {
  const out = {};
  for (const p of String(req.headers.cookie || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0) { const v = p.slice(i + 1).trim(); try { out[p.slice(0, i).trim()] = decodeURIComponent(v); } catch { out[p.slice(0, i).trim()] = v; } }
  }
  return out;
}
const ehHttps = (req) => String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';
// IP real: Cloudflare/Render informam em cabeçalho próprio; no X-Forwarded-For vale o último (adicionado pelo proxy)
const ipDe = (req) => String(req.headers['cf-connecting-ip'] || req.headers['true-client-ip']
  || String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean).pop()
  || req.socket.remoteAddress || '').trim();
const urlBase = (req) => process.env.URL_BASE || `${ehHttps(req) ? 'https' : 'http'}://${req.headers.host}`;

async function corpoForm(req, limite = 20000) {
  let dados = '';
  for await (const pedaco of req) {
    dados += pedaco;
    if (dados.length > limite) throw new Error('corpo grande demais');
  }
  return Object.fromEntries(new URLSearchParams(dados));
}

async function corpoJson(req, limite = 200000) {
  let dados = '';
  for await (const pedaco of req) { dados += pedaco; if (dados.length > limite) throw new Error('corpo grande demais'); }
  try { return JSON.parse(dados || '{}'); } catch { return {}; }
}
// Formulário com arquivo (multipart/form-data), sem dependências. Limite padrão: 3 MB.
async function corpoMultipart(req, limite = 3 * 1024 * 1024) {
  const tipo = String(req.headers['content-type'] || '');
  const m = tipo.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!m) throw new Error('formulário inválido');
  const fronteira = Buffer.from(`--${m[1] || m[2]}`);
  const pedacos = []; let total = 0;
  for await (const c of req) { total += c.length; if (total > limite) throw new Error('arquivo grande demais'); pedacos.push(c); }
  const corpo = Buffer.concat(pedacos);
  const campos = {}, arquivos = {};
  let pos = corpo.indexOf(fronteira);
  while (pos !== -1) {
    const inicio = pos + fronteira.length + 2;
    const prox = corpo.indexOf(fronteira, inicio);
    if (prox === -1) break;
    const parte = corpo.subarray(inicio, prox - 2);
    const sep = parte.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const cab = parte.subarray(0, sep).toString('utf8');
      const dados = parte.subarray(sep + 4);
      const nome = (cab.match(/name="([^"]*)"/i) || [])[1];
      const arq = (cab.match(/filename="([^"]*)"/i) || [])[1];
      const ct = (cab.match(/Content-Type:\s*([^\r\n]+)/i) || [])[1];
      if (nome && arq !== undefined) { if (dados.length) arquivos[nome] = { nome: arq, tipo: (ct || '').trim(), dados }; }
      else if (nome) campos[nome] = dados.toString('utf8');
    }
    pos = prox;
  }
  return { campos, arquivos };
}
// Confere a imagem pelos primeiros bytes (não confia na extensão)
function tipoImagem(b) {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

function json(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
// Valor digitado em reais → centavos. Aceita "50", "50,00", "50.00", "1.000", "1.000,50".
// Qualquer coisa ambígua (ex.: "1,000", "12.3456") é recusada em vez de virar um valor errado.
const centavos = (v) => {
  const t = String(v ?? '').trim().replace(/[^\d,.-]/g, '');
  let n = NaN;
  if (/^-?\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) n = Number(t.replace(/\./g, '').replace(',', '.'));
  else if (/^-?\d+(,\d{1,2})?$/.test(t)) n = Number(t.replace(',', '.'));
  else if (/^-?\d+\.\d{1,2}$/.test(t)) n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

// "Não sou um robô" (Cloudflare Turnstile): ativo quando as duas variáveis existem
const TURNSTILE = { site: process.env.TURNSTILE_SITE_KEY || '', segredo: process.env.TURNSTILE_SECRET_KEY || '' };
TURNSTILE.ativo = !!(TURNSTILE.site && TURNSTILE.segredo);
async function passouNoRobo(req, f) {
  if (!TURNSTILE.ativo) return true;
  const token = String(f['cf-turnstile-response'] || '');
  if (!token) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: TURNSTILE.segredo, response: token, remoteip: ipDe(req) }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json();
    return j.success === true;
  } catch (e) { console.warn('turnstile:', e.message); return false; }
}
P.configurarRobo(TURNSTILE.ativo ? TURNSTILE.site : '');

const CF = TURNSTILE.ativo ? ' https://challenges.cloudflare.com' : '';
// Pixel da Meta e tag do Google (ativos quando as variáveis existem)
const RASTREIO = {
  meta: (process.env.META_PIXEL_ID || '').replace(/\D/g, ''),
  google: (process.env.GOOGLE_TAG_ID || '').replace(/[^\w-]/g, ''),
  convCadastro: (process.env.GOOGLE_ADS_CONV_CADASTRO || '').replace(/[^\w/-]/g, ''),
  convRecarga: (process.env.GOOGLE_ADS_CONV_RECARGA || '').replace(/[^\w/-]/g, ''),
};
RASTREIO.ativo = !!(RASTREIO.meta || RASTREIO.google);
// API de Conversões da Meta: o servidor avisa cada compra paga (mesmo se o cliente fechou a página antes do Pix confirmar)
const CAPI = { token: process.env.META_CAPI_TOKEN || '', teste: process.env.META_CAPI_TEST_CODE || '' };
function guardarRastreio(req, chave) {
  try {
    const c = cookies(req);
    const ref = String(req.headers.referer || '').slice(0, 300);
    db.prepare(`INSERT INTO rastreio_meta (chave, fbp, fbc, ip, ua, url) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(chave) DO UPDATE SET fbp = COALESCE(excluded.fbp, fbp), fbc = COALESCE(excluded.fbc, fbc), ip = excluded.ip, ua = excluded.ua, url = COALESCE(excluded.url, url), atualizado_em = datetime('now')`)
      .run(chave, c._fbp || null, c._fbc || null, ipDe(req), String(req.headers['user-agent'] || '').slice(0, 400), ref || null);
  } catch (e) { console.error('rastreio:', e.message); }
}
const hashMeta = (v) => createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');
function telefoneMeta(t) { let d = String(t || '').replace(/\D/g, ''); if (!d) return null; if (d.length <= 11) d = '55' + d; return d; }
function capiCompra({ eid, valor, email, telefone, nome, usuarioId, chave, conteudo }) {
  if (!CAPI.token || !RASTREIO.meta || !eid || !valor) return;
  const r = (chave && db.prepare('SELECT * FROM rastreio_meta WHERE chave = ?').get(chave))
    || (usuarioId && db.prepare('SELECT * FROM rastreio_meta WHERE chave = ?').get(`u-${usuarioId}`)) || {};
  const partes = String(nome || '').trim().split(/\s+/);
  const ud = {};
  if (email) ud.em = [hashMeta(email)];
  const tel = telefoneMeta(telefone); if (tel) ud.ph = [hashMeta(tel)];
  if (partes[0]) ud.fn = [hashMeta(partes[0])];
  if (partes.length > 1) ud.ln = [hashMeta(partes[partes.length - 1])];
  if (usuarioId) ud.external_id = [hashMeta(`u${usuarioId}`)];
  ud.country = [hashMeta('br')];
  if (r.ip) ud.client_ip_address = r.ip;
  if (r.ua) ud.client_user_agent = r.ua;
  if (r.fbp) ud.fbp = r.fbp;
  if (r.fbc) ud.fbc = r.fbc;
  const corpo = { data: [{ event_name: 'Purchase', event_time: Math.floor(Date.now() / 1000), event_id: eid, action_source: 'website',
    event_source_url: r.url || `${baseEmails()}/`, user_data: ud, custom_data: { currency: 'BRL', value: Number(valor) / 100, content_name: conteudo || undefined } }] };
  if (CAPI.teste) corpo.test_event_code = CAPI.teste;
  fetch(`https://graph.facebook.com/v21.0/${RASTREIO.meta}/events?access_token=${encodeURIComponent(CAPI.token)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(15000) })
    .then(async (x) => { if (!x.ok) console.error('meta capi:', x.status, (await x.text()).slice(0, 300)); })
    .catch((e) => console.error('meta capi:', e.message));
}
const DOM_META = RASTREIO.meta ? ' https://connect.facebook.net https://www.facebook.com' : '';
const DOM_GOOGLE = RASTREIO.google ? ' https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.google.com https://www.google.com.br https://googleads.g.doubleclick.net https://*.doubleclick.net https://www.googleadservices.com' : '';
P.configurarRastreio(RASTREIO.ativo);
const CABECALHOS = {
  'Content-Security-Policy': `default-src 'self'; script-src 'self'${CF}${DOM_META}${DOM_GOOGLE}; frame-src https://www.youtube-nocookie.com https://player.vimeo.com${CF}${DOM_GOOGLE}; media-src 'self'; connect-src 'self'${CF}${DOM_META}${DOM_GOOGLE}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:${DOM_META}${DOM_GOOGLE}; form-action 'self'; frame-ancestors 'none'; base-uri 'self'`,
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
function html(res, conteudo, status = 200, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...CABECALHOS, ...extra });
  res.end(conteudo);
}
function redirecionar(res, para, extra = {}) {
  res.writeHead(303, { Location: para, 'Cache-Control': 'no-store', ...extra });
  res.end();
}
const AVISO_DISCO = `<div class="aviso erro" role="alert" style="font-size:1rem"><strong>ATENÇÃO: os dados NÃO estão sendo salvos no disco permanente.</strong>
  Cadastros, saldos, consultas e preços serão apagados na próxima atualização do site. No Render, confira em <strong>Disks</strong> se existe um disco com Mount Path <code>/var/data</code>
  e em <strong>Environment</strong> se <code>DATA_DIR</code> = <code>/var/data</code>. Pasta atual: <code>${P.esc(armazenamento.pasta)}</code>${armazenamento.erro ? `<br>${P.esc(armazenamento.erro)}` : ''}</div>`;
// Aviso geral (configurado no Admin) aparece no topo para todos os clientes logados
const avisoGeral = (usuario) => {
  const t = usuario ? String(lerConfig('aviso_geral') || '').trim() : '';
  return t ? `<div class="aviso" role="status" style="background:#FFF6E0;border-color:#F0C24B;color:#5A4300">${P.esc(t)}</div>` : '';
};
// Página do link do cliente (sem login): sem menu, sem botões de conta
const paginaExterna = (res, titulo, corpo, status) => html(res, P.layout({ titulo, corpo, usuario: null, externo: true }), status, { 'X-Robots-Tag': 'noindex' });
const pagina = (res, titulo, corpo, usuario, status, extra) =>
  html(res, P.layout({ titulo, corpo: (usuario?.admin && !armazenamento.persistente ? AVISO_DISCO : '') + avisoGeral(usuario) + corpo, usuario }), status, extra);

// Bloqueia envios de formulário vindos de outros sites
function origemValida(req) {
  const origem = req.headers.origin || req.headers.referer;
  if (!origem) return false;
  try { return new URL(origem).host === req.headers.host; } catch { return false; }
}

// ---------- rotas ----------
const rotas = {};
const rotasParam = [];
const rota = (metodo, caminho, fn) => {
  if (caminho.includes(':')) {
    const nomes = [];
    const re = new RegExp('^' + caminho.replace(/:(\w+)/g, (_, n) => { nomes.push(n); return '([^/]+)'; }) + '$');
    rotasParam.push({ metodo, re, nomes, fn });
  } else rotas[`${metodo} ${caminho}`] = fn;
};
function acharRota(metodo, caminho) {
  if (rotas[`${metodo} ${caminho}`]) return { fn: rotas[`${metodo} ${caminho}`], params: {} };
  for (const r of rotasParam) {
    if (r.metodo !== metodo) continue;
    const m = caminho.match(r.re);
    if (m) return { fn: r.fn, params: Object.fromEntries(r.nomes.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}
// Sem login: guarda a página pedida (ex.: link de e-mail) para voltar a ela depois de entrar
const exigeLogin = (fn) => async (ctx) => {
  if (ctx.usuario) return fn(ctx);
  const destino = ctx.req.method === 'GET' ? `${ctx.url.pathname}${ctx.url.search}` : '';
  const ok = /^\/(consultas|recarregar|painel|indicacoes|historico|limpa-nome|monitoramento|ebook|raio-x|parceiro|rating|app)[\w\/?=&%.-]*$/.test(destino) && destino.length < 300;
  return redirecionar(ctx.res, '/entrar', ok ? { 'Set-Cookie': `sc_voltar=${encodeURIComponent(destino)}; Path=/; Max-Age=1800; HttpOnly; SameSite=Lax` } : {});
};
const exigeAdmin = (fn) => async (ctx) => (ctx.usuario?.admin ? fn(ctx) : redirecionar(ctx.res, ctx.usuario ? '/painel' : '/entrar'));

function codigoUnico() {
  let c;
  do { c = A.novoCodigoIndicacao(); } while (db.prepare('SELECT 1 FROM usuarios WHERE codigo_indicacao = ?').get(c));
  return c;
}
function garantirCodigo(usuario) {
  if (usuario.codigo_indicacao) return usuario.codigo_indicacao;
  const c = codigoUnico();
  db.prepare('UPDATE usuarios SET codigo_indicacao = ? WHERE id = ?').run(c, usuario.id);
  usuario.codigo_indicacao = c;
  return c;
}

rota('GET', '/', ({ res, usuario }) => (usuario ? redirecionar(res, '/painel')
  : pagina(res, 'Consultas para o seu negócio', P.paginaInicial({}), null)));

// Cadastro
rota('GET', '/cadastro', ({ res, usuario, url }) => (usuario ? redirecionar(res, '/consultas')
  : pagina(res, 'Criar conta grátis', P.paginaCadastro({ v: { consulta: A.soNumeros(url.searchParams.get('doc') || '').slice(0, 14) || placaOk(url.searchParams.get('placa')) } }), null)));
function placaOk(v) { const p = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(p) ? p : ''; }
rota('POST', '/cadastro', async ({ req, res }) => {
  const f = await corpoForm(req);
  const v = {
    nome: String(f.nome || '').trim().slice(0, 120),
    email: String(f.email || '').trim().toLowerCase().slice(0, 160),
    documento: A.soNumeros(f.documento),
    telefone: A.soNumeros(f.telefone).replace(/^55(?=\d{10,11}$)/, ''),
    consulta: placaOk(f.consulta) || A.soNumeros(f.consulta || '').slice(0, 14),
  };
  const erro = (m) => pagina(res, 'Criar conta', P.paginaCadastro({ erro: m, v }), null, 400);
  if (!A.limitar(`cad:${ipDe(req)}`, 10, 60)) return erro('Muitas tentativas. Aguarde alguns minutos e tente de novo.');
  if (!(await passouNoRobo(req, f))) return erro('Confirme que você não é um robô.');
  if (v.nome.length < 3) return erro('Informe seu nome completo ou a razão social.');
  if (!A.emailValido(v.email)) return erro('Informe um e-mail válido.');
  if (v.documento && !A.documentoValido(v.documento)) return erro('CPF ou CNPJ inválido.');
  if (v.telefone.length < 10 || v.telefone.length > 11) return erro('Informe seu WhatsApp com DDD.');
  if (String(f.senha || '').length < 8) return erro('A senha precisa ter pelo menos 8 caracteres.');
  if (f.aceite !== '1') return erro('Para continuar, aceite os Termos de uso e a Política de privacidade.');
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(v.email)) return erro('Já existe uma conta com esse e-mail. Faça login ou recupere a senha.');

  const admin = String(process.env.ADMIN_EMAIL || '').split(',').map((x) => x.trim().toLowerCase()).includes(v.email) ? 1 : 0;
  const ref = String(cookies(req).sc_ref || '').toUpperCase();
  const indicador = ref ? db.prepare('SELECT id FROM usuarios WHERE codigo_indicacao = ? AND ativo = 1').get(ref) : null;
  let org = {};
  try { org = JSON.parse(cookies(req).sc_origem || '{}') || {}; } catch {}
  const t = (x) => String(x || '').slice(0, 80);
  const r = db.prepare(`INSERT INTO usuarios (nome, email, documento, telefone, senha_hash, admin, aceite_termos, indicado_por, codigo_indicacao,
      origem, utm_source, utm_medium, utm_campaign, utm_content, pagina_entrada)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?)`).run(v.nome, v.email, v.documento, v.telefone, A.gerarHashSenha(f.senha), admin, indicador?.id ?? null, codigoUnico(),
      t(org.origem || (indicador ? 'indicacao' : '')), t(org.utm_source), t(org.utm_medium), t(org.utm_campaign), t(org.utm_content), t(org.pagina));
  const token = A.criarSessao(Number(r.lastInsertRowid));
  const bv = montarEmail({ etapa: 'boasvindas', nome: v.nome, perfil: perfilDo({ origem: org.origem, utm_campaign: org.utm_campaign, pagina_entrada: org.pagina }), bonus: bonusPrimeira(), base: urlBase(req), sair: null });
  enviarEmail({ para: v.email, assunto: bv.assunto, html: bv.html })
    .catch((e) => console.error('e-mail boas-vindas:', e.message));
  const placaConsulta = placaOk(f.consulta);
  const docConsulta = placaConsulta ? '' : A.soNumeros(f.consulta || '').slice(0, 14);
  const voltarCad = String(cookies(req).sc_voltar || '');
  const destinoCad = /^\/(ebook|monitoramento|limpa-nome|raio-x|rating)[\w\/?=&%.-]*$/.test(voltarCad) ? voltarCad : null;
  redirecionar(res, destinoCad || (placaConsulta ? `/consultas/categoria/veiculos?bemvindo=1&placa=${placaConsulta}` : docConsulta ? `/consultas?bemvindo=1&doc=${docConsulta}` : '/painel?bemvindo=1'), { 'Set-Cookie': [A.cookieSessao(token, ehHttps(req)), 'sc_ref=; Path=/; Max-Age=0', 'sc_origem=; Path=/; Max-Age=0', 'sc_voltar=; Path=/; Max-Age=0'] });
});

// Login
rota('GET', '/entrar', ({ res, usuario, url }) => (usuario ? redirecionar(res, '/painel')
  : pagina(res, 'Entrar', P.paginaEntrar({ ok: url.searchParams.get('ok') === 'senha' ? 'Senha alterada. Entre com a nova senha.' : '' }), null)));
rota('POST', '/entrar', async ({ req, res }) => {
  const f = await corpoForm(req);
  const email = String(f.email || '').trim().toLowerCase();
  const erro = (m, s = 400) => pagina(res, 'Entrar', P.paginaEntrar({ erro: m, email }), null, s);
  if (!A.limitar(`login-ip:${ipDe(req)}`, 20, 15) || !A.limitar(`login:${email}`, 8, 15)) {
    return erro('Muitas tentativas. Aguarde 15 minutos e tente de novo.', 429);
  }
  if (!(await passouNoRobo(req, f))) return erro('Confirme que você não é um robô.', 400);
  const u = db.prepare('SELECT id, senha_hash, ativo FROM usuarios WHERE email = ?').get(email);
  if (!u || !A.conferirSenha(String(f.senha || ''), u.senha_hash)) return erro('E-mail ou senha incorretos.', 401);
  if (!u.ativo) return erro('Esta conta está desativada. Fale com o suporte.', 403);
  A.limparLimite(`login:${email}`);
  const voltar = String(cookies(req).sc_voltar || '');
  const destinoOk = /^\/(consultas|recarregar|painel|indicacoes|historico|limpa-nome|monitoramento|ebook|raio-x|parceiro|rating|app)[\w\/?=&%.-]*$/.test(voltar) ? voltar : (ctxReq.getStore()?.app ? '/app' : '/painel');
  redirecionar(res, destinoOk, { 'Set-Cookie': [A.cookieSessao(A.criarSessao(u.id), ehHttps(req)), 'sc_voltar=; Path=/; Max-Age=0'] });
});

rota('POST', '/sair', ({ req, res, token }) => {
  A.encerrarSessao(token);
  redirecionar(res, '/', { 'Set-Cookie': A.cookieApagar(ehHttps(req)) });
});

// Esqueci / redefinir senha
rota('GET', '/esqueci-senha', ({ res }) => pagina(res, 'Esqueci minha senha', P.paginaEsqueci({}), null));
rota('POST', '/esqueci-senha', async ({ req, res }) => {
  const f = await corpoForm(req);
  const email = String(f.email || '').trim().toLowerCase();
  const ok = 'Se existir uma conta com esse e-mail, você vai receber um link em instantes. Confira também o spam.';
  if (!A.limitar(`esq-ip:${ipDe(req)}`, 10, 60) || !A.limitar(`esq:${email}`, 3, 60)) {
    return pagina(res, 'Esqueci minha senha', P.paginaEsqueci({ ok }), null);
  }
  if (!(await passouNoRobo(req, f))) return pagina(res, 'Esqueci minha senha', P.paginaEsqueci({ erro: 'Confirme que você não é um robô.' }), null, 400);
  const u = db.prepare('SELECT id, nome FROM usuarios WHERE email = ? AND ativo = 1').get(email);
  if (u) {
    const t = A.criarTokenRedefinicao(u.id);
    enviarEmail({ para: email, assunto: 'Redefinir sua senha - Soft Consultas', html: emailRedefinicao(u.nome, `${urlBase(req)}/redefinir-senha?token=${t}`) })
      .catch((e) => console.error('e-mail redefinição:', e.message));
  }
  pagina(res, 'Esqueci minha senha', P.paginaEsqueci({ ok }), null);
});
rota('GET', '/redefinir-senha', ({ res, url }) => {
  const token = url.searchParams.get('token') || '';
  pagina(res, 'Nova senha', P.paginaRedefinir({ token, valido: !!A.usarTokenRedefinicao(token) }), null);
});
rota('POST', '/redefinir-senha', async ({ req, res }) => {
  const f = await corpoForm(req);
  const uid = A.usarTokenRedefinicao(f.token);
  const erro = (m) => pagina(res, 'Nova senha', P.paginaRedefinir({ erro: m, token: f.token, valido: !!uid }), null, 400);
  if (!uid) return erro('Este link é inválido ou já expirou.');
  if (String(f.senha || '').length < 8) return erro('A senha precisa ter pelo menos 8 caracteres.');
  if (f.senha !== f.senha2) return erro('As senhas não conferem.');
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(A.gerarHashSenha(f.senha), uid);
  A.marcarTokenUsado(f.token);
  A.encerrarTodasSessoes(uid);
  redirecionar(res, '/entrar?ok=senha');
});

// Área do cliente
rota('GET', '/painel', exigeLogin(async ({ res, usuario }) => {
  const transacoes = db.prepare('SELECT * FROM transacoes WHERE usuario_id = ? ORDER BY id DESC LIMIT 20').all(usuario.id);
  const consultas = db.prepare('SELECT * FROM consultas WHERE usuario_id = ? ORDER BY id DESC LIMIT 10').all(usuario.id);
  pagina(res, 'Painel', P.paginaPainel({ usuario, saldo: await saldoExibido(usuario), transacoes, consultas, anuncios: anunciosParaExibir(), contato: contatoAnuncie() }), usuario);
}));

rota('GET', '/conta', exigeLogin(({ res, usuario, url }) => pagina(res, 'Minha conta',
  P.paginaConta({ usuario, ok: url.searchParams.get('ok') ? 'Senha alterada com sucesso.' : '' }), usuario)));
// ---------- Notificações push do app (Firebase Cloud Messaging, Android e iPhone) ----------
// FCM_SERVICE_ACCOUNT no Render: o JSON da conta de serviço do Firebase (sem ela, o push fica desligado)
let _fcm = null;
function contaFcm() {
  if (_fcm !== null) return _fcm;
  try { _fcm = process.env.FCM_SERVICE_ACCOUNT ? JSON.parse(process.env.FCM_SERVICE_ACCOUNT) : false; } catch { _fcm = false; console.warn('FCM_SERVICE_ACCOUNT inválido'); }
  return _fcm;
}
let _tokenFcm = { valor: null, expira: 0 };
async function tokenFcm() {
  const c = contaFcm();
  if (!c) return null;
  if (_tokenFcm.valor && Date.now() < _tokenFcm.expira) return _tokenFcm.valor;
  const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  const agora = Math.floor(Date.now() / 1000);
  const corpo = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: c.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: agora, exp: agora + 3600 })}`;
  const assinatura = createSign('RSA-SHA256').update(corpo).sign(c.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${corpo}.${assinatura}` });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`FCM token: ${r.status} ${j.error || ''}`);
  _tokenFcm = { valor: j.access_token, expira: Date.now() + (Number(j.expires_in || 3600) - 300) * 1000 };
  return j.access_token;
}
async function enviarPush(usuarioId, { titulo, corpo, link = '/app' }) {
  const c = contaFcm();
  if (!c || !usuarioId) return 0;
  const aparelhos = db.prepare('SELECT token FROM app_dispositivos WHERE usuario_id = ? AND ativo = 1').all(usuarioId);
  if (!aparelhos.length) return 0;
  let ok = 0;
  try {
    const at = await tokenFcm();
    for (const { token } of aparelhos) {
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${c.project_id}/messages:send`, { method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token, notification: { title: String(titulo).slice(0, 100), body: String(corpo).slice(0, 240) }, data: { link },
          android: { priority: 'high', notification: { sound: 'default' } }, apns: { payload: { aps: { sound: 'default' } } } } }) });
      if (r.ok) ok++;
      else if (r.status === 404 || r.status === 400) db.prepare("UPDATE app_dispositivos SET ativo = 0, atualizado_em = datetime('now') WHERE token = ?").run(token);
    }
  } catch (e) { console.warn('push:', e.message); }
  return ok;
}
// O app registra o aparelho depois do login
rota('POST', '/api/app/dispositivo', exigeLogin(async ({ req, res, usuario }) => {
  const b = await corpoJson(req).catch(() => ({}));
  const token = String(b?.token || '').trim();
  if (!/^[\w:.\-]{20,4096}$/.test(token)) return json(res, { ok: false }, 400);
  const plat = ['android', 'ios'].includes(b.plataforma) ? b.plataforma : '';
  db.prepare(`INSERT INTO app_dispositivos (token, usuario_id, plataforma, ativo, atualizado_em) VALUES (?, ?, ?, 1, datetime('now'))
    ON CONFLICT(token) DO UPDATE SET usuario_id = excluded.usuario_id, plataforma = excluded.plataforma, ativo = 1, atualizado_em = datetime('now')`).run(token, usuario.id, plat);
  json(res, { ok: true });
}));
// Início do aplicativo
rota('GET', '/app', exigeLogin(({ res, usuario }) => {
  const m = db.prepare("SELECT * FROM monitoramentos WHERE usuario_id = ? AND status <> 'cancelado' ORDER BY CASE status WHEN 'ativo' THEN 0 ELSE 1 END, id DESC").get(usuario.id);
  let resumo = null; try { resumo = JSON.parse(m?.ultimo_resumo || 'null'); } catch {}
  const mon = m ? { ativo: m.status === 'ativo', status: m.status === 'aguardando' ? 'Aguardando pagamento' : m.status, ultima: m.ultima_checagem ? m.ultima_checagem.slice(0, 10).split('-').reverse().join('/') : '', resumo } : null;
  const peds = db.prepare("SELECT * FROM limpa_nome_pedidos WHERE usuario_id = ? AND parceiro_id IS NULL AND status NOT IN ('cancelado') ORDER BY id DESC LIMIT 10").all(usuario.id);
  const item = (p) => ({ titulo: `${SERVICOS[p.servico] || 'Limpa Nome'} · #${p.id}`, sub: SV.STATUS_LN[p.status]?.t || p.status, link: p.servico === 'rating' ? `/rating/${p.id}` : `/limpa-nome/servico/${p.id}` });
  pagina(res, 'Início', P.paginaAppInicio({ usuario, mon, whatsapp: lnCfg().whatsapp,
    pedidos: { ln: peds.filter((p) => p.servico !== 'rating').map(item), rating: peds.filter((p) => p.servico === 'rating').map(item) } }), usuario);
}));
// Exclusão de conta pelo próprio cliente (exigida pelas lojas de aplicativos). Saldo e histórico ficam guardados (obrigação legal).
rota('POST', '/conta/excluir', exigeLogin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  if (String(f.confirmar || '').trim().toUpperCase() !== 'EXCLUIR') return pagina(res, 'Minha conta', P.paginaConta({ usuario, erro: 'Para excluir, digite EXCLUIR no campo de confirmação.' }), usuario, 400);
  db.prepare("UPDATE usuarios SET ativo = 0, aceita_emails = 0, exclusao_solicitada_em = datetime('now') WHERE id = ?").run(usuario.id);
  db.prepare('UPDATE app_dispositivos SET ativo = 0 WHERE usuario_id = ?').run(usuario.id);
  A.encerrarTodasSessoes(usuario.id);
  registrar(null, 'Cliente pediu exclusão da conta', `${usuario.email} (#${usuario.id})`);
  if (process.env.EMAIL_EMPRESA) enviarEmail({ para: process.env.EMAIL_EMPRESA, assunto: 'Pedido de exclusão de conta', html: `<p>${P.esc(usuario.nome)} (${P.esc(usuario.email)}, #${usuario.id}) pediu a exclusão da conta.</p>` }).catch(() => {});
  pagina(res, 'Conta excluída', P.paginaEmBreve('Conta excluída', 'O seu acesso foi encerrado e o pedido de exclusão dos dados foi registrado. Se tiver um pedido em andamento, ele continua normalmente e você recebe as atualizações por e-mail.'), null);
}));
rota('POST', '/conta/senha', exigeLogin(async ({ req, res, usuario, token }) => {
  const f = await corpoForm(req);
  const erro = (m) => pagina(res, 'Minha conta', P.paginaConta({ usuario, erro: m }), usuario, 400);
  const u = db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(usuario.id);
  if (!A.limitar(`senha:${usuario.id}`, 5, 15)) return erro('Muitas tentativas. Aguarde alguns minutos.');
  if (!A.conferirSenha(String(f.atual || ''), u.senha_hash)) return erro('Senha atual incorreta.');
  if (String(f.nova || '').length < 8) return erro('A nova senha precisa ter pelo menos 8 caracteres.');
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(A.gerarHashSenha(f.nova), usuario.id);
  A.encerrarTodasSessoes(usuario.id);
  redirecionar(res, '/conta?ok=1', { 'Set-Cookie': A.cookieSessao(A.criarSessao(usuario.id), ehHttps(req)) });
}));

// ======================= CARTEIRA (recarga por Pix) =======================
const faixasBonus = () => { try { return JSON.parse(lerConfig('bonus_faixas') || '[]'); } catch { return []; } };
// Bônus de primeira recarga (oferta de lançamento), configurável no Admin
function bonusPrimeira() {
  const pct = Number(lerConfig('bonus_primeira_percentual') || 0);
  const min = Number(lerConfig('bonus_primeira_minimo_centavos') || 0);
  const ate = lerConfig('bonus_primeira_ate') || '';
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  return { pct, min, ate, ativo: pct > 0 && (!ate || hoje <= ate) };
}
const ehPrimeiraRecarga = (uid) => !db.prepare("SELECT 1 FROM recargas WHERE usuario_id = ? AND status = 'paga'").get(uid);
const bonusPara = (v, uid) => {
  let p = 0;
  for (const f of faixasBonus()) if (v >= f.a_partir_de) p = Math.max(p, f.percentual);
  const bp = bonusPrimeira();
  if (uid && bp.ativo && v >= bp.min && ehPrimeiraRecarga(uid)) p = Math.max(p, bp.pct);
  return Math.round((v * p) / 100);
};
const VALOR_MAXIMO_PADRAO = 100000; // R$ 1.000 por recarga (ajustável em Configurações)
const valorMaximo = () => Math.max(1000, Number(lerConfig('recarga_maxima_centavos') || VALOR_MAXIMO_PADRAO));
const VALOR_CONFIRMAR = 30000; // acima de R$ 300 o cliente confirma o valor antes de gerar o Pix

// Credita uma recarga uma única vez (webhook e verificação manual podem chamar ao mesmo tempo)
// Bônus recalculado no momento do pagamento: o de primeira recarga vale uma única vez por conta e por CPF/CNPJ
function bonusNoPagamento(r) {
  let p = 0;
  for (const f of faixasBonus()) if (r.valor_centavos >= f.a_partir_de) p = Math.max(p, f.percentual);
  const bp = bonusPrimeira();
  if (bp.ativo && r.valor_centavos >= bp.min) {
    const doc = db.prepare('SELECT documento FROM usuarios WHERE id = ?').get(r.usuario_id)?.documento || '';
    const jaPagou = db.prepare("SELECT 1 FROM recargas WHERE usuario_id = ? AND status = 'paga' AND id <> ?").get(r.usuario_id, r.id)
      || (doc && db.prepare("SELECT 1 FROM recargas rc JOIN usuarios u ON u.id = rc.usuario_id WHERE u.documento = ? AND rc.status = 'paga' AND rc.id <> ?").get(doc, r.id));
    if (!jaPagou) p = Math.max(p, bp.pct);
  }
  return Math.min(r.bonus_centavos || 0, Math.round((r.valor_centavos * p) / 100));
}

function creditarRecarga(recargaId) {
  const r0 = db.prepare('SELECT * FROM recargas WHERE id = ?').get(recargaId);
  if (!r0 || r0.status === 'paga') return false;
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = db.prepare('SELECT * FROM recargas WHERE id = ?').get(recargaId);
    if (r.status === 'paga') { db.exec('COMMIT'); return false; }
    r.bonus_centavos = bonusNoPagamento(r);
    db.prepare("UPDATE recargas SET status = 'paga', pago_em = datetime('now'), bonus_centavos = ? WHERE id = ? AND status <> 'paga'").run(r.bonus_centavos, r.id);
    db.prepare("INSERT OR IGNORE INTO transacoes (usuario_id, tipo, valor_centavos, descricao, referencia) VALUES (?, 'recarga', ?, ?, ?)")
      .run(r.usuario_id, r.valor_centavos, 'Recarga via Pix', `rec_${r.id}`);
    if (r.bonus_centavos > 0) {
      db.prepare("INSERT OR IGNORE INTO transacoes (usuario_id, tipo, valor_centavos, descricao, referencia) VALUES (?, 'ajuste', ?, ?, ?)")
        .run(r.usuario_id, r.bonus_centavos, 'Bônus de recarga', `bonus_${r.id}`);
    }
    db.exec('COMMIT');
    try { const u = db.prepare('SELECT nome, email, telefone FROM usuarios WHERE id = ?').get(r.usuario_id) || {};
      capiCompra({ eid: `rec-${r.id}`, valor: r.valor_centavos, email: u.email, telefone: u.telefone, nome: u.nome, usuarioId: r.usuario_id, conteudo: 'Recarga' }); } catch (e) { console.error('capi recarga:', e.message); }
    return true;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}


// ======================= REPASSE AUTOMÁTICO PARA A APIFULL =======================
// A cada recarga paga (depois de ligado), um percentual vai para a APIFull: o sistema gera um Pix de recarga
// na APIFull e paga com o saldo da conta Asaas. Junta valores pequenos até o mínimo configurado.
const repasseCfg = () => ({
  ativo: lerConfig('repasse_ativo') === '1',
  pct: Number(lerConfig('repasse_percentual') || 0),
  minimo: Math.max(1000, Number(lerConfig('repasse_minimo_centavos') || 5000)),
  desde: lerConfig('repasse_desde') || '',
});
function repasseAcumulado() {
  const c = repasseCfg();
  if (!c.desde || c.pct <= 0) return { valor: 0, ids: [] };
  const lista = db.prepare("SELECT id, valor_centavos FROM recargas WHERE status = 'paga' AND repasse_id IS NULL AND pago_em >= ?").all(c.desde);
  return { valor: Math.floor(lista.reduce((t, r) => t + r.valor_centavos, 0) * c.pct / 100), ids: lista.map((r) => r.id) };
}
let repasseRodando = false;
async function executarRepasse(id) {
  const rp = db.prepare('SELECT * FROM repasses_apifull WHERE id = ?').get(id);
  if (!rp || ['pago', 'enviado'].includes(rp.status)) return;
  try {
    const { payload, resposta } = await gerarRecargaApiFull(rp.valor_centavos);
    db.prepare("UPDATE repasses_apifull SET apifull_ref = ?, status = 'processando', erro = NULL WHERE id = ?").run(JSON.stringify(resposta).slice(0, 2000), id);
    const pg = await AS.pagarPixCopiaECola({ payload, valorCentavos: rp.valor_centavos, descricao: `Recarga APIFull - repasse Soft Consultas #${id}` });
    // DONE = Pix já saiu; outros status (ex.: aguardando autorização no app do Asaas) ficam como "enviado"
    const final = String(pg.status || '').toUpperCase() === 'DONE' ? 'pago' : 'enviado';
    db.prepare("UPDATE repasses_apifull SET status = ?, asaas_id = ?, pago_em = datetime('now'), erro = ? WHERE id = ?").run(final, pg.id || null, final === 'enviado' ? `Asaas: ${pg.status || 'sem status'} (confira/autorize no app do Asaas)` : null, id);
    registrar(null, 'Repasse APIFull pago', `#${id} de ${P.reais(rp.valor_centavos)} · Asaas ${pg.id || '-'} (${pg.status || '-'})`);
    limparCacheSaldo();
  } catch (e) {
    console.error('repasse APIFull:', e.message);
    db.prepare("UPDATE repasses_apifull SET status = 'erro', erro = ? WHERE id = ?").run(String(e.message).slice(0, 500), id);
    registrar(null, 'Repasse APIFull falhou', `#${id} de ${P.reais(rp.valor_centavos)}: ${e.message}`);
  }
}
// forcar: botão "Repassar agora" (ignora o mínimo do lote, respeitando o mínimo de R$ 10 da APIFull)
async function processarRepasse({ forcar = false, origem = 'automatico' } = {}) {
  const c = repasseCfg();
  if ((!c.ativo && !forcar) || repasseRodando) return null;
  repasseRodando = true;
  try {
    const { valor, ids } = repasseAcumulado();
    if (!ids.length || valor < (forcar ? 1000 : c.minimo)) return null;
    let id;
    db.exec('BEGIN IMMEDIATE');
    try {
      id = Number(db.prepare('INSERT INTO repasses_apifull (valor_centavos, recargas, origem) VALUES (?, ?, ?)').run(valor, ids.join(','), origem).lastInsertRowid);
      const marca = db.prepare('UPDATE recargas SET repasse_id = ? WHERE id = ? AND repasse_id IS NULL');
      for (const rid of ids) marca.run(id, rid);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    await executarRepasse(id);
    return id;
  } finally { repasseRodando = false; }
}
setInterval(() => processarRepasse().catch((e) => console.error('repasse:', e.message)), 30 * 60 * 1000).unref();


// ======================= E-MAILS AUTOMÁTICOS (quem cadastrou e não recarregou) =======================
// Segredo próprio (gerado uma vez e guardado no banco) para o link de descadastro
if (!lerConfig('segredo_emails')) gravarConfig('segredo_emails', randomBytes(24).toString('hex'));
const assinaturaSair = (uid) => createHmac('sha256', lerConfig('segredo_emails')).update(`sair:${uid}`).digest('hex').slice(0, 32);
const linkSair = (uid) => `${process.env.URL_BASE || 'https://softconsultas.com'}/emails/sair?u=${uid}&t=${assinaturaSair(uid)}`;
const baseEmails = () => process.env.URL_BASE || 'https://softconsultas.com';
const emailsCfg = () => ({
  ativo: lerConfig('emails_ativo') === '1',
  desde: lerConfig('emails_desde') || '',
  etapas: String(lerConfig('emails_etapas') || '').split(',').filter(Boolean),
});
// ---- Cota diária do provedor de e-mail (Resend grátis: 100/dia) ----
// O marketing usa no máximo "emails_limite_diario" por dia; o resto fica livre para senha, boas-vindas e avisos de pedidos.
const hojeBRT = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const limiteDiarioEmails = () => Math.max(0, Number(lerConfig('emails_limite_diario') ?? 80));
const marketingHoje = () => db.prepare("SELECT COUNT(*) n FROM emails_enviados WHERE status IN ('enviado','enviando') AND date(criado_em, '-3 hours') = ?").get(hojeBRT()).n;
const agoraSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const emailsPausados = () => (lerConfig('emails_pausa_ate') || '') > agoraSql();
const podeMarketing = () => !emailsPausados() && marketingHoje() < limiteDiarioEmails();
const ehErroCota = (e) => /\b429\b|quota|rate.?limit|daily|too many/i.test(String(e?.message || e));
// Bateu na cota do provedor: pausa o marketing até 00:05 de amanhã (Brasília)
function pausarPorCota() {
  const amanha = new Date(`${hojeBRT()}T03:05:00Z`); amanha.setUTCDate(amanha.getUTCDate() + 1);
  const ate = amanha.toISOString().slice(0, 19).replace('T', ' ');
  gravarConfig('emails_pausa_ate', ate);
  registrar(null, 'E-mails: cota diária do provedor atingida', `marketing pausado até ${P.dt(ate)}`);
}
// Quem falhou por cota volta para a fila (apaga a reserva para tentar de novo)
db.prepare("DELETE FROM emails_enviados WHERE status = 'erro' AND (erro LIKE '%429%' OR erro LIKE '%quota%' OR erro LIKE '%rate%limit%' OR erro LIKE '%daily%')").run();

let emailsRodando = false;
async function processarEmails() {
  await continuarCampanhas().catch((e) => console.error('fila de campanhas:', e.message));
  const c = emailsCfg();
  if (!c.ativo || !c.desde || emailsRodando || !process.env.RESEND_API_KEY || !podeMarketing()) return;
  emailsRodando = true;
  try {
    const bonus = bonusPrimeira();
    for (const et of ETAPAS) {
      if (!c.etapas.includes(et.chave)) continue;
      // Só quem: cadastrou depois de ligar, ainda não pagou nenhuma recarga, aceita e-mails, está ativo e não é interno
      const lista = db.prepare(`SELECT u.* FROM usuarios u
        WHERE u.ativo = 1 AND u.admin = 0 AND u.interno = 0 AND u.aceita_emails = 1
          AND u.criado_em >= ? AND u.criado_em <= datetime('now', ?)
          AND u.criado_em >= datetime('now', '-30 days')
          AND NOT EXISTS (SELECT 1 FROM recargas r WHERE r.usuario_id = u.id AND r.status = 'paga')
          AND NOT EXISTS (SELECT 1 FROM emails_enviados e WHERE e.usuario_id = u.id AND e.etapa = ?)
          AND NOT EXISTS (SELECT 1 FROM emails_enviados e WHERE e.usuario_id = u.id AND e.criado_em > datetime('now', '-40 hours'))
        ORDER BY u.id LIMIT 40`).all(c.desde, `-${et.horas} hours`, et.chave);
      for (const u of lista) {
        if (!podeMarketing()) return;
        // Reserva antes de enviar: nunca manda a mesma etapa duas vezes
        if (db.prepare('INSERT OR IGNORE INTO emails_enviados (usuario_id, etapa, status) VALUES (?, ?, ?)').run(u.id, et.chave, 'enviando').changes !== 1) continue;
        try {
          const m = montarEmail({ etapa: et.chave, nome: u.nome, perfil: perfilDo(u), bonus, base: baseEmails(), sair: linkSair(u.id), podeResponder: !!process.env.EMAIL_RESPOSTA });
          await enviarEmail({ para: u.email, assunto: m.assunto, html: m.html, cabecalhos: { 'List-Unsubscribe': `<${linkSair(u.id)}>` } });
          db.prepare("UPDATE emails_enviados SET status = 'enviado' WHERE usuario_id = ? AND etapa = ?").run(u.id, et.chave);
        } catch (e) {
          console.error('e-mail automático:', e.message);
          if (ehErroCota(e)) { db.prepare('DELETE FROM emails_enviados WHERE usuario_id = ? AND etapa = ?').run(u.id, et.chave); pausarPorCota(); return; }
          db.prepare("UPDATE emails_enviados SET status = 'erro', erro = ? WHERE usuario_id = ? AND etapa = ?").run(String(e.message).slice(0, 300), u.id, et.chave);
        }
        await new Promise((r) => setTimeout(r, 700)); // ritmo suave para o provedor de e-mail
      }
    }
  } finally { emailsRodando = false; }
}
setInterval(() => processarEmails().catch((e) => console.error('e-mails:', e.message)), 20 * 60 * 1000).unref();
setTimeout(() => processarEmails().catch((e) => console.error('e-mails:', e.message)), 60 * 1000).unref();

// Descadastro em um clique (link no rodapé de cada e-mail)
rota('GET', '/emails/sair', ({ res, url }) => {
  const uid = Number(url.searchParams.get('u'));
  const ok = uid && url.searchParams.get('t') === assinaturaSair(uid);
  if (ok) db.prepare('UPDATE usuarios SET aceita_emails = 0 WHERE id = ?').run(uid);
  pagina(res, 'E-mails', P.paginaEmBreve(ok ? 'Pronto, você não vai mais receber estes e-mails' : 'Link inválido',
    ok ? 'Sua conta continua ativa normalmente. Avisos importantes (como recuperação de senha) continuam chegando.' : 'Abra o link direto do e-mail que você recebeu.'), null, ok ? 200 : 400);
});

const dadosRecarga = (usuario) => ({ minimo: Number(lerConfig('recarga_minima_centavos')), faixas: faixasBonus(),
  primeira: bonusPrimeira().ativo && ehPrimeiraRecarga(usuario.id) ? bonusPrimeira() : null, pedirDocumento: !usuario.documento });
rota('GET', '/recarregar', exigeLogin(({ res, usuario }) => pagina(res, 'Recarregar', PA.paginaRecarregar(dadosRecarga(usuario)), usuario)));

rota('POST', '/recarregar', exigeLogin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const minimo = Number(lerConfig('recarga_minima_centavos'));
  const valor = String(f.outro || '').trim() ? centavos(f.outro) : centavos(f.valor);
  const erro = (m) => pagina(res, 'Recarregar', PA.paginaRecarregar({ ...dadosRecarga(usuario), erro: m }), usuario, 400);
  // CPF/CNPJ é pedido só na primeira recarga (exigido pelo pagamento)
  if (!usuario.documento) {
    const doc = A.soNumeros(f.documento);
    if (!A.documentoValido(doc)) return erro('Informe um CPF ou CNPJ válido para emitir o Pix.');
    db.prepare('UPDATE usuarios SET documento = ? WHERE id = ?').run(doc, usuario.id);
    usuario.documento = doc;
  }
  if (!Number.isFinite(valor)) return erro('Valor inválido. Digite só o valor em reais, por exemplo: 50 ou 50,00.');
  if (valor < minimo) return erro(`O valor mínimo de recarga é ${P.reais(minimo)}.`);
  if (valor > valorMaximo()) return erro(`O valor máximo por recarga é ${P.reais(valorMaximo())}. Confira se digitou o valor certo.`);
  // Valor alto: o cliente confirma antes de gerar o Pix (evita erro de digitação)
  if (valor > VALOR_CONFIRMAR && f.confirmado !== String(valor)) {
    return pagina(res, 'Confirmar recarga', `<div class="cartao estreito" style="max-width:520px;text-align:center">
      <h1 style="font-size:1.5rem">Confirma a recarga de ${P.reais(valor)}?</h1>
      <p class="muted">Esse valor fica como saldo para consultas e não pode ser sacado.</p>
      <form method="post" action="/recarregar" style="margin-top:18px"><input type="hidden" name="outro" value="${(valor / 100).toFixed(2).replace('.', ',')}"><input type="hidden" name="confirmado" value="${valor}">
        <button class="btn" type="submit">Sim, gerar Pix de ${P.reais(valor)}</button></form>
      <p style="margin-top:14px"><a href="/recarregar">Não, quero mudar o valor</a></p></div>`, usuario);
  }
  // Já existe um Pix em aberto com o mesmo valor (últimas 2 h): reaproveita em vez de criar outra cobrança
  const aberta = db.prepare("SELECT id FROM recargas WHERE usuario_id = ? AND status = 'pendente' AND valor_centavos = ? AND asaas_id IS NOT NULL AND criado_em > datetime('now', '-2 hours') ORDER BY id DESC").get(usuario.id, valor);
  if (aberta) return redirecionar(res, `/recarga/${aberta.id}`);
  if (db.prepare("SELECT COUNT(*) n FROM recargas WHERE usuario_id = ? AND status = 'pendente' AND criado_em > datetime('now', '-24 hours')").get(usuario.id).n >= 3)
    return erro('Você já tem 3 Pix em aberto. Pague um deles (veja no Painel) ou aguarde: Pix não pagos expiram em 48 horas.');
  if (!A.limitar(`rec:${usuario.id}`, 10, 60)) return erro('Muitas recargas geradas em pouco tempo. Aguarde alguns minutos.');
  try {
    let clienteId = db.prepare('SELECT asaas_cliente_id FROM usuarios WHERE id = ?').get(usuario.id).asaas_cliente_id;
    if (!clienteId) {
      clienteId = (await AS.criarCliente(usuario)).id;
      db.prepare('UPDATE usuarios SET asaas_cliente_id = ? WHERE id = ?').run(clienteId, usuario.id);
    }
    const bonus = bonusPara(valor, usuario.id);
    const rid = Number(db.prepare('INSERT INTO recargas (usuario_id, valor_centavos, bonus_centavos) VALUES (?, ?, ?)').run(usuario.id, valor, bonus).lastInsertRowid);
    const cob = await AS.criarCobranca({ clienteId, valorCentavos: valor, recargaId: rid });
    let pix = null;
    try { pix = await AS.pixQrCode(cob.id); } catch (e) { console.warn('Pix indisponível:', e.message); }
    db.prepare('UPDATE recargas SET asaas_id = ?, pix_codigo = ?, pix_imagem = ?, link_pagamento = ? WHERE id = ?')
      .run(cob.id, pix?.payload || null, pix?.encodedImage || null, cob.invoiceUrl || null, rid);
    redirecionar(res, `/recarga/${rid}`);
  } catch (e) {
    console.error('recarga:', e.message);
    erro('Não foi possível gerar o Pix agora. Tente de novo em instantes.');
  }
}));

rota('GET', '/recarga/:id', exigeLogin(({ res, usuario, params }) => {
  const r = db.prepare('SELECT * FROM recargas WHERE id = ? AND usuario_id = ?').get(Number(params.id), usuario.id);
  if (!r) return redirecionar(res, '/recarregar');
  if (r.status === 'paga') return redirecionar(res, '/painel');
  if (r.status === 'expirada') return pagina(res, 'Recarregar', PA.paginaRecarregar({ ...dadosRecarga(usuario), erro: 'Esse Pix expirou sem pagamento e foi cancelado. Gere um novo abaixo.' }), usuario);
  pagina(res, 'Pagar recarga', PA.paginaPagarRecarga({ r }), usuario);
}));

rota('GET', '/api/recarga/:id/status', async ({ res, usuario, params }) => {
  if (!usuario) return json(res, { pago: false }, 401);
  const r = db.prepare('SELECT * FROM recargas WHERE id = ? AND usuario_id = ?').get(Number(params.id), usuario.id);
  if (!r) return json(res, { pago: false }, 404);
  if (r.status === 'paga') return json(res, { pago: true, valor: r.valor_centavos / 100, eid: `rec-${r.id}` });
  if (r.asaas_id && A.limitar(`st:${r.id}`, 30, 5)) {
    try {
      const c = await AS.buscarCobranca(r.asaas_id);
      if (AS.STATUS_PAGO.includes(c.status)) { if (creditarRecarga(r.id)) processarRepasse().catch((e) => console.error('repasse:', e.message)); return json(res, { pago: true, valor: r.valor_centavos / 100, eid: `rec-${r.id}` }); }
    } catch (e) { console.warn('status recarga:', e.message); }
  }
  json(res, { pago: false });
});

// Aviso do Asaas (mesma conta do site da Soft Crédito: aqui só tratamos recargas "screc_")
rota('POST', '/webhook/asaas', async ({ req, res }) => {
  if (!process.env.ASAAS_WEBHOOK_TOKEN || req.headers['asaas-access-token'] !== process.env.ASAAS_WEBHOOK_TOKEN) return json(res, { ok: false }, 401);
  const corpo = await corpoJson(req);
  json(res, { ok: true });
  const { event, payment } = corpo || {};
  if (String(event || '').startsWith('RECEIVABLE_ANTICIPATION_') && corpo.anticipation?.id) {
    const ant = corpo.anticipation;
    const p = db.prepare('SELECT id, antecipacao_status FROM limpa_nome_pedidos WHERE antecipacao_id = ?').get(ant.id);
    if (p && ant.status && ant.status !== p.antecipacao_status) {
      db.prepare('UPDATE limpa_nome_pedidos SET antecipacao_status = ? WHERE id = ?').run(ant.status, p.id);
      registrar(null, 'Limpa Nome: antecipação atualizada', `#${p.id} · ${p.antecipacao_status} → ${ant.status}`);
      if (ant.status === 'CREDITED') processarRepasses().catch((e) => console.error('repasses:', e.message));
    }
    return;
  }
  const ref = String(payment?.externalReference || '');
  // Mensalidade dos parceiros (assinatura)
  if (payment?.subscription || ref.startsWith(AS.PREFIXO_PARCEIRO)) { try { if (webhookParceiro(event, payment)) return; } catch (e) { console.error('webhook parceiro:', e.message); return; } }
  // Assinaturas do monitoramento (inclui PAYMENT_CREATED para avisar a renovação no Pix)
  if (payment?.subscription || ref.startsWith(AS.PREFIXO_MONITORAMENTO)) { try { if (webhookMonitoramento(event, payment)) return; } catch (e) { console.error('webhook monitoramento:', e.message); return; } }
  if (!['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(event)) return;
  if (ref.startsWith(AS.PREFIXO_ADESAO)) {
    const a = db.prepare('SELECT * FROM parceiro_adesoes WHERE id = ?').get(Number(ref.slice(AS.PREFIXO_ADESAO.length)));
    const confere = a && (a.asaas_parcelamento ? (payment.installment === a.asaas_parcelamento || payment.id === a.asaas_id) : (payment.id === a.asaas_id && Math.round(Number(payment.value) * 100) >= a.valor_centavos));
    if (confere) { try { confirmarAdesao(a.id); } catch (e) { console.error('adesão:', e.message); } }
    return;
  }
  if (ref.startsWith(AS.PREFIXO_RAIOX)) {
    const p = db.prepare('SELECT * FROM raiox_pedidos WHERE id = ?').get(Number(ref.slice(AS.PREFIXO_RAIOX.length)));
    if (p && p.asaas_id === payment.id && Math.round(Number(payment.value) * 100) >= p.valor_centavos) { try { confirmarRaioX(p.id); } catch (e) { console.error('raio-x:', e.message); } }
    return;
  }
  if (ref.startsWith(AS.PREFIXO_DIGITAL)) {
    const c = db.prepare('SELECT * FROM compras_digitais WHERE id = ?').get(Number(ref.slice(AS.PREFIXO_DIGITAL.length)));
    if (c && c.asaas_id === payment.id && Math.round(Number(payment.value) * 100) >= c.valor_centavos) { try { confirmarCompraDigital(c.id); } catch (e) { console.error('ebook:', e.message); } }
    return;
  }
  if (ref.startsWith(AS.PREFIXO_LIMPA_NOME)) {
    const p = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE id = ?').get(Number(ref.slice(AS.PREFIXO_LIMPA_NOME.length)));
    if (!p) return;
    const confere = p.asaas_parcelamento ? (payment.installment === p.asaas_parcelamento || payment.id === p.asaas_id) : (payment.id === p.asaas_id && Math.round(Number(payment.value) * 100) >= p.valor_centavos);
    if (confere) { try { confirmarPedidoLN(p.id); } catch (e) { console.error('pedido limpa nome:', e.message); } }
    return;
  }
  if (!ref.startsWith(AS.PREFIXO)) return;
  const rid = Number(ref.slice(AS.PREFIXO.length));
  const r = db.prepare('SELECT * FROM recargas WHERE id = ?').get(rid);
  if (!r || r.asaas_id !== payment.id || Math.round(Number(payment.value) * 100) < r.valor_centavos) return;
  try { if (creditarRecarga(rid)) processarRepasse().catch((e) => console.error('repasse:', e.message)); } catch (e) { console.error('crédito recarga:', e.message); }
});

// Admin enxerga (e usa) o saldo real da APIFull; clientes, a carteira interna
const saldoExibido = async (usuario) => (usuario.interno ? await saldoApiFull() : saldoCentavos(usuario.id));

// ======================= RETENÇÃO DO HISTÓRICO =======================
const diasHistorico = () => Math.max(1, Number(lerConfig('dias_historico') || 10));
const expirou = (c) => c.status === 'concluida' && !c.resultado;
// Pix não pagos: depois de 48 h (recarga) ou 3 dias (Limpa Nome) a cobrança é cancelada no Asaas, para não ficar fatura em aberto.
// Antes de cancelar, confere se foi paga (aí credita normalmente).
async function expirarCobrancasAbertas() {
  const recs = db.prepare("SELECT * FROM recargas WHERE status = 'pendente' AND criado_em < datetime('now', '-48 hours') ORDER BY id LIMIT 50").all();
  for (const r of recs) {
    try {
      if (r.asaas_id) {
        const c = await AS.buscarCobranca(r.asaas_id).catch(() => null);
        if (c && AS.STATUS_PAGO.includes(c.status)) { if (creditarRecarga(r.id)) processarRepasse().catch(() => {}); continue; }
        if (c && !c.deleted && c.status === 'PENDING') await AS.cancelarCobranca(r.asaas_id);
      }
      db.prepare("UPDATE recargas SET status = 'expirada' WHERE id = ? AND status = 'pendente'").run(r.id);
    } catch (e) { console.warn('expirar recarga', r.id, e.message); }
  }
  const peds = db.prepare("SELECT * FROM limpa_nome_pedidos WHERE status = 'aguardando_pagamento' AND ((parceiro_id IS NULL AND criado_em < datetime('now', '-3 days')) OR (parceiro_id IS NOT NULL AND COALESCE(atualizado_em, criado_em) < datetime('now', '-7 days'))) ORDER BY id LIMIT 50").all();
  for (const p of peds) {
    try {
      if (p.asaas_id) {
        const c = await AS.buscarCobranca(p.asaas_id).catch(() => null);
        if (c && AS.STATUS_PAGO.includes(c.status)) { confirmarPedidoLN(p.id); continue; }
        if (c && !c.deleted && c.status === 'PENDING') await AS.cancelarCobranca(p.asaas_id);
      }
      db.prepare("UPDATE limpa_nome_pedidos SET status = 'cancelado', obs_admin = 'Pagamento não realizado no prazo', atualizado_em = datetime('now') WHERE id = ? AND status = 'aguardando_pagamento'").run(p.id);
    } catch (e) { console.warn('expirar pedido LN', p.id, e.message); }
  }
  for (const c of db.prepare("SELECT * FROM raiox_pedidos WHERE status = 'pendente' AND criado_em < datetime('now', '-48 hours') LIMIT 50").all()) {
    try {
      if (c.asaas_id) {
        const cob = await AS.buscarCobranca(c.asaas_id).catch(() => null);
        if (cob && AS.STATUS_PAGO.includes(cob.status)) { confirmarRaioX(c.id); continue; }
        if (cob && !cob.deleted && cob.status === 'PENDING') await AS.cancelarCobranca(c.asaas_id);
      }
      db.prepare("UPDATE raiox_pedidos SET status = 'expirada' WHERE id = ? AND status = 'pendente'").run(c.id);
    } catch (e) { console.warn('expirar raio-x', c.id, e.message); }
  }
  for (const c of db.prepare("SELECT * FROM compras_digitais WHERE status = 'pendente' AND criado_em < datetime('now', '-48 hours') LIMIT 50").all()) {
    try {
      if (c.asaas_id) {
        const cob = await AS.buscarCobranca(c.asaas_id).catch(() => null);
        if (cob && AS.STATUS_PAGO.includes(cob.status)) { confirmarCompraDigital(c.id); continue; }
        if (cob && !cob.deleted && cob.status === 'PENDING') await AS.cancelarCobranca(c.asaas_id);
      }
      db.prepare("UPDATE compras_digitais SET status = 'expirada' WHERE id = ? AND status = 'pendente'").run(c.id);
    } catch (e) { console.warn('expirar compra', c.id, e.message); }
  }
  const mons = db.prepare("SELECT * FROM monitoramentos WHERE status = 'aguardando' AND criado_em < datetime('now', '-3 days') LIMIT 50").all();
  for (const m of mons) {
    try {
      if (m.asaas_sub_id) {
        const pago = (await AS.pagamentosAssinatura(m.asaas_sub_id).catch(() => null))?.data?.find((p) => AS.STATUS_PAGO.includes(p.status));
        if (pago) { confirmarPagamentoMon(m, pago.id); continue; }
        await AS.cancelarAssinatura(m.asaas_sub_id).catch(() => {});
      }
      db.prepare("UPDATE monitoramentos SET status = 'cancelado', cancelado_em = datetime('now') WHERE id = ? AND status = 'aguardando'").run(m.id);
    } catch (e) { console.warn('expirar monitoramento', m.id, e.message); }
  }
  if (recs.length || peds.length) registrar(null, 'Cobranças em aberto expiradas', `${recs.length} recarga(s) e ${peds.length} pedido(s) de Limpa Nome sem pagamento`);
}
async function limparExpiradas() {
  // Consultas que ficaram "processando" (queda ou reinício do servidor no meio): marca como falha e devolve o valor
  const travadas = db.prepare(`SELECT c.id, c.usuario_id, c.produto, c.preco_centavos, u.interno FROM consultas c JOIN usuarios u ON u.id = c.usuario_id
    WHERE c.status = 'processando' AND c.criado_em < datetime('now', '-30 minutes')`).all();
  for (const c of travadas) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare("UPDATE consultas SET status = 'falhou', erro = 'Interrompida (servidor reiniciado). Valor estornado.', custo_centavos = 0, comissao_centavos = 0 WHERE id = ? AND status = 'processando'").run(c.id).changes === 1 && !c.interno) {
        db.prepare("INSERT OR IGNORE INTO transacoes (usuario_id, tipo, valor_centavos, descricao, referencia) VALUES (?, 'estorno', ?, ?, ?)")
          .run(c.usuario_id, c.preco_centavos, `Estorno: ${c.produto}`, `est_${c.id}`);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); console.error('estorno travada:', e.message); }
  }
  if (travadas.length) console.log(`Consultas interrompidas estornadas: ${travadas.length}`);
  await expirarCobrancasAbertas().catch((e) => console.error('expirar cobranças:', e.message));
  const dias = diasHistorico();
  // Relatórios do monitoramento ficam até a checagem seguinte (35 dias); as demais consultas seguem o prazo configurado
  const lista = db.prepare(`SELECT id FROM consultas WHERE status = 'concluida' AND resultado IS NOT NULL AND (
    (produto NOT LIKE 'Monitoramento ·%' AND criado_em < datetime('now', ?)) OR (produto LIKE 'Monitoramento ·%' AND criado_em < datetime('now', '-35 days')))`).all(`-${dias} days`);
  for (const { id } of lista) {
    db.prepare('UPDATE consultas SET resultado = NULL, pdf_origem = NULL WHERE id = ?').run(id);
    await unlink(path.join(pastaPdfs, `${id}.pdf`)).catch(() => {});
  }
  if (lista.length) console.log(`Histórico: ${lista.length} consulta(s) expirada(s) e removida(s).`);
}
setTimeout(() => limparExpiradas().catch((e) => console.error('limpeza:', e.message)), 10000).unref();
setInterval(() => limparExpiradas().catch((e) => console.error('limpeza:', e.message)), 60 * 60 * 1000).unref();

// ======================= CONSULTAS =======================
const produtosAtivos = () => db.prepare("SELECT * FROM produtos WHERE ativo = 1 AND endpoint <> '' ORDER BY ordem, nome").all();
// Administrador consulta a preço de custo (sem margem)
// Indicado paga o preço normal + a comissão escolhida pelo indicador (a nossa margem não muda)
function comissaoDoIndicador(usuario) {
  if (!usuario?.indicado_por || usuario.interno) return null;
  const ind = db.prepare('SELECT id, comissao_percentual FROM usuarios WHERE id = ? AND ativo = 1').get(usuario.indicado_por);
  if (!ind || ind.id === usuario.id) return null;
  const max = Number(lerConfig('comissao_maxima') ?? 100);
  return { id: ind.id, pct: Math.max(0, Math.min(max, Number(ind.comissao_percentual) || 0)) };
}
const produtosPara = (usuario) => {
  const ind = comissaoDoIndicador(usuario);
  return produtosAtivos().map((p) => {
    if (usuario?.interno) return { ...p, preco_centavos: p.custo_centavos, precoCusto: true, comissao_centavos: 0, indicador_id: null };
    const com = ind ? Math.round((p.preco_centavos * ind.pct) / 100) : 0;
    return { ...p, preco_base: p.preco_centavos, preco_centavos: p.preco_centavos + com, comissao_centavos: com, indicador_id: com > 0 ? ind.id : null };
  });
};
const PLACA = /^[A-Z]{3}\d[A-Z0-9]\d{2}$/;
const PALAVRAS_SENSIVEIS = /mandado|antecedente|pessoas relacionadas|endere[cç]|telefone|celular|cpf completo|e-?mail|parente|grafo|contato|localiza|ve[ií]culos por cpf|radar|rastreamento/i;
// Pode fazer consultas sensíveis? Empresas (CNPJ) e admin sim; pessoa física só com liberação do admin
const podeSensivel = (u) => !!(u?.admin || u?.interno || u?.liberado_sensivel || String(u?.documento || '').length === 14);
function validarValor(tipo, bruto) {
  if (tipo === 'placa') {
    const v = String(bruto || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return PLACA.test(v) ? { v } : { erro: 'Placa inválida. Use o formato ABC1234 ou ABC1D23.' };
  }
  const v = A.soNumeros(bruto);
  if (tipo === 'cep') return /^\d{8}$/.test(v) && !/^0{8}$/.test(v) ? { v } : { erro: 'CEP inválido. Informe os 8 números.' };
  if (tipo === 'cpf' && !(v.length === 11 && A.cpfValido(v))) return { erro: 'CPF inválido.' };
  if (tipo === 'cnpj' && !(v.length === 14 && A.cnpjValido(v))) return { erro: 'CNPJ inválido.' };
  if (tipo === 'cpf_cnpj' && !A.documentoValido(v)) return { erro: 'CPF ou CNPJ inválido.' };
  return { v };
}

rota('GET', '/consultas', exigeLogin(async ({ res, usuario, url }) => {
  // compatibilidade com links antigos ?categoria=
  const cat = url.searchParams.get('categoria');
  if (cat) return redirecionar(res, `/consultas/categoria/${PA.slugCategoria(cat)}`);
  pagina(res, 'Consultas', PA.paginaCategorias({ produtos: produtosPara(usuario), saldo: await saldoExibido(usuario), busca: url.searchParams.get('busca') || '' }), usuario);
}));

rota('GET', '/consultas/categoria/:cat', exigeLogin(async ({ res, usuario, url, params }) => {
  const todos = produtosPara(usuario);
  const produtos = todos.filter((p) => PA.slugCategoria(p.categoria) === params.cat);
  if (!produtos.length) return redirecionar(res, '/consultas');
  pagina(res, produtos[0].categoria, PA.paginaCategoria({ categoria: produtos[0].categoria, produtos, saldo: await saldoExibido(usuario), busca: url.searchParams.get('busca') || '' }), usuario);
}));

rota('GET', '/consultas/:slug', exigeLogin(async ({ res, usuario, params }) => {
  const produto = produtosPara(usuario).find((p) => p.slug === params.slug);
  if (!produto) return redirecionar(res, '/consultas');
  pagina(res, produto.nome, PA.paginaConsultar({ produto, saldo: await saldoExibido(usuario), admin: !!usuario.interno, bloqueada: produto.sensivel && !podeSensivel(usuario) }), usuario);
}));

rota('POST', '/consultas/:slug', exigeLogin(async ({ req, res, usuario, params }) => {
  const produto = produtosPara(usuario).find((p) => p.slug === params.slug);
  if (!produto) return redirecionar(res, '/consultas');
  const f = await corpoForm(req);
  const v = { valor: f.valor, finalidade: f.finalidade };
  const erro = async (m) => pagina(res, produto.nome, PA.paginaConsultar({ produto, saldo: await saldoExibido(usuario), admin: !!usuario.interno, erro: m, v }), usuario, 400);
  if (lerConfig('consultas_pausadas') === '1' && !usuario.admin) return erro('As consultas estão temporariamente em manutenção. Seu saldo está preservado. Tente novamente em alguns minutos.');
  if (produto.sensivel && !podeSensivel(usuario)) return erro('Esta consulta contém dados sensíveis e precisa de liberação. Fale com o suporte.');
  const val = validarValor(produto.documento, f.valor);
  if (val.erro) return erro(val.erro);
  if (f.aceite !== '1') return erro('Marque a confirmação da LGPD e dos Termos de Uso para continuar.');
  // Finalidade: agora uma única declaração (o histórico guarda o aceite)
  f.finalidade = 'Declaração LGPD e Termos aceitos';
  if (!A.limitar(`con:${usuario.id}`, 30, 10)) return erro('Muitas consultas em pouco tempo. Aguarde alguns minutos.');

  // Reserva o valor (bloco síncrono: sem risco de gastar o mesmo saldo duas vezes)
  let cid;
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!usuario.interno && saldoCentavos(usuario.id) < produto.preco_centavos) { db.exec('ROLLBACK'); return erro('Saldo insuficiente. Faça uma recarga para continuar.'); }
    cid = Number(db.prepare(`INSERT INTO consultas (usuario_id, produto_id, produto, parametro, finalidade, status, preco_centavos, custo_centavos, indicador_id, comissao_centavos)
      VALUES (?, ?, ?, ?, ?, 'processando', ?, ?, ?, ?)`).run(usuario.id, produto.id, produto.nome, val.v, f.finalidade, produto.preco_centavos, produto.custo_centavos, produto.indicador_id, produto.comissao_centavos).lastInsertRowid);
    // Admin consulta direto no saldo da APIFull: nada é descontado da carteira interna
    if (!usuario.interno) {
      db.prepare("INSERT INTO transacoes (usuario_id, tipo, valor_centavos, descricao, referencia) VALUES (?, 'consulta', ?, ?, ?)")
        .run(usuario.id, -produto.preco_centavos, `Consulta: ${produto.nome}`, `con_${cid}`);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  try {
    const dados = await consultarApiFull(produto, val.v);
    const a = analisar(dados);
    // Não guardamos o PDF embutido no banco (só o link); a cópia vai para o disco
    const origemBanco = a.pdfOrigem && !a.pdfOrigem.startsWith('base64:') ? a.pdfOrigem : null;
    if (dados?.aux && a.pdfOrigem?.startsWith('base64:')) dados.aux = { type: 'pdf', data: '(salvo em arquivo)' };
    db.prepare("UPDATE consultas SET status = 'concluida', resultado = ?, pdf_origem = ? WHERE id = ?").run(JSON.stringify(dados), origemBanco, cid);
    // Guarda uma cópia do PDF original da fonte (o link externo pode expirar)
    // Comissão do indicador (só em consulta concluída)
    if (produto.indicador_id && produto.comissao_centavos > 0) {
      db.prepare("INSERT OR IGNORE INTO comissoes (usuario_id, tipo, valor_centavos, descricao, referencia) VALUES (?, 'comissao', ?, ?, ?)")
        .run(produto.indicador_id, produto.comissao_centavos, `Comissão: ${produto.nome}`, `com_${cid}`);
    }
    const bytes = await obterPdf(a.pdfOrigem);
    if (bytes) await writeFile(path.join(pastaPdfs, `${cid}.pdf`), bytes).catch((e) => console.warn('salvar pdf:', e.message));
  } catch (e) {
    console.error('consulta falhou', cid, e.message);
    db.prepare("UPDATE consultas SET status = 'falhou', erro = ?, custo_centavos = 0, comissao_centavos = 0 WHERE id = ?").run(String(e.message).slice(0, 500), cid);
    if (!usuario.interno) {
      db.prepare("INSERT OR IGNORE INTO transacoes (usuario_id, tipo, valor_centavos, descricao, referencia) VALUES (?, 'estorno', ?, ?, ?)")
        .run(usuario.id, produto.preco_centavos, `Estorno: ${produto.nome}`, `est_${cid}`);
    }
  }
  limparCacheSaldo();
  // Consulta concluída: abre direto o PDF. Se falhou, mostra o aviso de estorno.
  const final = db.prepare('SELECT status FROM consultas WHERE id = ?').get(cid);
  redirecionar(res, final?.status === 'concluida' ? `/consulta/${cid}/pdf` : `/consulta/${cid}`);
}));

const dadosLegiveis = (dados) => dados?.dados?.data?.saida ?? dados?.dados?.data ?? dados?.dados ?? {};
const consultaDo = (id, usuario) => db.prepare(`SELECT * FROM consultas WHERE id = ? ${usuario.admin ? '' : 'AND usuario_id = ?'}`)
  .get(...(usuario.admin ? [Number(id)] : [Number(id), usuario.id]));

rota('GET', '/consulta/:id', exigeLogin(({ res, usuario, params }) => {
  const c = consultaDo(params.id, usuario);
  if (!c) return redirecionar(res, '/historico');
  if (expirou(c)) return pagina(res, `Consulta #${c.id}`, P.paginaEmBreve('Consulta expirada', `O resultado desta consulta ficou disponível por ${diasHistorico()} dias e já foi removido, conforme nossa política de privacidade. Se precisar, faça uma nova consulta.`), usuario);
  const dados = c.resultado ? JSON.parse(c.resultado) : {};
  const a = analisar(dados);
  pagina(res, `Consulta #${c.id}`, PA.paginaResultado({ c, a, linhas: achatar(dadosLegiveis(dados)) }), usuario);
}));

rota('GET', '/consulta/:id/pdf', exigeLogin(async ({ res, usuario, params, url }) => {
  const c = consultaDo(params.id, usuario);
  if (!c || c.status !== 'concluida' || expirou(c)) return redirecionar(res, c ? `/consulta/${c.id}` : '/historico');
  const nome = `consulta-${c.id}.pdf`;
  const arquivo = path.join(pastaPdfs, `${c.id}.pdf`);
  let bytes = null;
  // 1) cópia salva no disco  2) link da fonte (e salva a cópia)  3) PDF simples com os dados
  try { await access(arquivo); bytes = await readFile(arquivo); } catch {}
  if (!bytes && c.pdf_origem) {
    bytes = await obterPdf(c.pdf_origem);
    if (bytes) await writeFile(arquivo, bytes).catch(() => {});
  }
  if (!bytes) {
    const dados = JSON.parse(c.resultado || '{}');
    bytes = await pdfGenerico({ id: c.id, produto: c.produto, parametro: c.parametro, dataHora: P.dt(c.criado_em) }, achatar(dadosLegiveis(dados)));
  }
  const modo = url.searchParams.get('baixar') ? 'attachment' : 'inline';
  res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `${modo}; filename="${nome}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(bytes);
}));

rota('GET', '/historico', exigeLogin(({ res, usuario, url }) => {
  const busca = url.searchParams.get('busca') || '';
  const termo = `%${busca.replace(/[%_]/g, '')}%`;
  const doc = `%${A.soNumeros(busca) || '@@'}%`;
  const consultas = busca
    ? db.prepare('SELECT * FROM consultas WHERE usuario_id = ? AND (produto LIKE ? OR parametro LIKE ? OR parametro LIKE ?) ORDER BY id DESC LIMIT 200').all(usuario.id, termo, termo.toUpperCase(), doc)
    : db.prepare('SELECT * FROM consultas WHERE usuario_id = ? ORDER BY id DESC LIMIT 200').all(usuario.id);
  pagina(res, 'Histórico', (usuario.interno ? '' : `<div style="margin-bottom:18px">${P.bannerAnuncios(anunciosParaExibir(), contatoAnuncie())}</div>`) + PA.paginaHistorico({ consultas, busca, dias: diasHistorico() }), usuario);
}));

// ======================= INDICAÇÕES =======================
rota('GET', '/indicacoes', exigeLogin(({ req, res, usuario, url }) => {
  const codigo = garantirCodigo(usuario);
  const indicados = db.prepare(`SELECT u.nome, u.criado_em,
      (SELECT COUNT(*) FROM consultas c WHERE c.usuario_id = u.id AND c.status = 'concluida') AS consultas,
      (SELECT COALESCE(SUM(valor_centavos), 0) FROM comissoes k WHERE k.usuario_id = ? AND k.tipo = 'comissao' AND k.referencia IN (SELECT 'com_' || id FROM consultas WHERE usuario_id = u.id)) AS gerado
    FROM usuarios u WHERE u.indicado_por = ? ORDER BY u.id DESC LIMIT 200`).all(usuario.id, usuario.id);
  const extrato = db.prepare('SELECT * FROM comissoes WHERE usuario_id = ? ORDER BY id DESC LIMIT 50').all(usuario.id);
  const saques = db.prepare('SELECT * FROM saques WHERE usuario_id = ? ORDER BY id DESC LIMIT 20').all(usuario.id);
  const msgs = { pct: 'Comissão atualizada.', conv: 'Comissões convertidas em créditos.', saque: 'Saque solicitado. Você recebe por Pix assim que for aprovado.' };
  pagina(res, 'Indicações', PA.paginaIndicacoes({
    link: `${urlBase(req)}/?ref=${codigo}`, usuario, indicados, extrato, saques,
    saldo: saldoComissao(usuario.id), maximo: Number(lerConfig('comissao_maxima') ?? 100), minimoSaque: Number(lerConfig('saque_minimo_centavos') ?? 5000), taxaSaque: taxaSaque(),
    ok: msgs[url.searchParams.get('ok')] || '', erro: url.searchParams.get('erro') || '',
  }), usuario);
}));

rota('POST', '/indicacoes/comissao', exigeLogin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const max = Number(lerConfig('comissao_maxima') ?? 100);
  const pct = Number(String(f.percentual || '').replace(',', '.'));
  if (!Number.isFinite(pct) || pct < 0 || pct > max) return redirecionar(res, `/indicacoes?erro=${encodeURIComponent(`Escolha uma comissão entre 0% e ${max}%.`)}`);
  db.prepare('UPDATE usuarios SET comissao_percentual = ? WHERE id = ?').run(Math.round(pct), usuario.id);
  redirecionar(res, '/indicacoes?ok=pct');
}));

rota('POST', '/indicacoes/converter', exigeLogin(async ({ req, res, usuario }) => {
  await corpoForm(req);
  db.exec('BEGIN IMMEDIATE');
  try {
    const saldo = saldoComissao(usuario.id);
    if (saldo <= 0) { db.exec('ROLLBACK'); return redirecionar(res, `/indicacoes?erro=${encodeURIComponent('Você não tem comissões disponíveis.')}`); }
    const ref = `conv_${usuario.id}_${Date.now()}`;
    db.prepare("INSERT INTO comissoes (usuario_id, tipo, valor_centavos, descricao, referencia) VALUES (?, 'conversao', ?, 'Convertido em créditos', ?)").run(usuario.id, -saldo, ref);
    db.prepare("INSERT INTO transacoes (usuario_id, tipo, valor_centavos, descricao, referencia) VALUES (?, 'ajuste', ?, 'Comissões convertidas em créditos', ?)").run(usuario.id, saldo, ref);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  redirecionar(res, '/indicacoes?ok=conv');
}));

// Taxa sobre saque de comissões (%), configurável no Admin. Depósitos (recargas) nunca podem ser sacados.
const taxaSaque = () => Math.min(50, Math.max(0, Number(lerConfig('saque_taxa_percentual') ?? 5)));
rota('POST', '/indicacoes/saque', exigeLogin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const valor = centavos(f.valor);
  const chave = String(f.chave_pix || '').trim().slice(0, 140);
  const minimo = Number(lerConfig('saque_minimo_centavos') ?? 5000);
  const erro = (m) => redirecionar(res, `/indicacoes?erro=${encodeURIComponent(m)}`);
  if (!chave || chave.length < 5) return erro('Informe a sua chave Pix.');
  if (!Number.isFinite(valor) || valor < minimo) return erro(`O saque mínimo é de ${P.reais(minimo)}.`);
  if (!A.limitar(`saque:${usuario.id}`, 5, 60)) return erro('Muitas solicitações. Aguarde um pouco.');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (valor > saldoComissao(usuario.id)) { db.exec('ROLLBACK'); return erro('Valor maior que o seu saldo de comissões.'); }
    const taxa = Math.round((valor * taxaSaque()) / 100);
    const sid = Number(db.prepare('INSERT INTO saques (usuario_id, valor_centavos, chave_pix, taxa_centavos) VALUES (?, ?, ?, ?)').run(usuario.id, valor, chave, taxa).lastInsertRowid);
    db.prepare("INSERT INTO comissoes (usuario_id, tipo, valor_centavos, descricao, referencia) VALUES (?, 'saque', ?, ?, ?)").run(usuario.id, -valor, `Saque via Pix #${sid}`, `saque_${sid}`);
    db.prepare('UPDATE usuarios SET chave_pix = ? WHERE id = ?').run(chave, usuario.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  redirecionar(res, '/indicacoes?ok=saque');
}));

rota('GET', '/admin/saques', exigeAdmin(({ res, usuario, url }) => pagina(res, 'Admin · Saques', PD.adminSaques({
  saques: db.prepare('SELECT s.*, u.nome, u.email, u.documento FROM saques s JOIN usuarios u ON u.id = s.usuario_id ORDER BY (s.status = \'pendente\') DESC, s.id DESC LIMIT 300').all(),
  ok: url.searchParams.get('ok') ? 'Saque atualizado.' : '', erro: url.searchParams.get('erro') || '',
}), usuario)));

const saquesEmAndamento = new Set();
rota('POST', '/admin/saques/resolver', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const s = db.prepare("SELECT * FROM saques WHERE id = ? AND status = 'pendente'").get(Number(f.id));
  if (!s) return redirecionar(res, '/admin/saques');
  // Trava: o mesmo saque não pode ser processado duas vezes ao mesmo tempo (clique duplo, duas abas, dois admins)
  if (saquesEmAndamento.has(s.id)) return redirecionar(res, `/admin/saques?erro=${encodeURIComponent('Este saque já está sendo processado. Aguarde e atualize a página.')}`);
  saquesEmAndamento.add(s.id);
  try {
  // Pagar automaticamente pelo Asaas (Pix sai da conta Asaas para a chave do usuário)
  if (f.acao === 'asaas') {
    try {
      const liquido = s.valor_centavos - (s.taxa_centavos || 0);
      const t = await AS.transferirPix({ valorCentavos: liquido, chave: s.chave_pix, descricao: `Saque de comissão Soft Consultas #${s.id}` });
      db.prepare("UPDATE saques SET status = 'pago', resolvido_em = datetime('now'), observacao = ?, asaas_transferencia_id = ? WHERE id = ? AND status = 'pendente'")
        .run(`Pix pelo Asaas (${t.status || 'enviado'})`, t.id || null, s.id);
      registrar(usuario, 'Pagou saque pelo Asaas', `Saque #${s.id} de ${P.reais(s.valor_centavos)} (Pix de ${P.reais(liquido)}, taxa ${P.reais(s.taxa_centavos || 0)}) para ${s.chave_pix} · transferência ${t.id || '-'} (${t.status || '-'})`);
      return redirecionar(res, '/admin/saques?ok=1');
    } catch (e) {
      console.error('transferência asaas:', e.message);
      return redirecionar(res, `/admin/saques?erro=${encodeURIComponent(`Não foi possível pagar pelo Asaas: ${e.message}`)}`);
    }
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    if (f.acao === 'pagar') {
      if (db.prepare("UPDATE saques SET status = 'pago', resolvido_em = datetime('now'), observacao = ? WHERE id = ? AND status = 'pendente'").run(String(f.obs || '').slice(0, 200), s.id).changes !== 1) { db.exec('ROLLBACK'); return redirecionar(res, '/admin/saques'); }
    } else {
      if (db.prepare("UPDATE saques SET status = 'recusado', resolvido_em = datetime('now'), observacao = ? WHERE id = ? AND status = 'pendente'").run(String(f.obs || '').slice(0, 200), s.id).changes !== 1) { db.exec('ROLLBACK'); return redirecionar(res, '/admin/saques'); }
      db.prepare("INSERT OR IGNORE INTO comissoes (usuario_id, tipo, valor_centavos, descricao, referencia) VALUES (?, 'estorno_saque', ?, ?, ?)")
        .run(s.usuario_id, s.valor_centavos, `Saque #${s.id} recusado: valor devolvido`, `estsaque_${s.id}`);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  registrar(usuario, f.acao === 'pagar' ? 'Marcou saque como pago' : 'Recusou saque', `Saque #${s.id} de ${P.reais(s.valor_centavos)} para a chave ${s.chave_pix}${f.obs ? ` (${String(f.obs).slice(0, 200)})` : ''}`);
  redirecionar(res, '/admin/saques?ok=1');
  } finally { saquesEmAndamento.delete(s.id); }
}));


// ======================= OPERAÇÃO (aviso geral, pausa e repasse APIFull) =======================
rota('GET', '/admin/operacao', exigeAdmin(async ({ res, usuario, url }) => {
  let saldoAsaas = null;
  try { saldoAsaas = Math.round(Number((await AS.saldoConta()).balance) * 100); } catch (e) { console.warn('saldo Asaas:', e.message); }
  pagina(res, 'Admin · Operação', PD.adminOperacao({
    aviso: lerConfig('aviso_geral') || '', pausadas: lerConfig('consultas_pausadas') === '1', repasse: repasseCfg(), acumulado: repasseAcumulado(),
    repasses: db.prepare('SELECT * FROM repasses_apifull ORDER BY id DESC LIMIT 100').all(), saldoApiFull: await saldoApiFull(), saldoAsaas,
    emails: { ...emailsCfg(), etapasLista: ETAPAS, limite: limiteDiarioEmails(), hoje: marketingHoje(), pausaAte: emailsPausados() ? lerConfig('emails_pausa_ate') : '',
      fila: filaCampanhas().map((x) => ({ ...x, nome: CAMPANHAS[x.chave]?.nome || x.chave, faltam: CAMPANHAS[x.chave] && PUBLICOS_CAMPANHA[x.publico] ? listaCampanha(x.chave, x.publico).length : 0 })), perfis: PERFIS, temChave: !!process.env.RESEND_API_KEY,
      enviados: db.prepare("SELECT etapa, status, COUNT(*) n FROM emails_enviados GROUP BY etapa, status").all(),
      descadastrados: db.prepare('SELECT COUNT(*) n FROM usuarios WHERE aceita_emails = 0').get().n,
      campanhas: Object.entries(CAMPANHAS).map(([k, c]) => ({ chave: k, nome: c.nome, rodando: campanhaRodando.has(k),
        semanal: !!c.semanal, lote: c.semanal ? proximoLoteLN() : null,
        enviados: db.prepare("SELECT COUNT(*) n FROM emails_enviados WHERE (etapa = ? OR etapa LIKE ?) AND status = 'enviado'").get(`camp:${k}`, `camp:${k}:%`).n,
        enviadosSemana: c.semanal ? db.prepare("SELECT COUNT(*) n FROM emails_enviados WHERE etapa = ? AND status = 'enviado'").get(etapaCampanha(k)).n : null,
        erros: db.prepare("SELECT COUNT(*) n FROM emails_enviados WHERE (etapa = ? OR etapa LIKE ?) AND status = 'erro'").get(`camp:${k}`, `camp:${k}:%`).n,
        pendentes: Object.fromEntries(Object.keys(PUBLICOS_CAMPANHA).map((p) => [p, listaCampanha(k, p).length])),
        consultaram: c.produto
          ? db.prepare(`SELECT COUNT(DISTINCT e.usuario_id) n FROM emails_enviados e JOIN consultas c ON c.usuario_id = e.usuario_id AND c.status = 'concluida' AND c.criado_em > e.criado_em AND c.produto_id = (SELECT id FROM produtos WHERE slug = ?) WHERE e.etapa = ? AND e.status = 'enviado'`).get(c.produto, `camp:${k}`).n
          : c.promo ? db.prepare(`SELECT COUNT(DISTINCT e.usuario_id) n FROM emails_enviados e JOIN consultas c ON c.usuario_id = e.usuario_id AND c.status = 'concluida' AND c.criado_em > e.criado_em WHERE e.etapa = ? AND e.status = 'enviado'`).get(`camp:${k}`).n
          : db.prepare(`SELECT COUNT(DISTINCT e.usuario_id) n FROM emails_enviados e JOIN limpa_nome_pedidos lp ON lp.usuario_id = e.usuario_id AND lp.pago_em > e.criado_em WHERE e.etapa LIKE ? AND e.status = 'enviado'`).get(`camp:${k}:%`).n })),
      publicosCampanha: Object.fromEntries(Object.entries(PUBLICOS_CAMPANHA).map(([k, v]) => [k, v.nome])),
      recargasDepois: db.prepare(`SELECT COUNT(DISTINCT e.usuario_id) n FROM emails_enviados e JOIN recargas r ON r.usuario_id = e.usuario_id AND r.status = 'paga' AND r.pago_em > e.criado_em WHERE e.status = 'enviado'`).get().n },
    ok: url.searchParams.get('ok') || '', erro: url.searchParams.get('erro') || '',
  }), usuario);
}));

rota('POST', '/admin/operacao/aviso', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const texto = String(f.aviso || '').trim().slice(0, 300);
  const pausar = f.pausadas === '1' ? '1' : '0';
  const antes = lerConfig('consultas_pausadas');
  gravarConfig('aviso_geral', texto);
  gravarConfig('consultas_pausadas', pausar);
  registrar(usuario, 'Alterou aviso/pausa', `aviso: "${texto || '(nenhum)'}" · consultas ${pausar === '1' ? 'PAUSADAS' : 'liberadas'}${antes !== pausar ? ' (mudou)' : ''}`);
  redirecionar(res, `/admin/operacao?ok=${encodeURIComponent('Aviso e status das consultas salvos.')}`);
}));

rota('POST', '/admin/operacao/repasse', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const pct = Number(String(f.pct || '').replace(',', '.')), minimo = centavos(f.minimo);
  const volta = (m, ok) => redirecionar(res, `/admin/operacao?${ok ? 'ok' : 'erro'}=${encodeURIComponent(m)}`);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return volta('Percentual inválido (0 a 100).');
  if (!Number.isFinite(minimo) || minimo < 1000) return volta('O lote mínimo precisa ser de pelo menos R$ 10,00 (mínimo da APIFull).');
  const ligar = f.ativo === '1', estava = lerConfig('repasse_ativo') === '1';
  // Ao ligar, só entram as recargas pagas a partir de agora (o que já foi pago antes não é repassado)
  if (ligar && !estava) gravarConfig('repasse_desde', db.prepare("SELECT datetime('now') AS d").get().d);
  gravarConfig('repasse_ativo', ligar ? '1' : '0');
  gravarConfig('repasse_percentual', pct);
  gravarConfig('repasse_minimo_centavos', minimo);
  registrar(usuario, 'Alterou repasse APIFull', `${ligar ? 'LIGADO' : 'desligado'} · ${pct}% de cada recarga · lote mínimo ${P.reais(minimo)}`);
  volta('Repasse automático salvo.', true);
}));

rota('POST', '/admin/operacao/repassar-agora', exigeAdmin(async ({ res, usuario }) => {
  if (repasseAcumulado().valor < 1000) return redirecionar(res, `/admin/operacao?erro=${encodeURIComponent('O valor acumulado ainda é menor que R$ 10,00 (mínimo da APIFull).')}`);
  const id = await processarRepasse({ forcar: true, origem: `manual (${usuario.email})` });
  const rp = id ? db.prepare('SELECT status, erro FROM repasses_apifull WHERE id = ?').get(id) : null;
  if (!rp) return redirecionar(res, `/admin/operacao?erro=${encodeURIComponent('Já existe um repasse em andamento. Aguarde e atualize a página.')}`);
  redirecionar(res, ['pago', 'enviado'].includes(rp.status) ? `/admin/operacao?ok=${encodeURIComponent(`Repasse #${id} pago.`)}` : `/admin/operacao?erro=${encodeURIComponent(`Repasse #${id} falhou: ${rp.erro || ''}`)}`);
}));

rota('POST', '/admin/operacao/repasse-tentar', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const rp = db.prepare("SELECT * FROM repasses_apifull WHERE id = ? AND status = 'erro'").get(Number(f.id));
  if (!rp || repasseRodando) return redirecionar(res, '/admin/operacao');
  if (f.acao === 'cancelar') {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE repasses_apifull SET status = 'cancelado' WHERE id = ? AND status = 'erro'").run(rp.id);
      db.prepare('UPDATE recargas SET repasse_id = NULL WHERE repasse_id = ?').run(rp.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    registrar(usuario, 'Cancelou repasse APIFull', `#${rp.id} de ${P.reais(rp.valor_centavos)} (valores voltam para o acumulado)`);
    return redirecionar(res, `/admin/operacao?ok=${encodeURIComponent(`Repasse #${rp.id} cancelado. O valor voltou para o acumulado.`)}`);
  }
  repasseRodando = true;
  try { await executarRepasse(rp.id); } finally { repasseRodando = false; }
  registrar(usuario, 'Tentou de novo repasse APIFull', `#${rp.id}`);
  const st = db.prepare('SELECT status, erro FROM repasses_apifull WHERE id = ?').get(rp.id);
  redirecionar(res, ['pago', 'enviado'].includes(st.status) ? `/admin/operacao?ok=${encodeURIComponent(`Repasse #${rp.id} pago.`)}` : `/admin/operacao?erro=${encodeURIComponent(`Repasse #${rp.id} falhou de novo: ${st.erro || ''}`)}`);
}));



// ---- Campanhas de e-mail avulsas (disparo manual pelo Admin) ----
// Cada cliente recebe cada campanha uma única vez (registrado em emails_enviados com etapa "camp:<chave>")
const PUBLICOS_CAMPANHA = {
  todos: { nome: 'Todos os clientes', sql: '1=1' },
  sem_recarga: { nome: 'Quem ainda não recarregou', sql: "NOT EXISTS (SELECT 1 FROM recargas r WHERE r.usuario_id = u.id AND r.status = 'paga')" },
  com_recarga: { nome: 'Quem já recarregou', sql: "EXISTS (SELECT 1 FROM recargas r WHERE r.usuario_id = u.id AND r.status = 'paga')" },
};
// Campanha semanal: a "etapa" leva a data do próximo lote, então pode ser reenviada uma vez por semana
const etapaCampanha = (chave) => (CAMPANHAS[chave].semanal ? `camp:${chave}:${proximoLoteLN()}` : `camp:${chave}`);
const filtroCampanha = (chave) => (chave === 'limpa-nome-servico'
  ? ` AND NOT EXISTS (SELECT 1 FROM limpa_nome_pedidos lp WHERE lp.usuario_id = u.id AND lp.status IN ('pago','em_analise','em_lote','em_andamento','decisao','concluido'))` : '');
const listaCampanha = (chave, publico, limite = 100000) => {
  const lista = db.prepare(`SELECT u.* FROM usuarios u
  WHERE u.ativo = 1 AND u.admin = 0 AND u.interno = 0 AND u.aceita_emails = 1 AND (${PUBLICOS_CAMPANHA[publico].sql})${filtroCampanha(chave)}
    AND NOT EXISTS (SELECT 1 FROM emails_enviados e WHERE e.usuario_id = u.id AND e.etapa = ?)
  ORDER BY u.id LIMIT ?`).all(etapaCampanha(chave), CAMPANHAS[chave].perfil ? 100000 : limite);
  // Campanha por segmento: só quem é daquele perfil (de onde o cliente veio)
  return CAMPANHAS[chave].perfil ? lista.filter((u) => perfilDo(u) === CAMPANHAS[chave].perfil).slice(0, limite) : lista;
};
// Campanha de preços: consultas do segmento (mais usadas primeiro) com o preço antigo (margem de 150%) riscado
const REGEX_SEGMENTO = { 'limpa-nome': /d[ií]vida|cr[eé]dito|negativ|score/i, veiculos: /ve[ií]cul|placa|auto/i, empresas: /empresa|cnpj|cr[eé]dito|d[ií]vida/i, advogados: /pessoa|localiz|cadastr|endere|telefone|ve[ií]cul|im[oó]v/i };
const MARKUP_ANTIGO = 150;
function promoCampanha(chave) {
  const c = CAMPANHAS[chave];
  if (!c?.promo) return null;
  const todos = db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM consultas k WHERE k.produto_id = p.id AND k.criado_em > datetime('now', '-90 days')) usos
    FROM produtos p WHERE p.ativo = 1 AND p.endpoint <> '' ORDER BY usos DESC, p.ordem`).all();
  const re = REGEX_SEGMENTO[c.perfil];
  let lista = re ? todos.filter((p) => re.test(`${p.categoria} ${p.nome}`)) : todos;
  if (lista.length < 2) lista = todos;
  const itens = lista.slice(0, 6).map((p) => {
    const antes = (p.markup_percentual === null || p.markup_percentual === undefined) ? precoDe(p.custo_centavos, MARKUP_ANTIGO) : null;
    return { nome: p.nome, descricao: p.descricao, preco: p.preco_centavos, antes: antes && antes > p.preco_centavos ? antes : null };
  });
  const desconto = Math.max(0, ...itens.filter((i) => i.antes).map((i) => Math.floor((1 - i.preco / i.antes) * 100)));
  return { itens, desconto };
}
const servicoCampanha = (chave) => (chave === 'limpa-nome-servico' ? { ...lnCfgComTabela(), lote: proximoLoteLN() } : null);
const produtoCampanha = (chave) => (CAMPANHAS[chave].produto ? db.prepare('SELECT * FROM produtos WHERE slug = ?').get(CAMPANHAS[chave].produto) : null);
const campanhaRodando = new Set();
// Fila de campanhas: o que não couber na cota de hoje continua sozinho nos próximos dias
const filaCampanhas = () => { try { return JSON.parse(lerConfig('campanhas_fila') || '[]'); } catch { return []; } };
const gravarFila = (f) => gravarConfig('campanhas_fila', JSON.stringify(f));
async function continuarCampanhas() {
  for (const item of filaCampanhas()) {
    if (!podeMarketing()) return;
    if (!CAMPANHAS[item.chave] || !PUBLICOS_CAMPANHA[item.publico]) { gravarFila(filaCampanhas().filter((x) => x.chave !== item.chave)); continue; }
    await dispararCampanha(item.chave, item.publico, { email: item.admin });
  }
}
async function dispararCampanha(chave, publico, admin) {
  if (campanhaRodando.has(chave)) return;
  campanhaRodando.add(chave);
  if (!filaCampanhas().some((x) => x.chave === chave)) gravarFila([...filaCampanhas(), { chave, publico, admin: admin?.email || 'sistema' }]);
  let ok = 0, falhas = 0, parou = false;
  try {
    const produto = produtoCampanha(chave), bonus = bonusPrimeira(), etapa = etapaCampanha(chave), servico = servicoCampanha(chave), promo = promoCampanha(chave);
    for (const u of listaCampanha(chave, publico)) {
      if (!podeMarketing()) { parou = true; break; }
      if (db.prepare('INSERT OR IGNORE INTO emails_enviados (usuario_id, etapa, status) VALUES (?, ?, ?)').run(u.id, etapa, 'enviando').changes !== 1) continue;
      try {
        const m = montarCampanha({ chave, nome: u.nome, produto, servico, promo, bonus: publico === 'com_recarga' ? null : bonus, base: baseEmails(), sair: linkSair(u.id), podeResponder: !!process.env.EMAIL_RESPOSTA });
        await enviarEmail({ para: u.email, assunto: m.assunto, html: m.html, cabecalhos: { 'List-Unsubscribe': `<${linkSair(u.id)}>` } });
        db.prepare("UPDATE emails_enviados SET status = 'enviado' WHERE usuario_id = ? AND etapa = ?").run(u.id, etapa);
        ok++;
      } catch (e) {
        if (ehErroCota(e)) { db.prepare('DELETE FROM emails_enviados WHERE usuario_id = ? AND etapa = ?').run(u.id, etapa); pausarPorCota(); parou = true; break; }
        falhas++;
        db.prepare("UPDATE emails_enviados SET status = 'erro', erro = ? WHERE usuario_id = ? AND etapa = ?").run(String(e.message).slice(0, 300), u.id, etapa);
      }
      await new Promise((r) => setTimeout(r, 700));
    }
  } finally {
    campanhaRodando.delete(chave);
    const restam = listaCampanha(chave, publico).length;
    if (!restam) gravarFila(filaCampanhas().filter((x) => x.chave !== chave));
    if (ok || falhas || !restam) registrar(admin, restam ? 'Campanha de e-mail: parte enviada (continua amanhã)' : 'Campanha de e-mail concluída',
      `${CAMPANHAS[chave].nome} · público: ${PUBLICOS_CAMPANHA[publico].nome} · ${ok} enviados${falhas ? `, ${falhas} com erro` : ''}${restam ? ` · faltam ${restam} (limite diário)` : ''}`);
  }
}

rota('GET', '/admin/emails/campanha/previa', exigeAdmin(({ res, url }) => {
  const chave = CAMPANHAS[url.searchParams.get('c')] ? url.searchParams.get('c') : 'cpf-credplus';
  const m = montarCampanha({ chave, nome: 'Maria Silva', produto: produtoCampanha(chave), servico: servicoCampanha(chave), promo: promoCampanha(chave), bonus: bonusPrimeira(), base: baseEmails(), sair: '#', podeResponder: !!process.env.EMAIL_RESPOSTA });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; img-src * data:; style-src 'unsafe-inline'", 'X-Frame-Options': 'SAMEORIGIN' });
  res.end(`<div style="font-family:Arial;padding:10px 16px;background:#0F0C14;color:#fff">Assunto: <strong>${P.esc(m.assunto)}</strong></div>${m.html}`);
}));

rota('POST', '/admin/emails/campanha', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const chave = CAMPANHAS[f.c] ? f.c : null;
  const publico = PUBLICOS_CAMPANHA[f.publico] ? f.publico : 'todos';
  const volta = (m, ok) => redirecionar(res, `/admin/operacao?${ok ? 'ok' : 'erro'}=${encodeURIComponent(m)}`);
  if (!chave) return volta('Campanha inválida.');
  if (chave === 'limpa-nome-servico' && !lnCfg().ativo) return volta('Ligue o serviço Limpa Nome (Admin → Limpa Nome) antes de disparar esta campanha.');
  if (!process.env.RESEND_API_KEY) return volta('Falta a RESEND_API_KEY no Render: sem ela nenhum e-mail sai.');
  if (f.acao === 'teste') {
    try {
      const m = montarCampanha({ chave, nome: usuario.nome, produto: produtoCampanha(chave), servico: servicoCampanha(chave), promo: promoCampanha(chave), bonus: bonusPrimeira(), base: baseEmails(), sair: '#', podeResponder: !!process.env.EMAIL_RESPOSTA });
      await enviarEmail({ para: usuario.email, assunto: `[TESTE] ${m.assunto}`, html: m.html });
      return volta(`E-mail de teste enviado para ${usuario.email}.`, true);
    } catch (e) { return volta(`Falha ao enviar o teste: ${e.message}`); }
  }
  if (f.confirmar !== 'ENVIAR') return volta('Para disparar, digite ENVIAR no campo de confirmação.');
  if (campanhaRodando.has(chave)) return volta('Essa campanha já está sendo enviada. Aguarde terminar.');
  const qtd = listaCampanha(chave, publico).length;
  if (!qtd) return volta('Ninguém para enviar: todos desse público já receberam ou não aceitam e-mails.');
  if (filaCampanhas().some((x) => x.chave === chave)) return volta('Essa campanha já está na fila e continua sozinha conforme o limite diário.');
  registrar(usuario, 'Disparou campanha de e-mail', `${CAMPANHAS[chave].nome} · público: ${PUBLICOS_CAMPANHA[publico].nome} · ${qtd} destinatário(s)`);
  const cabeHoje = emailsPausados() ? 0 : Math.max(0, limiteDiarioEmails() - marketingHoje());
  dispararCampanha(chave, publico, usuario).catch((e) => console.error('campanha:', e.message));
  volta(qtd <= cabeHoje ? `Disparo iniciado para ${qtd} cliente(s). Atualize a página para acompanhar.`
    : `Disparo iniciado: ${cabeHoje} hoje e o restante (${qtd - cabeHoje}) segue sozinho nos próximos dias, respeitando o limite de ${limiteDiarioEmails()} e-mails de marketing por dia.`, true);
}));
// ---- Admin: e-mails automáticos ----
rota('POST', '/admin/operacao/emails', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const etapas = ETAPAS.map((e) => e.chave).filter((k) => f[`etapa_${k}`] === '1');
  const ligar = f.ativo === '1', estava = lerConfig('emails_ativo') === '1';
  if (ligar && !process.env.RESEND_API_KEY) return redirecionar(res, `/admin/operacao?erro=${encodeURIComponent('Falta a RESEND_API_KEY no Render: sem ela nenhum e-mail sai.')}`);
  if (ligar && !estava) {
    // Ao ligar: incluir quem se cadastrou nos últimos 7 dias (opcional) ou só os novos daqui pra frente
    const desde = db.prepare(`SELECT datetime('now', ?) AS d`).get(f.incluir_recentes === '1' ? '-7 days' : '+0 seconds').d;
    gravarConfig('emails_desde', desde);
  }
  gravarConfig('emails_ativo', ligar ? '1' : '0');
  gravarConfig('emails_etapas', etapas.join(','));
  const lim = Math.floor(Number(f.limite));
  if (Number.isFinite(lim) && lim >= 0 && lim <= 100000) gravarConfig('emails_limite_diario', String(lim));
  if (f.despausar === '1') gravarConfig('emails_pausa_ate', '');
  registrar(usuario, 'Alterou e-mails automáticos', `${ligar ? 'LIGADO' : 'desligado'} · limite marketing/dia: ${lerConfig('emails_limite_diario')}${f.despausar === '1' ? ' · pausa por cota removida' : ''} · etapas: ${etapas.join(', ') || 'nenhuma'}${ligar && !estava && f.incluir_recentes === '1' ? ' · incluiu cadastros dos últimos 7 dias' : ''}`);
  processarEmails().catch((e) => console.error('e-mails:', e.message));
  redirecionar(res, `/admin/operacao?ok=${encodeURIComponent('E-mails automáticos salvos.')}`);
}));

rota('GET', '/admin/emails/previa', exigeAdmin(({ res, url }) => {
  const etapa = [...ETAPAS.map((e) => e.chave), 'boasvindas'].includes(url.searchParams.get('etapa')) ? url.searchParams.get('etapa') : 'd1';
  const perfil = PERFIS.includes(url.searchParams.get('perfil')) ? url.searchParams.get('perfil') : 'geral';
  const m = montarEmail({ etapa, nome: 'Maria Silva', perfil, bonus: bonusPrimeira(), base: baseEmails(), sair: '#', podeResponder: !!process.env.EMAIL_RESPOSTA });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; img-src * data:; style-src 'unsafe-inline'", 'X-Frame-Options': 'SAMEORIGIN' });
  res.end(`<div style="font-family:Arial;padding:10px 16px;background:#0F0C14;color:#fff">Assunto: <strong>${P.esc(m.assunto)}</strong></div>${m.html}`);
}));

rota('POST', '/admin/emails/teste', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const etapa = [...ETAPAS.map((e) => e.chave), 'boasvindas'].includes(f.etapa) ? f.etapa : 'd1';
  const perfil = PERFIS.includes(f.perfil) ? f.perfil : 'geral';
  try {
    const m = montarEmail({ etapa, nome: usuario.nome, perfil, bonus: bonusPrimeira(), base: baseEmails(), sair: '#', podeResponder: !!process.env.EMAIL_RESPOSTA });
    await enviarEmail({ para: usuario.email, assunto: `[TESTE] ${m.assunto}`, html: m.html });
    redirecionar(res, `/admin/operacao?ok=${encodeURIComponent(`E-mail de teste enviado para ${usuario.email}.`)}`);
  } catch (e) {
    redirecionar(res, `/admin/operacao?erro=${encodeURIComponent(`Falha ao enviar: ${e.message}`)}`);
  }
}));
// Bloquear / reativar cliente (bloqueado não entra e é desconectado na hora)
rota('POST', '/admin/clientes/ativo', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const cli = db.prepare('SELECT id, nome, email, admin FROM usuarios WHERE id = ?').get(Number(f.id));
  if (!cli || cli.admin) return redirecionar(res, '/admin/clientes');
  const ativo = f.ativo === '1' ? 1 : 0;
  db.prepare('UPDATE usuarios SET ativo = ? WHERE id = ?').run(ativo, cli.id);
  if (!ativo) A.encerrarTodasSessoes(cli.id);
  registrar(usuario, ativo ? 'Reativou cliente' : 'Bloqueou cliente', `${cli.nome} (${cli.email})${f.motivo ? ` · motivo: ${String(f.motivo).slice(0, 120)}` : ''}`);
  redirecionar(res, '/admin/clientes?ok=1');
}));

// Conferir no Asaas uma recarga que ficou pendente (credita se já foi paga)
rota('POST', '/admin/recargas/verificar', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const r = db.prepare("SELECT * FROM recargas WHERE id = ? AND status <> 'paga'").get(Number(f.id));
  if (!r || !r.asaas_id) return redirecionar(res, '/admin/recargas');
  try {
    const c = await AS.buscarCobranca(r.asaas_id);
    if (AS.STATUS_PAGO.includes(c.status)) {
      creditarRecarga(r.id);
      processarRepasse().catch((e) => console.error('repasse:', e.message));
      registrar(usuario, 'Conferiu recarga no Asaas e creditou', `Recarga #${r.id} de ${P.reais(r.valor_centavos)} (${c.status})`);
      return redirecionar(res, `/admin/recargas?ok=${encodeURIComponent(`Recarga #${r.id} estava paga e foi creditada.`)}`);
    }
    return redirecionar(res, `/admin/recargas?erro=${encodeURIComponent(`Recarga #${r.id} ainda não foi paga no Asaas (status: ${c.status}).`)}`);
  } catch (e) {
    return redirecionar(res, `/admin/recargas?erro=${encodeURIComponent(`Não foi possível consultar o Asaas: ${e.message}`)}`);
  }
}));

// Estorno manual de uma consulta concluída (ex.: cliente reclamou de resultado vazio)
rota('POST', '/admin/consultas/estornar', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const c = db.prepare("SELECT c.*, u.interno, u.admin FROM consultas c JOIN usuarios u ON u.id = c.usuario_id WHERE c.id = ? AND c.status = 'concluida'").get(Number(f.id));
  if (!c || c.interno || c.admin) return redirecionar(res, '/admin/consultas');
  const r = db.prepare("INSERT OR IGNORE INTO transacoes (usuario_id, tipo, valor_centavos, descricao, referencia) VALUES (?, 'estorno', ?, ?, ?)")
    .run(c.usuario_id, c.preco_centavos, `Estorno: ${c.produto}`, `est_${c.id}`);
  if (r.changes) registrar(usuario, 'Estornou consulta', `#${c.id} ${c.produto} · ${P.reais(c.preco_centavos)}${f.motivo ? ` · motivo: ${String(f.motivo).slice(0, 120)}` : ''}`);
  redirecionar(res, `/admin/consultas?ok=${encodeURIComponent(r.changes ? `Consulta #${c.id} estornada.` : `A consulta #${c.id} já tinha sido estornada.`)}`);
}));
// ======================= ADMIN =======================
rota('GET', '/admin', exigeAdmin(async ({ res, usuario }) => {
  const g = (sql, ...a) => db.prepare(sql).get(...a);
  const m = {
    clientes: g('SELECT COUNT(*) n FROM usuarios').n,
    clientesMes: g("SELECT COUNT(*) n FROM usuarios WHERE criado_em > datetime('now','-30 days')").n,
    recargas: g("SELECT COALESCE(SUM(valor_centavos),0) s FROM recargas WHERE status='paga'").s,
    qtdRecargas: g("SELECT COUNT(*) n FROM recargas WHERE status='paga'").n,
    bonus: g("SELECT COALESCE(SUM(bonus_centavos),0) s FROM recargas WHERE status='paga'").s,
    saldos: g('SELECT COALESCE(SUM(valor_centavos),0) s FROM transacoes').s,
    consultas: g("SELECT COUNT(*) n FROM consultas c JOIN usuarios u ON u.id=c.usuario_id WHERE c.status='concluida' AND (u.admin = 0 AND u.interno = 0)").n,
    falhas: g("SELECT COUNT(*) n FROM consultas WHERE status='falhou'").n,
    faturamento: g("SELECT COALESCE(SUM(c.preco_centavos - c.comissao_centavos),0) s FROM consultas c JOIN usuarios u ON u.id=c.usuario_id WHERE c.status='concluida' AND (u.admin = 0 AND u.interno = 0)").s,
    comissoes: g("SELECT COALESCE(SUM(comissao_centavos),0) s FROM consultas WHERE status='concluida'").s,
    saquesPendentes: g("SELECT COALESCE(SUM(valor_centavos - taxa_centavos),0) s FROM saques WHERE status='pendente'").s,
    qtdSaquesPendentes: g("SELECT COUNT(*) n FROM saques WHERE status='pendente'").n,
    custo: g("SELECT COALESCE(SUM(c.custo_centavos),0) s FROM consultas c JOIN usuarios u ON u.id=c.usuario_id WHERE c.status='concluida' AND (u.admin = 0 AND u.interno = 0)").s,
    internas: g("SELECT COUNT(*) n FROM consultas c JOIN usuarios u ON u.id=c.usuario_id WHERE c.status='concluida' AND (u.admin = 1 OR u.interno = 1)").n,
    custoInternas: g("SELECT COALESCE(SUM(c.custo_centavos),0) s FROM consultas c JOIN usuarios u ON u.id=c.usuario_id WHERE c.status='concluida' AND (u.admin = 1 OR u.interno = 1)").s,
    saldoApiFull: await saldoApiFull({ forcar: true }),
    alertaApiFull: Number(lerConfig('alerta_saldo_apifull_centavos') ?? 5000),
  };
  pagina(res, 'Admin', PD.adminResumo({ m }), usuario);
}));

rota('GET', '/admin/produtos', exigeAdmin(({ res, usuario, url }) => pagina(res, 'Admin · Consultas', PD.adminProdutos({
  produtos: db.prepare('SELECT * FROM produtos ORDER BY ativo DESC, categoria, ordem, nome').all(), markup: lerConfig('markup_percentual'), ok: url.searchParams.get('ok') ? 'Salvo com sucesso.' : '',
}), usuario)));

rota('GET', '/admin/produtos/editar', exigeAdmin(({ res, usuario, url }) => {
  const id = Number(url.searchParams.get('id'));
  const p = id ? db.prepare('SELECT * FROM produtos WHERE id = ?').get(id) : {};
  pagina(res, 'Admin · Editar consulta', PD.adminProdutoForm({ p: p || {}, markup: lerConfig('markup_percentual') }), usuario);
}));

rota('POST', '/admin/produtos/salvar', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const custo = centavos(f.custo);
  const p = {
    id: Number(f.id) || null,
    nome: String(f.nome || '').trim(), categoria: String(f.categoria || '').trim(), descricao: String(f.descricao || '').trim(),
    documento: ['cpf', 'cnpj', 'cpf_cnpj', 'placa', 'cep'].includes(f.documento) ? f.documento : 'cpf_cnpj',
    endpoint: String(f.endpoint || '').trim(), link: String(f.link || '').trim(), campo: String(f.campo || 'document').trim() || 'document',
    custo_centavos: custo, ordem: Number(f.ordem) || 100, ativo: f.ativo === '1' ? 1 : 0, sensivel: f.sensivel === '1' ? 1 : 0,
    destaque_limpa_nome: ['economica', 'completa'].includes(f.destaque_limpa_nome) ? f.destaque_limpa_nome : '',
    markup_percentual: String(f.markup_proprio ?? '').trim() === '' ? null : Number(String(f.markup_proprio).replace(',', '.')),
  };
  const erro = (m) => pagina(res, 'Admin · Editar consulta', PD.adminProdutoForm({ p, markup: lerConfig('markup_percentual'), erro: m }), usuario, 400);
  if (!p.nome || !p.categoria) return erro('Preencha o nome e a categoria.');
  if (!Number.isFinite(custo) || custo <= 0) return erro('Informe o custo da consulta na APIFull.');
  if (p.endpoint && !/^[\w.-]+$/.test(p.endpoint)) return erro('Endpoint inválido: use só letras, números, ponto, hífen ou sublinhado.');
  if (p.markup_percentual !== null && (!Number.isFinite(p.markup_percentual) || p.markup_percentual < 0 || p.markup_percentual > 1000)) return erro('Margem própria inválida (0 a 1000%).');
  const preco = p.markup_percentual !== null ? precoDe(custo, p.markup_percentual) : precoDe(custo);
  const antes = p.id ? db.prepare('SELECT nome, custo_centavos, ativo, endpoint FROM produtos WHERE id = ?').get(p.id) : null;
  registrar(usuario, p.id ? 'Editou consulta' : 'Criou consulta',
    `${p.nome}: custo ${P.reais(antes?.custo_centavos ?? 0)} → ${P.reais(custo)}, preço ${P.reais(preco)}, ${p.ativo ? 'ativa' : 'inativa'}${antes && antes.endpoint !== p.endpoint ? `, endpoint ${antes.endpoint || '—'} → ${p.endpoint}` : ''}`);
  if (p.id) {
    db.prepare(`UPDATE produtos SET nome=?, categoria=?, descricao=?, documento=?, endpoint=?, link=?, campo=?, custo_centavos=?, preco_centavos=?, ordem=?, ativo=?, sensivel=?, destaque_limpa_nome=?, markup_percentual=? WHERE id=?`)
      .run(p.nome, p.categoria, p.descricao, p.documento, p.endpoint, p.link, p.campo, custo, preco, p.ordem, p.ativo, p.sensivel, p.destaque_limpa_nome, p.markup_percentual, p.id);
  } else {
    let slug = p.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'consulta';
    while (db.prepare('SELECT 1 FROM produtos WHERE slug = ?').get(slug)) slug += '-2';
    db.prepare(`INSERT INTO produtos (slug, nome, categoria, descricao, documento, endpoint, link, campo, custo_centavos, preco_centavos, ordem, ativo, sensivel, destaque_limpa_nome, markup_percentual) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(slug, p.nome, p.categoria, p.descricao, p.documento, p.endpoint, p.link, p.campo, custo, preco, p.ordem, p.ativo, p.sensivel, p.destaque_limpa_nome, p.markup_percentual);
  }
  redirecionar(res, '/admin/produtos?ok=1');
}));

rota('GET', '/admin/produtos/importar', exigeAdmin(({ res, usuario }) => pagina(res, 'Admin · Importar', PD.adminImportar({}), usuario)));

rota('POST', '/admin/produtos/importar', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req, 800000);
  const texto = String(f.texto || '');
  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const erros = [];
  let criadas = 0, atualizadas = 0, inativas = 0;
  const tipos = ['cpf', 'cnpj', 'cpf_cnpj', 'placa', 'cep'];
  const slugDe = (n) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'consulta';
  db.exec('BEGIN');
  try {
    linhas.forEach((linha, i) => {
      const [nome, endpoint, custoTxt, categoria, documento, descricao, campoTxt] = linha.split(';').map((x) => (x || '').trim());
      if (!nome || !endpoint || !/^[\w.-]+$/.test(endpoint)) { erros.push(`Linha ${i + 1}: preencha nome e um endpoint válido.`); return; }
      const custo = centavos(custoTxt);
      const temCusto = Number.isFinite(custo) && custo > 0;
      const doc = tipos.includes(documento) ? documento : 'cpf_cnpj';
      const cat = categoria || 'Dívidas e Crédito';
      const campo = /^[\w]+$/.test(campoTxt || '') ? campoTxt : (doc === 'placa' ? 'placa' : doc === 'cep' ? 'cep' : 'document');
      // Atualiza pelo endpoint; senão, pela consulta de mesmo nome ainda sem endpoint (catálogo inicial)
      const existente = db.prepare('SELECT * FROM produtos WHERE endpoint = ?').get(endpoint)
        || db.prepare("SELECT * FROM produtos WHERE endpoint = '' AND lower(nome) = lower(?)").get(nome);
      if (existente) {
        const c = temCusto ? custo : existente.custo_centavos;
        const ativo = c > 0 ? (existente.endpoint ? existente.ativo : 1) : 0;
        const mkp = existente.markup_percentual;
        db.prepare(`UPDATE produtos SET nome=?, categoria=?, documento=?, endpoint=?, link=?, campo=?, custo_centavos=?, preco_centavos=?, ativo=?,
          descricao=COALESCE(NULLIF(?, ''), descricao) WHERE id=?`)
          .run(nome, cat, doc, endpoint, endpoint, campo, c, mkp !== null && mkp !== undefined ? precoDe(c, mkp) : precoDe(c), ativo, descricao || '', existente.id);
        atualizadas++;
        if (!ativo) inativas++;
      } else {
        let slug = slugDe(nome);
        while (db.prepare('SELECT 1 FROM produtos WHERE slug = ?').get(slug)) slug += '-2';
        const c = temCusto ? custo : 0;
        db.prepare(`INSERT INTO produtos (slug, nome, categoria, descricao, documento, endpoint, link, campo, custo_centavos, preco_centavos, ativo, ordem, sensivel)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,100,?)`).run(slug, nome, cat, descricao || '', doc, endpoint, endpoint, campo, c, precoDe(c), temCusto ? 1 : 0, PALAVRAS_SENSIVEIS.test(nome) ? 1 : 0);
        criadas++;
        if (!temCusto) inativas++;
      }
    });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  const resultado = `${criadas} consulta(s) criada(s) e ${atualizadas} atualizada(s). ${inativas} ficaram inativas aguardando o custo: edite e informe o custo para ativar.`;
  registrar(usuario, 'Importou consultas em lote', resultado);
  pagina(res, 'Admin · Importar', PD.adminImportar({ texto: erros.length ? texto : '', resultado, erro: erros.slice(0, 15).join(' ') }), usuario);
}));

rota('GET', '/admin/config', exigeAdmin(({ res, usuario, url }) => pagina(res, 'Admin · Configurações', PD.adminConfig({
  maximo: valorMaximo(), minimo: Number(lerConfig('recarga_minima_centavos')), faixas: faixasBonus(), markup: lerConfig('markup_percentual'), dias: diasHistorico(), comissaoMax: lerConfig('comissao_maxima'), saqueMin: Number(lerConfig('saque_minimo_centavos')), taxaSaque: taxaSaque(), alerta: Number(lerConfig('alerta_saldo_apifull_centavos')), primeira: bonusPrimeira(), ok: url.searchParams.get('ok') ? 'Configurações salvas e preços recalculados.' : '',
}), usuario)));

rota('POST', '/admin/config', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const minimo = centavos(f.minimo), markup = Number(String(f.markup || '').replace(',', '.'));
  const erro = (m) => pagina(res, 'Admin · Configurações', PD.adminConfig({ maximo: valorMaximo(), minimo: Number(lerConfig('recarga_minima_centavos')), faixas: faixasBonus(), markup: lerConfig('markup_percentual'), dias: diasHistorico(), comissaoMax: lerConfig('comissao_maxima'), saqueMin: Number(lerConfig('saque_minimo_centavos')), taxaSaque: taxaSaque(), alerta: Number(lerConfig('alerta_saldo_apifull_centavos')), primeira: bonusPrimeira(), erro: m }), usuario, 400);
  const dias = Number(f.dias);
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) return erro('O prazo do histórico precisa ser entre 1 e 365 dias.');
  const comissaoMax = Number(f.comissao_maxima), saqueMin = centavos(f.saque_minimo);
  if (!Number.isInteger(comissaoMax) || comissaoMax < 0 || comissaoMax > 300) return erro('Comissão máxima inválida (0 a 300%).');
  if (!Number.isFinite(saqueMin) || saqueMin < 100) return erro('Saque mínimo inválido.');
  const taxaS = Number(String(f.saque_taxa ?? '5').replace(',', '.'));
  if (!Number.isFinite(taxaS) || taxaS < 0 || taxaS > 50) return erro('Taxa de saque inválida (0 a 50%).');
  const bpPct = Number(String(f.primeira_pct ?? '0').replace(',', '.')), bpMin = centavos(f.primeira_min || '0'), bpAte = /^\d{4}-\d{2}-\d{2}$/.test(f.primeira_ate || '') ? f.primeira_ate : '';
  if (!Number.isFinite(bpPct) || bpPct < 0 || bpPct > 100 || !Number.isFinite(bpMin) || bpMin < 0) return erro('Bônus de primeira recarga inválido.');
  const alerta = centavos(f.alerta_apifull);
  if (!Number.isFinite(alerta) || alerta < 0) return erro('Valor de alerta do saldo APIFull inválido.');
  if (!Number.isFinite(minimo) || minimo < 500) return erro('A recarga mínima precisa ser de pelo menos R$ 5,00.');
  const maximo = centavos(f.maximo);
  if (String(f.maximo ?? '').trim() && (!Number.isFinite(maximo) || maximo < minimo || maximo > 2000000)) return erro('Recarga máxima inválida (entre a mínima e R$ 20.000).');
  if (!Number.isFinite(markup) || markup < 0 || markup > 1000) return erro('Margem inválida.');
  const faixas = [];
  for (const parte of String(f.faixas || '').split(';').map((x) => x.trim()).filter(Boolean)) {
    const [v, pct] = parte.split('=').map((x) => x.trim());
    const vc = centavos(v), pc = Number(String(pct).replace(',', '.'));
    if (!Number.isFinite(vc) || !Number.isFinite(pc) || pc <= 0 || pc > 50) return erro(`Faixa de bônus inválida: "${parte}". Use o formato 100=5.`);
    faixas.push({ a_partir_de: vc, percentual: pc });
  }
  gravarConfig('recarga_minima_centavos', minimo);
  if (Number.isFinite(maximo) && String(f.maximo ?? '').trim()) gravarConfig('recarga_maxima_centavos', maximo);
  gravarConfig('markup_percentual', markup);
  gravarConfig('dias_historico', dias);
  gravarConfig('comissao_maxima', comissaoMax);
  gravarConfig('saque_minimo_centavos', saqueMin);
  gravarConfig('saque_taxa_percentual', taxaS);
  gravarConfig('alerta_saldo_apifull_centavos', alerta);
  gravarConfig('bonus_primeira_percentual', bpPct);
  gravarConfig('bonus_primeira_minimo_centavos', bpMin);
  gravarConfig('bonus_primeira_ate', bpAte);
  gravarConfig('bonus_faixas', JSON.stringify(faixas.sort((a, b) => a.a_partir_de - b.a_partir_de)));
  recalcularPrecos();
  registrar(usuario, 'Alterou configurações', `margem ${markup}%, recarga mínima ${P.reais(minimo)}, máxima ${P.reais(valorMaximo())}, bônus ${faixas.map((x) => `${P.reais(x.a_partir_de)}=${x.percentual}%`).join('; ') || 'nenhum'}, histórico ${dias} dias, comissão máx. ${comissaoMax}%, saque mín. ${P.reais(saqueMin)}, taxa de saque ${taxaS}%, alerta APIFull ${P.reais(alerta)}`);
  redirecionar(res, '/admin/config?ok=1');
}));

rota('GET', '/admin/clientes', exigeAdmin(({ res, usuario, url }) => {
  const busca = url.searchParams.get('busca') || '';
  const t = `%${busca.replace(/[%_]/g, '')}%`;
  const clientes = db.prepare(`SELECT u.*, COALESCE((SELECT SUM(valor_centavos) FROM transacoes WHERE usuario_id = u.id), 0) AS saldo FROM usuarios u
    WHERE ? = '' OR u.nome LIKE ? OR u.email LIKE ? OR u.documento LIKE ? ORDER BY u.id DESC LIMIT 200`).all(busca, t, t, `%${A.soNumeros(busca) || '@@'}%`);
  const ok = url.searchParams.get('ok') ? 'Cliente atualizado.' : '';
  pagina(res, 'Admin · Clientes', PD.adminClientes({ clientes, busca, ok }), usuario);
}));

rota('POST', '/admin/clientes/ajuste', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const valor = centavos(f.valor);
  const motivo = String(f.motivo || '').trim().slice(0, 120);
  if (!Number.isFinite(valor) || valor === 0 || !motivo || !db.prepare('SELECT 1 FROM usuarios WHERE id = ?').get(Number(f.id))) return redirecionar(res, '/admin/clientes');
  db.prepare("INSERT INTO transacoes (usuario_id, tipo, valor_centavos, descricao) VALUES (?, 'ajuste', ?, ?)").run(Number(f.id), valor, `Ajuste: ${motivo} (por ${usuario.email})`);
  const cli = db.prepare('SELECT nome, email FROM usuarios WHERE id = ?').get(Number(f.id));
  registrar(usuario, 'Ajustou saldo', `${cli.nome} (${cli.email}): ${valor > 0 ? '+' : '-'}${P.reais(Math.abs(valor))}, motivo: ${motivo}`);
  redirecionar(res, '/admin/clientes?ok=1');
}));

rota('POST', '/admin/clientes/interno', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const cli = db.prepare('SELECT id, nome, email, admin FROM usuarios WHERE id = ?').get(Number(f.id));
  if (!cli || cli.admin) return redirecionar(res, '/admin/clientes');
  const valor = f.interno === '1' ? 1 : 0;
  db.prepare('UPDATE usuarios SET interno = ? WHERE id = ?').run(valor, cli.id);
  registrar(usuario, valor ? 'Tornou conta interna (saldo APIFull)' : 'Removeu conta interna', `${cli.nome} (${cli.email})`);
  redirecionar(res, '/admin/clientes?ok=1');
}));

rota('POST', '/admin/clientes/sensivel', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const cli = db.prepare('SELECT id, nome, email FROM usuarios WHERE id = ?').get(Number(f.id));
  if (!cli) return redirecionar(res, '/admin/clientes');
  const valor = f.liberar === '1' ? 1 : 0;
  db.prepare('UPDATE usuarios SET liberado_sensivel = ? WHERE id = ?').run(valor, cli.id);
  registrar(usuario, valor ? 'Liberou consultas sensíveis' : 'Bloqueou consultas sensíveis', `${cli.nome} (${cli.email})`);
  redirecionar(res, '/admin/clientes?ok=1');
}));

rota('GET', '/admin/consultas', exigeAdmin(({ res, usuario, url }) => pagina(res, 'Admin · Consultas feitas', PD.adminConsultas({
  consultas: db.prepare(`SELECT c.*, u.nome AS cliente, (u.admin OR u.interno) AS interno,
    EXISTS (SELECT 1 FROM transacoes t WHERE t.tipo = 'estorno' AND t.referencia = 'est_' || c.id) AS estornada
    FROM consultas c JOIN usuarios u ON u.id = c.usuario_id ORDER BY c.id DESC LIMIT 300`).all(),
  ok: url.searchParams.get('ok') || '', erro: url.searchParams.get('erro') || '',
}), usuario)));

rota('GET', '/admin/recargas', exigeAdmin(({ res, usuario, url }) => pagina(res, 'Admin · Recargas', PD.adminRecargas({
  recargas: db.prepare('SELECT r.*, u.nome AS cliente FROM recargas r JOIN usuarios u ON u.id = r.usuario_id ORDER BY r.id DESC LIMIT 300').all(),
  ok: url.searchParams.get('ok') || '', erro: url.searchParams.get('erro') || '',
}), usuario)));

// ======================= REDE DE CLIENTES E REGISTRO =======================
rota('GET', '/admin/rede', exigeAdmin(({ res, usuario, url }) => {
  const clientes = db.prepare(`SELECT u.id, u.nome, u.email, u.documento, u.telefone, u.indicado_por, u.comissao_percentual, u.criado_em, u.admin, u.ativo,
      COALESCE((SELECT SUM(valor_centavos) FROM transacoes t WHERE t.usuario_id = u.id), 0) AS saldo,
      COALESCE((SELECT SUM(valor_centavos) FROM recargas r WHERE r.usuario_id = u.id AND r.status = 'paga'), 0) AS recarregado,
      (SELECT COUNT(*) FROM consultas c WHERE c.usuario_id = u.id AND c.status = 'concluida') AS consultas,
      COALESCE((SELECT SUM(c.preco_centavos - c.comissao_centavos - c.custo_centavos) FROM consultas c WHERE c.usuario_id = u.id AND c.status = 'concluida'), 0) AS lucro,
      COALESCE((SELECT SUM(valor_centavos) FROM comissoes k WHERE k.usuario_id = u.id AND k.tipo = 'comissao'), 0) AS comissoes_ganhas,
      COALESCE((SELECT SUM(valor_centavos) FROM comissoes k WHERE k.usuario_id = u.id), 0) AS comissoes_saldo
    FROM usuarios u ORDER BY u.id`).all();
  pagina(res, 'Admin · Rede de clientes', PD.adminRede({ clientes, busca: url.searchParams.get('busca') || '' }), usuario);
}));

rota('GET', '/admin/registro', exigeAdmin(({ res, usuario }) => pagina(res, 'Admin · Registro', PD.adminRegistro({
  linhas: db.prepare('SELECT * FROM registro_admin ORDER BY id DESC LIMIT 500').all(),
}), usuario)));

// ======================= ANÚNCIOS (banner) =======================
// Planos de anúncio (preços fixos, editáveis no Admin → Anúncios)
const planosAnuncio = () => { try { return JSON.parse(lerConfig('anuncio_planos') || '[]'); } catch { return []; } };
const maxAnuncios = () => Math.min(8, Math.max(1, Number(lerConfig('anuncio_max_simultaneos') || 4)));
const anunciosNoAr = () => db.prepare(`SELECT * FROM anuncios WHERE ativo = 1
  AND (inicio IS NULL OR inicio = '' OR inicio <= date('now', '-3 hours'))
  AND (fim IS NULL OR fim = '' OR fim >= date('now', '-3 hours')) ORDER BY exclusivo DESC, id ASC`).all();
// Destaque exclusivo no ar: só ele aparece. Senão, rodízio com no máximo N anunciantes (os mais antigos primeiro).
const anunciosAtivos = () => {
  const lista = anunciosNoAr();
  const exclusivo = lista.find((a) => a.exclusivo);
  return exclusivo ? [exclusivo] : lista.slice(0, maxAnuncios());
};
function anunciosParaExibir() {
  const lista = anunciosAtivos();
  if (lista.length) db.prepare(`UPDATE anuncios SET impressoes = impressoes + 1 WHERE id IN (${lista.map(() => '?').join(',')})`).run(...lista.map((a) => a.id));
  return lista;
}
const whatsAnuncie = () => process.env.CONTATO_ANUNCIE || 'https://wa.me/5547997400955?text=Quero%20anunciar%20na%20Soft%20Consultas';
const contatoAnuncie = () => '/anuncie';

// Página pública para anunciantes: formatos, tamanhos, planos e regras
rota('GET', '/anuncie', ({ res, usuario }) => {
  const clientes = db.prepare('SELECT COUNT(*) n FROM usuarios WHERE admin = 0 AND interno = 0').get().n;
  const exib = db.prepare('SELECT COALESCE(SUM(impressoes), 0) n FROM anuncios').get().n;
  const noAr = anunciosNoAr().filter((a) => !a.exclusivo).length;
  pagina(res, 'Anuncie na Soft Consultas', PD.paginaAnuncie({ planos: planosAnuncio(), arte: Number(lerConfig('anuncio_arte_centavos') || 0),
    vagas: Math.max(0, maxAnuncios() - noAr), max: maxAnuncios(), mostrarNumeros: lerConfig('anuncio_mostrar_numeros') === '1', clientes, exib, whats: whatsAnuncie() }), usuario);
});

rota('GET', '/anuncio-img/:id', async ({ res, params, url }) => {
  const a = db.prepare('SELECT imagem, imagem_mobile FROM anuncios WHERE id = ?').get(Number(params.id));
  if (!a) { res.writeHead(404); return res.end(); }
  const arq = url.searchParams.get('m') === '1' && a.imagem_mobile ? a.imagem_mobile : a.imagem;
  try {
    const dados = await readFile(path.join(pastaAnuncios, path.basename(arq)));
    const ext = arq.split('.').pop();
    res.writeHead(200, { 'Content-Type': ext === 'jpg' ? 'image/jpeg' : `image/${ext}`, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    res.end(dados);
  } catch { res.writeHead(404); res.end(); }
});

rota('GET', '/anuncio/:id', ({ res, params }) => {
  const a = db.prepare('SELECT id, link FROM anuncios WHERE id = ? AND ativo = 1').get(Number(params.id));
  if (!a || !/^https?:\/\//i.test(a.link)) return redirecionar(res, '/');
  db.prepare('UPDATE anuncios SET cliques = cliques + 1 WHERE id = ?').run(a.id);
  res.writeHead(302, { Location: a.link, 'Cache-Control': 'no-store', 'Referrer-Policy': 'origin' });
  res.end();
});

rota('GET', '/admin/anuncios', exigeAdmin(({ res, usuario, url }) => pagina(res, 'Admin · Anúncios', PD.adminAnuncios({
  anuncios: db.prepare('SELECT * FROM anuncios ORDER BY id DESC').all(), planos: planosAnuncio(), arte: Number(lerConfig('anuncio_arte_centavos') || 0),
  max: maxAnuncios(), noAr: anunciosNoAr().length, exclusivoNoAr: anunciosNoAr().some((a) => a.exclusivo), mostrarNumeros: lerConfig('anuncio_mostrar_numeros') === '1',
  ok: url.searchParams.get('ok') ? 'Anúncio salvo.' : '', erro: url.searchParams.get('erro') || '',
}), usuario)));

rota('POST', '/admin/anuncios/criar', exigeAdmin(async ({ req, res, usuario }) => {
  const erro = (m) => redirecionar(res, `/admin/anuncios?erro=${encodeURIComponent(m)}`);
  let form;
  try { form = await corpoMultipart(req, 7 * 1024 * 1024); } catch (e) { return erro(e.message === 'arquivo grande demais' ? 'Imagens grandes demais (máximo 3 MB cada).' : 'Não foi possível ler o formulário.'); }
  const { campos, arquivos } = form;
  if (Object.values(arquivos).some((a) => a.dados.length > 3 * 1024 * 1024)) return erro('Cada imagem pode ter no máximo 3 MB.');
  const anunciante = String(campos.anunciante || '').trim().slice(0, 120);
  const link = String(campos.link || '').trim().slice(0, 500);
  const img = arquivos.imagem, imgM = arquivos.imagem_mobile;
  if (!anunciante) return erro('Informe o nome do anunciante.');
  if (link && !/^https?:\/\/[^\s]+$/i.test(link)) return erro('O link precisa começar com http:// ou https://');
  if (!img) return erro('Envie a imagem do banner.');
  const ext = tipoImagem(img.dados);
  if (!ext) return erro('A imagem precisa ser PNG, JPG ou WEBP.');
  const extM = imgM ? tipoImagem(imgM.dados) : null;
  if (imgM && !extM) return erro('A imagem para celular precisa ser PNG, JPG ou WEBP.');
  const dataOk = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : null);
  // Plano: preenche valor e data de fim quando ficarem em branco
  const plano = planosAnuncio().find((p) => p.k === campos.plano) || null;
  const inicio = dataOk(campos.inicio) || new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  let fim = dataOk(campos.fim);
  if (!fim && plano) { const d = new Date(`${inicio}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + plano.dias - 1); fim = d.toISOString().slice(0, 10); }
  let valor = String(campos.valor || '').trim() ? centavos(campos.valor) : (plano ? plano.v + (campos.arte === '1' ? Number(lerConfig('anuncio_arte_centavos') || 0) : 0) : 0);
  if (!Number.isFinite(valor)) valor = 0;
  const arquivo = `anuncio-${Date.now()}.${ext}`;
  await writeFile(path.join(pastaAnuncios, arquivo), img.dados);
  const arquivoM = imgM ? `anuncio-${Date.now()}-m.${extM}` : null;
  if (arquivoM) await writeFile(path.join(pastaAnuncios, arquivoM), imgM.dados);
  db.prepare('INSERT INTO anuncios (anunciante, titulo, link, imagem, imagem_mobile, inicio, fim, valor_centavos, plano, exclusivo, contato) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(anunciante, String(campos.titulo || '').trim().slice(0, 160), link, arquivo, arquivoM, inicio, fim, valor, plano?.k || '', plano?.exclusivo ? 1 : 0, String(campos.contato || '').trim().slice(0, 200));
  registrar(usuario, 'Criou anúncio', `${anunciante} · ${plano ? plano.n : 'sem plano'} · ${P.reais(valor)} · ${inicio} até ${fim || 'sem fim'} · ${link || 'sem link'}`);
  redirecionar(res, '/admin/anuncios?ok=1');
}));

rota('POST', '/admin/anuncios/planos', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const novos = planosAnuncio().map((p) => {
    const v = centavos(f[`v_${p.k}`]);
    return { ...p, v: Number.isFinite(v) && v >= 0 ? v : p.v };
  });
  const arte = centavos(f.arte);
  gravarConfig('anuncio_planos', JSON.stringify(novos));
  if (Number.isFinite(arte) && arte >= 0) gravarConfig('anuncio_arte_centavos', String(arte));
  const max = Math.min(8, Math.max(1, Math.floor(Number(f.max) || 4)));
  gravarConfig('anuncio_max_simultaneos', String(max));
  gravarConfig('anuncio_mostrar_numeros', f.numeros === '1' ? '1' : '0');
  registrar(usuario, 'Alterou planos de anúncio', `${novos.map((p) => `${p.n}: ${P.reais(p.v)}`).join(' · ')} · arte ${P.reais(lerConfig('anuncio_arte_centavos'))} · máx. ${max} simultâneos`);
  redirecionar(res, '/admin/anuncios?ok=1');
}));

rota('POST', '/admin/anuncios/acao', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const a = db.prepare('SELECT * FROM anuncios WHERE id = ?').get(Number(f.id));
  if (!a) return redirecionar(res, '/admin/anuncios');
  if (f.acao === 'alternar') {
    db.prepare('UPDATE anuncios SET ativo = 1 - ativo WHERE id = ?').run(a.id);
    registrar(usuario, a.ativo ? 'Pausou anúncio' : 'Ativou anúncio', a.anunciante);
  } else if (f.acao === 'excluir') {
    db.prepare('DELETE FROM anuncios WHERE id = ?').run(a.id);
    await unlink(path.join(pastaAnuncios, a.imagem)).catch(() => {});
    if (a.imagem_mobile) await unlink(path.join(pastaAnuncios, a.imagem_mobile)).catch(() => {});
    registrar(usuario, 'Excluiu anúncio', `${a.anunciante} (${a.impressoes} exibições, ${a.cliques} cliques)`);
  }
  redirecionar(res, '/admin/anuncios?ok=1');
}));

// ======================= PÁGINAS DE CAMPANHA =======================
rota('GET', '/para/:publico', ({ res, usuario, params }) => {
  const cfg = PUBLICOS[params.publico];
  if (!cfg) return redirecionar(res, '/');
  const ativos = db.prepare("SELECT * FROM produtos WHERE ativo = 1 AND endpoint <> ''").all();
  const produtos = cfg.consultas.map((e) => ativos.find((p) => p.endpoint === e)).filter(Boolean);
  const consultasFeitas = db.prepare("SELECT COUNT(*) n FROM consultas WHERE status = 'concluida'").get().n;
  const menor = Math.min(...produtos.map((p) => p.preco_centavos).filter((v) => v > 0), Infinity);
  html(res, P.layout({ titulo: cfg.titulo, descricao: cfg.descricaoMeta, minimo: true,
    corpo: paginaLanding({ chave: params.publico, cfg, produtos, bonus: bonusPrimeira(), consultasFeitas, menor: Number.isFinite(menor) ? menor : 0 }), usuario }));
});

rota('GET', '/admin/campanhas', exigeAdmin(({ res, usuario, url }) => {
  const { ini, fim } = periodoDe(url);
  const linhas = db.prepare(`
    SELECT CASE WHEN u.utm_campaign <> '' THEN u.utm_campaign WHEN u.origem <> '' THEN u.origem ELSE '(direto)' END AS campanha,
      CASE WHEN u.utm_source <> '' THEN u.utm_source WHEN u.origem = 'indicacao' THEN 'indicação' WHEN u.origem <> '' THEN 'página de campanha' ELSE '-' END AS fonte,
      COUNT(*) AS cadastros,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM recargas r WHERE r.usuario_id = u.id AND r.status = 'paga') THEN 1 ELSE 0 END) AS pagantes,
      COALESCE(SUM((SELECT SUM(valor_centavos) FROM recargas r WHERE r.usuario_id = u.id AND r.status = 'paga')), 0) AS recarregado,
      COALESCE(SUM((SELECT COUNT(*) FROM consultas c WHERE c.usuario_id = u.id AND c.status = 'concluida')), 0) AS consultas,
      COALESCE(SUM((SELECT SUM(c.preco_centavos - c.comissao_centavos - c.custo_centavos) FROM consultas c WHERE c.usuario_id = u.id AND c.status = 'concluida')), 0) AS lucro
    FROM usuarios u WHERE (u.admin = 0 AND u.interno = 0) AND date(u.criado_em, '-3 hours') BETWEEN ? AND ?
    GROUP BY campanha, fonte ORDER BY lucro DESC, cadastros DESC`).all(ini, fim);
  pagina(res, 'Admin · Campanhas', PD.adminCampanhas({ ini, fim, linhas, rastreio: RASTREIO, base: process.env.URL_BASE || '' }), usuario);
}));

// ======================= ÁREA LIMPA NOME =======================
rota('GET', '/limpa-nome', exigeLogin(async ({ res, usuario }) => {
  const todos = produtosPara(usuario);
  pagina(res, 'Área Limpa Nome', PA.paginaLimpaNome({
    economicas: todos.filter((p) => p.destaque_limpa_nome === 'economica').sort((a, b) => a.preco_centavos - b.preco_centavos),
    completas: todos.filter((p) => p.destaque_limpa_nome === 'completa').sort((a, b) => a.preco_centavos - b.preco_centavos),
    saldo: await saldoExibido(usuario), admin: !!usuario.interno,
    servico: lnCfg().ativo || usuario.admin ? lnCfgComTabela() : null,
  }), usuario);
}));

// ======================= EBOOK (produto digital, entrega automática) =======================
const ebookCfg = () => ({
  ativo: lerConfig('ebook_ativo') === '1', preco: Number(lerConfig('ebook_preco') || 2700), precoDe: Number(lerConfig('ebook_preco_de') || 0),
  arquivo: lerConfig('ebook_arquivo') || '',
});
const EBOOK = 'ebook-nome-limpo';
const EBOOK_NOME = 'Nome Limpo e Score Alto';
const comprouEbook = (uid) => db.prepare("SELECT * FROM compras_digitais WHERE usuario_id = ? AND produto = ? AND status = 'paga' ORDER BY id DESC").get(uid, EBOOK);
async function arquivoEbook() {
  const c = ebookCfg();
  if (!c.arquivo) return null;
  try { return await readFile(path.join(pastaProdutos, path.basename(c.arquivo))); } catch { return null; }
}
async function entregarEbook(compra) {
  const u = db.prepare('SELECT nome, email FROM usuarios WHERE id = ?').get(compra.usuario_id);
  if (!u || !process.env.RESEND_API_KEY) return;
  const pdf = await arquivoEbook();
  const base = baseEmails();
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F4F1F7;font-family:Arial,Helvetica,sans-serif;color:#0F0C14">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:18px;overflow:hidden">
<tr><td style="background:#0F0C14;padding:20px 28px;color:#fff;font-weight:bold;font-size:18px">Soft <span style="color:#C98BEB;font-weight:normal">Consultas</span></td></tr>
<tr><td style="padding:28px;font-size:16px;line-height:1.55"><h1 style="font-size:21px;margin:0 0 12px">Seu guia chegou! 📘</h1>
<p>Olá, ${P.esc(String(u.nome).split(' ')[0])}! Obrigado pela compra do <strong>${EBOOK_NOME}</strong>. ${pdf ? 'O PDF está em anexo neste e-mail.' : ''} Você também pode baixar quando quiser pela sua conta:</p>
<p style="margin:24px 0"><a href="${base}/ebook/baixar" style="display:inline-block;background:#9F31D3;color:#fff;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:bold">Baixar meu guia</a></p>
<p><strong>Comece pelo capítulo 1:</strong> o primeiro passo é saber exatamente o que tem no seu nome. Você pode consultar o seu CPF na Soft Consultas e ver tudo em um relatório só.</p>
<p style="font-size:13px;color:#7A7285">Você tem 7 dias de garantia: se não gostar, é só responder este e-mail pedindo o reembolso.</p></td></tr></table></td></tr></table></body></html>`;
  await enviarEmail({ para: u.email, assunto: `📘 Seu guia "${EBOOK_NOME}" chegou`, html,
    anexos: pdf ? [{ filename: 'nome-limpo-score-alto.pdf', content: pdf.toString('base64') }] : undefined }).catch((e) => console.error('entrega ebook:', e.message));
}
function confirmarCompraDigital(id) {
  const ok = db.prepare("UPDATE compras_digitais SET status = 'paga', pago_em = datetime('now') WHERE id = ? AND status <> 'paga'").run(id).changes === 1;
  if (ok) {
    const c = db.prepare('SELECT * FROM compras_digitais WHERE id = ?').get(id);
    registrar(null, 'Ebook: venda paga', `#${id} · ${P.reais(c.valor_centavos)} · ${c.forma}`);
    { const u = db.prepare('SELECT nome, email, telefone FROM usuarios WHERE id = ?').get(c.usuario_id) || {};
      capiCompra({ eid: `dig-${id}`, valor: c.valor_centavos, email: u.email, telefone: u.telefone, nome: u.nome, usuarioId: c.usuario_id, conteudo: 'Ebook' }); }
    entregarEbook(c).catch(() => {});
  }
  return ok;
}

// Página de vendas (pública)
rota('GET', '/ebook', ({ res, usuario }) => {
  const cfg = ebookCfg();
  if (!cfg.ativo && !usuario?.admin) return pagina(res, EBOOK_NOME, P.paginaEmBreve(EBOOK_NOME, 'Em breve: o guia prático para limpar o nome e aumentar o score.'), usuario);
  pagina(res, `${EBOOK_NOME} · Guia prático`, SV.paginaVendaEbook({ cfg, comprou: usuario ? !!comprouEbook(usuario.id) : false }), usuario,
    200, undefined);
});

// Comprar: sem conta → cadastro grátis e volta para cá
rota('GET', '/ebook/comprar', ({ res, usuario, req }) => {
  if (!usuario) return redirecionar(res, '/cadastro?origem=ebook', { 'Set-Cookie': 'sc_voltar=%2Febook%2Fcomprar; Path=/; Max-Age=1800; HttpOnly; SameSite=Lax' });
  const cfg = ebookCfg();
  if (comprouEbook(usuario.id)) return redirecionar(res, '/ebook/baixar');
  if (!cfg.ativo && !usuario.admin) return redirecionar(res, '/ebook');
  pagina(res, 'Comprar o guia', SV.paginaCheckoutEbook({ cfg, usuario }), usuario);
});

rota('POST', '/ebook/comprar', exigeLogin(async ({ req, res, usuario }) => {
  const cfg = ebookCfg();
  const f = await corpoForm(req);
  const erro = (m) => pagina(res, 'Comprar o guia', SV.paginaCheckoutEbook({ cfg, usuario, erro: m }), usuario, 400);
  if (comprouEbook(usuario.id)) return redirecionar(res, '/ebook/baixar');
  if (!cfg.ativo && !usuario.admin) return redirecionar(res, '/ebook');
  if (!cfg.arquivo) return erro('O guia ainda não está disponível. Tente mais tarde.');
  if (!usuario.documento) {
    const doc = A.soNumeros(f.documento);
    if (!A.documentoValido(doc)) return erro('Informe um CPF válido para emitir o pagamento.');
    db.prepare('UPDATE usuarios SET documento = ? WHERE id = ?').run(doc, usuario.id); usuario.documento = doc;
  }
  const forma = f.forma === 'cartao' ? 'cartao' : 'pix';
  const aberta = db.prepare("SELECT id FROM compras_digitais WHERE usuario_id = ? AND produto = ? AND status = 'pendente' AND forma = ? AND asaas_id IS NOT NULL AND criado_em > datetime('now', '-2 hours') ORDER BY id DESC").get(usuario.id, EBOOK, forma);
  if (aberta && forma === 'pix') return redirecionar(res, `/ebook/pedido/${aberta.id}`);
  if (!A.limitar(`ebk:${usuario.id}`, 5, 60)) return erro('Muitas tentativas. Aguarde alguns minutos.');
  const id = Number(db.prepare('INSERT INTO compras_digitais (usuario_id, produto, valor_centavos, forma) VALUES (?, ?, ?, ?)').run(usuario.id, EBOOK, cfg.preco, forma).lastInsertRowid);
  try {
    let clienteId = db.prepare('SELECT asaas_cliente_id FROM usuarios WHERE id = ?').get(usuario.id).asaas_cliente_id;
    if (!clienteId) { clienteId = (await AS.criarCliente(usuario)).id; db.prepare('UPDATE usuarios SET asaas_cliente_id = ? WHERE id = ?').run(clienteId, usuario.id); }
    const cob = await AS.criarCobrancaDigital({ clienteId, valorCentavos: cfg.preco, compraId: id, forma, descricao: `Ebook ${EBOOK_NOME} - Soft Consultas #${id}` });
    let pix = null;
    if (forma === 'pix') { try { pix = await AS.pixQrCode(cob.id); } catch (e) { console.warn('Pix indisponível:', e.message); } }
    db.prepare('UPDATE compras_digitais SET asaas_id = ?, pix_codigo = ?, pix_imagem = ?, link_pagamento = ? WHERE id = ?').run(cob.id, pix?.payload || null, pix?.encodedImage || null, cob.invoiceUrl || null, id);
    if (forma === 'cartao' && cob.invoiceUrl) return redirecionar(res, cob.invoiceUrl);
    redirecionar(res, `/ebook/pedido/${id}`);
  } catch (e) {
    console.error('ebook:', e.message);
    db.prepare("UPDATE compras_digitais SET status = 'expirada' WHERE id = ?").run(id);
    erro('Não foi possível gerar o pagamento agora. Tente de novo em instantes.');
  }
}));

rota('GET', '/ebook/pedido/:id', exigeLogin(({ res, usuario, params }) => {
  const c = db.prepare('SELECT * FROM compras_digitais WHERE id = ? AND usuario_id = ?').get(Number(params.id), usuario.id);
  if (!c) return redirecionar(res, '/ebook');
  if (c.status === 'paga') return redirecionar(res, '/ebook/baixar');
  pagina(res, 'Pagar o guia', SV.paginaPagarEbook({ c }), usuario);
}));

rota('GET', '/api/ebook/:id/status', async ({ res, usuario, params }) => {
  if (!usuario) return json(res, { pago: false }, 401);
  const c = db.prepare('SELECT * FROM compras_digitais WHERE id = ? AND usuario_id = ?').get(Number(params.id), usuario.id);
  if (!c) return json(res, { pago: false }, 404);
  if (c.status === 'paga') return json(res, { pago: true, valor: c.valor_centavos / 100, eid: `dig-${c.id}` });
  if (c.asaas_id && A.limitar(`stebk:${c.id}`, 30, 5)) {
    try {
      const cob = await AS.buscarCobranca(c.asaas_id);
      if (AS.STATUS_PAGO.includes(cob.status) && Math.round(Number(cob.value) * 100) >= c.valor_centavos) { confirmarCompraDigital(c.id); return json(res, { pago: true, valor: c.valor_centavos / 100, eid: `dig-${c.id}` }); }
    } catch (e) { console.warn('status ebook:', e.message); }
  }
  json(res, { pago: false });
});

rota('GET', '/ebook/baixar', exigeLogin(({ res, usuario }) => {
  const c = comprouEbook(usuario.id);
  if (!c && !usuario.admin) return redirecionar(res, '/ebook');
  pagina(res, 'Meu guia', SV.paginaBaixarEbook({ c }), usuario);
}));

rota('GET', '/ebook/arquivo', exigeLogin(async ({ res, usuario }) => {
  const c = comprouEbook(usuario.id);
  if (!c && !usuario.admin) return redirecionar(res, '/ebook');
  const pdf = await arquivoEbook();
  if (!pdf) { res.writeHead(404); return res.end('Arquivo indisponível'); }
  if (c) db.prepare('UPDATE compras_digitais SET downloads = downloads + 1 WHERE id = ?').run(c.id);
  res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="nome-limpo-score-alto.pdf"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(pdf);
}));

// ---------- Admin ----------
rota('GET', '/admin/ebook', exigeAdmin(async ({ res, usuario, url }) => {
  const compras = db.prepare('SELECT c.*, u.email AS cliente FROM compras_digitais c JOIN usuarios u ON u.id = c.usuario_id ORDER BY c.id DESC LIMIT 300').all();
  const pagas = compras.filter((c) => c.status === 'paga');
  const pdf = await arquivoEbook();
  pagina(res, 'Admin · Ebook', SV.adminEbook({ menu: PD.menu('/admin/ebook'), cfg: ebookCfg(), compras, vendas: pagas.length, receita: pagas.reduce((s, c) => s + c.valor_centavos, 0),
    tamanho: pdf ? pdf.length : 0, ok: url.searchParams.get('ok') || '', erro: url.searchParams.get('erro') || '' }), usuario);
}));

rota('POST', '/admin/ebook', exigeAdmin(async ({ req, res, usuario }) => {
  const volta = (m, ok) => redirecionar(res, `/admin/ebook?${ok ? 'ok' : 'erro'}=${encodeURIComponent(m)}`);
  let form;
  try { form = await corpoMultipart(req, 25 * 1024 * 1024); } catch (e) { return volta(e.message === 'arquivo grande demais' ? 'PDF grande demais (máximo 25 MB).' : 'Não foi possível ler o formulário.'); }
  const f = form.campos, pdf = form.arquivos.pdf;
  const preco = centavos(f.preco), de = String(f.preco_de || '').trim() ? centavos(f.preco_de) : 0;
  if (!Number.isFinite(preco) || preco < 500) return volta('Preço inválido (mínimo R$ 5,00).');
  if (!Number.isFinite(de) || de < 0) return volta('Preço "de" inválido.');
  if (pdf) {
    if (pdf.dados.subarray(0, 5).toString() !== '%PDF-') return volta('O arquivo precisa ser um PDF.');
    const nome = `ebook-${Date.now()}.pdf`;
    await writeFile(path.join(pastaProdutos, nome), pdf.dados);
    const antigo = lerConfig('ebook_arquivo');
    gravarConfig('ebook_arquivo', nome);
    if (antigo) await unlink(path.join(pastaProdutos, path.basename(antigo))).catch(() => {});
  }
  if (f.ativo === '1' && !lerConfig('ebook_arquivo')) return volta('Envie o PDF do guia antes de ligar a venda.');
  gravarConfig('ebook_ativo', f.ativo === '1' ? '1' : '0'); gravarConfig('ebook_preco', String(preco)); gravarConfig('ebook_preco_de', String(de));
  registrar(usuario, 'Ebook: configuração', `${f.ativo === '1' ? 'à venda' : 'fora do ar'} · ${P.reais(preco)}${pdf ? ' · novo PDF enviado' : ''}`);
  volta('Salvo.', true);
}));

rota('POST', '/admin/ebook/reenviar', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const c = db.prepare("SELECT * FROM compras_digitais WHERE id = ? AND status = 'paga'").get(Number(f.id));
  if (!c) return redirecionar(res, '/admin/ebook?erro=' + encodeURIComponent('Compra não encontrada.'));
  await entregarEbook(c);
  registrar(usuario, 'Ebook: reenviou o guia', `#${c.id}`);
  redirecionar(res, '/admin/ebook?ok=' + encodeURIComponent('E-mail com o guia reenviado.'));
}));

// ======================= RAIO-X DO CPF (venda avulsa: página de vendas → Pix/cartão → PDF no e-mail) =======================
const raioxCfg = () => ({
  ativo: lerConfig('raiox_ativo') === '1', preco: Number(lerConfig('raiox_preco') || 3790), precoDe: Number(lerConfig('raiox_preco_de') || 0),
  produto: lerConfig('raiox_produto') || 'cred-completa-plus',
});
const produtoRaioX = () => db.prepare("SELECT * FROM produtos WHERE slug = ? AND endpoint <> ''").get(raioxCfg().produto);
const arquivoRaioX = (id) => path.join(pastaProdutos, `raiox-${Number(id)}.pdf`);
const pedidoRX = (token) => (/^[a-f0-9]{32}$/.test(String(token)) ? db.prepare('SELECT * FROM raiox_pedidos WHERE token = ?').get(token) : null);
const raioxEmAndamento = new Set();

function confirmarRaioX(id) {
  const ok = db.prepare("UPDATE raiox_pedidos SET status = 'paga', pago_em = datetime('now') WHERE id = ? AND status <> 'paga'").run(id).changes === 1;
  if (ok) {
    const p = db.prepare('SELECT * FROM raiox_pedidos WHERE id = ?').get(id);
    registrar(null, 'Raio-X: venda paga', `#${id} · ${p.email} · ${P.reais(p.valor_centavos)} · ${p.forma}`);
    capiCompra({ eid: `rx-${id}`, valor: p.valor_centavos, email: p.email, telefone: p.whatsapp, nome: p.nome, chave: `rx-${id}`, conteudo: 'Raio-X' });
    entregarRaioX(id);
  }
  return ok;
}

// Consulta → diagnóstico → PDF → e-mail (com o PDF em anexo)
async function entregarRaioX(id, { reenviar = false } = {}) {
  if (raioxEmAndamento.has(id)) return;
  raioxEmAndamento.add(id);
  try {
    const p = db.prepare('SELECT * FROM raiox_pedidos WHERE id = ?').get(id);
    if (!p || p.status !== 'paga') return;
    let pdf = null;
    if (p.entregue_em) { try { pdf = await readFile(arquivoRaioX(p.id)); } catch {} }
    if (!pdf) {
      const produto = produtoRaioX();
      if (!produto) throw new Error('consulta do Raio-X não configurada');
      db.prepare('UPDATE raiox_pedidos SET tentativas = tentativas + 1 WHERE id = ?').run(p.id);
      const dados = await consultarApiFull(produto, p.documento);
      limparCacheSaldo();
      const resumo = montarResumoRX(dados);
      const diag = montarDiagnosticoRX(resumo, p.documento, { limpaNome: lnCfg().ativo ? lnCfg() : null });
      pdf = await gerarRaioXPDF({ nome: resumo.cadastro?.nome || p.nome, documento: p.documento, resumo, diagnostico: diag, fonte: 'Boa Vista (SCPC)' });
      await writeFile(arquivoRaioX(p.id), pdf);
      db.prepare("UPDATE raiox_pedidos SET entregue_em = datetime('now'), erro = NULL, resumo = ? WHERE id = ?")
        .run(JSON.stringify({ nivel: diag.nivel, titulo: diag.titulo, score: resumo.score?.valor ?? null, qtd: resumo.quantidade, total: resumo.total, custo: produto.custo_centavos }), p.id);
      registrar(null, 'Raio-X: entregue', `#${p.id} · ${p.email} · ${diag.titulo}`);
    }
    const r = JSON.parse(db.prepare('SELECT resumo FROM raiox_pedidos WHERE id = ?').get(p.id).resumo || '{}');
    const base = baseEmails();
    await enviarEmail({ para: p.email, assunto: `🩺 Seu Raio-X do ${String(p.documento).length === 14 ? 'CNPJ' : 'CPF'} está pronto`,
      html: `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F4F1F7;font-family:Arial,Helvetica,sans-serif;color:#0F0C14">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:18px;overflow:hidden">
<tr><td style="background:#0F0C14;padding:20px 28px;color:#fff;font-weight:bold;font-size:18px">Soft <span style="color:#C98BEB;font-weight:normal">Consultas</span> · Raio-X</td></tr>
<tr><td style="padding:28px;font-size:16px;line-height:1.55"><h1 style="font-size:21px;margin:0 0 12px">Seu Raio-X está pronto 🩺</h1>
<p>Olá, ${P.esc(String(p.nome).split(' ')[0])}! ${r.titulo ? `<strong>${P.esc(r.titulo)}.</strong> ` : ''}O relatório completo está <strong>em anexo</strong>: o diagnóstico, tudo o que aparece no seu documento e o <strong>plano de ação</strong> para agora, 30 e 90 dias.</p>
<p style="margin:24px 0"><a href="${base}/raio-x/r/${p.token}" style="display:inline-block;background:#9F31D3;color:#fff;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:bold">Abrir meu Raio-X</a></p>
<p style="font-size:14px">Comece pelo item 1 do plano ainda hoje. Quanto antes, melhor.</p>
<p style="font-size:12px;color:#7A7285">Soft Consultas · Soft Solutions Technology Ltda · CNPJ 20.801.827/0001-01</p></td></tr></table></td></tr></table></body></html>`,
      anexos: [{ filename: 'raio-x-soft-consultas.pdf', content: pdf.toString('base64') }] });
    db.prepare("UPDATE raiox_pedidos SET erro = NULL, email_enviado_em = datetime('now') WHERE id = ?").run(p.id);
    falhasRX.delete(id);
    if (reenviar) registrar(null, 'Raio-X: e-mail reenviado', `#${p.id}`);
  } catch (e) {
    console.error('raio-x', id, e.message);
    db.prepare('UPDATE raiox_pedidos SET erro = ? WHERE id = ?').run(String(e.message).slice(0, 300), id);
    registrar(null, 'Raio-X: falha na entrega', `#${id} · ${e.message}`);
    // Nova tentativa automática em 2, 10 e 30 minutos; na primeira falha, avisa o admin por e-mail
    const n = (falhasRX.get(id) || 0) + 1;
    falhasRX.set(id, n);
    const espera = [2, 10, 30][n - 1];
    if (espera && !reenviar) setTimeout(() => entregarRaioX(id), espera * 60 * 1000).unref();
    if (n === 1) avisarAdminRaioX(id, e.message);
  } finally { raioxEmAndamento.delete(id); }
}
const falhasRX = new Map();
function avisarAdminRaioX(id, motivo) {
  const p = db.prepare('SELECT nome, email, documento FROM raiox_pedidos WHERE id = ?').get(id);
  const admins = String(process.env.ADMIN_EMAIL || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!p || !admins.length) return;
  const base = baseEmails();
  enviarEmail({ para: admins[0], assunto: `⚠️ Raio-X #${id} pago e não entregue`,
    html: `<p>O Raio-X <strong>#${id}</strong> foi pago, mas a entrega falhou.</p><p>Cliente: ${P.esc(p.nome)} · ${P.esc(p.email)}<br>Motivo: <strong>${P.esc(motivo)}</strong></p><p>O sistema tenta de novo sozinho em 2, 10 e 30 minutos. Se continuar falhando, use "Gerar de novo" em <a href="${base}/admin/raio-x/vendas">Admin → Vendas Raio-X</a>.</p>` })
    .catch((e) => console.error('aviso admin raio-x:', e.message));
}
// Pagos e não entregues (ex.: APIFull fora do ar) ou com o e-mail não enviado: tenta de novo a cada 30 min, até 5 vezes
setInterval(() => {
  for (const p of db.prepare("SELECT id FROM raiox_pedidos WHERE status = 'paga' AND ((entregue_em IS NULL AND tentativas < 5) OR (entregue_em IS NOT NULL AND email_enviado_em IS NULL))").all()) {
    if ((falhasRX.get(p.id) || 0) < 8) entregarRaioX(p.id);
  }
}, 30 * 60 * 1000).unref();

// Página de vendas com o formulário (sem cadastro)
rota('GET', '/raio-x', ({ res, usuario, url }) => {
  const cfg = raioxCfg();
  if (!cfg.ativo && !usuario?.admin) return pagina(res, 'Raio-X do CPF', P.paginaEmBreve('Raio-X do CPF', 'Em breve: o diagnóstico completo do seu CPF com plano de ação personalizado.'), usuario);
  pagina(res, 'Raio-X do CPF', SV.paginaVendaRaioX({ cfg, v: { nome: usuario?.nome, email: usuario?.email, whatsapp: usuario?.telefone, documento: usuario?.documento } }), usuario);
});

rota('POST', '/raio-x', async ({ req, res, usuario }) => {
  const cfg = raioxCfg();
  const f = await corpoForm(req);
  const erro = (m) => pagina(res, 'Raio-X do CPF', SV.paginaVendaRaioX({ cfg, v: f, erro: m }), usuario, 400);
  if (!cfg.ativo && !usuario?.admin) return redirecionar(res, '/raio-x');
  if (!produtoRaioX()) return erro('O Raio-X está indisponível no momento. Tente mais tarde.');
  const nome = String(f.nome || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const email = String(f.email || '').trim().toLowerCase().slice(0, 120);
  const whats = A.soNumeros(f.whatsapp).slice(0, 13);
  const doc = A.soNumeros(f.documento);
  if (nome.split(' ').length < 2) return erro('Informe seu nome completo.');
  if (!A.documentoValido(doc)) return erro('Informe um CPF ou CNPJ válido.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erro('Informe um e-mail válido: é para ele que enviamos o Raio-X.');
  if (whats && (whats.length < 10 || whats.length > 13)) return erro('Informe o WhatsApp com DDD (ou deixe em branco).');
  if (f.aceite !== '1') return erro('Marque a declaração para continuar.');
  if (!A.limitar(`rx:${ipDe(req)}`, 8, 60)) return erro('Muitas tentativas. Aguarde alguns minutos.');
  const forma = f.forma === 'cartao' ? 'cartao' : 'pix';
  const aberto = db.prepare("SELECT token FROM raiox_pedidos WHERE email = ? AND documento = ? AND status = 'pendente' AND forma = 'pix' AND asaas_id IS NOT NULL AND criado_em > datetime('now', '-2 hours') ORDER BY id DESC").get(email, doc);
  if (aberto && forma === 'pix') return redirecionar(res, `/raio-x/r/${aberto.token}`);
  const token = randomBytes(16).toString('hex');
  let org = {}; try { org = JSON.parse(cookies(req).sc_origem || '{}') || {}; } catch {}
  const id = Number(db.prepare('INSERT INTO raiox_pedidos (token, nome, email, whatsapp, documento, valor_centavos, forma, aceite_ip, origem) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(token, nome, email, whats || null, doc, cfg.preco, forma, ipDe(req), String(org.utm_campaign || org.origem || '').slice(0, 80)).lastInsertRowid);
  guardarRastreio(req, `rx-${id}`);
  try {
    const cli = await AS.criarCliente({ nome, documento: doc, email, telefone: whats || undefined });
    const cob = await AS.criarCobrancaDigital({ clienteId: cli.id, valorCentavos: cfg.preco, compraId: id, forma, prefixo: AS.PREFIXO_RAIOX, descricao: `Raio-X do ${doc.length === 14 ? 'CNPJ' : 'CPF'} - Soft Consultas #${id}` });
    let pix = null;
    if (forma === 'pix') { try { pix = await AS.pixQrCode(cob.id); } catch (e) { console.warn('Pix indisponível:', e.message); } }
    db.prepare('UPDATE raiox_pedidos SET asaas_id = ?, pix_codigo = ?, pix_imagem = ?, link_pagamento = ? WHERE id = ?').run(cob.id, pix?.payload || null, pix?.encodedImage || null, cob.invoiceUrl || null, id);
    if (forma === 'cartao' && cob.invoiceUrl) return redirecionar(res, cob.invoiceUrl);
    redirecionar(res, `/raio-x/r/${token}`);
  } catch (e) {
    console.error('raio-x:', e.message);
    db.prepare("UPDATE raiox_pedidos SET status = 'expirada' WHERE id = ?").run(id);
    erro('Não foi possível gerar o pagamento agora. Tente de novo em instantes.');
  }
});

// Página do pedido (link secreto): pagamento → "enviamos para o seu e-mail" → baixar
rota('GET', '/raio-x/r/:token', ({ res, usuario, params }) => {
  const p = pedidoRX(params.token);
  if (!p) return redirecionar(res, '/raio-x');
  pagina(res, 'Meu Raio-X', SV.paginaPedidoRaioX({ p }), usuario);
});
rota('GET', '/api/raio-x/:token/status', async ({ res, params }) => {
  const p = pedidoRX(params.token);
  if (!p) return json(res, { pago: false }, 404);
  if (p.status === 'paga') return json(res, { pago: true, entregue: !!p.entregue_em, valor: p.valor_centavos / 100, eid: `rx-${p.id}` });
  if (p.asaas_id && A.limitar(`strx:${p.id}`, 30, 5)) {
    try {
      const cob = await AS.buscarCobranca(p.asaas_id);
      if (AS.STATUS_PAGO.includes(cob.status) && Math.round(Number(cob.value) * 100) >= p.valor_centavos) { confirmarRaioX(p.id); return json(res, { pago: true, entregue: false, valor: p.valor_centavos / 100, eid: `rx-${p.id}` }); }
    } catch (e) { console.warn('status raio-x:', e.message); }
  }
  json(res, { pago: false });
});
rota('GET', '/raio-x/r/:token/pdf', async ({ res, params }) => {
  const p = pedidoRX(params.token);
  if (!p || p.status !== 'paga' || !p.entregue_em) return redirecionar(res, p ? `/raio-x/r/${p.token}` : '/raio-x');
  try {
    const pdf = await readFile(arquivoRaioX(p.id));
    db.prepare('UPDATE raiox_pedidos SET downloads = downloads + 1 WHERE id = ?').run(p.id);
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="raio-x-${p.id}.pdf"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' });
    res.end(pdf);
  } catch { redirecionar(res, `/raio-x/r/${p.token}`); }
});

// ---------- Admin ----------
rota('GET', '/admin/raio-x', exigeAdmin(({ res, usuario, url }) => {
  const t = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(valor_centavos), 0) r FROM raiox_pedidos WHERE status = 'paga'").get();
  pagina(res, 'Admin · Raio-X', SV.adminRaioX({ menu: PD.menu('/admin/raio-x'), cfg: raioxCfg(), vendas: t.n, receita: t.r,
    produto: produtoRaioX(), produtos: db.prepare("SELECT slug, nome, custo_centavos FROM produtos WHERE endpoint <> '' AND documento IN ('cpf','cnpj','cpf_cnpj') ORDER BY nome").all(),
    ok: url.searchParams.get('ok') || '', erro: url.searchParams.get('erro') || '' }), usuario);
}));
// Vendas do Raio-X: filtros por período (horário de Brasília), status e busca
function filtroVendasRX(url) {
  const f = { periodo: url.searchParams.get('periodo') || '30', status: url.searchParams.get('status') || '', q: String(url.searchParams.get('q') || '').trim().slice(0, 80) };
  const dia = "date(criado_em, '-3 hours')", hoje = "date('now', '-3 hours')";
  const per = { hoje: `${dia} = ${hoje}`, ontem: `${dia} = date(${hoje}, '-1 day')`, 7: `${dia} >= date(${hoje}, '-6 days')`, 30: `${dia} >= date(${hoje}, '-29 days')`,
    mes: `${dia} >= date(${hoje}, 'start of month')`, mes_ant: `${dia} >= date(${hoje}, 'start of month', '-1 month') AND ${dia} < date(${hoje}, 'start of month')`, tudo: '1=1' };
  if (!per[f.periodo]) f.periodo = '30';
  const onde = [per[f.periodo]], args = [];
  if (f.status === 'nao_entregue') onde.push("status = 'paga' AND entregue_em IS NULL");
  else if (['paga', 'pendente', 'expirada'].includes(f.status)) { onde.push('status = ?'); args.push(f.status); } else f.status = '';
  if (f.q) {
    const n = f.q.replace(/\D/g, '');
    const c = ['nome LIKE ?', 'email LIKE ?']; args.push(`%${f.q}%`, `%${f.q}%`);
    if (n) { c.push('documento LIKE ?', 'whatsapp LIKE ?'); args.push(`%${n}%`, `%${n}%`); if (n.length <= 7) { c.push('id = ?'); args.push(Number(n)); } }
    onde.push(`(${c.join(' OR ')})`);
  }
  return { f, where: onde.join(' AND '), args };
}
rota('GET', '/admin/raio-x/vendas', exigeAdmin(({ res, usuario, url }) => {
  const { f, where, args } = filtroVendasRX(url);
  const pedidos = db.prepare(`SELECT * FROM raiox_pedidos WHERE ${where} ORDER BY id DESC LIMIT 500`).all(...args);
  const todos = db.prepare(`SELECT status, forma, valor_centavos, entregue_em, email_enviado_em, resumo FROM raiox_pedidos WHERE ${where}`).all(...args);
  const pagos = todos.filter((p) => p.status === 'paga');
  const custoPadrao = produtoRaioX()?.custo_centavos || 0;
  const custo = pagos.reduce((s, p) => { if (!p.entregue_em) return s; let r = {}; try { r = JSON.parse(p.resumo || '{}'); } catch {} return s + (Number(r.custo) || custoPadrao); }, 0);
  const receita = pagos.reduce((s, p) => s + p.valor_centavos, 0);
  const k = { pedidos: todos.length, pagos: pagos.length, receita, custo, ticket: pagos.length ? Math.round(receita / pagos.length) : 0,
    conversao: todos.length ? Math.round((pagos.length / todos.length) * 100) : 0,
    pix: pagos.filter((p) => p.forma !== 'cartao').length, cartao: pagos.filter((p) => p.forma === 'cartao').length,
    naoEntregues: pagos.filter((p) => !p.entregue_em || !p.email_enviado_em).length };
  const dias = db.prepare(`SELECT date(COALESCE(pago_em, criado_em), '-3 hours') dia, COUNT(*) vendas, SUM(valor_centavos) receita FROM raiox_pedidos WHERE ${where} AND status = 'paga' GROUP BY dia ORDER BY dia DESC LIMIT 60`).all(...args);
  pagina(res, 'Admin · Vendas Raio-X', SV.adminVendasRaioX({ menu: PD.menu('/admin/raio-x/vendas'), pedidos, f, k, dias,
    ok: url.searchParams.get('ok') || '', erro: url.searchParams.get('erro') || '' }), usuario);
}));
rota('GET', '/admin/raio-x/vendas.csv', exigeAdmin(({ res, usuario, url }) => {
  const { f, where, args } = filtroVendasRX(url);
  const linhas = db.prepare(`SELECT * FROM raiox_pedidos WHERE ${where} ORDER BY id DESC`).all(...args);
  const c = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['Pedido;Criado em;Pago em;Entregue em;Nome;E-mail;WhatsApp;Documento;Valor;Forma;Status;Resultado;Score;Restrições;Erro;Origem;Cobrança Asaas'].concat(linhas.map((p) => {
    let r = {}; try { r = JSON.parse(p.resumo || '{}'); } catch {}
    return [p.id, p.criado_em, p.pago_em, p.entregue_em, p.nome, p.email, p.whatsapp, p.documento, (p.valor_centavos / 100).toFixed(2).replace('.', ','), p.forma, p.status, r.titulo, r.score, r.qtd, p.erro, p.origem, p.asaas_id].map(c).join(';');
  })).join('\r\n');
  registrar(usuario, 'Raio-X: planilha de vendas baixada', `${linhas.length} linha(s) · período ${f.periodo}`);
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="vendas-raio-x-${f.periodo}.csv"`, 'Cache-Control': 'no-store' });
  res.end('﻿' + csv);
}));
rota('POST', '/admin/raio-x', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const destino = /^\/admin\/raio-x\/vendas(\?[^\s]*)?$/.test(String(f.volta || '')) ? String(f.volta) : '/admin/raio-x';
  const volta = (m, ok) => redirecionar(res, `${destino}${destino.includes('?') ? '&' : '?'}${ok ? 'ok' : 'erro'}=${encodeURIComponent(m)}`);
  if (f.acao === 'refazer' || f.acao === 'reenviar' || f.acao === 'conferir') {
    const p = db.prepare('SELECT * FROM raiox_pedidos WHERE id = ?').get(Number(f.id));
    if (!p) return volta('Pedido não encontrado.');
    if (f.acao === 'conferir') {
      try { const cob = await AS.buscarCobranca(p.asaas_id); if (AS.STATUS_PAGO.includes(cob.status)) { confirmarRaioX(p.id); registrar(usuario, 'Raio-X: pagamento conferido', `#${p.id}`); return volta('Pagamento confirmado: o Raio-X está sendo gerado e enviado.', true); } return volta(`Ainda não pago (status ${cob.status}).`); }
      catch (e) { return volta(`Falhou: ${e.message}`); }
    }
    if (p.status !== 'paga') return volta('Esse pedido não está pago.');
    if (f.acao === 'refazer') { db.prepare('UPDATE raiox_pedidos SET entregue_em = NULL, erro = NULL WHERE id = ?').run(p.id); await unlink(arquivoRaioX(p.id)).catch(() => {}); }
    await entregarRaioX(p.id, { reenviar: true });
    registrar(usuario, f.acao === 'refazer' ? 'Raio-X: refeito pelo admin' : 'Raio-X: reenviado pelo admin', `#${p.id}`);
    const d = db.prepare('SELECT erro FROM raiox_pedidos WHERE id = ?').get(p.id);
    return d.erro ? volta(`Falhou: ${d.erro}`) : volta(f.acao === 'refazer' ? 'Raio-X refeito e enviado.' : 'E-mail reenviado.', true);
  }
  const preco = centavos(f.preco), de = String(f.preco_de || '').trim() ? centavos(f.preco_de) : 0;
  if (!Number.isFinite(preco) || preco < 500) return volta('Preço inválido (mínimo R$ 5,00).');
  if (!Number.isFinite(de) || de < 0) return volta('Preço "de" inválido.');
  if (!db.prepare("SELECT 1 FROM produtos WHERE slug = ? AND endpoint <> ''").get(f.produto)) return volta('Escolha uma consulta com endpoint configurado.');
  gravarConfig('raiox_ativo', f.ativo === '1' ? '1' : '0'); gravarConfig('raiox_preco', String(preco)); gravarConfig('raiox_preco_de', String(de)); gravarConfig('raiox_produto', f.produto);
  registrar(usuario, 'Raio-X: configuração', `${f.ativo === '1' ? 'à venda' : 'fora do ar'} · ${P.reais(preco)} · consulta ${f.produto}`);
  volta('Salvo.', true);
}));

// ======================= ÁREA DE PARCEIROS (Limpa Nome) =======================
// O parceiro cadastra o cliente e escolhe: o cliente paga pelo link (parceiro ganha comissão) ou o parceiro paga o atacado.
// Mensalidade do parceiro: assinatura mensal no Asaas; sem mensalidade em dia ele não cadastra clientes novos (acompanha os antigos).
const RODAPE_PARC = 'Você recebe este e-mail porque é parceiro do Limpa Nome da Soft Consultas.';
const hojeBR = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
// Preço de venda do Limpa Nome para o cliente final dos parceiros (separado do preço do site)
// Valores próprios do parceiro por serviço (Limpa Nome usa as colunas antigas; Rating e combo ficam em valores_servicos)
function valoresProprios(x, svc) {
  if (!x) return {};
  if (svc === 'limpa_nome') return { preco: x.preco_centavos ?? null, minimo: x.preco_minimo_centavos ?? null, comissao_tipo: x.comissao_tipo || null, comissao_valor: x.comissao_valor ?? null, atacado: x.atacado_centavos ?? null };
  let j = {}; try { j = JSON.parse(x.valores_servicos || '{}') || {}; } catch {}
  const v = j[svc] || {};
  return { preco: v.preco ?? null, minimo: v.minimo ?? null, comissao_tipo: v.comissao_tipo || null, comissao_valor: v.comissao_valor ?? null, atacado: v.atacado ?? null };
}
const tipoComissao = (t) => (['fixo', 'nossa_parte'].includes(t) ? t : 'percentual');
const tipoComissaoOuNulo = (t) => (['fixo', 'nossa_parte', 'percentual'].includes(t) ? t : null);
const textoTipoComissao = (t, v) => (t === 'nossa_parte' ? `nossa parte fixa ${P.reais(v || 0)}` : t === 'fixo' ? P.reais(v || 0) : `${v || 0}%`);
const chaveParc = (svc) => (svc === 'limpa_nome' ? 'parceiro_' : `parceiro_${svc}_`);
const lnCfgParceiro = (uid = null, svc = 'limpa_nome') => {
  svc = svcOk(svc);
  const c = cfgServico(svc);
  const proprio = uid ? valoresProprios(parceiroRow(uid), svc).preco : null;
  const preco = proprio || Number(lerConfig(`${chaveParc(svc)}preco_centavos`) || 0) || c.preco;
  return { ...c, preco, tabela: SV.tabelaParcelas(preco, c.parcelas, c.juros) };
};
const parceiroRow = (uid) => db.prepare('SELECT * FROM parceiros WHERE usuario_id = ?').get(uid);
function regraParceiro(uid, x = parceiroRow(uid) || {}, svc = 'limpa_nome') {
  svc = svcOk(svc);
  const cfg = lnCfgParceiro(uid, svc), vp = valoresProprios(x, svc), k = chaveParc(svc);
  const proprio = !!vp.comissao_tipo;
  const tipo = tipoComissao(proprio ? vp.comissao_tipo : lerConfig(`${k}comissao_tipo`));
  const valor = Math.max(0, Number(proprio ? vp.comissao_valor : lerConfig(`${k}comissao_valor`)) || 0);
  // "nossa_parte": a Soft Consultas fica com um valor fixo e todo o resto é do parceiro
  const comissao = Math.min(cfg.preco, tipo === 'nossa_parte' ? Math.max(0, cfg.preco - valor) : tipo === 'fixo' ? valor : Math.round((cfg.preco * Math.min(100, valor)) / 100));
  const atac = vp.atacado ?? (Number(lerConfig(`${k}atacado_centavos`) || 0) || null);
  // Preço mínimo: o parceiro pode dar desconto até esse valor (nunca abaixo da nossa parte)
  const minCfg = vp.minimo ?? (Number(lerConfig(`${k}preco_minimo_centavos`) || 0) || null);
  // Com preço de atacado definido, ele é a nossa parte: tudo o que o parceiro cobrar acima disso é comissão dele (sem %)
  if (atac && atac >= 500) {
    const preco = Math.max(cfg.preco, atac);
    return { servico: svc, nomeServico: SERVICOS[svc], disponivel: cfg.ativo && cfg.preco >= 500, comissaoTipo: 'nossa_parte', comissaoValor: atac, comissaoCentavos: preco - atac,
      atacado: atac, preco, nossaParte: atac, precoMinimo: Math.min(preco, Math.max(atac, minCfg || preco)), precoMaximo: preco * 3, porAtacado: true };
  }
  return { servico: svc, nomeServico: SERVICOS[svc], disponivel: cfg.ativo && cfg.preco >= 500, comissaoTipo: tipo, comissaoValor: valor, comissaoCentavos: comissao,
    atacado: atac && atac >= 500 ? atac : null, preco: cfg.preco, nossaParte: cfg.preco - comissao, precoMinimo: Math.min(cfg.preco, Math.max(cfg.preco - comissao, minCfg || cfg.preco)), precoMaximo: cfg.preco * 3 };
}
const regrasParceiro = (uid, x = parceiroRow(uid) || {}) => Object.keys(SERVICOS).map((svc) => regraParceiro(uid, x, svc));
function mensalidadeParceiro(x) {
  const valor = x.mensalidade_centavos ?? Number(lerConfig('parceiro_mensalidade_centavos') || 0);
  const emDia = !!x.isento || valor <= 0 || (x.pago_ate && x.pago_ate >= hojeBR());
  return { valor, isento: !!x.isento || valor <= 0, emDia, pagoAte: x.pago_ate, assinatura: x.assinatura_id, forma: x.assinatura_forma, link: x.assinatura_link };
}
// Credita uma mensalidade paga: estende o acesso por 1 mês a partir do maior entre hoje e o vencimento atual
function creditarMensalidade(uid, pagamentoId) {
  const x = parceiroRow(uid);
  if (!x || (pagamentoId && x.ultimo_pagamento === pagamentoId)) return false;
  const base = x.pago_ate && x.pago_ate > hojeBR() ? x.pago_ate : hojeBR();
  const ate = db.prepare("SELECT date(?, '+1 month') d").get(base).d;
  db.prepare("UPDATE parceiros SET pago_ate = ?, ultimo_pagamento = ?, atualizado_em = datetime('now') WHERE usuario_id = ?").run(ate, pagamentoId || null, uid);
  const u = db.prepare('SELECT nome, email FROM usuarios WHERE id = ?').get(uid);
  registrar(null, 'Parceiro: mensalidade paga', `${u?.email} · acesso até ${ate}`);
  return true;
}
function webhookParceiro(event, payment) {
  const ref = String(payment?.externalReference || '');
  const x = (payment?.subscription && db.prepare('SELECT * FROM parceiros WHERE assinatura_id = ?').get(payment.subscription))
    || (ref.startsWith(AS.PREFIXO_PARCEIRO) && parceiroRow(Number(ref.slice(AS.PREFIXO_PARCEIRO.length))));
  if (!x) return false;
  if (['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(event)) creditarMensalidade(x.usuario_id, payment.id);
  else if (event === 'PAYMENT_CREATED' && x.assinatura_forma === 'pix' && x.ativo) {
    db.prepare('UPDATE parceiros SET assinatura_link = ? WHERE usuario_id = ?').run(payment.invoiceUrl || x.assinatura_link, x.usuario_id);
    const u = db.prepare('SELECT email FROM usuarios WHERE id = ?').get(x.usuario_id);
    emailServico({ para: u?.email, assunto: 'Mensalidade de parceiro disponível', titulo: 'Sua mensalidade de parceiro',
      html: `<p>A mensalidade da sua área de parceiro (<strong>${P.reais(Math.round(Number(payment.value) * 100))}</strong>) já pode ser paga por Pix. Pagando em dia, você continua cadastrando clientes no Limpa Nome sem interrupção.</p>`,
      botao: { href: payment.invoiceUrl || `${baseEmails()}/parceiro`, texto: 'Pagar com Pix' }, rodape: RODAPE_PARC });
  }
  return true;
}
// Quando o webhook falha: confere no Asaas se alguma mensalidade foi paga
async function conferirMensalidade(x) {
  if (!x?.assinatura_id || !A.limitar(`mensp:${x.usuario_id}`, 6, 10)) return;
  try {
    const pags = (await AS.pagamentosAssinatura(x.assinatura_id))?.data || [];
    const pago = pags.filter((p) => AS.STATUS_PAGO.includes(p.status)).sort((a, b) => String(b.dueDate).localeCompare(String(a.dueDate)))[0];
    if (pago && pago.id !== x.ultimo_pagamento && !(x.pago_ate && x.pago_ate >= hojeBR())) creditarMensalidade(x.usuario_id, pago.id);
  } catch (e) { console.warn('mensalidade parceiro:', e.message); }
}
const exigeParceiro = (fn) => exigeLogin(async (ctx) => {
  const x = parceiroRow(ctx.usuario.id);
  if (!x?.ativo) return redirecionar(ctx.res, '/parceiro');
  return fn({ ...ctx, parc: x });
});
const emailParceiroLN = (p, titulo, texto) => {
  if (!p.parceiro_id) return;
  const u = db.prepare('SELECT email FROM usuarios WHERE id = ?').get(p.parceiro_id);
  emailServico({ para: u?.email, assunto: `${titulo} · cliente ${String(p.nome).split(' ')[0]} (#${p.id})`, titulo,
    html: `<p>${texto}</p><p style="font-size:14px;color:#7A7285">Cliente: ${P.esc(p.nome)} · pedido #${p.id}</p>`, botao: { href: `${baseEmails()}/parceiro/cliente/${p.id}`, texto: 'Ver na área do parceiro' }, rodape: RODAPE_PARC });
};

const areaParceiro = async ({ req, res, usuario, url, parc }) => {
  if (!mensalidadeParceiro(parc).emDia && parc.assinatura_id) { await conferirMensalidade(parc); parc = parceiroRow(usuario.id); }
  const pedidos = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE parceiro_id = ? ORDER BY id DESC LIMIT 500').all(usuario.id);
  const n = (f) => pedidos.filter(f).length;
  const k = { total: pedidos.length, aguardando: n((p) => p.status === 'aguardando_pagamento'), pagos: n((p) => p.pago_em && p.status !== 'reembolsado'),
    andamento: n((p) => ['pago', 'em_analise', 'em_lote', 'em_andamento', 'decisao'].includes(p.status)), concluidos: n((p) => p.status === 'concluido'),
    comissoes: db.prepare("SELECT COALESCE(SUM(valor_centavos), 0) s FROM comissoes WHERE usuario_id = ? AND tipo = 'comissao' AND referencia LIKE 'ln_%'").get(usuario.id).s };
  const msgs = { cad: 'Cliente cadastrado.', cancel: 'Pedido cancelado.', mens: 'Mensalidade cancelada. Seu acesso continua até a data já paga.', pref: 'Preferência salva.' };
  pagina(res, 'Área do parceiro', SV.blocoMensalidadeParceiro({ m: mensalidadeParceiro(parc) }) + SV.paginaParceiro({ usuario, mostrarNome: !!parc.mostrar_nome, repasse: parc.repasse_auto ? parc.repasse_pix : null, r: regraParceiro(usuario.id, parc), regras: regrasParceiro(usuario.id, parc), cfg: lnCfgParceiro(usuario.id), pedidos, k, saldo: saldoComissao(usuario.id), base: urlBase(req),
    ok: msgs[url.searchParams.get('ok')] || '', erro: url.searchParams.get('erro') || '' }), usuario);
};
// Quem ainda não é parceiro vê a página de adesão (taxa única); o preço de parceiro/atacado só aparece depois
const adesaoValor = () => Number(lerConfig('parceiro_adesao_centavos') || 0);
rota('GET', '/parceiro', exigeLogin(async (ctx) => {
  const x = parceiroRow(ctx.usuario.id);
  if (x?.ativo) return areaParceiro({ ...ctx, parc: x });
  const aberta = db.prepare("SELECT * FROM parceiro_adesoes WHERE usuario_id = ? AND status = 'pendente' AND criado_em > datetime('now', '-2 days') ORDER BY id DESC").get(ctx.usuario.id);
  pagina(ctx.res, 'Seja parceiro', SV.paginaAdesaoParceiro({ valor: adesaoValor(), cfg: lnCfgComTabela(), bloqueado: !!x && !x.ativo, aberta, erro: ctx.url.searchParams.get('erro') || '' }), ctx.usuario);
}));
rota('POST', '/parceiro/adesao', exigeLogin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const volta = (m) => redirecionar(res, `/parceiro?erro=${encodeURIComponent(m)}`);
  const x = parceiroRow(usuario.id), valor = adesaoValor();
  if (x?.ativo) return redirecionar(res, '/parceiro');
  if (x && !x.ativo) return volta('Sua área de parceiro está suspensa. Fale com o suporte.');
  if (valor < 500) return volta('A adesão de parceiros está fechada no momento.');
  if (f.aceite !== '1') return volta('Aceite os termos de parceria para continuar.');
  const aberta = db.prepare("SELECT * FROM parceiro_adesoes WHERE usuario_id = ? AND status = 'pendente' AND criado_em > datetime('now', '-2 days') ORDER BY id DESC").get(usuario.id);
  if (aberta) return redirecionar(res, aberta.forma === 'cartao' && aberta.link_pagamento ? aberta.link_pagamento : `/parceiro/adesao/${aberta.id}`);
  if (!A.limitar(`ades:${usuario.id}`, 5, 60)) return volta('Muitas tentativas. Aguarde alguns minutos.');
  const cfg = lnCfgComTabela(), tabela = SV.tabelaParcelas(valor, cfg.parcelas, cfg.juros);
  const forma = f.forma === 'cartao' ? 'cartao' : 'pix';
  const parcelas = forma === 'cartao' ? Math.min(cfg.parcelas, Math.max(1, Math.floor(Number(f.parcelas) || 1))) : 1;
  const total = forma === 'cartao' ? tabela[parcelas - 1].total : valor;
  try {
    let clienteId = db.prepare('SELECT asaas_cliente_id FROM usuarios WHERE id = ?').get(usuario.id).asaas_cliente_id;
    if (!clienteId) {
      if (!usuario.documento) return volta('Cadastre o seu CPF ou CNPJ em "Minha conta" para continuar.');
      clienteId = (await AS.criarCliente(usuario)).id;
      db.prepare('UPDATE usuarios SET asaas_cliente_id = ? WHERE id = ?').run(clienteId, usuario.id);
    }
    const id = Number(db.prepare('INSERT INTO parceiro_adesoes (usuario_id, valor_centavos, forma, parcelas) VALUES (?, ?, ?, ?)').run(usuario.id, total, forma, parcelas).lastInsertRowid);
    const cob = await AS.criarCobrancaServico({ clienteId, valorCentavos: total, pedidoId: id, forma, parcelas, prefixo: AS.PREFIXO_ADESAO, descricao: `Adesão à área de parceiros - Soft Consultas #${id}` });
    let pix = null;
    if (forma === 'pix') { try { pix = await AS.pixQrCode(cob.id); } catch (e) { console.warn('Pix adesão:', e.message); } }
    db.prepare('UPDATE parceiro_adesoes SET asaas_id = ?, asaas_parcelamento = ?, pix_codigo = ?, pix_imagem = ?, link_pagamento = ? WHERE id = ?')
      .run(cob.id, cob.installment || null, pix?.payload || null, pix?.encodedImage || null, cob.invoiceUrl || null, id);
    registrar(usuario, 'Parceiro: adesão gerada', `#${id} · ${P.reais(total)} · ${forma}${parcelas > 1 ? ` ${parcelas}x` : ''}`);
    if (forma === 'cartao' && cob.invoiceUrl) return redirecionar(res, cob.invoiceUrl);
    redirecionar(res, `/parceiro/adesao/${id}`);
  } catch (e) { console.error('adesão parceiro:', e.message); volta('Não foi possível gerar o pagamento agora. Tente de novo em instantes.'); }
}));
rota('GET', '/parceiro/adesao/:id', exigeLogin(({ res, usuario, params }) => {
  const a = db.prepare('SELECT * FROM parceiro_adesoes WHERE id = ? AND usuario_id = ?').get(Number(params.id), usuario.id);
  if (!a || a.status === 'paga') return redirecionar(res, '/parceiro');
  pagina(res, 'Adesão de parceiro', SV.paginaPagarAdesao({ a }), usuario);
}));
rota('GET', '/api/parceiro/adesao/:id/status', exigeLogin(async ({ res, usuario, params }) => {
  const a = db.prepare('SELECT * FROM parceiro_adesoes WHERE id = ? AND usuario_id = ?').get(Number(params.id), usuario.id);
  if (!a) return json(res, { pago: false }, 404);
  if (a.status === 'paga') return json(res, { pago: true });
  if (a.asaas_id && A.limitar(`stad:${a.id}`, 30, 5)) {
    try {
      const c = await AS.buscarCobranca(a.asaas_id);
      if (AS.STATUS_PAGO.includes(c.status) && (a.asaas_parcelamento || Math.round(Number(c.value) * 100) >= a.valor_centavos)) { confirmarAdesao(a.id); return json(res, { pago: true }); }
    } catch (e) { console.warn('status adesão:', e.message); }
  }
  json(res, { pago: false });
}));
// Adesão paga: vira parceiro na hora (com o 1º mês de mensalidade incluído)
function confirmarAdesao(id) {
  if (db.prepare("UPDATE parceiro_adesoes SET status = 'paga', pago_em = datetime('now') WHERE id = ? AND status = 'pendente'").run(id).changes !== 1) return false;
  const a = db.prepare('SELECT * FROM parceiro_adesoes WHERE id = ?').get(id);
  const ate = db.prepare("SELECT date('now', '-3 hours', '+1 month') d").get().d;
  if (parceiroRow(a.usuario_id)) db.prepare("UPDATE parceiros SET ativo = 1, pago_ate = MAX(COALESCE(pago_ate, ''), ?), obs = COALESCE(obs, 'Entrou pela adesão'), atualizado_em = datetime('now') WHERE usuario_id = ?").run(ate, a.usuario_id);
  else db.prepare("INSERT INTO parceiros (usuario_id, pago_ate, obs) VALUES (?, ?, 'Entrou pela adesão')").run(a.usuario_id, ate);
  db.prepare('UPDATE usuarios SET parceiro = 1 WHERE id = ?').run(a.usuario_id);
  const u = db.prepare('SELECT nome, email FROM usuarios WHERE id = ?').get(a.usuario_id);
  registrar(null, 'Parceiro: adesão paga (novo parceiro)', `${u?.email} · ${P.reais(a.valor_centavos)}`);
  capiCompra({ eid: `ade-${a.id}`, valor: a.valor_centavos, email: u?.email, nome: u?.nome, usuarioId: a.usuario_id, conteudo: 'Adesão parceiro' });
  emailServico({ para: u?.email, assunto: 'Bem-vindo à área de parceiros · Soft Consultas', titulo: 'Agora você é parceiro!',
    html: `<p>Olá, ${P.esc(String(u?.nome || '').split(' ')[0])}! A sua adesão foi confirmada e a <strong>área de parceiro</strong> já está liberada. Lá você vê os seus preços de parceiro, cadastra clientes de Limpa Nome e Rating Bancário, envia o link de pagamento pelo WhatsApp e acompanha cada etapa.</p>`,
    botao: { href: `${baseEmails()}/parceiro`, texto: 'Abrir minha área de parceiro' }, rodape: RODAPE_PARC });
  return true;
}


// Mensalidade: cria a assinatura mensal e leva para o primeiro pagamento
rota('POST', '/parceiro/mensalidade', exigeParceiro(async ({ req, res, usuario, parc }) => {
  const f = await corpoForm(req);
  const volta = (m) => redirecionar(res, `/parceiro?erro=${encodeURIComponent(m)}`);
  const m = mensalidadeParceiro(parc);
  if (f.acao === 'cancelar') {
    if (parc.assinatura_id) await AS.cancelarAssinatura(parc.assinatura_id).catch((e) => console.warn('cancelar assinatura parceiro:', e.message));
    db.prepare("UPDATE parceiros SET assinatura_id = NULL, assinatura_link = NULL, atualizado_em = datetime('now') WHERE usuario_id = ?").run(usuario.id);
    registrar(usuario, 'Parceiro: cancelou a mensalidade', usuario.email);
    return redirecionar(res, '/parceiro?ok=mens');
  }
  if (m.isento) return volta('Sua área de parceiro não tem mensalidade.');
  if (parc.assinatura_id && m.link && !m.emDia) return redirecionar(res, m.link);
  if (parc.assinatura_id) return volta('Sua mensalidade já está ativa.');
  if (!A.limitar(`assp:${usuario.id}`, 4, 60)) return volta('Muitas tentativas. Aguarde alguns minutos.');
  const forma = f.forma === 'cartao' ? 'cartao' : 'pix';
  try {
    let clienteId = db.prepare('SELECT asaas_cliente_id FROM usuarios WHERE id = ?').get(usuario.id).asaas_cliente_id;
    if (!clienteId) {
      if (!usuario.documento) return volta('Cadastre o seu CPF ou CNPJ em "Minha conta" para gerar a mensalidade.');
      clienteId = (await AS.criarCliente(usuario)).id;
      db.prepare('UPDATE usuarios SET asaas_cliente_id = ? WHERE id = ?').run(clienteId, usuario.id);
    }
    const sub = await AS.criarAssinatura({ clienteId, valorCentavos: m.valor, ciclo: 'mensal', forma, descricao: 'Mensalidade parceiro Limpa Nome - Soft Consultas', ref: `${AS.PREFIXO_PARCEIRO}${usuario.id}` });
    const pag = (await AS.pagamentosAssinatura(sub.id).catch(() => ({ data: [] })))?.data?.[0] || null;
    db.prepare("UPDATE parceiros SET assinatura_id = ?, assinatura_forma = ?, assinatura_link = ?, atualizado_em = datetime('now') WHERE usuario_id = ?").run(sub.id, forma, pag?.invoiceUrl || null, usuario.id);
    registrar(usuario, 'Parceiro: assinou a mensalidade', `${usuario.email} · ${P.reais(m.valor)} · ${forma}`);
    if (pag?.invoiceUrl) return redirecionar(res, pag.invoiceUrl);
    redirecionar(res, '/parceiro');
  } catch (e) { console.error('assinatura parceiro:', e.message); volta('Não foi possível gerar a mensalidade agora. Tente de novo em instantes.'); }
}));

rota('POST', '/parceiro/preferencias', exigeParceiro(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  db.prepare("UPDATE parceiros SET mostrar_nome = ?, atualizado_em = datetime('now') WHERE usuario_id = ?").run(f.mostrar_nome === '1' ? 1 : 0, usuario.id);
  registrar(usuario, 'Parceiro: preferência de identificação', f.mostrar_nome === '1' ? 'mostra o nome ao cliente' : 'não mostra o nome ao cliente');
  redirecionar(res, '/parceiro?ok=pref');
}));
// Nome do parceiro para o cliente: só quando o parceiro escolheu aparecer
const nomeParceiroVisivel = (pid) => { const x = pid && db.prepare('SELECT p.mostrar_nome, u.nome FROM parceiros p JOIN usuarios u ON u.id = p.usuario_id WHERE p.usuario_id = ?').get(pid); return x?.mostrar_nome ? x.nome : null; };
rota('GET', '/parceiro/novo', exigeParceiro(({ res, usuario, parc, url }) => {
  const cfg = lnCfgParceiro(usuario.id);
  if (!regrasParceiro(usuario.id, parc).some((r) => r.disponivel)) return redirecionar(res, '/parceiro');
  if (!mensalidadeParceiro(parc).emDia) return redirecionar(res, `/parceiro?erro=${encodeURIComponent('Ative a mensalidade para cadastrar clientes novos.')}`);
  pagina(res, 'Cadastrar cliente', SV.paginaParceiroNovo({ cfg, regras: regrasParceiro(usuario.id, parc), v: { servico: url.searchParams.get('s') || '' } }), usuario);
}));

rota('POST', '/parceiro/novo', exigeParceiro(async ({ req, res, usuario, parc }) => {
  let cfg = lnCfgParceiro(usuario.id), r = regraParceiro(usuario.id, parc);
  const regras = regrasParceiro(usuario.id, parc);
  let v = {};
  const erro = (m) => pagina(res, 'Cadastrar cliente', SV.paginaParceiroNovo({ cfg, regras, v, erro: m }), usuario, 400);
  if (!mensalidadeParceiro(parc).emDia) return erro('Ative a mensalidade de parceiro para cadastrar clientes novos.');
  let form;
  try { form = await corpoMultipart(req, 11 * 1024 * 1024); } catch (e) { return erro(e.message === 'arquivo grande demais' ? 'Arquivos grandes demais (até 5 MB cada).' : 'Não foi possível ler o formulário.'); }
  v = form.campos;
  const svc = svcOk(v.servico);
  r = regraParceiro(usuario.id, parc, svc); cfg = lnCfgParceiro(usuario.id, svc);
  if (!r.disponivel) return erro(`${r.nomeServico} não está recebendo pedidos no momento.`);
  const modelo = 'comissao'; // o cliente sempre paga o valor cheio pelo link; o atacado é a nossa parte
  if (modelo === 'atacado' && !r.atacado) return erro('O modelo de atacado não está liberado para você.');
  const nome = String(v.nome || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const cpf = A.soNumeros(v.cpf);
  const nasc = String(v.nascimento || '');
  const tel = A.soNumeros(v.telefone);
  const email = String(v.email || '').trim().toLowerCase().slice(0, 120);
  const docTipo = v.doc_tipo === 'CNH' ? 'CNH' : 'RG';
  const forma = modelo === 'atacado' && v.forma === 'cartao' ? 'cartao' : 'pix';
  if (nome.split(' ').length < 2) return erro('Informe o nome completo do titular.');
  if (!((cpf.length === 11 || cpf.length === 14) && A.documentoValido(cpf))) return erro('CPF ou CNPJ inválido.');
  const anos = (Date.now() - Date.parse(nasc)) / (365.25 * 86400000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nasc) || !(anos >= 18 && anos < 120)) return erro('Informe uma data de nascimento válida (o titular ou sócio precisa ser maior de idade).');
  if (tel.length < 10 || tel.length > 13) return erro('Informe o WhatsApp do cliente com DDD.');
  if (!A.emailValido(email)) return erro('Informe um e-mail válido do cliente.');
  if (v.aceite !== '1') return erro('Confirme que você tem a autorização do titular.');
  // Preço ao cliente: o parceiro pode cobrar o sugerido ou mais; a nossa parte é fixa e o que passar dela é comissão dele
  let venda = r.preco;
  if (modelo === 'comissao' && String(v.preco_venda || '').trim()) {
    venda = centavos(v.preco_venda);
    if (!Number.isFinite(venda)) return erro('Valor de venda inválido. Use, por exemplo, 1.800,00.');
    if (venda < r.precoMinimo) return erro(`O valor mínimo para o cliente é ${P.reais(r.precoMinimo)}.`);
    if (venda > r.precoMaximo) return erro(`O valor máximo é ${P.reais(r.precoMaximo)}. Confira se digitou certo.`);
  }
  const comissaoPedido = modelo === 'comissao' ? Math.max(0, venda - r.nossaParte) : 0;
  if (db.prepare(`SELECT 1 FROM limpa_nome_pedidos WHERE cpf = ? AND servico IN ${familiaServico(svc)} AND status IN ('pago','em_analise','em_lote','em_andamento','decisao')`).get(cpf)) return erro('Já existe um pedido em andamento para este CPF/CNPJ.');
  if (db.prepare("SELECT 1 FROM limpa_nome_pedidos WHERE cpf = ? AND parceiro_id = ? AND servico = ? AND status = 'aguardando_pagamento'").get(cpf, usuario.id, svc)) return erro('Você já tem um pedido aguardando pagamento para este CPF/CNPJ. Reenvie o link ou cancele o anterior.');
  const docs = {};
  for (const lado of ['doc_frente', 'doc_verso']) {
    const a = form.arquivos[lado];
    if (!a) continue;
    if (a.dados.length > 5 * 1024 * 1024) return erro('Cada arquivo pode ter até 5 MB.');
    const t = tipoDoc(a.dados);
    if (!t) return erro('Envie o documento em JPG, PNG, WEBP ou PDF.');
    docs[lado] = { t, dados: a.dados };
  }
  if (!docs.doc_frente) return erro('Envie a foto da frente do documento.');
  if (!A.limitar(`lnp:${usuario.id}`, 30, 60)) return erro('Muitos cadastros em pouco tempo. Aguarde alguns minutos.');
  const valor = modelo === 'atacado' ? r.atacado : venda;
  const token = randomBytes(16).toString('hex');
  const id = Number(db.prepare(`INSERT INTO limpa_nome_pedidos (usuario_id, nome, cpf, nascimento, telefone, email, doc_tipo, titular_proprio, aceite_em, aceite_ip, valor_centavos, forma_pagamento, parcelas, juros_centavos,
      parceiro_id, parceiro_modelo, parceiro_comissao_centavos, token, preco_venda_centavos, servico) VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?)`)
    .run(usuario.id, nome, cpf, nasc, tel, email, docTipo, ipDe(req), valor, forma, usuario.id, modelo, comissaoPedido, token, modelo === 'comissao' ? venda : null, svc).lastInsertRowid);
  try {
    const nomes = {};
    for (const [lado, d] of Object.entries(docs)) {
      const arq = `${id}-${lado.slice(4)}-${randomBytes(8).toString('hex')}.${d.t}`;
      await writeFile(path.join(pastaDocsLimpaNome, arq), d.dados, { mode: 0o600 });
      nomes[lado] = arq;
    }
    db.prepare('UPDATE limpa_nome_pedidos SET doc_frente = ?, doc_verso = ? WHERE id = ?').run(nomes.doc_frente || null, nomes.doc_verso || null, id);
  } catch (e) {
    db.prepare("UPDATE limpa_nome_pedidos SET status = 'cancelado', obs_admin = 'Falha ao salvar os documentos', atualizado_em = datetime('now') WHERE id = ?").run(id);
    return erro('Não foi possível salvar os documentos. Tente de novo.');
  }
  registrar(usuario, 'Parceiro: cliente cadastrado', `#${id} · ${r.nomeServico} · ${nome} · ${modelo === 'atacado' ? `atacado ${P.reais(valor)}` : `cliente paga ${P.reais(venda)} · comissão ${P.reais(comissaoPedido)}`}`);
  if (modelo === 'comissao') {
    const p = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE id = ?').get(id);
    emailPedidoLN(p, `Falta só o pagamento do seu ${r.nomeServico}`, `O seu pedido de <strong>${P.esc(r.nomeServico)}</strong> foi cadastrado${parc.mostrar_nome ? ` por <strong>${P.esc(usuario.nome)}</strong>` : ''}. Para começar, conclua o pagamento de <strong>${P.reais(venda)}</strong> (Pix ou até ${cfg.parcelas}x no cartão) pelo botão abaixo.`);
    return redirecionar(res, `/parceiro/cliente/${id}?novo=1`);
  }
  // Atacado: o parceiro paga agora
  try {
    let clienteId = db.prepare('SELECT asaas_cliente_id FROM usuarios WHERE id = ?').get(usuario.id).asaas_cliente_id;
    if (!clienteId && usuario.documento) {
      clienteId = (await AS.criarCliente(usuario)).id;
      db.prepare('UPDATE usuarios SET asaas_cliente_id = ? WHERE id = ?').run(clienteId, usuario.id);
    }
    if (!clienteId) clienteId = (await AS.criarCliente({ nome, documento: cpf, email: usuario.email, telefone: tel })).id;
    const cob = await AS.criarCobrancaServico({ clienteId, valorCentavos: valor, pedidoId: id, forma, parcelas: 1, descricao: `${r.nomeServico} (parceiro, atacado) - ${nome} #${id}` });
    let pix = null;
    if (forma === 'pix') { try { pix = await AS.pixQrCode(cob.id); } catch (e) { console.warn('Pix indisponível:', e.message); } }
    db.prepare("UPDATE limpa_nome_pedidos SET asaas_id = ?, pix_codigo = ?, pix_imagem = ?, link_pagamento = ?, atualizado_em = datetime('now') WHERE id = ?")
      .run(cob.id, pix?.payload || null, pix?.encodedImage || null, cob.invoiceUrl || null, id);
    if (forma === 'cartao' && cob.invoiceUrl) return redirecionar(res, cob.invoiceUrl);
    redirecionar(res, `/parceiro/cliente/${id}`);
  } catch (e) {
    console.error('parceiro atacado:', e.message);
    db.prepare("UPDATE limpa_nome_pedidos SET status = 'cancelado', obs_admin = 'Falha ao gerar a cobrança', atualizado_em = datetime('now') WHERE id = ?").run(id);
    erro('Não foi possível gerar a cobrança agora. Tente de novo em instantes.');
  }
}));

rota('GET', '/parceiro/cliente/:id', exigeParceiro(({ req, res, usuario, url, params }) => {
  const p = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE id = ? AND parceiro_id = ?').get(Number(params.id), usuario.id);
  if (!p) return redirecionar(res, '/parceiro');
  const link = `${urlBase(req)}/ln/${p.token}`;
  const tel = String(p.telefone || '').replace(/\D/g, '');
  const wpp = `https://wa.me/${tel.length <= 11 ? '55' + tel : tel}?text=${encodeURIComponent(`Olá, ${String(p.nome).split(' ')[0]}! Segue o link para concluir o seu Limpa Nome (pedido #${p.id}). Você paga com Pix ou cartão e acompanha cada etapa por ele: ${link}`)}`;
  const topo = `${url.searchParams.get('novo') ? '<div class="aviso ok">Cliente cadastrado! Agora envie o link de pagamento para ele.</div>' : ''}${url.searchParams.get('ficha') ? '<div class="aviso ok">Ficha cadastral salva.</div>' : ''}${fichaPendente(p) ? avisoFicha(`/parceiro/cliente/${p.id}/ficha`, 'você ou o cliente') + `<p class="muted" style="margin:-8px 0 18px">O cliente também pode preencher pelo link dele: ${P.esc(`${urlBase(req)}/ln/${p.token}/ficha`)}</p>` : ''}
<div class="cartao" style="max-width:620px;margin-bottom:18px">
  <p style="margin:0 0 6px"><strong>${p.parceiro_modelo === 'atacado' ? `Atacado · você paga ${P.reais(p.valor_centavos)}` : `O cliente paga · sua comissão: ${P.reais(p.parceiro_comissao_centavos)}`}</strong></p>
  <p class="muted" style="margin:0 0 10px">${P.esc(p.email)} · ${P.esc(p.telefone)}</p>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    ${p.status === 'aguardando_pagamento' && p.parceiro_modelo !== 'atacado' ? `<a class="btn" style="background:#1FA855" href="${P.esc(wpp)}" target="_blank" rel="noopener">Enviar link no WhatsApp</a>` : ''}
    <button class="btn sec" type="button" data-copiar-texto="${P.esc(link)}">Copiar link do cliente</button>
  </div>
  <div class="campo" style="margin:12px 0 0"><label for="link-cli">${p.status === 'aguardando_pagamento' ? 'Link de pagamento do cliente (ele escolhe Pix ou cartão e paga por aqui)' : 'Link do cliente (acompanhamento)'}</label><input id="link-cli" type="text" readonly value="${P.esc(link)}" style="font-size:.9rem"></div></div>`;
  pagina(res, `Cliente #${p.id}`, SV.paginaPedidoLN({ p, cfg: cfgServico(p.servico), voltar: ['/parceiro', '← Área do parceiro'], statusUrl: `/api/ln/${p.token}/status`, semPagamento: p.parceiro_modelo !== 'atacado' || !!p.combo_de, topo, ...relacionadosCombo(p) }), usuario);
}));

rota('POST', '/parceiro/cliente/:id/cancelar', exigeParceiro(async ({ req, res, usuario, params }) => {
  await corpoForm(req);
  const p = db.prepare("SELECT * FROM limpa_nome_pedidos WHERE id = ? AND parceiro_id = ? AND status = 'aguardando_pagamento'").get(Number(params.id), usuario.id);
  if (!p) return redirecionar(res, `/parceiro?erro=${encodeURIComponent('Este pedido não pode mais ser cancelado.')}`);
  if (p.asaas_id) {
    const c = await AS.buscarCobranca(p.asaas_id).catch(() => null);
    if (c && AS.STATUS_PAGO.includes(c.status)) { confirmarPedidoLN(p.id); return redirecionar(res, `/parceiro?erro=${encodeURIComponent('Este pedido já foi pago, não dá para cancelar.')}`); }
    if (c && !c.deleted) await AS.cancelarCobranca(p.asaas_id).catch(() => {});
  }
  db.prepare("UPDATE limpa_nome_pedidos SET status = 'cancelado', obs_admin = 'Cancelado pelo parceiro', atualizado_em = datetime('now') WHERE id = ? AND status = 'aguardando_pagamento'").run(p.id);
  registrar(usuario, 'Parceiro: cancelou pedido', `#${p.id} · ${p.nome}`);
  redirecionar(res, '/parceiro?ok=cancel');
}));

// ---------- Link do cliente (sem login) ----------
const pedidoToken = (t) => (/^[a-f0-9]{32}$/.test(String(t)) ? db.prepare('SELECT * FROM limpa_nome_pedidos WHERE token = ?').get(t) : null);
// Preço escolhido pelo parceiro para este cliente (o parcelamento é calculado em cima dele)
const cfgPedidoParceiro = (p) => {
  const c = lnCfgParceiro(p.parceiro_id, p.servico);
  const preco = p.preco_venda_centavos || c.preco;
  return { ...c, preco, tabela: SV.tabelaParcelas(preco, c.parcelas, c.juros) };
};
const cfgPublicoLN = (p) => ({ ...cfgPedidoParceiro(p), ajudaUrl: `/ln/${p.token}/ajuda` });
rota('GET', '/ln/:token', ({ res, usuario, params, url }) => {
  const p = pedidoToken(params.token);
  if (!p) return paginaExterna(res, 'Pedido não encontrado', P.paginaEmBreve('Link inválido', 'Este link de pedido não existe. Confira com quem te enviou.'), 404);
  const cfg = cfgPublicoLN(p);
  const parceiro = nomeParceiroVisivel(p.parceiro_id);
  const ficha = (url.searchParams.get('ficha') ? '<div class="aviso ok" style="max-width:620px">Ficha cadastral recebida! Avisamos a cada etapa por e-mail.</div>' : '') + (parceiro ? `<p class="muted" style="margin:-10px 0 16px">Atendimento: ${P.esc(parceiro)}</p>` : '');
  if (p.status === 'aguardando_pagamento' && p.parceiro_modelo === 'comissao' && !p.asaas_id)
    return paginaExterna(res, `${SERVICOS[p.servico] || 'Limpa Nome'} · pagamento`, SV.paginaPagarClienteLN({ p, cfg, parceiro, erro: url.searchParams.get('erro') || '' }));
  const trocar = p.status === 'aguardando_pagamento' && p.parceiro_modelo === 'comissao' && p.asaas_id
    ? `<form method="post" action="/ln/${p.token}/trocar" style="max-width:520px;text-align:center;margin:0 auto 18px"><button class="btn sec" style="min-height:34px;padding:4px 14px;font-size:.85rem">Trocar a forma de pagamento</button></form>` : '';
  paginaExterna(res, `${SERVICOS[p.servico] || 'Limpa Nome'} · pedido #${p.id}`, SV.paginaPedidoLN({ p, cfg, voltar: null, statusUrl: `/api/ln/${p.token}/status`, semPagamento: p.parceiro_modelo === 'atacado', topo: ficha + (fichaPendente(p) ? avisoFicha(linkFicha(p)) : '') + trocar, ...relacionadosCombo(p) }));
});

rota('POST', '/ln/:token/pagar', async ({ req, res, params }) => {
  const p = pedidoToken(params.token);
  if (!p) return redirecionar(res, '/');
  const f = await corpoForm(req);
  const volta = (m) => redirecionar(res, `/ln/${p.token}${m ? `?erro=${encodeURIComponent(m)}` : ''}`);
  if (p.status !== 'aguardando_pagamento' || p.parceiro_modelo !== 'comissao' || p.asaas_id) return volta();
  const cfg = cfgPedidoParceiro(p);
  if (f.aceite !== '1') return volta('Confirme a autorização para continuar.');
  if (!A.limitar(`lnt:${p.id}`, 8, 60)) return volta('Muitas tentativas. Aguarde alguns minutos.');
  const forma = f.forma === 'cartao' ? 'cartao' : 'pix';
  const parcelas = forma === 'cartao' ? Math.min(cfg.parcelas, Math.max(1, Math.floor(Number(f.parcelas) || 1))) : 1;
  const total = forma === 'cartao' ? cfg.tabela[parcelas - 1].total : cfg.preco;
  try {
    const clienteId = (await AS.criarCliente({ nome: p.nome, documento: p.cpf, email: p.email, telefone: p.telefone })).id;
    const cob = await AS.criarCobrancaServico({ clienteId, valorCentavos: total, pedidoId: p.id, forma, parcelas });
    let pix = null;
    if (forma === 'pix') { try { pix = await AS.pixQrCode(cob.id); } catch (e) { console.warn('Pix indisponível:', e.message); } }
    db.prepare(`UPDATE limpa_nome_pedidos SET valor_centavos = ?, forma_pagamento = ?, parcelas = ?, juros_centavos = ?, asaas_id = ?, asaas_parcelamento = ?, pix_codigo = ?, pix_imagem = ?, link_pagamento = ?,
      cliente_aceite_em = datetime('now'), cliente_aceite_ip = ?, atualizado_em = datetime('now') WHERE id = ? AND asaas_id IS NULL`)
      .run(total, forma, parcelas, total - cfg.preco, cob.id, cob.installment || null, pix?.payload || null, pix?.encodedImage || null, cob.invoiceUrl || null, ipDe(req), p.id);
    if (forma === 'cartao' && cob.invoiceUrl) return redirecionar(res, cob.invoiceUrl);
    volta();
  } catch (e) { console.error('link cliente LN:', e.message); volta('Não foi possível gerar o pagamento agora. Tente de novo em instantes.'); }
});

rota('POST', '/ln/:token/trocar', async ({ req, res, params }) => {
  const p = pedidoToken(params.token);
  if (!p) return redirecionar(res, '/');
  await corpoForm(req);
  if (p.status === 'aguardando_pagamento' && p.parceiro_modelo === 'comissao' && p.asaas_id && A.limitar(`lnx:${p.id}`, 5, 60)) {
    const c = await AS.buscarCobranca(p.asaas_id).catch(() => null);
    if (c && AS.STATUS_PAGO.includes(c.status)) confirmarPedidoLN(p.id);
    else {
      if (c && !c.deleted) await AS.cancelarCobranca(p.asaas_id).catch(() => {});
      db.prepare("UPDATE limpa_nome_pedidos SET asaas_id = NULL, asaas_parcelamento = NULL, pix_codigo = NULL, pix_imagem = NULL, link_pagamento = NULL, valor_centavos = ?, juros_centavos = 0, atualizado_em = datetime('now') WHERE id = ? AND status = 'aguardando_pagamento'").run(cfgPedidoParceiro(p).preco, p.id);
    }
  }
  redirecionar(res, `/ln/${p.token}`);
});

rota('GET', '/api/ln/:token/status', async ({ res, params }) => {
  const p = pedidoToken(params.token);
  if (!p) return json(res, { pago: false }, 404);
  if (p.status !== 'aguardando_pagamento') return json(res, { pago: true, valor: p.valor_centavos / 100, eid: `ln-${p.id}` });
  if (p.asaas_id && A.limitar(`stln:${p.id}`, 30, 5)) {
    try {
      const c = await AS.buscarCobranca(p.asaas_id);
      if (AS.STATUS_PAGO.includes(c.status) && (p.asaas_parcelamento || Math.round(Number(c.value) * 100) >= p.valor_centavos)) { confirmarPedidoLN(p.id); return json(res, { pago: true, valor: p.valor_centavos / 100, eid: `ln-${p.id}` }); }
    } catch (e) { console.warn('status LN token:', e.message); }
  }
  json(res, { pago: false });
});

rota('GET', '/ln/:token/ajuda', ({ res, params, url }) => {
  const p = pedidoToken(params.token), cfg = lnCfg();
  if (!p || !cfg.whatsapp) return redirecionar(res, p ? `/ln/${p.token}` : '/');
  const etapa = String(url.searchParams.get('e') || '').replace(/[^\w-]/g, '').slice(0, 30);
  registrar(null, 'Limpa Nome: cliente chamou o atendimento', `link do parceiro · pedido #${p.id} (${p.status})${etapa ? ` · na etapa: ${etapa}` : ''}`);
  redirecionar(res, `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(`Olá! Preciso de ajuda com o Limpa Nome da Soft Consultas. Meu pedido é o #${p.id}.`)}`);
});

// ---------- Admin ----------
function listaParceirosAdmin() {
  return db.prepare(`SELECT x.*, u.nome, u.email, u.telefone,
      (SELECT COUNT(*) FROM limpa_nome_pedidos p WHERE p.parceiro_id = x.usuario_id) clientes,
      (SELECT COUNT(*) FROM limpa_nome_pedidos p WHERE p.parceiro_id = x.usuario_id AND p.pago_em IS NOT NULL AND p.status <> 'reembolsado') pagos,
      (SELECT COALESCE(SUM(valor_centavos), 0) FROM limpa_nome_pedidos p WHERE p.parceiro_id = x.usuario_id AND p.pago_em IS NOT NULL AND p.status <> 'reembolsado') receita,
      (SELECT COALESCE(SUM(valor_centavos), 0) FROM comissoes k WHERE k.usuario_id = x.usuario_id AND k.tipo = 'comissao' AND k.referencia LIKE 'ln_%') comissoes
    FROM parceiros x JOIN usuarios u ON u.id = x.usuario_id ORDER BY x.ativo DESC, x.criado_em DESC`).all()
    .map((x) => ({ ...x, saldo: saldoComissao(x.usuario_id), regra: regraParceiro(x.usuario_id, x), regras: regrasParceiro(x.usuario_id, x), proprios: { rating: valoresProprios(x, 'rating'), combo: valoresProprios(x, 'combo') }, mens: mensalidadeParceiro(x) }));
}
const padraoServico = (sv) => ({ minimo: Number(lerConfig(`parceiro_${sv}_preco_minimo_centavos`) || 0) || null, comissaoTipo: tipoComissao(lerConfig(`parceiro_${sv}_comissao_tipo`)), comissaoValor: Number(lerConfig(`parceiro_${sv}_comissao_valor`) || 0),
  preco: Number(lerConfig(`parceiro_${sv}_preco_centavos`) || 0) || null, atacado: Number(lerConfig(`parceiro_${sv}_atacado_centavos`) || 0) || null, precoSite: cfgServico(sv).preco });
const padraoParceiro = () => ({ adesao: Number(lerConfig('parceiro_adesao_centavos') || 0), rating: padraoServico('rating'), combo: padraoServico('combo'), minimo: Number(lerConfig('parceiro_preco_minimo_centavos') || 0) || null, comissaoTipo: tipoComissao(lerConfig('parceiro_comissao_tipo')), comissaoValor: Number(lerConfig('parceiro_comissao_valor') || 0),
  atacado: Number(lerConfig('parceiro_atacado_centavos') || 0) || null, mensalidade: Number(lerConfig('parceiro_mensalidade_centavos') || 0), preco: Number(lerConfig('parceiro_preco_centavos') || 0) || null });
rota('GET', '/admin/parceiros', exigeAdmin(({ res, usuario, url }) => {
  pagina(res, 'Admin · Parceiros', SV.adminParceiros({ menu: PD.menu('/admin/parceiros'), padrao: padraoParceiro(), parceiros: listaParceirosAdmin(), cfg: lnCfgParceiro(),
    ok: url.searchParams.get('ok') || '', erro: url.searchParams.get('erro') || '' }), usuario);
}));
const voltaParc = (res, m, ok) => redirecionar(res, `/admin/parceiros?${ok ? 'ok' : 'erro'}=${encodeURIComponent(m)}`);
// "20" = 20% ; "300" ou "300,00" = R$ 300 (fixo) ; vazio = null
const lerComissao = (tipo, txt) => {
  const t = String(txt ?? '').trim();
  if (!t) return null;
  if (tipo === 'fixo' || tipo === 'nossa_parte') { const c = centavos(t); return Number.isFinite(c) && c >= 0 ? c : NaN; }
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : NaN;
};
const lerReais = (txt) => { const t = String(txt ?? '').trim(); if (!t) return null; const c = centavos(t); return Number.isFinite(c) && c >= 0 ? c : NaN; };
rota('POST', '/admin/parceiros/padrao', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const tipo = tipoComissao(f.tipo);
  const valor = lerComissao(tipo, f.valor), atac = lerReais(f.atacado), mens = lerReais(f.mensalidade);
  if (valor === null || Number.isNaN(valor)) return voltaParc(res, tipo === 'percentual' ? 'Informe a comissão entre 0 e 100%.' : 'Informe o valor em reais.');
  if (Number.isNaN(atac) || (atac !== null && atac < 500)) return voltaParc(res, 'Preço de atacado inválido (mínimo R$ 5,00, ou deixe vazio).');
  if (Number.isNaN(mens)) return voltaParc(res, 'Mensalidade inválida.');
  const precoP = lerReais(f.preco), minP = lerReais(f.minimo), adesao = lerReais(f.adesao);
  if (Number.isNaN(adesao)) return voltaParc(res, 'Taxa de adesão inválida.');
  gravarConfig('parceiro_adesao_centavos', String(adesao || 0));
  if (Number.isNaN(minP)) return voltaParc(res, 'Preço mínimo inválido.');
  gravarConfig('parceiro_preco_minimo_centavos', minP ? String(minP) : '');
  if (Number.isNaN(precoP) || (precoP !== null && precoP < 500)) return voltaParc(res, 'Preço de venda inválido.');
  gravarConfig('parceiro_preco_centavos', precoP ? String(precoP) : '');
  // Rating e combo: mesmos campos com prefixo (rating_..., combo_...)
  const extra = [];
  for (const sv of ['rating', 'combo']) {
    const t2 = tipoComissao(f[`${sv}_tipo`]), v2 = lerComissao(t2, f[`${sv}_valor`]), p2 = lerReais(f[`${sv}_preco`]), a2 = lerReais(f[`${sv}_atacado`]), m2 = lerReais(f[`${sv}_minimo`]);
    if (Number.isNaN(m2)) return voltaParc(res, `Preço mínimo inválido em ${SERVICOS[sv]}.`);
    gravarConfig(`parceiro_${sv}_preco_minimo_centavos`, m2 ? String(m2) : '');
    if (Number.isNaN(v2) || Number.isNaN(p2) || Number.isNaN(a2) || (p2 !== null && p2 < 500) || (a2 !== null && a2 < 500)) return voltaParc(res, `Valores inválidos em ${SERVICOS[sv]}.`);
    gravarConfig(`parceiro_${sv}_comissao_tipo`, t2); gravarConfig(`parceiro_${sv}_comissao_valor`, String(v2 ?? 0));
    gravarConfig(`parceiro_${sv}_preco_centavos`, p2 ? String(p2) : ''); gravarConfig(`parceiro_${sv}_atacado_centavos`, a2 ? String(a2) : '');
    extra.push(`${sv}: preço ${p2 ? P.reais(p2) : 'do site'}, comissão ${textoTipoComissao(t2, v2)}, atacado ${a2 ? P.reais(a2) : 'desligado'}`);
  }
  gravarConfig('parceiro_comissao_tipo', tipo); gravarConfig('parceiro_comissao_valor', String(valor));
  gravarConfig('parceiro_atacado_centavos', atac ? String(atac) : ''); gravarConfig('parceiro_mensalidade_centavos', String(mens || 0));
  registrar(usuario, 'Parceiros: regra padrão', `preço ao cliente ${precoP ? P.reais(precoP) : 'igual ao do site'} · comissão ${textoTipoComissao(tipo, valor)} · atacado ${atac ? P.reais(atac) : 'desligado'} · mensalidade ${P.reais(mens || 0)} · ${extra.join(' · ')}`);
  voltaParc(res, 'Regra padrão salva.', true);
}));
rota('POST', '/admin/parceiros/novo', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const email = String(f.email || '').trim().toLowerCase().slice(0, 120);
  if (!A.emailValido(email)) return voltaParc(res, 'Informe um e-mail válido.');
  let u = db.prepare('SELECT id, nome, email FROM usuarios WHERE email = ?').get(email);
  let criado = false;
  if (!u) {
    const nome = String(f.nome || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (nome.split(' ').length < 2) return voltaParc(res, 'Para criar a conta, informe o nome completo do parceiro.');
    const id = Number(db.prepare(`INSERT INTO usuarios (nome, email, documento, telefone, senha_hash, aceite_termos, codigo_indicacao, origem) VALUES (?, ?, '', ?, ?, datetime('now'), ?, 'parceiro')`)
      .run(nome, email, A.soNumeros(f.telefone).slice(0, 13), A.gerarHashSenha(randomBytes(24).toString('hex')), codigoUnico()).lastInsertRowid);
    u = { id, nome, email }; criado = true;
  }
  if (parceiroRow(u.id)) db.prepare("UPDATE parceiros SET ativo = 1, atualizado_em = datetime('now') WHERE usuario_id = ?").run(u.id);
  else db.prepare('INSERT INTO parceiros (usuario_id) VALUES (?)').run(u.id);
  if (f.isento === '1') db.prepare("UPDATE parceiros SET isento = 1, atualizado_em = datetime('now') WHERE usuario_id = ?").run(u.id);
  db.prepare('UPDATE usuarios SET parceiro = 1 WHERE id = ?').run(u.id);
  // Convite: link para definir a senha (vale 7 dias) ou para entrar
  let link = `${baseEmails()}/entrar`;
  if (criado) {
    const t = randomBytes(32).toString('hex');
    db.prepare("INSERT INTO redefinicoes_senha (token_hash, usuario_id, expira_em) VALUES (?, ?, datetime('now', '+7 days'))").run(createHash('sha256').update(t).digest('hex'), u.id);
    link = `${baseEmails()}/redefinir-senha?token=${t}`;
  }
  const mens = mensalidadeParceiro(parceiroRow(u.id));
  emailServico({ para: u.email, assunto: 'Você agora é parceiro do Limpa Nome · Soft Consultas', titulo: 'Bem-vindo à área de parceiros',
    html: `<p>Olá, ${P.esc(String(u.nome).split(' ')[0])}! A sua área de parceiro do <strong>Limpa Nome</strong> está liberada. Lá você cadastra os seus clientes, envia o link de pagamento pelo WhatsApp e acompanha cada etapa do processo.</p>${mens.isento ? '' : `<p>Para começar a cadastrar clientes, ative a mensalidade de <strong>${P.reais(mens.valor)}</strong> dentro da área.</p>`}${criado ? '<p>Primeiro, crie a sua senha pelo botão abaixo (o link vale 7 dias). Depois é só entrar e clicar em <strong>Parceiro</strong> no menu.</p>' : '<p>Entre com o seu e-mail e senha de sempre e clique em <strong>Parceiro</strong> no menu.</p>'}`,
    botao: { href: link, texto: criado ? 'Criar minha senha' : 'Entrar' }, rodape: RODAPE_PARC });
  registrar(usuario, 'Parceiros: parceiro cadastrado', `${u.email}${criado ? ' (conta nova, convite enviado)' : ''}${f.isento === '1' ? ' · isento de mensalidade' : ''}`);
  voltaParc(res, `${u.email} agora é parceiro.${criado ? ' Enviamos o convite para ele criar a senha.' : ' Avisamos por e-mail.'}`, true);
}));
rota('GET', '/admin/parceiros/:id', exigeAdmin(({ res, usuario, url, params }) => {
  const x = listaParceirosAdmin().find((p) => p.usuario_id === Number(params.id));
  if (!x) return voltaParc(res, 'Parceiro não encontrado.');
  const pedidos = db.prepare('SELECT id, nome, cpf, status, servico, parceiro_modelo, valor_centavos, parceiro_comissao_centavos, criado_em, pago_em FROM limpa_nome_pedidos WHERE parceiro_id = ? ORDER BY id DESC LIMIT 200').all(x.usuario_id);
  pagina(res, 'Admin · Parceiro', SV.adminParceiroEditar({ menu: PD.menu('/admin/parceiros'), x, padrao: padraoParceiro(), cfg: lnCfg(), pedidos, ok: url.searchParams.get('ok') || '', erro: url.searchParams.get('erro') || '' }), usuario);
}));
rota('POST', '/admin/parceiros/salvar', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const x = parceiroRow(Number(f.id));
  if (!x) return voltaParc(res, 'Parceiro não encontrado.');
  const voltaP = (r, m, ok) => redirecionar(r, `/admin/parceiros/${x.usuario_id}?${ok ? 'ok' : 'erro'}=${encodeURIComponent(m)}`);
  const tipo = tipoComissaoOuNulo(f.tipo);
  const valor = tipo ? lerComissao(tipo, f.valor) : null, atac = lerReais(f.atacado), mens = lerReais(f.mensalidade), preco = lerReais(f.preco), minimo = lerReais(f.minimo);
  if (Number.isNaN(minimo)) return voltaP(res, 'Preço mínimo inválido.');
  if (Number.isNaN(preco) || (preco !== null && preco < 500)) return voltaP(res, 'Preço de venda inválido (mínimo R$ 5,00, ou deixe vazio para usar o padrão).');
  if (tipo && (valor === null || Number.isNaN(valor))) return voltaP(res, 'Informe o valor da comissão própria (ou escolha "padrão").');
  if (Number.isNaN(atac) || (atac !== null && atac > 0 && atac < 500)) return voltaP(res, 'Preço de atacado inválido (use 0 para desligar o atacado deste parceiro).');
  if (Number.isNaN(mens)) return voltaP(res, 'Mensalidade inválida.');
  const ativo = f.ativo === '1' ? 1 : 0, isento = f.isento === '1' ? 1 : 0;
  let pagoAte = x.pago_ate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(f.pago_ate || ''))) pagoAte = f.pago_ate; else if (f.pago_ate === '') pagoAte = x.pago_ate;
  const obs = String(f.obs ?? x.obs ?? '').trim().slice(0, 500);
  const repAuto = f.repasse_auto === '1' ? 1 : 0, repPix = String(f.repasse_pix || '').trim().slice(0, 140);
  if (repAuto && !AS.tipoChavePix(repPix)) return voltaP(res, 'Para o repasse automático, informe uma chave Pix válida (CPF, CNPJ, e-mail, celular ou chave aleatória).');
  const vs = {};
  for (const sv of ['rating', 'combo']) {
    const t2 = tipoComissaoOuNulo(f[`${sv}_tipo`]);
    const v2 = t2 ? lerComissao(t2, f[`${sv}_valor`]) : null, p2 = lerReais(f[`${sv}_preco`]), a2 = lerReais(f[`${sv}_atacado`]), m2 = lerReais(f[`${sv}_minimo`]);
    if (Number.isNaN(m2)) return voltaP(res, `Preço mínimo inválido em ${SERVICOS[sv]}.`);
    if ((t2 && (v2 === null || Number.isNaN(v2))) || Number.isNaN(p2) || Number.isNaN(a2) || (p2 !== null && p2 < 500) || (a2 !== null && a2 > 0 && a2 < 500)) return voltaP(res, `Valores inválidos em ${SERVICOS[sv]}.`);
    vs[sv] = { preco: p2, minimo: m2, comissao_tipo: t2, comissao_valor: t2 ? v2 : null, atacado: a2 };
  }
  db.prepare("UPDATE parceiros SET ativo = ?, comissao_tipo = ?, comissao_valor = ?, atacado_centavos = ?, mensalidade_centavos = ?, isento = ?, pago_ate = ?, preco_centavos = ?, obs = ?, valores_servicos = ?, repasse_auto = ?, repasse_pix = ?, preco_minimo_centavos = ?, atualizado_em = datetime('now') WHERE usuario_id = ?")
    .run(ativo, tipo, tipo ? valor : null, atac, mens, isento, pagoAte, preco, obs || null, JSON.stringify(vs), repAuto, repPix || null, minimo, x.usuario_id);
  if (repAuto && repPix) db.prepare('UPDATE usuarios SET chave_pix = ? WHERE id = ?').run(repPix, x.usuario_id);
  db.prepare('UPDATE usuarios SET parceiro = ? WHERE id = ?').run(ativo, x.usuario_id);
  if (!ativo && x.assinatura_id) { await AS.cancelarAssinatura(x.assinatura_id).catch(() => {}); db.prepare('UPDATE parceiros SET assinatura_id = NULL, assinatura_link = NULL WHERE usuario_id = ?').run(x.usuario_id); }
  const em = db.prepare('SELECT email FROM usuarios WHERE id = ?').get(x.usuario_id)?.email;
  registrar(usuario, 'Parceiros: regra do parceiro', `${em} · ${ativo ? 'ativo' : 'inativo'} · preço ao cliente ${preco ? P.reais(preco) : 'padrão'} · comissão ${tipo ? textoTipoComissao(tipo, valor) : 'padrão'} · atacado ${atac ? P.reais(atac) : 'padrão'} · mensalidade ${isento ? 'isento' : mens != null ? P.reais(mens) : 'padrão'}${pagoAte !== x.pago_ate ? ` · pago até ${pagoAte}` : ''} · repasse automático ${repAuto ? `ligado (${repPix})` : 'desligado'}`);
  voltaP(res, 'Parceiro atualizado. Os novos valores valem para os próximos clientes cadastrados.', true);
}));

// ======================= MONITORAMENTO DE CPF/CNPJ (assinatura) =======================
const monCfg = () => ({
  ativo: lerConfig('mon_ativo') === '1',
  mensal: Number(lerConfig('mon_preco_mensal') || 1490), anual: Number(lerConfig('mon_preco_anual') || 12900),
  produto: lerConfig('mon_produto') || 'cred-completa-plus',
  freq: Math.min(90, Math.max(7, Number(lerConfig('mon_frequencia_dias') || 30))),
  quedaScore: Math.max(10, Number(lerConfig('mon_queda_score') || 50)),
});
const produtoMonitor = () => db.prepare("SELECT * FROM produtos WHERE slug = ? AND endpoint <> ''").get(monCfg().produto);
const sqlAgora = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const somarPeriodo = (base, plano) => {
  const d = new Date(String(base).replace(' ', 'T') + 'Z');
  if (plano === 'anual') d.setUTCFullYear(d.getUTCFullYear() + 1); else d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(d.getUTCDate() + 3); // 3 dias de tolerância para o pagamento seguinte
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

// E-mail de serviço (transacional: o cliente contratou)
function emailServico({ para, assunto, titulo, html, botao, rodape }) {
  if (!process.env.RESEND_API_KEY || !para) return Promise.resolve();
  const base = baseEmails();
  const corpo = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F4F1F7;font-family:Arial,Helvetica,sans-serif;color:#0F0C14">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:18px;overflow:hidden">
<tr><td style="background:#0F0C14;padding:20px 28px;color:#fff;font-weight:bold;font-size:18px"><img src="${base}/icone-branco.png" width="26" height="26" alt="" style="vertical-align:middle"> Soft <span style="color:#C98BEB;font-weight:normal">Consultas</span></td></tr>
<tr><td style="padding:28px;font-size:16px;line-height:1.55"><h1 style="font-size:21px;margin:0 0 12px">${titulo}</h1>${html}
${botao ? `<p style="margin:24px 0"><a href="${botao.href.startsWith('http') ? botao.href : base + botao.href}" style="display:inline-block;background:#9F31D3;color:#fff;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:bold">${P.esc(botao.texto)}</a></p>` : ''}
<p style="font-size:12px;color:#7A7285;margin-top:24px">${rodape || 'Você recebe este e-mail porque contratou o Monitoramento de CPF/CNPJ da Soft Consultas.'}</p></td></tr></table></td></tr></table></body></html>`;
  return enviarEmail({ para, assunto, html: corpo }).catch((e) => console.error('e-mail monitoramento:', e.message));
}
const docFmt = (d) => (String(d).length === 14 ? 'CNPJ' : 'CPF') + ' final ' + String(d).slice(-4);

// Pagamento confirmado (webhook ou conferência): ativa/renova
function confirmarPagamentoMon(m, pagamentoId) {
  const novo = db.prepare("UPDATE monitoramentos SET pagamento_atual = ? WHERE id = ? AND (pagamento_atual IS NULL OR pagamento_atual <> ? OR status = 'aguardando')").run(pagamentoId, m.id, pagamentoId).changes === 1;
  if (!novo && m.status === 'ativo') return false;
  // Renovação em dia: soma a partir do fim do período anterior (sem acumular os 3 dias de tolerância)
  const fimAnterior = m.ativo_ate ? new Date(new Date(m.ativo_ate.replace(' ', 'T') + 'Z').getTime() - 3 * 86400000).toISOString().slice(0, 19).replace('T', ' ') : null;
  const base = fimAnterior && fimAnterior > sqlAgora() ? fimAnterior : sqlAgora();
  const ate = somarPeriodo(base, m.plano);
  const primeiro = m.status === 'aguardando';
  db.prepare("UPDATE monitoramentos SET status = 'ativo', ativo_ate = ?, pagamentos = pagamentos + 1, proxima_checagem = COALESCE(CASE WHEN ? THEN datetime('now') END, proxima_checagem, datetime('now')) WHERE id = ?").run(ate, primeiro ? 1 : 0, m.id);
  registrar(null, primeiro ? 'Monitoramento: assinatura ativada' : 'Monitoramento: renovação paga', `#${m.id} · ${docFmt(m.documento)} · ${m.plano} · ${P.reais(m.valor_centavos)} · ativo até ${ate.slice(0, 10)}`);
  const u = db.prepare('SELECT nome, email, telefone FROM usuarios WHERE id = ?').get(m.usuario_id);
  if (primeiro) capiCompra({ eid: `mon-${m.id}`, valor: m.valor_centavos, email: u?.email, telefone: u?.telefone, nome: u?.nome, usuarioId: m.usuario_id, conteudo: 'Monitoramento' });
  if (primeiro) emailServico({ para: u?.email, assunto: 'Seu monitoramento está ativo 🛡️', titulo: 'Monitoramento ativado!',
    html: `<p>Olá, ${P.esc(String(u?.nome || '').split(' ')[0])}! A partir de agora vigiamos o seu ${docFmt(m.documento)}. A primeira checagem acontece agora e você recebe o resultado por e-mail.</p><p>Se aparecer negativação nova, protesto ou queda no score, avisamos na hora.</p>`,
    botao: { href: '/monitoramento', texto: 'Ver meu monitoramento' } });
  if (primeiro) setTimeout(() => checarMonitoramentos().catch((e) => console.error('monitoramento:', e.message)), 3000).unref();
  return true;
}

// Uma checagem: consulta, compara com a anterior e avisa
async function checarUm(m) {
  const produto = produtoMonitor();
  if (!produto) throw new Error('consulta do monitoramento não configurada');
  const cid = Number(db.prepare(`INSERT INTO consultas (usuario_id, produto_id, produto, parametro, finalidade, status, preco_centavos, custo_centavos, indicador_id, comissao_centavos)
    VALUES (?, ?, ?, ?, 'Monitoramento contratado pelo titular', 'processando', 0, ?, NULL, 0)`).run(m.usuario_id, produto.id, `Monitoramento · ${produto.nome}`, m.documento, produto.custo_centavos).lastInsertRowid);
  let dados;
  try {
    dados = await consultarApiFull(produto, m.documento);
  } catch (e) {
    db.prepare("UPDATE consultas SET status = 'falhou', erro = ?, custo_centavos = 0 WHERE id = ?").run(String(e.message).slice(0, 500), cid);
    db.prepare("UPDATE monitoramentos SET proxima_checagem = datetime('now', '+6 hours') WHERE id = ?").run(m.id);
    throw e;
  }
  const a = analisar(dados);
  const origemBanco = a.pdfOrigem && !a.pdfOrigem.startsWith('base64:') ? a.pdfOrigem : null;
  if (dados?.aux && a.pdfOrigem?.startsWith('base64:')) dados.aux = { type: 'pdf', data: '(salvo em arquivo)' };
  db.prepare("UPDATE consultas SET status = 'concluida', resultado = ?, pdf_origem = ? WHERE id = ?").run(JSON.stringify(dados), origemBanco, cid);
  const bytes = await obterPdf(a.pdfOrigem).catch(() => null);
  if (bytes) await writeFile(path.join(pastaPdfs, `${cid}.pdf`), bytes).catch(() => {});
  limparCacheSaldo();

  const chave = (i) => `${i.tipo}|${i.credor}|${i.valor}|${i.data}`;
  const resumo = { score: a.score, qtd: a.qtdRestricoes, total: a.totalValor, itens: a.itens.map(chave).slice(0, 200), consultas: a.consultasRecentes };
  let antes = null; try { antes = m.ultimo_resumo ? JSON.parse(m.ultimo_resumo) : null; } catch {}
  const novos = antes ? a.itens.filter((i) => !antes.itens.includes(chave(i))) : [];
  const quedaScore = antes && antes.score != null && a.score != null ? antes.score - a.score : 0;
  const cfg = monCfg();
  db.prepare("UPDATE monitoramentos SET ultima_checagem = datetime('now'), proxima_checagem = datetime('now', ?), ultimo_resumo = ?, ultima_consulta_id = ?, checagens = checagens + 1 WHERE id = ?")
    .run(`+${cfg.freq} days`, JSON.stringify(resumo), cid, m.id);

  const u = db.prepare('SELECT nome, email FROM usuarios WHERE id = ?').get(m.usuario_id);
  const primeiroNome = P.esc(String(u?.nome || '').split(' ')[0]);
  const resumoHtml = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#F6ECFC;border-radius:12px;margin:12px 0"><tr><td style="padding:14px 16px;font-size:15px">
    <strong>Score:</strong> ${a.score ?? 'não informado'}${antes && antes.score != null && a.score != null && a.score !== antes.score ? ` (antes ${antes.score})` : ''}<br>
    <strong>Restrições:</strong> ${a.qtdRestricoes}${a.totalValor ? ` · ${P.reais(Math.round(a.totalValor * 100))}` : ''}<br>
    <strong>Consultas recentes ao documento:</strong> ${a.consultasRecentes}</td></tr></table>`;
  const ofertaLN = lnCfg().ativo ? `<p>Quer resolver? Com o <strong>Limpa Nome</strong>, as negativações saem por ação judicial coletiva, ${P.esc(lnCfg().prazo.toLowerCase() || 'em até 30 dias')}.</p>` : '';
  let tipo;
  if (novos.length) {
    tipo = 'alerta';
    enviarPush(m.usuario_id, { titulo: `⚠️ ${novos.length === 1 ? 'Nova restrição' : `${novos.length} novas restrições`} no seu ${docFmt(m.documento)}`, corpo: 'Toque para ver o que apareceu e o que fazer.', link: `/consulta/${cid}` }).catch(() => {});
    await emailServico({ para: u?.email, assunto: `⚠️ Alerta: ${novos.length === 1 ? 'nova restrição' : `${novos.length} novas restrições`} no seu ${docFmt(m.documento)}`, titulo: 'Encontramos algo novo no seu documento',
      html: `<p>Olá, ${primeiroNome}. Na checagem de hoje apareceu${novos.length > 1 ? 'ram' : ''}:</p><ul>${novos.slice(0, 10).map((i) => `<li><strong>${P.esc(i.tipo)}</strong> · ${P.esc(i.credor)}${i.valor ? ` · ${P.reais(Math.round(i.valor * 100))}` : ''}${i.data ? ` · ${P.esc(i.data)}` : ''}</li>`).join('')}</ul>${resumoHtml}<p>Se você não reconhece, pode ser fraude: entre em contato com o credor e registre um boletim de ocorrência.</p>${ofertaLN}`,
      botao: { href: `/consulta/${cid}`, texto: 'Ver o relatório completo' } });
  } else if (quedaScore >= cfg.quedaScore) {
    tipo = 'score';
    enviarPush(m.usuario_id, { titulo: `📉 Seu score caiu ${quedaScore} pontos`, corpo: `Agora ele está em ${a.score}. Toque para ver o relatório.`, link: `/consulta/${cid}` }).catch(() => {});
    await emailServico({ para: u?.email, assunto: `📉 Seu score caiu ${quedaScore} pontos`, titulo: 'Seu score caiu',
      html: `<p>Olá, ${primeiroNome}. Seu score passou de ${antes.score} para <strong>${a.score}</strong>.</p>${resumoHtml}<p>Quedas assim costumam vir de muitas consultas ao CPF em pouco tempo, atraso em contas ou uso alto do limite do cartão.</p>`,
      botao: { href: `/consulta/${cid}`, texto: 'Ver o relatório completo' } });
  } else {
    tipo = antes ? 'ok' : 'inicial';
    await emailServico({ para: u?.email, assunto: antes ? `✅ Monitoramento: nada de novo no seu ${docFmt(m.documento)}` : `📋 Primeira checagem do seu ${docFmt(m.documento)}`,
      titulo: antes ? 'Tudo certo por aqui' : 'Sua primeira checagem está pronta',
      html: `<p>Olá, ${primeiroNome}. ${antes ? 'Nenhuma restrição nova desde a última checagem.' : 'Esta é a foto atual do seu documento. A partir dela, avisamos qualquer mudança.'}</p>${resumoHtml}${!antes && a.qtdRestricoes ? ofertaLN : ''}<p style="font-size:14px;color:#5B5366">Próxima checagem em ${cfg.freq} dias.</p>`,
      botao: { href: `/consulta/${cid}`, texto: 'Ver o relatório completo' } });
  }
  registrar(null, 'Monitoramento: checagem', `#${m.id} · ${docFmt(m.documento)} · ${tipo} · score ${a.score ?? '—'} · ${a.qtdRestricoes} restrição(ões)${novos.length ? ` · ${novos.length} nova(s)` : ''}`);
  return tipo;
}

let monRodando = false;
async function checarMonitoramentos() {
  if (monRodando) return;
  monRodando = true;
  try {
    // Venceu sem pagar: para de checar
    for (const m of db.prepare("SELECT * FROM monitoramentos WHERE status = 'ativo' AND ativo_ate < datetime('now')").all()) {
      db.prepare("UPDATE monitoramentos SET status = ? WHERE id = ?").run(m.cancelado_em ? 'cancelado' : 'inadimplente', m.id);
      registrar(null, 'Monitoramento: encerrado por falta de pagamento ou cancelamento', `#${m.id} · ${docFmt(m.documento)}`);
      if (!m.cancelado_em) {
        const u = db.prepare('SELECT email FROM usuarios WHERE id = ?').get(m.usuario_id);
        emailServico({ para: u?.email, assunto: 'Seu monitoramento foi pausado', titulo: 'Monitoramento pausado', html: '<p>Não identificamos o pagamento da renovação, então pausamos as checagens do seu documento. Para voltar a ficar protegido, é só assinar de novo.</p>', botao: { href: '/monitoramento', texto: 'Reativar monitoramento' } });
      }
    }
    if (!produtoMonitor()) return;
    for (const m of db.prepare("SELECT * FROM monitoramentos WHERE status = 'ativo' AND ativo_ate >= datetime('now') AND proxima_checagem <= datetime('now') ORDER BY proxima_checagem LIMIT 20").all()) {
      try { await checarUm(m); } catch (e) { console.error('checagem monitoramento', m.id, e.message); }
    }
  } finally { monRodando = false; }
}
setInterval(() => checarMonitoramentos().catch((e) => console.error('monitoramento:', e.message)), 30 * 60 * 1000).unref();
setTimeout(() => checarMonitoramentos().catch((e) => console.error('monitoramento:', e.message)), 30000).unref();

// Webhook do Asaas para assinaturas (chamado pelo /webhook/asaas)
function webhookMonitoramento(event, payment) {
  const ref = String(payment?.externalReference || '');
  const m = (payment?.subscription && db.prepare('SELECT * FROM monitoramentos WHERE asaas_sub_id = ?').get(payment.subscription))
    || (ref.startsWith(AS.PREFIXO_MONITORAMENTO) && db.prepare('SELECT * FROM monitoramentos WHERE id = ?').get(Number(ref.slice(AS.PREFIXO_MONITORAMENTO.length))));
  if (!m || (m.asaas_sub_id && payment.subscription && payment.subscription !== m.asaas_sub_id)) return false;
  if (['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(event)) {
    if (Math.round(Number(payment.value) * 100) >= m.valor_centavos) confirmarPagamentoMon(m, payment.id);
  } else if (event === 'PAYMENT_CREATED' && m.status === 'ativo' && m.forma === 'pix' && !m.cancelado_em) {
    // Nova mensalidade no Pix: manda o link para o cliente pagar
    db.prepare('UPDATE monitoramentos SET link_pagamento = ? WHERE id = ?').run(payment.invoiceUrl || m.link_pagamento, m.id);
    const u = db.prepare('SELECT email FROM usuarios WHERE id = ?').get(m.usuario_id);
    emailServico({ para: u?.email, assunto: 'Renove seu monitoramento de CPF', titulo: 'Sua renovação está disponível',
      html: `<p>A ${m.plano === 'anual' ? 'anuidade' : 'mensalidade'} do seu monitoramento (${docFmt(m.documento)}) de <strong>${P.reais(m.valor_centavos)}</strong> já pode ser paga por Pix. Pagando, a proteção continua sem interrupção.</p>`,
      botao: { href: payment.invoiceUrl || '/monitoramento', texto: 'Pagar com Pix' } });
  }
  return true;
}

// ---------- Cliente ----------
rota('GET', '/monitoramento', exigeLogin(({ res, usuario, url }) => {
  const cfg = monCfg();
  const lista = db.prepare('SELECT * FROM monitoramentos WHERE usuario_id = ? ORDER BY id DESC').all(usuario.id);
  if (!cfg.ativo && !usuario.admin && !lista.length) return pagina(res, 'Monitoramento', P.paginaEmBreve('Monitoramento de CPF', 'Em breve: monitoramento do seu CPF com alertas de negativação e queda de score.'), usuario);
  pagina(res, 'Monitoramento de CPF', (!cfg.ativo ? '<div class="aviso">Produto desligado para novos clientes (você vê por ser admin).</div>' : '') +
    SV.paginaMonitoramento({ cfg, lista, usuario, app: !!ctxReq.getStore()?.app, ok: url.searchParams.get('ok') || '', erro: url.searchParams.get('erro') || '' }), usuario);
}));

rota('POST', '/monitoramento', exigeLogin(async ({ req, res, usuario }) => {
  const cfg = monCfg();
  const f = await corpoForm(req);
  const volta = (m) => redirecionar(res, `/monitoramento?erro=${encodeURIComponent(m)}`);
  if (!cfg.ativo && !usuario.admin) return volta('O monitoramento não está disponível no momento.');
  if (!produtoMonitor()) return volta('O monitoramento ainda não está configurado.');
  const doc = A.soNumeros(f.documento);
  if (!A.documentoValido(doc)) return volta('Informe um CPF ou CNPJ válido.');
  // LGPD: só o próprio CPF (o do cadastro) ou um CNPJ do qual o cliente declara ser responsável
  if (doc.length === 11 && usuario.documento && usuario.documento.length === 11 && usuario.documento !== doc) return volta('Por segurança (LGPD), só é possível monitorar o seu próprio CPF, o mesmo do seu cadastro.');
  if (doc.length === 14 && f.responsavel !== '1') return volta('Para monitorar um CNPJ, confirme que você é sócio ou responsável pela empresa.');
  if (f.aceite !== '1') return volta('Aceite os termos para continuar.');
  if (db.prepare("SELECT 1 FROM monitoramentos WHERE usuario_id = ? AND documento = ? AND status = 'ativo' AND cancelado_em IS NULL").get(usuario.id, doc)) return volta('Esse documento já está sendo monitorado.');
  const plano = f.plano === 'anual' ? 'anual' : 'mensal';
  const forma = f.forma === 'cartao' ? 'cartao' : 'pix';
  const valor = plano === 'anual' ? cfg.anual : cfg.mensal;
  if (!A.limitar(`mon:${usuario.id}`, 5, 60)) return volta('Muitas tentativas. Aguarde alguns minutos.');
  // Pedido anterior não pago do mesmo documento: cancela a assinatura velha
  for (const old of db.prepare("SELECT * FROM monitoramentos WHERE usuario_id = ? AND documento = ? AND status = 'aguardando'").all(usuario.id, doc)) {
    if (old.asaas_sub_id) await AS.cancelarAssinatura(old.asaas_sub_id).catch(() => {});
    db.prepare("UPDATE monitoramentos SET status = 'cancelado', cancelado_em = datetime('now') WHERE id = ?").run(old.id);
  }
  if (doc.length === 11 && !usuario.documento) { db.prepare('UPDATE usuarios SET documento = ? WHERE id = ?').run(doc, usuario.id); usuario.documento = doc; }
  const id = Number(db.prepare("INSERT INTO monitoramentos (usuario_id, documento, plano, forma, valor_centavos, aceite_em, aceite_ip) VALUES (?, ?, ?, ?, ?, datetime('now'), ?)")
    .run(usuario.id, doc, plano, forma, valor, ipDe(req)).lastInsertRowid);
  try {
    let clienteId = db.prepare('SELECT asaas_cliente_id FROM usuarios WHERE id = ?').get(usuario.id).asaas_cliente_id;
    if (!clienteId) {
      if (!usuario.documento) throw new Error('Cadastre seu CPF em Minha conta antes de assinar.');
      clienteId = (await AS.criarCliente(usuario)).id;
      db.prepare('UPDATE usuarios SET asaas_cliente_id = ? WHERE id = ?').run(clienteId, usuario.id);
    }
    const sub = await AS.criarAssinatura({ clienteId, valorCentavos: valor, ciclo: plano, forma, monId: id, descricao: `Monitoramento de ${doc.length === 14 ? 'CNPJ' : 'CPF'} - Soft Consultas (${plano})` });
    let pag = null;
    for (let i = 0; i < 3 && !pag; i++) {
      pag = (await AS.pagamentosAssinatura(sub.id).catch(() => ({ data: [] })))?.data?.[0] || null;
      if (!pag) await new Promise((r) => setTimeout(r, 1200));
    }
    let pix = null;
    if (pag && forma === 'pix') { try { pix = await AS.pixQrCode(pag.id); } catch (e) { console.warn('Pix indisponível:', e.message); } }
    db.prepare('UPDATE monitoramentos SET asaas_sub_id = ?, link_pagamento = ?, pix_codigo = ?, pix_imagem = ? WHERE id = ?').run(sub.id, pag?.invoiceUrl || null, pix?.payload || null, pix?.encodedImage || null, id);
    registrar(null, 'Monitoramento: assinatura criada', `#${id} · ${usuario.email} · ${docFmt(doc)} · ${plano} · ${forma}`);
    if (forma === 'cartao' && pag?.invoiceUrl) return redirecionar(res, pag.invoiceUrl);
    redirecionar(res, `/monitoramento/${id}`);
  } catch (e) {
    console.error('monitoramento:', e.message);
    db.prepare("UPDATE monitoramentos SET status = 'cancelado', cancelado_em = datetime('now') WHERE id = ?").run(id);
    volta(e.message.startsWith('Cadastre') ? e.message : 'Não foi possível gerar o pagamento agora. Tente de novo em instantes.');
  }
}));

rota('GET', '/monitoramento/:id', exigeLogin(({ res, usuario, params }) => {
  const m = db.prepare('SELECT * FROM monitoramentos WHERE id = ? AND usuario_id = ?').get(Number(params.id), usuario.id);
  if (!m) return redirecionar(res, '/monitoramento');
  if (m.status !== 'aguardando') return redirecionar(res, '/monitoramento');
  pagina(res, 'Pagar monitoramento', SV.paginaPagarMonitoramento({ m }), usuario);
}));

rota('GET', '/api/monitoramento/:id/status', async ({ res, usuario, params }) => {
  if (!usuario) return json(res, { pago: false }, 401);
  const m = db.prepare('SELECT * FROM monitoramentos WHERE id = ? AND usuario_id = ?').get(Number(params.id), usuario.id);
  if (!m) return json(res, { pago: false }, 404);
  if (m.status === 'ativo') return json(res, { pago: true, valor: m.valor_centavos / 100, eid: `mon-${m.id}` });
  if (m.asaas_sub_id && A.limitar(`stmon:${m.id}`, 30, 5)) {
    try {
      const pag = (await AS.pagamentosAssinatura(m.asaas_sub_id))?.data?.find((p) => AS.STATUS_PAGO.includes(p.status));
      if (pag && Math.round(Number(pag.value) * 100) >= m.valor_centavos) { confirmarPagamentoMon(m, pag.id); return json(res, { pago: true, valor: m.valor_centavos / 100, eid: `mon-${m.id}` }); }
    } catch (e) { console.warn('status monitoramento:', e.message); }
  }
  json(res, { pago: false });
});

rota('POST', '/monitoramento/cancelar', exigeLogin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const m = db.prepare('SELECT * FROM monitoramentos WHERE id = ? AND usuario_id = ?').get(Number(f.id), usuario.id);
  if (!m || m.cancelado_em) return redirecionar(res, '/monitoramento');
  if (m.asaas_sub_id) await AS.cancelarAssinatura(m.asaas_sub_id).catch((e) => console.warn('cancelar assinatura:', e.message));
  db.prepare("UPDATE monitoramentos SET cancelado_em = datetime('now'), status = CASE WHEN status = 'ativo' THEN 'ativo' ELSE 'cancelado' END WHERE id = ?").run(m.id);
  registrar(null, 'Monitoramento: cancelado pelo cliente', `#${m.id} · ${usuario.email} · ${docFmt(m.documento)}`);
  redirecionar(res, `/monitoramento?ok=${encodeURIComponent(m.status === 'ativo' ? `Assinatura cancelada. Seu monitoramento continua até ${m.ativo_ate.slice(0, 10).split('-').reverse().join('/')} e não será mais cobrado.` : 'Assinatura cancelada.')}`);
}));

// ---------- Admin ----------
rota('GET', '/admin/monitoramento', exigeAdmin(({ res, usuario, url }) => {
  const lista = db.prepare('SELECT m.*, u.email AS cliente FROM monitoramentos m JOIN usuarios u ON u.id = m.usuario_id ORDER BY m.id DESC LIMIT 500').all();
  const ativos = lista.filter((m) => m.status === 'ativo');
  const mrr = ativos.filter((m) => !m.cancelado_em).reduce((s, m) => s + (m.plano === 'anual' ? Math.round(m.valor_centavos / 12) : m.valor_centavos), 0);
  const prod = produtoMonitor();
  pagina(res, 'Admin · Monitoramento', SV.adminMonitoramento({ menu: PD.menu('/admin/monitoramento'), cfg: monCfg(), lista, ativos: ativos.length, mrr, produto: prod,
    produtos: db.prepare("SELECT slug, nome, custo_centavos FROM produtos WHERE endpoint <> '' AND documento IN ('cpf','cnpj','cpf_cnpj') ORDER BY nome").all(),
    ok: url.searchParams.get('ok') || '', erro: url.searchParams.get('erro') || '' }), usuario);
}));

rota('POST', '/admin/monitoramento/config', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const mensal = centavos(f.mensal), anual = centavos(f.anual);
  const volta = (m, ok) => redirecionar(res, `/admin/monitoramento?${ok ? 'ok' : 'erro'}=${encodeURIComponent(m)}`);
  if (!Number.isFinite(mensal) || mensal < 500 || !Number.isFinite(anual) || anual < 500) return volta('Preços inválidos (mínimo R$ 5,00).');
  if (!db.prepare("SELECT 1 FROM produtos WHERE slug = ? AND endpoint <> ''").get(f.produto)) return volta('Escolha uma consulta com endpoint configurado.');
  gravarConfig('mon_ativo', f.ativo === '1' ? '1' : '0');
  gravarConfig('mon_preco_mensal', String(mensal)); gravarConfig('mon_preco_anual', String(anual));
  gravarConfig('mon_produto', f.produto);
  gravarConfig('mon_frequencia_dias', String(Math.min(90, Math.max(7, Math.floor(Number(f.freq) || 30)))));
  gravarConfig('mon_queda_score', String(Math.max(10, Math.floor(Number(f.queda) || 50))));
  registrar(usuario, 'Monitoramento: configuração', `${f.ativo === '1' ? 'LIGADO' : 'desligado'} · mensal ${P.reais(mensal)} · anual ${P.reais(anual)} · consulta ${f.produto} · a cada ${f.freq} dias`);
  volta('Configuração salva.', true);
}));

rota('POST', '/admin/monitoramento/acao', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const m = db.prepare('SELECT * FROM monitoramentos WHERE id = ?').get(Number(f.id));
  const volta = (msg, ok) => redirecionar(res, `/admin/monitoramento?${ok ? 'ok' : 'erro'}=${encodeURIComponent(msg)}`);
  if (!m) return volta('Assinatura não encontrada.');
  if (f.acao === 'checar') {
    if (m.status !== 'ativo') return volta('Só assinaturas ativas são checadas.');
    try { const t = await checarUm(m); registrar(usuario, 'Monitoramento: checagem manual', `#${m.id} · ${t}`); return volta(`Checagem feita (${t}). O cliente recebeu o e-mail.`, true); }
    catch (e) { return volta(`Falhou: ${e.message}`); }
  }
  if (f.acao === 'conferir') {
    try {
      const pag = (await AS.pagamentosAssinatura(m.asaas_sub_id))?.data?.find((p) => AS.STATUS_PAGO.includes(p.status) && p.id !== m.pagamento_atual);
      if (pag) { confirmarPagamentoMon(m, pag.id); registrar(usuario, 'Monitoramento: pagamento conferido', `#${m.id}`); return volta('Pagamento encontrado e assinatura atualizada.', true); }
      return volta('Nenhum pagamento novo no Asaas.');
    } catch (e) { return volta(`Falhou: ${e.message}`); }
  }
  if (f.acao === 'cancelar') {
    if (m.asaas_sub_id) await AS.cancelarAssinatura(m.asaas_sub_id).catch(() => {});
    db.prepare("UPDATE monitoramentos SET cancelado_em = COALESCE(cancelado_em, datetime('now')), status = CASE WHEN status = 'ativo' THEN 'ativo' ELSE 'cancelado' END WHERE id = ?").run(m.id);
    registrar(usuario, 'Monitoramento: cancelado pelo admin', `#${m.id} · ${docFmt(m.documento)}`);
    return volta('Assinatura cancelada (não será mais cobrada; segue ativa até o fim do período pago).', true);
  }
  volta('Ação inválida.');
}));

// ======================= SERVIÇO LIMPA NOME (lote semanal, Pix separado) =======================
const lnCfg = () => ({
  ativo: lerConfig('lns_ativo') === '1', preco: Number(lerConfig('lns_preco_centavos') || 0),
  dia: Math.min(6, Math.max(0, Number(lerConfig('lns_dia_lote') ?? 5))),
  prazo: lerConfig('lns_prazo') || '', executor: lerConfig('lns_executor') || '', garantia: lerConfig('lns_garantia') || '',
  resumo: lerConfig('lns_resumo') || '', video: lerConfig('lns_video') || '',
  blindagem: Math.min(24, Math.max(0, Math.floor(Number(lerConfig('lns_blindagem_meses') ?? 6)))),
  whatsapp: (lerConfig('lns_whatsapp') || '').replace(/\D/g, ''), atendimento: lerConfig('lns_atendimento') || '',
  parcelas: Math.min(12, Math.max(1, Number(lerConfig('lns_parcelas') || 10))),
  juros: Math.min(15, Math.max(0, Number(lerConfig('lns_juros_mensal') ?? 2.99))),
  antecipar: lerConfig('lns_antecipar') !== '0',
});
const lnCfgComTabela = () => { const c = lnCfg(); return { ...c, servico: 'limpa_nome', nomeServico: 'Limpa Nome', tabela: SV.tabelaParcelas(c.preco, c.parcelas, c.juros) }; };
// Serviços vendidos pelo mesmo fluxo (pedido, pagamento, etapas): Limpa Nome, Rating Bancário e o combo dos dois
const SERVICOS = SV.SERVICOS;
const svcOk = (s) => (SERVICOS[s] ? s : 'limpa_nome');
function cfgServico(svc) {
  const c = lnCfg();
  if (svc === 'rating') return { ...c, servico: 'rating', nomeServico: SERVICOS.rating, ativoFlag: lerConfig('rtg_ativo') === '1', ativo: lerConfig('rtg_ativo') === '1' && Number(lerConfig('rtg_preco_centavos') || 0) >= 500,
    preco: Number(lerConfig('rtg_preco_centavos') || 0), prazo: lerConfig('rtg_prazo') || '', resumo: lerConfig('rtg_resumo') || '', video: '' };
  if (svc === 'combo') {
    const r = cfgServico('rating'), preco = Number(lerConfig('cmb_preco_centavos') || 0);
    return { ...c, servico: 'combo', nomeServico: SERVICOS.combo, ativo: c.ativo && r.ativo && preco >= 500, preco, precoSeparado: c.preco + r.preco, prazoRating: r.prazo };
  }
  return { ...c, servico: 'limpa_nome', nomeServico: SERVICOS.limpa_nome };
}
const cfgServicoComTabela = (svc) => { const c = cfgServico(svc); return { ...c, tabela: SV.tabelaParcelas(c.preco, c.parcelas, c.juros) }; };
// Serviços que entram no lote semanal da ação (o Rating sozinho não entra)
const SQL_LOTE = "servico <> 'rating'";
// Pedidos que conflitam (mesmo CPF em andamento)
const familiaServico = (svc) => (svc === 'rating' ? "('rating','combo')" : svc === 'combo' ? "('limpa_nome','combo','rating')" : "('limpa_nome','combo')");
const linkPedidoCliente = (p) => (p.token ? `/ln/${p.token}` : p.servico === 'rating' ? `/rating/${p.id}` : `/limpa-nome/servico/${p.id}`);
// Próximo dia de lote (horário de Brasília), sempre a partir de amanhã: quem paga no dia do lote entra no seguinte
function proximoLoteLN(dia = lnCfg().dia) {
  const d = new Date(Date.now() - 3 * 3600000);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== dia) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const ATIVOS_LN = "('aguardando_pagamento','pago','em_analise','em_lote','em_andamento','decisao')";
const FINAIS_LN = ['concluido', 'cancelado', 'reembolsado'];
function tipoDoc(b) {
  if (b.subarray(0, 5).toString() === '%PDF-') return 'pdf';
  return tipoImagem(b);
}
const MIME_DOC = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

function emailPedidoLN(p, titulo, texto) {
  if (!process.env.RESEND_API_KEY || !p.email) return;
  const base = baseEmails();
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F4F1F7;font-family:Arial,Helvetica,sans-serif;color:#0F0C14">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:18px;overflow:hidden">
<tr><td style="background:#0F0C14;padding:20px 28px;color:#fff;font-weight:bold;font-size:18px">Soft <span style="color:#C98BEB;font-weight:normal">Consultas</span> · ${P.esc(SERVICOS[p.servico] || 'Limpa Nome')}</td></tr>
<tr><td style="padding:28px;font-size:16px;line-height:1.55"><h1 style="font-size:21px;margin:0 0 12px">${P.esc(titulo)}</h1>
<p>Olá, ${P.esc(String(p.nome).split(/\s+/)[0])}! ${texto}</p>
<p style="margin:24px 0"><a href="${base}${linkPedidoCliente(p)}" style="display:inline-block;background:#9F31D3;color:#fff;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:bold">${p.token && p.status === 'aguardando_pagamento' ? 'Pagar e acompanhar meu pedido' : 'Acompanhar meu pedido'}</a></p>
<p style="font-size:14px">Dúvidas? <a href="${p.token ? `${base}/ln/${p.token}/ajuda?e=email` : `${base}/limpa-nome/ajuda?p=${p.id}&e=email`}" style="color:#1FA855;font-weight:bold">Fale com a gente no WhatsApp</a></p>
<p style="font-size:13px;color:#7A7285">Pedido #${p.id} · documento final ${P.esc(String(p.cpf).slice(-4))}</p></td></tr></table></td></tr></table></body></html>`;
  enviarEmail({ para: p.email, assunto: `${titulo} · Pedido #${p.id}`, html }).catch((e) => console.error('e-mail limpa nome:', e.message));
}
const TEXTO_STATUS_LN = {
  pago: (p) => [`Pagamento confirmado`, `Recebemos o seu pagamento. O seu nome será incluído na ação coletiva de <strong>${P.esc(p.lote?.split('-').reverse().join('/') || '')}</strong>.`],
  em_lote: (p) => [`Você foi incluído na ação coletiva`, `O seu pedido foi incluído na ação judicial coletiva de ${P.esc(p.lote?.split('-').reverse().join('/') || '')}. Agora é aguardar o andamento; avisamos a cada etapa.`],
  em_analise: () => [`Estamos analisando seus documentos`, 'Recebemos o seu pedido e estamos conferindo os dados e documentos para incluir você na ação coletiva.'],
  em_andamento: () => [`Aguardando a decisão judicial`, 'A ação com o seu pedido foi protocolada e agora aguarda a decisão judicial. Avisamos assim que sair.'],
  decisao: () => [`Saiu a decisão: os órgãos estão dando baixa`, 'A decisão judicial foi obtida e os órgãos de proteção ao crédito estão cumprindo a determinação. Você acompanha a baixa em cada órgão (Serasa, SPC, Boa Vista e protestos) na página do pedido.'],
  concluido: (p) => [`Seu nome está limpo`, `O seu pedido de Limpa Nome foi concluído. Faça uma consulta do seu CPF ou CNPJ na plataforma para conferir o "nada consta".${p.blindagem_ate ? ` A sua <strong>blindagem</strong> vale até ${P.esc(p.blindagem_ate.split('-').reverse().join('/'))}: se alguma negativação abrangida voltar, é só chamar o atendimento.` : ''}`],
  cancelado: () => [`Seu pedido foi cancelado`, 'O seu pedido foi cancelado.'],
  reembolsado: () => [`Seu pagamento foi reembolsado`, 'O valor do seu pedido foi devolvido.'],
};
// Rating Bancário: textos próprios de cada etapa
const TEXTO_STATUS_RTG = {
  pago: (p) => p.combo_de ? [`Seu Rating Bancário está garantido`, 'O Rating Bancário faz parte do seu combo e começa assim que o Limpa Nome for concluído. Avisamos aqui quando iniciar.']
    : [`Pagamento confirmado`, 'Recebemos o seu pagamento. Nos próximos dias úteis começamos a análise do seu perfil bancário e avisamos a cada etapa.'],
  em_analise: () => [`Estamos analisando o seu perfil bancário`, 'Estamos levantando o seu histórico de crédito (Registrato/SCR do Banco Central, score, Cadastro Positivo e dados cadastrais) para montar a estratégia do seu caso.'],
  em_andamento: () => [`O trabalho no seu rating começou`, 'Estamos cuidando das atualizações cadastrais, do Cadastro Positivo e dos ajustes que melhoram a forma como os bancos enxergam você. Siga as orientações que enviarmos: elas fazem parte do resultado.'],
  decisao: () => [`Reavaliação do seu perfil`, 'Estamos medindo a evolução do seu perfil depois das ações realizadas. Em breve enviamos o resultado e os próximos passos.'],
  concluido: () => [`Rating Bancário concluído`, 'O trabalho no seu perfil foi concluído. Mantenha as recomendações (contas em dia, uso consciente do limite e poucos pedidos de crédito) para seguir evoluindo. O serviço não garante aprovação de crédito: a decisão final é sempre de cada instituição.'],
  cancelado: () => [`Seu pedido foi cancelado`, 'O seu pedido de Rating Bancário foi cancelado.'],
  reembolsado: () => [`Seu pagamento foi reembolsado`, 'O valor do seu pedido foi devolvido.'],
};
function avisarStatusLN(p) {
  let f = (p.servico === 'rating' ? TEXTO_STATUS_RTG : TEXTO_STATUS_LN)[p.status];
  if (p.servico === 'combo' && p.status === 'pago' && f) { const g = f; f = (q) => { const [t, x] = g(q); return [t, `${x} O Rating Bancário do seu combo começa assim que o Limpa Nome for concluído. Já deixe pronta a <a href="${baseEmails()}${linkFicha(q)}">ficha cadastral do Rating</a>.`]; }; }
  if (p.servico === 'rating' && p.status === 'pago' && !p.combo_de && f) { const g = f; f = (q) => { const [t, x] = g(q); return [t, `${x}<br><br><strong>Próximo passo:</strong> preencha a <a href="${baseEmails()}${linkFicha(q)}">ficha cadastral</a> (dados, referências, acesso ao Serasa e selfie com o documento). O trabalho começa assim que ela chegar.`]; }; }
  if (!f) return;
  const [t, x] = f(p);
  emailPedidoLN(p, t, x + (p.obs_admin ? `<br><br><strong>Mensagem da equipe:</strong> ${P.esc(p.obs_admin)}` : ''));
  enviarPush(p.usuario_id, { titulo: `${SERVICOS[p.servico] || 'Limpa Nome'} · ${t}`, corpo: String(x).replace(/<[^>]+>/g, '').slice(0, 200), link: p.servico === 'rating' ? `/rating/${p.id}` : `/limpa-nome/servico/${p.id}` }).catch(() => {});
  if (p.parceiro_id) emailParceiroLN(p, t, `Atualização do seu cliente: <strong>${P.esc(SV.STATUS_LN[p.status]?.t || p.status)}</strong>.${p.status === 'pago' && p.parceiro_modelo === 'comissao' && p.parceiro_comissao_centavos ? ` A sua comissão de <strong>${P.reais(p.parceiro_comissao_centavos)}</strong> já está no seu saldo.` : ''}${p.obs_admin ? `<br><br><strong>Mensagem da equipe:</strong> ${P.esc(p.obs_admin)}` : ''}`);
}
// Confirma o pagamento (webhook ou consulta de status). Retorna true só na primeira vez.
// Repasse automático: parceiros com chave Pix cadastrada recebem a comissão sozinhos.
// Pix: sai na hora. Cartão: só depois que a antecipação cai (ou 31 dias), para não pagarmos antes de receber.
function agendarRepasse(p) {
  const x = db.prepare('SELECT * FROM parceiros WHERE usuario_id = ?').get(p.parceiro_id);
  if (!x?.repasse_auto || !x.repasse_pix || !AS.tipoChavePix(x.repasse_pix)) return;
  if (db.prepare('SELECT 1 FROM saques WHERE automatico = 1 AND pedido_id = ?').get(p.id)) return;
  db.exec('BEGIN IMMEDIATE');
  let sid = null;
  try {
    const valor = Math.min(p.parceiro_comissao_centavos, saldoComissao(p.parceiro_id));
    if (valor > 0) {
      const liberar = p.forma_pagamento === 'cartao' ? null : db.prepare("SELECT datetime('now') d").get().d;
      sid = Number(db.prepare('INSERT INTO saques (usuario_id, valor_centavos, chave_pix, taxa_centavos, automatico, pedido_id, liberar_em, observacao) VALUES (?, ?, ?, 0, 1, ?, ?, ?)')
        .run(p.parceiro_id, valor, x.repasse_pix, p.id, liberar, p.forma_pagamento === 'cartao' ? 'Repasse automático: aguardando o cartão cair' : 'Repasse automático').lastInsertRowid);
      db.prepare("INSERT INTO comissoes (usuario_id, tipo, valor_centavos, descricao, referencia) VALUES (?, 'saque', ?, ?, ?)").run(p.parceiro_id, -valor, `Repasse automático via Pix · pedido #${p.id}`, `saque_${sid}`);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); console.error('repasse:', e.message); return; }
  if (sid) { registrar(null, 'Parceiro: repasse agendado', `saque #${sid} · pedido #${p.id}`); processarRepasses().catch((e) => console.error('repasses:', e.message)); }
}
let repassando = false;
async function processarRepasses() {
  if (repassando) return;
  repassando = true;
  try {
    for (const s2 of db.prepare("SELECT * FROM saques WHERE automatico = 1 AND status = 'pendente' AND tentativas < 10 ORDER BY id LIMIT 30").all()) {
      if (!s2.liberar_em) {
        const ped = db.prepare('SELECT pago_em, antecipacao_status, status FROM limpa_nome_pedidos WHERE id = ?').get(s2.pedido_id);
        const caiu = ped && (ped.antecipacao_status === 'CREDITED' || db.prepare("SELECT ? < datetime('now', '-31 days') v").get(ped.pago_em).v);
        if (!caiu) continue;
        db.prepare("UPDATE saques SET liberar_em = datetime('now') WHERE id = ?").run(s2.id);
      } else if (db.prepare("SELECT ? > datetime('now') v").get(s2.liberar_em).v) continue;
      if (saquesEmAndamento.has(s2.id)) continue;
      saquesEmAndamento.add(s2.id);
      try {
        const t = await AS.transferirPix({ valorCentavos: s2.valor_centavos, chave: s2.chave_pix, descricao: `Repasse Soft Consultas · pedido #${s2.pedido_id}` });
        db.prepare("UPDATE saques SET status = 'pago', resolvido_em = datetime('now'), observacao = ?, asaas_transferencia_id = ? WHERE id = ? AND status = 'pendente'").run(`Repasse automático (${t.status || 'enviado'})`, t.id || null, s2.id);
        registrar(null, 'Parceiro: repasse automático pago', `saque #${s2.id} · ${P.reais(s2.valor_centavos)} para ${s2.chave_pix} · pedido #${s2.pedido_id} · transferência ${t.id || '-'}`);
      } catch (e) {
        db.prepare('UPDATE saques SET tentativas = tentativas + 1, observacao = ? WHERE id = ?').run(`Repasse automático: falhou (${String(e.message).slice(0, 150)}). Tentamos de novo a cada 30 min.`, s2.id);
        registrar(null, 'Parceiro: repasse automático falhou', `saque #${s2.id} · ${e.message}`);
      } finally { saquesEmAndamento.delete(s2.id); }
    }
  } finally { repassando = false; }
}
setInterval(() => processarRepasses().catch((e) => console.error('repasses:', e.message)), 30 * 60 * 1000).unref();

// Combo pago: cria o pedido do Rating Bancário (sem cobrança própria), que começa depois que o Limpa Nome terminar
function criarRatingDoCombo(paiId) {
  if (db.prepare('SELECT 1 FROM limpa_nome_pedidos WHERE combo_de = ?').get(paiId)) return;
  const p = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE id = ?').get(paiId);
  db.prepare(`INSERT INTO limpa_nome_pedidos (usuario_id, nome, cpf, nascimento, telefone, email, doc_tipo, titular_proprio, aceite_em, aceite_ip, valor_centavos, forma_pagamento, parcelas, status, pago_em,
      obs_admin, servico, combo_de, parceiro_id, parceiro_modelo, parceiro_comissao_centavos, token, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, 'pago', datetime('now'), ?, 'rating', ?, ?, ?, 0, ?, datetime('now'))`)
    .run(p.usuario_id, p.nome, p.cpf, p.nascimento, p.telefone, p.email, p.doc_tipo, p.titular_proprio, p.aceite_em, p.aceite_ip, p.forma_pagamento,
      'Faz parte do combo: começa assim que o Limpa Nome for concluído.', p.id, p.parceiro_id, p.parceiro_modelo, p.token ? randomBytes(16).toString('hex') : null);
  registrar(null, 'Combo: pedido de Rating criado', `combo #${p.id} · ${p.nome}`);
}
function confirmarPedidoLN(id) {
  const svc = db.prepare('SELECT servico FROM limpa_nome_pedidos WHERE id = ?').get(id)?.servico;
  const lote = svc === 'rating' ? null : proximoLoteLN();
  const ok = db.prepare("UPDATE limpa_nome_pedidos SET status = 'pago', pago_em = datetime('now'), lote = ?, atualizado_em = datetime('now') WHERE id = ? AND status = 'aguardando_pagamento'").run(lote, id).changes === 1;
  if (ok && svc === 'combo') criarRatingDoCombo(id);
  if (ok) {
    const p = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE id = ?').get(id);
    registrar(null, 'Limpa Nome: pedido pago', `#${id} · ${p.nome} · ${P.reais(p.valor_centavos)}${p.forma_pagamento === 'cartao' ? ` (cartão ${p.parcelas}x)` : ''} · lote ${lote}`);
    avisarStatusLN(p);
    if (!p.parceiro_id && !p.combo_de) capiCompra({ eid: `ln-${p.id}`, valor: p.valor_centavos, email: p.email, telefone: p.telefone || p.whatsapp, nome: p.nome, usuarioId: p.usuario_id, conteudo: p.servico || 'limpa-nome' });
    // Parceiro: comissão quando o cliente paga (uma vez por pedido)
    if (p.parceiro_id && p.parceiro_modelo === 'comissao' && p.parceiro_comissao_centavos > 0) {
      const ins = db.prepare("INSERT OR IGNORE INTO comissoes (usuario_id, tipo, valor_centavos, descricao, referencia) VALUES (?, 'comissao', ?, ?, ?)")
        .run(p.parceiro_id, p.parceiro_comissao_centavos, `Limpa Nome #${p.id} · ${String(p.nome).slice(0, 60)}`, `ln_${p.id}`);
      if (ins.changes) { registrar(null, 'Parceiro: comissão creditada', `#${p.id} · ${P.reais(p.parceiro_comissao_centavos)}`); agendarRepasse(p); }
    }
    if (p.forma_pagamento === 'cartao' && lnCfg().antecipar) anteciparPedidoLN(p.id).catch((e) => console.error('antecipação:', e.message));
  }
  return ok;
}

// Antecipação do cartão: pede ao Asaas o parcelamento inteiro de uma vez (o crédito costuma cair no próximo dia útil)
const antecipando = new Set();
async function anteciparPedidoLN(id, admin = null) {
  if (antecipando.has(id)) return { ok: false, msg: 'Já está em andamento.' };
  antecipando.add(id);
  try {
    const p = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE id = ?').get(id);
    if (!p || p.forma_pagamento !== 'cartao' || !p.pago_em || p.antecipacao_id) return { ok: false, msg: 'Pedido não elegível para antecipação.' };
    const alvo = p.asaas_parcelamento ? { installment: p.asaas_parcelamento } : { payment: p.asaas_id };
    db.prepare('UPDATE limpa_nome_pedidos SET antecipacao_tentativas = antecipacao_tentativas + 1 WHERE id = ?').run(id);
    try {
      const sim = await AS.simularAntecipacao(alvo);
      if (sim?.isDocumentationRequired) throw new Error('O Asaas pediu documentos para esta antecipação: faça pelo painel do Asaas.');
      const a = await AS.solicitarAntecipacao(alvo);
      const liquido = Math.round(Number(a.netValue ?? sim?.netValue ?? 0) * 100) || null;
      db.prepare("UPDATE limpa_nome_pedidos SET antecipacao_id = ?, antecipacao_status = ?, antecipacao_liquido_centavos = ?, antecipacao_erro = NULL, atualizado_em = datetime('now') WHERE id = ?")
        .run(a.id || null, a.status || 'PENDING', liquido, id);
      registrar(admin, 'Limpa Nome: antecipação pedida', `#${id} · ${P.reais(p.valor_centavos)}${liquido ? ` · líquido ${P.reais(liquido)}` : ''} · ${a.status || ''}`);
      return { ok: true, msg: `Antecipação solicitada${liquido ? `: líquido ${P.reais(liquido)}` : ''}.` };
    } catch (e) {
      db.prepare('UPDATE limpa_nome_pedidos SET antecipacao_erro = ? WHERE id = ?').run(String(e.message).slice(0, 300), id);
      registrar(admin, 'Limpa Nome: antecipação falhou', `#${id} · ${e.message}`);
      return { ok: false, msg: e.message };
    }
  } finally { antecipando.delete(id); }
}
// A cada 30 min: tenta de novo as que falharam (até 6 vezes) e atualiza o status das pedidas
async function revisarAntecipacoesLN() {
  if (!lnCfg().antecipar) return;
  for (const p of db.prepare("SELECT id FROM limpa_nome_pedidos WHERE forma_pagamento = 'cartao' AND pago_em IS NOT NULL AND antecipacao_id IS NULL AND antecipacao_tentativas < 6 AND status NOT IN ('cancelado','reembolsado')").all())
    await anteciparPedidoLN(p.id);
  for (const p of db.prepare("SELECT id, antecipacao_id, antecipacao_status FROM limpa_nome_pedidos WHERE antecipacao_id IS NOT NULL AND antecipacao_status IN ('PENDING','SCHEDULED')").all()) {
    try {
      const a = await AS.buscarAntecipacao(p.antecipacao_id);
      if (a.status && a.status !== p.antecipacao_status) {
        db.prepare('UPDATE limpa_nome_pedidos SET antecipacao_status = ?, antecipacao_liquido_centavos = COALESCE(?, antecipacao_liquido_centavos) WHERE id = ?').run(a.status, Math.round(Number(a.netValue || 0) * 100) || null, p.id);
        registrar(null, 'Limpa Nome: antecipação atualizada', `#${p.id} · ${p.antecipacao_status} → ${a.status}`);
        if (a.status === 'CREDITED') processarRepasses().catch((e) => console.error('repasses:', e.message));
      }
    } catch (e) { console.warn('antecipação status:', e.message); }
  }
}
setInterval(() => revisarAntecipacoesLN().catch((e) => console.error('antecipações:', e.message)), 30 * 60 * 1000).unref();

rota('POST', '/admin/limpa-nome/antecipar', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const r = await anteciparPedidoLN(Number(f.id), usuario);
  redirecionar(res, `/admin/limpa-nome?f=todos&${r.ok ? 'ok' : 'erro'}=${encodeURIComponent(r.msg)}`);
}));

// Pedidos do próprio cliente (os cadastrados por parceiro ficam na área do parceiro)
const pedidosDoCliente = (uid, origem) => db.prepare(`SELECT * FROM limpa_nome_pedidos WHERE usuario_id = ? AND parceiro_id IS NULL AND servico ${origem === 'rating' ? "= 'rating'" : "<> 'rating'"} ORDER BY id DESC`).all(uid);
rota('GET', '/limpa-nome/servico', exigeLogin(({ res, usuario }) => {
  const cfg = lnCfgComTabela();
  const pedidos = pedidosDoCliente(usuario.id, 'limpa_nome');
  if (!cfg.ativo && !usuario.admin && !pedidos.length) return pagina(res, 'Limpa Nome', P.paginaEmBreve('Limpa Nome', 'O serviço de Limpa Nome estará disponível em breve.'), usuario);
  pagina(res, 'Serviço Limpa Nome', (!cfg.ativo ? '<div class="aviso">Serviço desligado para novos pedidos' + (usuario.admin ? ' (você vê esta página por ser admin).' : '.') + '</div>' : '') +
    SV.paginaServicoLN({ cfg, combo: cfgServico('combo'), proximoLote: proximoLoteLN(cfg.dia), pedidos, usuario }), usuario);
}));

async function criarPedidoCliente({ req, res, usuario }, origem) {
  let cfg = cfgServicoComTabela(origem);
  const pedidos = pedidosDoCliente(usuario.id, origem);
  let v = {};
  const erro = (m) => (origem === 'rating'
    ? pagina(res, 'Rating Bancário', SV.paginaServicoRating({ cfg: cfgServicoComTabela('rating'), combo: cfgServico('combo'), pedidos, usuario, erro: m, v }), usuario, 400)
    : pagina(res, 'Serviço Limpa Nome', SV.paginaServicoLN({ cfg: lnCfgComTabela(), combo: cfgServico('combo'), proximoLote: proximoLoteLN(cfg.dia), pedidos, usuario, erro: m, v }), usuario, 400));
  if (!cfg.ativo && !usuario.admin) return erro('O serviço não está recebendo pedidos no momento.');
  if (cfg.preco < 500) return erro('O serviço ainda não está configurado. Tente novamente mais tarde.');
  let form;
  try { form = await corpoMultipart(req, 11 * 1024 * 1024); } catch (e) { return erro(e.message === 'arquivo grande demais' ? 'Arquivos grandes demais (até 5 MB cada).' : 'Não foi possível ler o formulário.'); }
  v = form.campos;
  const svc = v.combo === '1' ? 'combo' : origem;
  if (svc !== origem) { cfg = cfgServicoComTabela(svc); if (!cfg.ativo && !usuario.admin) return erro('O combo não está disponível no momento.'); }
  if (cfg.preco < 500) return erro('Este serviço ainda não está configurado. Tente novamente mais tarde.');
  const nome = String(v.nome || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const cpf = A.soNumeros(v.cpf);
  const nasc = String(v.nascimento || '');
  const tel = A.soNumeros(v.telefone);
  const email = String(v.email || '').trim().toLowerCase().slice(0, 120);
  const docTipo = v.doc_tipo === 'CNH' ? 'CNH' : 'RG';
  const forma = v.forma === 'cartao' && cfg.parcelas >= 1 ? 'cartao' : 'pix';
  const parcelas = forma === 'cartao' ? Math.min(cfg.parcelas, Math.max(1, Math.floor(Number(v.parcelas) || 1))) : 1;
  const totalCobrado = forma === 'cartao' ? cfg.tabela[parcelas - 1].total : cfg.preco;
  if (nome.split(' ').length < 2) return erro('Informe o nome completo do titular.');
  if (!((cpf.length === 11 || cpf.length === 14) && A.documentoValido(cpf))) return erro('CPF ou CNPJ inválido.');
  const anos = (Date.now() - Date.parse(nasc)) / (365.25 * 86400000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nasc) || !(anos >= 18 && anos < 120)) return erro('Informe uma data de nascimento válida (o titular ou sócio precisa ser maior de idade).');
  if (tel.length < 10 || tel.length > 13) return erro('Informe um WhatsApp válido com DDD.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erro('Informe um e-mail válido.');
  if (v.aceite !== '1') return erro('É preciso aceitar a autorização para continuar.');
  if (db.prepare(`SELECT 1 FROM limpa_nome_pedidos WHERE cpf = ? AND servico IN ${familiaServico(svc)} AND status IN ('pago','em_analise','em_lote','em_andamento','decisao')`).get(cpf)) return erro('Já existe um pedido em andamento para este CPF/CNPJ.');
  const docs = {};
  for (const lado of ['doc_frente', 'doc_verso']) {
    const a = form.arquivos[lado];
    if (!a) continue;
    if (a.dados.length > 5 * 1024 * 1024) return erro('Cada arquivo pode ter até 5 MB.');
    const t = tipoDoc(a.dados);
    if (!t) return erro('Envie o documento em JPG, PNG, WEBP ou PDF.');
    docs[lado] = { t, dados: a.dados };
  }
  if (!docs.doc_frente) return erro('Envie a foto da frente do documento.');
  if (!A.limitar(`ln:${usuario.id}`, 5, 60)) return erro('Muitos pedidos em pouco tempo. Aguarde alguns minutos.');
  // Pedido para o mesmo CPF ainda não pago: reaproveita (não cria cobranças duplicadas)
  const antigo = db.prepare("SELECT id FROM limpa_nome_pedidos WHERE usuario_id = ? AND cpf = ? AND status = 'aguardando_pagamento' AND parceiro_id IS NULL AND servico = ?").get(usuario.id, cpf, svc);
  if (antigo) db.prepare("UPDATE limpa_nome_pedidos SET status = 'cancelado', obs_admin = 'Substituído por um novo pedido', atualizado_em = datetime('now') WHERE id = ?").run(antigo.id);
  const id = Number(db.prepare(`INSERT INTO limpa_nome_pedidos (usuario_id, nome, cpf, nascimento, telefone, email, doc_tipo, titular_proprio, aceite_em, aceite_ip, valor_centavos, forma_pagamento, parcelas, juros_centavos, servico)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?)`).run(usuario.id, nome, cpf, nasc, tel, email, docTipo, v.proprio === '1' ? 1 : 0, ipDe(req), totalCobrado, forma, parcelas, totalCobrado - cfg.preco, svc).lastInsertRowid);
  try {
    const nomes = {};
    for (const [lado, d] of Object.entries(docs)) {
      const arq = `${id}-${lado.slice(4)}-${randomBytes(8).toString('hex')}.${d.t}`;
      await writeFile(path.join(pastaDocsLimpaNome, arq), d.dados, { mode: 0o600 });
      nomes[lado] = arq;
    }
    db.prepare('UPDATE limpa_nome_pedidos SET doc_frente = ?, doc_verso = ? WHERE id = ?').run(nomes.doc_frente || null, nomes.doc_verso || null, id);
    let clienteId = db.prepare('SELECT asaas_cliente_id FROM usuarios WHERE id = ?').get(usuario.id).asaas_cliente_id;
    if (!clienteId && !usuario.documento && v.proprio !== '1') {
      // Conta sem CPF pedindo para terceiro: a cobrança sai no nome do titular (não mexe no cadastro do cliente)
      clienteId = (await AS.criarCliente({ nome, documento: cpf, email, telefone: tel })).id;
    } else if (!clienteId) {
      if (!usuario.documento) { db.prepare('UPDATE usuarios SET documento = ? WHERE id = ?').run(cpf, usuario.id); usuario.documento = cpf; }
      clienteId = (await AS.criarCliente(usuario)).id;
      db.prepare('UPDATE usuarios SET asaas_cliente_id = ? WHERE id = ?').run(clienteId, usuario.id);
    }
    const cob = await AS.criarCobrancaServico({ clienteId, valorCentavos: totalCobrado, pedidoId: id, forma, parcelas, descricao: `${cfg.nomeServico} - Soft Consultas #${id}` });
    let pix = null;
    if (forma === 'pix') { try { pix = await AS.pixQrCode(cob.id); } catch (e) { console.warn('Pix indisponível:', e.message); } }
    db.prepare("UPDATE limpa_nome_pedidos SET asaas_id = ?, asaas_parcelamento = ?, pix_codigo = ?, pix_imagem = ?, link_pagamento = ?, atualizado_em = datetime('now') WHERE id = ?")
      .run(cob.id, cob.installment || null, pix?.payload || null, pix?.encodedImage || null, cob.invoiceUrl || null, id);
    // Cartão: vai direto para a página segura do Asaas
    if (forma === 'cartao' && cob.invoiceUrl) return redirecionar(res, cob.invoiceUrl);
    redirecionar(res, origem === 'rating' ? `/rating/${id}` : `/limpa-nome/servico/${id}`);
  } catch (e) {
    console.error('limpa nome:', e.message);
    db.prepare("UPDATE limpa_nome_pedidos SET status = 'cancelado', obs_admin = 'Falha ao gerar o Pix', atualizado_em = datetime('now') WHERE id = ?").run(id);
    erro('Não foi possível gerar o Pix agora. Tente de novo em instantes.');
  }
}
rota('POST', '/limpa-nome/servico', exigeLogin((ctx) => criarPedidoCliente(ctx, 'limpa_nome')));
rota('POST', '/rating', exigeLogin((ctx) => criarPedidoCliente(ctx, 'rating')));

// Atendimento: registra o pedido de ajuda (para medir quantos não conseguem sozinhos) e abre o WhatsApp
rota('GET', '/limpa-nome/ajuda', exigeLogin(({ res, usuario, url }) => {
  const cfg = lnCfg();
  if (!cfg.whatsapp) return redirecionar(res, '/limpa-nome/servico');
  const p = db.prepare('SELECT id, status FROM limpa_nome_pedidos WHERE id = ? AND usuario_id = ?').get(Number(url.searchParams.get('p')) || 0, usuario.id);
  const etapa = String(url.searchParams.get('e') || '').replace(/[^\w-]/g, '').slice(0, 30);
  registrar(null, 'Limpa Nome: cliente chamou o atendimento', `${usuario.email}${p ? ` · pedido #${p.id} (${p.status})` : ''}${etapa ? ` · na etapa: ${etapa}` : ''}`);
  const msg = `Olá! Preciso de ajuda com o Limpa Nome da Soft Consultas.${p ? ` Meu pedido é o #${p.id}.` : ''} (conta: ${usuario.email})`;
  redirecionar(res, `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(msg)}`);
}));

const detalhePedidoCliente = ({ res, usuario, params, url }) => {
  const p = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE id = ? AND usuario_id = ?').get(Number(params.id), usuario.id);
  if (!p) return redirecionar(res, '/limpa-nome/servico');
  const voltar = p.servico === 'rating' ? ['/rating', '← Rating Bancário'] : ['/limpa-nome/servico', '← Limpa Nome'];
  const topo = (url.searchParams.get('ficha') ? '<div class="aviso ok" style="max-width:620px">Ficha cadastral recebida! Agora é com a gente: avisamos a cada etapa.</div>' : '') + (fichaPendente(p) ? avisoFicha(linkFicha(p)) : '');
  pagina(res, `Pedido #${p.id}`, SV.paginaPedidoLN({ p, cfg: cfgServico(p.servico), voltar, topo, ...relacionadosCombo(p) }), usuario);
};
// Combo: o pedido do Limpa Nome mostra o Rating que vem depois, e vice-versa
const relacionadosCombo = (p) => ({
  filho: p.servico === 'combo' ? db.prepare('SELECT id, token, status, servico FROM limpa_nome_pedidos WHERE combo_de = ?').get(p.id) : null,
  pai: p.combo_de ? db.prepare('SELECT id, token, status, servico FROM limpa_nome_pedidos WHERE id = ?').get(p.combo_de) : null,
});
rota('GET', '/limpa-nome/servico/:id', exigeLogin(detalhePedidoCliente));
rota('GET', '/rating/:id', exigeLogin(detalhePedidoCliente));
// ---------- Ficha cadastral do Rating ----------
// Chave de criptografia: CHAVE_DADOS no Render (recomendado) ou um arquivo de chave gerado no disco
let _chave = null;
function chaveDados() {
  if (_chave) return _chave;
  if (process.env.CHAVE_DADOS) return (_chave = scryptSync(process.env.CHAVE_DADOS, 'softconsultas-fichas', 32));
  const arq = path.join(pastaDocsLimpaNome, '.chave-fichas');
  if (!existsSync(arq)) writeFileSync(arq, randomBytes(32).toString('hex'), { mode: 0o600 });
  return (_chave = Buffer.from(readFileSync(arq, 'utf8').trim(), 'hex'));
}
function cifrar(t) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', chaveDados(), iv);
  const ct = Buffer.concat([c.update(String(t), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}
function decifrar(s2) {
  const [v, iv, tag, ct] = String(s2 || '').split(':');
  if (v !== 'v1') return null;
  const d = createDecipheriv('aes-256-gcm', chaveDados(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}
const fichaDe = (pid) => db.prepare('SELECT * FROM rating_fichas WHERE pedido_id = ?').get(pid);
const dadosFicha = (f) => { try { return JSON.parse(f?.dados || '{}') || {}; } catch { return {}; } };
// Pedido que recebe a ficha: o próprio Rating ou o Rating criado pelo combo
const alvoFicha = (p) => (p.servico === 'rating' ? p : p.servico === 'combo' ? db.prepare('SELECT * FROM limpa_nome_pedidos WHERE combo_de = ?').get(p.id) : null);
const fichaPendente = (p) => { const a = alvoFicha(p); return !!a && !!a.pago_em && !['concluido', 'cancelado', 'reembolsado'].includes(a.status) && !fichaDe(a.id); };
const linkFicha = (p) => (p.token ? `/ln/${p.token}/ficha` : `/rating/${alvoFicha(p)?.id || p.id}/ficha`);
const avisoFicha = (link, quem = 'você') => `<div class="cartao" style="max-width:620px;margin-bottom:18px;border:2px solid #C62828"><h2 style="font-size:1.15rem;margin:0 0 6px">📝 Falta a ficha cadastral do Rating</h2><p style="margin:0 0 12px">O trabalho no perfil bancário só começa depois que ${quem} preencher a ficha (dados pessoais, trabalho, referências, acesso ao Serasa e selfie com o documento).</p><a class="btn" href="${P.esc(link)}">Preencher a ficha cadastral</a></div>`;
const formatarReaisCampo = (t) => { const c = centavos(t); return Number.isFinite(c) && c > 0 ? P.reais(c) : null; };
async function salvarFicha({ req, alvo, quem }) {
  let form;
  try { form = await corpoMultipart(req, 16 * 1024 * 1024); } catch (e) { return { erro: e.message === 'arquivo grande demais' ? 'Arquivos grandes demais (até 6 MB cada).' : 'Não foi possível ler o formulário.', v: {} }; }
  const c = form.campos, antiga = fichaDe(alvo.id), antes = dadosFicha(antiga);
  const d = {};
  for (const [k, rot, tipo] of SV.listaCamposFicha()) {
    let val = String(c[k] ?? '').trim().replace(/\s+/g, tipo === 'textarea' ? ' ' : ' ').slice(0, tipo === 'textarea' ? 400 : 150);
    if (!val) return { erro: `Preencha: ${rot}.`, v: { ...antes, ...c } };
    if (Array.isArray(tipo) && !tipo.includes(val)) return { erro: `Escolha uma opção em: ${rot}.`, v: { ...antes, ...c } };
    if (tipo === 'uf' && !SV.UFS.includes(val)) return { erro: `Escolha o estado em: ${rot}.`, v: { ...antes, ...c } };
    if (tipo === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(val)) return { erro: `Data inválida em: ${rot}.`, v: { ...antes, ...c } };
    if (tipo === 'email' && !A.emailValido(val)) return { erro: 'E-mail inválido.', v: { ...antes, ...c } };
    if (tipo === 'tel' && A.soNumeros(val).length < 10) return { erro: `Telefone com DDD em: ${rot}.`, v: { ...antes, ...c } };
    if (tipo === 'cep') { val = A.soNumeros(val); if (val.length !== 8) return { erro: 'CEP inválido.', v: { ...antes, ...c } }; val = val.replace(/^(\d{5})(\d{3})$/, '$1-$2'); }
    if (tipo === 'money') { const r = formatarReaisCampo(val); if (!r) return { erro: `Valor inválido em: ${rot}. Ex.: 3.500,00`, v: { ...antes, ...c } }; val = r; }
    d[k] = val;
  }
  const senha = String(c.senha_serasa || '');
  if (!senha && !antiga?.senha_cript) return { erro: 'Informe a senha do Serasa.', v: { ...antes, ...d } };
  if (c.aceite !== '1') return { erro: 'Confirme a autorização para enviar a ficha.', v: { ...antes, ...d } };
  const arqs = {};
  for (const [campo, nomeArq, obrigatorio] of [['selfie', 'selfie', !antiga?.selfie], ['doc_ficha', 'docficha', !alvo.doc_frente && !(alvo.combo_de && db.prepare('SELECT doc_frente FROM limpa_nome_pedidos WHERE id = ?').get(alvo.combo_de)?.doc_frente) && !antiga?.doc_extra]]) {
    const a = form.arquivos[campo];
    if (!a) { if (obrigatorio) return { erro: campo === 'selfie' ? 'Envie a selfie segurando o documento.' : 'Envie a foto da CNH ou do RG.', v: { ...antes, ...d } }; continue; }
    if (a.dados.length > 6 * 1024 * 1024) return { erro: 'Cada arquivo pode ter até 6 MB.', v: { ...antes, ...d } };
    const t = tipoDoc(a.dados);
    if (!t || (campo === 'selfie' && t === 'pdf')) return { erro: campo === 'selfie' ? 'A selfie precisa ser uma foto (JPG, PNG ou WEBP).' : 'Envie o documento em JPG, PNG, WEBP ou PDF.', v: { ...antes, ...d } };
    const arq = `${alvo.id}-${nomeArq}-${randomBytes(8).toString('hex')}.${t}`;
    await writeFile(path.join(pastaDocsLimpaNome, arq), a.dados, { mode: 0o600 });
    arqs[campo] = arq;
  }
  if (antiga) {
    for (const [campo, col] of [['selfie', 'selfie'], ['doc_ficha', 'doc_extra']]) if (arqs[campo] && antiga[col]) await unlink(path.join(pastaDocsLimpaNome, path.basename(antiga[col]))).catch(() => {});
    db.prepare("UPDATE rating_fichas SET dados = ?, senha_cript = COALESCE(?, senha_cript), selfie = COALESCE(?, selfie), doc_extra = COALESCE(?, doc_extra), preenchido_por = ?, atualizado_em = datetime('now') WHERE pedido_id = ?")
      .run(JSON.stringify(d), senha ? cifrar(senha) : null, arqs.selfie || null, arqs.doc_ficha || null, quem, alvo.id);
  } else {
    db.prepare('INSERT INTO rating_fichas (pedido_id, dados, senha_cript, selfie, doc_extra, preenchido_por) VALUES (?, ?, ?, ?, ?, ?)')
      .run(alvo.id, JSON.stringify(d), cifrar(senha), arqs.selfie || null, arqs.doc_ficha || null, quem);
  }
  registrar(null, 'Rating: ficha cadastral enviada', `#${alvo.id} · ${alvo.nome} · por ${quem}`);
  return { ok: true };
}
const renderFicha = (res, usuario, { p, alvo, action, voltar, erro = '', v = null, status, externo = false }) => {
  const f = fichaDe(alvo.id), d = v || { ...dadosFicha(f), _selfie: !!f?.selfie };
  if (!v && !f) Object.assign(d, { nome: alvo.nome, email: alvo.email, celular: alvo.telefone });
  const precisaDoc = !alvo.doc_frente && !(alvo.combo_de && db.prepare('SELECT doc_frente FROM limpa_nome_pedidos WHERE id = ?').get(alvo.combo_de)?.doc_frente) && !f?.doc_extra;
  const corpo = SV.paginaFichaRating({ p: alvo, d, action, voltar, precisaDoc, temSenha: !!f?.senha_cript, erro });
  return externo ? paginaExterna(res, 'Ficha cadastral · Rating', corpo, status) : pagina(res, 'Ficha cadastral · Rating', corpo, usuario, status);
};
// Cliente da venda direta
const fichaCliente = (fn) => exigeLogin(async (ctx) => {
  const p = db.prepare("SELECT * FROM limpa_nome_pedidos WHERE id = ? AND usuario_id = ? AND parceiro_id IS NULL AND servico = 'rating'").get(Number(ctx.params.id), ctx.usuario.id);
  if (!p || !p.pago_em) return redirecionar(ctx.res, '/rating');
  return fn({ ...ctx, alvo: p, action: `/rating/${p.id}/ficha`, voltar: [`/rating/${p.id}`, '← Meu pedido'], depois: `/rating/${p.id}` });
});
rota('GET', '/rating/:id/ficha', fichaCliente(({ res, usuario, alvo, action, voltar }) => renderFicha(res, usuario, { p: alvo, alvo, action, voltar })));
rota('POST', '/rating/:id/ficha', fichaCliente(async ({ req, res, usuario, alvo, action, voltar, depois }) => {
  const r = await salvarFicha({ req, alvo, quem: `cliente (${usuario.email})` });
  if (r.erro) return renderFicha(res, usuario, { p: alvo, alvo, action, voltar, erro: r.erro, v: r.v, status: 400 });
  redirecionar(res, `${depois}?ficha=1`);
}));
// Link do cliente (parceiro) e área do parceiro
const fichaToken = (fn) => async (ctx) => {
  const p = pedidoToken(ctx.params.token), alvo = p && alvoFicha(p);
  if (!p || !alvo || !alvo.pago_em) return redirecionar(ctx.res, p ? `/ln/${p.token}` : '/');
  return fn({ ...ctx, p, alvo, action: `/ln/${p.token}/ficha`, voltar: [`/ln/${p.token}`, '← Meu pedido'], depois: `/ln/${p.token}` });
};
rota('GET', '/ln/:token/ficha', fichaToken(({ res, usuario, p, alvo, action, voltar }) => renderFicha(res, usuario, { p, alvo, action, voltar, externo: true })));
rota('POST', '/ln/:token/ficha', fichaToken(async ({ req, res, usuario, p, alvo, action, voltar, depois }) => {
  if (!A.limitar(`ficha:${alvo.id}`, 20, 60)) return renderFicha(res, usuario, { p, alvo, action, voltar, erro: 'Muitas tentativas. Aguarde alguns minutos.', status: 429, externo: true });
  const r = await salvarFicha({ req, alvo, quem: 'cliente (link)' });
  if (r.erro) return renderFicha(res, usuario, { p, alvo, action, voltar, erro: r.erro, v: r.v, status: 400, externo: true });
  redirecionar(res, `${depois}?ficha=1`);
}));
const fichaParceiro = (fn) => exigeParceiro(async (ctx) => {
  const p = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE id = ? AND parceiro_id = ?').get(Number(ctx.params.id), ctx.usuario.id), alvo = p && alvoFicha(p);
  if (!p || !alvo || !alvo.pago_em) return redirecionar(ctx.res, '/parceiro');
  return fn({ ...ctx, p, alvo, action: `/parceiro/cliente/${p.id}/ficha`, voltar: [`/parceiro/cliente/${p.id}`, '← Cliente'], depois: `/parceiro/cliente/${p.id}` });
});
rota('GET', '/parceiro/cliente/:id/ficha', fichaParceiro(({ res, usuario, p, alvo, action, voltar }) => renderFicha(res, usuario, { p, alvo, action, voltar })));
rota('POST', '/parceiro/cliente/:id/ficha', fichaParceiro(async ({ req, res, usuario, p, alvo, action, voltar, depois }) => {
  const r = await salvarFicha({ req, alvo, quem: `parceiro (${usuario.email})` });
  if (r.erro) return renderFicha(res, usuario, { p, alvo, action, voltar, erro: r.erro, v: r.v, status: 400 });
  redirecionar(res, `${depois}?ficha=1`);
}));
// Admin: ver ficha, revelar a senha (registrado), baixar em texto
rota('GET', '/admin/rating/ficha/:id', exigeAdmin(({ res, usuario, params }) => {
  const id = String(params.id);
  const txt = id.endsWith('.txt');
  const p = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE id = ?').get(Number(id.replace(/\.txt$/, ''))), f = p && fichaDe(p.id);
  if (!f) return redirecionar(res, `/admin/rating?erro=${encodeURIComponent('Ficha não encontrada.')}`);
  const d = { ...dadosFicha(f), _em: f.atualizado_em || f.criado_em, _por: f.preenchido_por };
  registrar(usuario, 'Rating: viu ficha cadastral', `#${p.id}`);
  if (txt) {
    const linhas = [`FICHA CADASTRAL RATING PF · pedido #${p.id}`, `CPF: ${p.cpf}`, ...SV.CAMPOS_FICHA.flatMap(([t, cs]) => ['', t.toUpperCase(), ...cs.map(([k, rot]) => `${rot}: ${d[k] ?? ''}`)]), '', 'Senha do Serasa: ver no painel (não vai no arquivo)'];
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="ficha-rating-${p.id}.txt"`, 'Cache-Control': 'no-store' });
    return res.end(linhas.join('\r\n'));
  }
  pagina(res, 'Admin · Ficha', SV.adminFichaRating({ menu: PD.menu('/admin/rating'), p, d, temSenha: !!f.senha_cript, selfie: !!f.selfie, docExtra: !!f.doc_extra }), usuario);
}));
rota('POST', '/admin/rating/ficha/:id/senha', exigeAdmin(async ({ req, res, usuario, params }) => {
  await corpoForm(req);
  const p = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE id = ?').get(Number(params.id)), f = p && fichaDe(p.id);
  if (!f) return redirecionar(res, '/admin/rating');
  let senha = null;
  try { senha = f.senha_cript ? decifrar(f.senha_cript) : null; } catch { senha = '(não foi possível abrir: a chave de criptografia mudou)'; }
  registrar(usuario, 'Rating: viu a senha do Serasa', `#${p.id} · ${p.nome}`);
  pagina(res, 'Admin · Ficha', SV.adminFichaRating({ menu: PD.menu('/admin/rating'), p, d: { ...dadosFicha(f), _em: f.atualizado_em || f.criado_em, _por: f.preenchido_por }, temSenha: !!f.senha_cript, senha: senha ?? '', selfie: !!f.selfie, docExtra: !!f.doc_extra }), usuario);
}));

// Visitante clica em "Contratar": faz login/cadastro e volta para o formulário
rota('GET', '/rating/contratar', exigeLogin(({ res }) => redirecionar(res, '/rating#pedido')));
rota('GET', '/admin/rating', exigeAdmin(({ res, usuario, url }) => {
  const pedidos = db.prepare(`SELECT p.*, u.email AS cliente, pu.nome AS parceiro_nome, (SELECT COUNT(*) FROM rating_fichas rf WHERE rf.pedido_id = p.id) AS tem_ficha FROM limpa_nome_pedidos p JOIN usuarios u ON u.id = p.usuario_id LEFT JOIN usuarios pu ON pu.id = p.parceiro_id
    WHERE p.servico = 'rating' ORDER BY CASE WHEN p.status IN ('pago','em_analise','em_andamento','decisao') THEN 0 ELSE 1 END, p.id DESC LIMIT 500`).all();
  const n = (w) => db.prepare(`SELECT COUNT(*) n FROM limpa_nome_pedidos WHERE servico = 'rating' AND ${w}`).get().n;
  const k = { andamento: n("status IN ('em_analise','em_andamento','decisao')"), aguardandoInicio: n("status = 'pago'"), concluidos: n("status = 'concluido'"),
    receita: db.prepare("SELECT COALESCE(SUM(valor_centavos),0) s FROM limpa_nome_pedidos WHERE servico = 'rating' AND pago_em IS NOT NULL AND status <> 'reembolsado'").get().s,
    combos: db.prepare("SELECT COUNT(*) n, COALESCE(SUM(valor_centavos),0) s FROM limpa_nome_pedidos WHERE servico = 'combo' AND pago_em IS NOT NULL AND status <> 'reembolsado'").get() };
  pagina(res, 'Admin · Rating Bancário', SV.adminRating({ menu: PD.menu('/admin/rating'), cfg: cfgServico('rating'), combo: cfgServico('combo'), ln: lnCfg(), pedidos, k,
    ok: url.searchParams.get('ok') || '', erro: url.searchParams.get('erro') || '' }), usuario);
}));
rota('POST', '/admin/rating/config', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const volta = (m, ok) => redirecionar(res, `/admin/rating?${ok ? 'ok' : 'erro'}=${encodeURIComponent(m)}`);
  const preco = centavos(f.preco), combo = String(f.combo || '').trim() ? centavos(f.combo) : 0;
  if (!Number.isFinite(preco) || preco < 0 || preco > 1000000) return volta('Preço inválido.');
  if (f.ativo === '1' && preco < 500) return volta('Para ligar o serviço, defina um preço de pelo menos R$ 5,00.');
  if (!Number.isFinite(combo) || combo < 0 || combo > 2000000) return volta('Preço do combo inválido.');
  const novos = { rtg_ativo: f.ativo === '1' ? '1' : '0', rtg_preco_centavos: String(preco), rtg_prazo: String(f.prazo || '').trim().slice(0, 150), rtg_resumo: String(f.resumo || '').trim().slice(0, 300), cmb_preco_centavos: String(combo) };
  const mudou = Object.entries(novos).filter(([k2, v2]) => (lerConfig(k2) || '') !== v2).map(([k2, v2]) => `${k2}: ${v2 || '(vazio)'}`);
  for (const [k2, v2] of Object.entries(novos)) gravarConfig(k2, v2);
  registrar(usuario, 'Rating Bancário: configuração', mudou.join(' · ') || 'sem mudanças');
  volta('Configuração salva.', true);
}));
rota('GET', '/rating', ({ res, usuario }) => {
  const cfg = cfgServicoComTabela('rating');
  const pedidos = usuario ? pedidosDoCliente(usuario.id, 'rating') : [];
  if (!cfg.ativo && !usuario?.admin && !pedidos.length) return pagina(res, 'Rating Bancário', P.paginaEmBreve('Rating Bancário', 'Em breve: o serviço que melhora o seu perfil junto aos bancos.'), usuario);
  pagina(res, 'Rating Bancário', (!cfg.ativo ? '<div class="aviso">Serviço desligado para novos pedidos (você vê esta página por ser admin).</div>' : '') +
    SV.paginaServicoRating({ cfg, combo: cfgServico('combo'), pedidos, usuario }), usuario);
});

rota('GET', '/api/limpa-nome/:id/status', async ({ res, usuario, params }) => {
  if (!usuario) return json(res, { pago: false }, 401);
  const p = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE id = ? AND usuario_id = ?').get(Number(params.id), usuario.id);
  if (!p) return json(res, { pago: false }, 404);
  if (p.status !== 'aguardando_pagamento') return json(res, { pago: true, valor: p.valor_centavos / 100, eid: `ln-${p.id}` });
  if (p.asaas_id && A.limitar(`stln:${p.id}`, 30, 5)) {
    try {
      const c = await AS.buscarCobranca(p.asaas_id);
      if (AS.STATUS_PAGO.includes(c.status) && (p.asaas_parcelamento || Math.round(Number(c.value) * 100) >= p.valor_centavos)) { confirmarPedidoLN(p.id); return json(res, { pago: true, valor: p.valor_centavos / 100, eid: `ln-${p.id}` }); }
    } catch (e) { console.warn('status limpa nome:', e.message); }
  }
  json(res, { pago: false });
});

// ---------- Admin ----------
rota('GET', '/admin/limpa-nome', exigeAdmin(({ res, usuario, url }) => {
  const cfg = lnCfg(), lote = proximoLoteLN(cfg.dia);
  const f = ['lote', 'ativos', 'aguardando', 'todos'].includes(url.searchParams.get('f')) ? url.searchParams.get('f') : 'lote';
  const onde = `p.servico <> 'rating' AND ` + { lote: "p.status IN ('pago','em_analise')", ativos: "p.status IN ('pago','em_analise','em_lote','em_andamento','decisao')", aguardando: "p.status = 'aguardando_pagamento'", todos: '1=1' }[f];
  const pedidos = db.prepare(`SELECT p.*, u.email AS cliente, pu.nome AS parceiro_nome FROM limpa_nome_pedidos p JOIN usuarios u ON u.id = p.usuario_id LEFT JOIN usuarios pu ON pu.id = p.parceiro_id WHERE ${onde} ORDER BY p.id DESC LIMIT 500`).all();
  const lotes = {
    proximo: db.prepare(`SELECT COUNT(*) n FROM limpa_nome_pedidos WHERE ${SQL_LOTE} AND status IN ('pago','em_analise')`).get().n,
    pagos: db.prepare(`SELECT COUNT(*) n FROM limpa_nome_pedidos WHERE ${SQL_LOTE} AND pago_em IS NOT NULL AND status <> 'reembolsado'`).get().n,
    receita: db.prepare(`SELECT COALESCE(SUM(valor_centavos),0) s FROM limpa_nome_pedidos WHERE ${SQL_LOTE} AND pago_em IS NOT NULL AND status <> 'reembolsado'`).get().s,
    aguardando: db.prepare(`SELECT COUNT(*) n FROM limpa_nome_pedidos WHERE ${SQL_LOTE} AND status = 'aguardando_pagamento'`).get().n,
    ajuda: db.prepare("SELECT COUNT(*) n FROM registro_admin WHERE acao = 'Limpa Nome: cliente chamou o atendimento' AND criado_em > datetime('now', '-30 days')").get().n,
  };
  pagina(res, 'Admin · Limpa Nome', SV.adminServicoLN({ menu: PD.menu('/admin/limpa-nome'), cfg: lnCfgComTabela(), pedidos, lotes, filtro: f, proximoLote: lote,
    ok: url.searchParams.get('ok') || '', erro: url.searchParams.get('erro') || '' }), usuario);
}));

rota('POST', '/admin/limpa-nome/config', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const volta = (m, ok) => redirecionar(res, `/admin/limpa-nome?${ok ? 'ok' : 'erro'}=${encodeURIComponent(m)}`);
  const preco = centavos(f.preco);
  const ativo = f.ativo === '1';
  if (!Number.isFinite(preco) || preco < 0 || preco > 1000000) return volta('Preço inválido.');
  if (ativo && preco < 500) return volta('Para ligar o serviço, defina um preço de pelo menos R$ 5,00.');
  const video = String(f.video || '').trim().slice(0, 300);
  if (video && !SV.blocoVideo(video)) return volta('Link de vídeo não reconhecido. Use um link do YouTube, do Vimeo ou /criativos/nome.mp4.');
  const novos = { lns_ativo: ativo ? '1' : '0', lns_preco_centavos: String(preco), lns_dia_lote: String(Math.min(6, Math.max(0, Number(f.dia) || 0))),
    lns_prazo: String(f.prazo || '').trim().slice(0, 150), lns_executor: String(f.executor || '').trim().slice(0, 150),
    lns_garantia: String(f.garantia || '').trim().slice(0, 300),
    lns_blindagem_meses: String(Math.min(24, Math.max(0, Math.floor(Number(f.blindagem) || 0)))),
    lns_whatsapp: A.soNumeros(f.whatsapp).slice(0, 15), lns_atendimento: String(f.atendimento || '').trim().slice(0, 100), lns_parcelas: String(Math.min(12, Math.max(1, Math.floor(Number(f.parcelas) || 1)))),
    lns_juros_mensal: String(Math.min(15, Math.max(0, Number(String(f.juros ?? '').replace(',', '.')) || 0))), lns_antecipar: f.antecipar === '1' ? '1' : '0', lns_resumo: String(f.resumo || '').trim().slice(0, 300), lns_video: video };
  const mudou = Object.entries(novos).filter(([k, val]) => (lerConfig(k) || '') !== val).map(([k, val]) => `${k.slice(4)}: ${val || '(vazio)'}`);
  for (const [k, val] of Object.entries(novos)) gravarConfig(k, val);
  registrar(usuario, 'Limpa Nome: configuração', mudou.join(' · ') || 'sem mudanças');
  volta('Configuração salva.', true);
}));

rota('POST', '/admin/limpa-nome/status', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const base = String(f.volta || '') === '/admin/rating' ? '/admin/rating?' : '/admin/limpa-nome?f=todos&';
  const volta = (m, ok) => redirecionar(res, `${base}${ok ? 'ok' : 'erro'}=${encodeURIComponent(m)}`);
  const p = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE id = ?').get(Number(f.id));
  if (!p) return volta('Pedido não encontrado.');
  if (!SV.STATUS_LN[f.status] || (p.servico === 'rating' && f.status === 'em_lote')) return volta('Status inválido.');
  if (p.servico === 'rating' && ['em_analise', 'em_andamento', 'decisao', 'concluido'].includes(f.status) && !fichaDe(p.id)) return volta(`Pedido #${p.id}: a ficha cadastral ainda não foi preenchida. O cliente recebeu o link; você pode reenviar pelo WhatsApp.`);
  if (f.status !== 'aguardando_pagamento' && f.status !== 'cancelado' && !p.pago_em) return volta('Este pedido ainda não foi pago. Use "Conferir" ou aguarde a confirmação do Pix.');
  const obs = String(f.obs || '').trim().slice(0, 300);
  const lote = p.lote || (f.status === 'pago' && p.servico !== 'rating' ? proximoLoteLN() : null);
  db.prepare("UPDATE limpa_nome_pedidos SET status = ?, obs_admin = ?, lote = ?, atualizado_em = datetime('now') WHERE id = ?").run(f.status, obs || null, lote, p.id);
  // Rating encerrado: a senha do Serasa é apagada na hora (os demais dados seguem a regra de 90 dias)
  if (p.servico === 'rating' && ['concluido', 'cancelado', 'reembolsado'].includes(f.status)) db.prepare('UPDATE rating_fichas SET senha_cript = NULL WHERE pedido_id = ?').run(p.id);
  // Combo: Limpa Nome concluído libera o Rating Bancário
  if (p.servico === 'combo' && f.status === 'concluido' && p.status !== 'concluido') {
    const filho = db.prepare("SELECT * FROM limpa_nome_pedidos WHERE combo_de = ? AND status = 'pago'").get(p.id);
    if (filho && !fichaDe(filho.id)) emailPedidoLN(filho, 'Seu Rating Bancário vai começar: falta a ficha', `O seu Limpa Nome foi concluído e agora é a vez do <strong>Rating Bancário</strong>. Para começarmos, preencha a ficha cadastral: <a href="${baseEmails()}${linkFicha(p.token ? p : filho)}">preencher agora</a>.`);
    else if (filho) {
      db.prepare("UPDATE limpa_nome_pedidos SET status = 'em_analise', obs_admin = NULL, atualizado_em = datetime('now') WHERE id = ?").run(filho.id);
      avisarStatusLN({ ...filho, status: 'em_analise', obs_admin: null });
      registrar(usuario, 'Combo: Rating iniciado', `#${filho.id} (combo #${p.id})`);
    }
  }
  // Concluído: começa a blindagem (N meses a partir de hoje)
  let blindagemAte = p.blindagem_ate;
  if (f.status === 'concluido' && p.status !== 'concluido' && p.servico !== 'rating') {
    const meses = lnCfg().blindagem;
    blindagemAte = meses ? db.prepare("SELECT date('now', '-3 hours', ?) d").get(`+${meses} months`).d : null;
    db.prepare("UPDATE limpa_nome_pedidos SET concluido_em = datetime('now'), blindagem_ate = ? WHERE id = ?").run(blindagemAte, p.id);
  }
  registrar(usuario, 'Limpa Nome: status', `#${p.id} · ${p.nome} · ${p.status} → ${f.status}${obs ? ` · "${obs}"` : ''}`);
  // Reembolso/cancelamento de pedido pago de parceiro: estorna a comissão (fica registrado no extrato dele)
  if (['reembolsado', 'cancelado'].includes(f.status) && p.parceiro_id && db.prepare("SELECT 1 FROM comissoes WHERE tipo = 'comissao' AND referencia = ?").get(`ln_${p.id}`)) {
    const c = db.prepare("SELECT valor_centavos FROM comissoes WHERE tipo = 'comissao' AND referencia = ?").get(`ln_${p.id}`).valor_centavos;
    if (db.prepare("INSERT OR IGNORE INTO comissoes (usuario_id, tipo, valor_centavos, descricao, referencia) VALUES (?, 'comissao', ?, ?, ?)").run(p.parceiro_id, -c, `Estorno: Limpa Nome #${p.id} ${f.status}`, `ln_estorno_${p.id}`).changes)
      registrar(usuario, 'Parceiro: comissão estornada', `#${p.id} · ${P.reais(c)}`);
  }
  if (f.status !== p.status || (obs && obs !== (p.obs_admin || ''))) avisarStatusLN({ ...p, status: f.status, obs_admin: obs, lote, blindagem_ate: blindagemAte });
  volta(`Pedido #${p.id} atualizado.`, true);
}));

// Baixa por órgão: marca/desmarca e avisa o cliente das novas
rota('POST', '/admin/limpa-nome/baixas', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const p = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE id = ?').get(Number(f.id));
  if (!p) return redirecionar(res, '/admin/limpa-nome?f=todos&erro=' + encodeURIComponent('Pedido não encontrado.'));
  const antes = SV.lerBaixas(p), hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const novas = {}, adicionadas = [];
  for (const [k, n] of SV.ORGAOS_LN) {
    if (f[`b_${k}`] === '1') { novas[k] = antes[k] || hoje; if (!antes[k]) adicionadas.push(n); }
  }
  db.prepare("UPDATE limpa_nome_pedidos SET baixas = ?, atualizado_em = datetime('now') WHERE id = ?").run(JSON.stringify(novas), p.id);
  registrar(usuario, 'Limpa Nome: baixas', `#${p.id} · ${p.nome} · ${Object.keys(novas).join(', ') || 'nenhuma'}`);
  if (adicionadas.length) enviarPush(p.usuario_id, { titulo: `Baixa confirmada: ${adicionadas.join(', ')}`, corpo: 'Mais um órgão tirou as negativações do seu nome. Toque para ver.', link: `/limpa-nome/servico/${p.id}` }).catch(() => {});
  if (adicionadas.length) emailPedidoLN(p, `Baixa confirmada: ${adicionadas.join(', ')}`, `Boa notícia: ${adicionadas.length > 1 ? 'os órgãos' : 'o órgão'} <strong>${P.esc(adicionadas.join(', '))}</strong> já ${adicionadas.length > 1 ? 'deram' : 'deu'} baixa nas negativações do seu ${String(p.cpf).length === 14 ? 'CNPJ' : 'CPF'}. Acompanhe os demais na página do pedido.`);
  const todas = SV.ORGAOS_LN.every(([k]) => novas[k]);
  redirecionar(res, `/admin/limpa-nome?f=ativos&ok=${encodeURIComponent(`Baixas do pedido #${p.id} salvas.${todas && p.status !== 'concluido' ? ' Todos os órgãos deram baixa: mude o status para "Concluído" para iniciar a blindagem.' : ''}`)}`);
}));

rota('POST', '/admin/limpa-nome/fechar-lote', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const lista = db.prepare(`SELECT * FROM limpa_nome_pedidos WHERE ${SQL_LOTE} AND status IN ('pago','em_analise')`).all();
  for (const p of lista) {
    if (db.prepare("UPDATE limpa_nome_pedidos SET status = 'em_lote', lote = COALESCE(?, lote), atualizado_em = datetime('now') WHERE id = ? AND status IN ('pago','em_analise')").run(/^\d{4}-\d{2}-\d{2}$/.test(f.lote || '') ? f.lote : null, p.id).changes === 1)
      avisarStatusLN({ ...p, status: 'em_lote', lote: f.lote || p.lote, obs_admin: null });
  }
  registrar(usuario, 'Limpa Nome: lote enviado', `lote ${f.lote} · ${lista.length} pedido(s): ${lista.map((p) => `#${p.id}`).join(', ')}`);
  redirecionar(res, `/admin/limpa-nome?f=ativos&ok=${encodeURIComponent(`${lista.length} pedido(s) marcados como enviados no lote.`)}`);
}));

rota('GET', '/admin/limpa-nome/lote.csv', exigeAdmin(({ res, usuario }) => {
  const lista = db.prepare(`SELECT * FROM limpa_nome_pedidos WHERE ${SQL_LOTE} AND status IN ('pago','em_analise','em_lote','em_andamento','decisao') ORDER BY lote, id`).all();
  const c = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const linhas = [['pedido', 'lote', 'status', 'nome', 'cpf', 'nascimento', 'telefone', 'email', 'documento', 'titular_proprio', 'pagamento', 'pago_em'].join(';'),
    ...lista.map((p) => [p.id, p.lote, p.status, p.nome, p.cpf, p.nascimento, p.telefone, p.email, p.doc_tipo, p.titular_proprio ? 'sim' : 'não (autorizado)', p.forma_pagamento === 'cartao' ? `cartão ${p.parcelas}x` : 'pix', p.pago_em].map(c).join(';'))];
  registrar(usuario, 'Limpa Nome: baixou planilha', `${lista.length} pedido(s)`);
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="limpa-nome-${proximoLoteLN()}.csv"`, 'Cache-Control': 'no-store' });
  res.end('﻿' + linhas.join('\r\n'));
}));

rota('GET', '/admin/limpa-nome/doc/:id/:lado', exigeAdmin(async ({ res, usuario, params }) => {
  const p = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE id = ?').get(Number(params.id));
  const fic = p && ['selfie', 'ficha'].includes(params.lado) ? fichaDe(p.id) : null;
  const arq = p && (params.lado === 'frente' ? p.doc_frente : params.lado === 'verso' ? p.doc_verso : params.lado === 'selfie' ? fic?.selfie : params.lado === 'ficha' ? fic?.doc_extra : null);
  if (!arq || p.docs_apagados) { res.writeHead(404); return res.end('Documento não encontrado'); }
  try {
    const dados = await readFile(path.join(pastaDocsLimpaNome, path.basename(arq)));
    registrar(usuario, 'Limpa Nome: viu documento', `#${p.id} · ${params.lado}`);
    res.writeHead(200, { 'Content-Type': MIME_DOC[arq.split('.').pop()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; plugin-types application/pdf", 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
    res.end(dados);
  } catch { res.writeHead(404); res.end('Documento não encontrado'); }
}));

// LGPD: apaga os documentos 90 dias depois de o pedido terminar
async function limparDocsLN() {
  const lista = db.prepare(`SELECT id, doc_frente, doc_verso FROM limpa_nome_pedidos WHERE docs_apagados = 0 AND status IN ('concluido','cancelado','reembolsado') AND atualizado_em < datetime('now', '-90 days')`).all();
  for (const p of lista) {
    for (const a of [p.doc_frente, p.doc_verso]) if (a) await unlink(path.join(pastaDocsLimpaNome, path.basename(a))).catch(() => {});
    db.prepare('UPDATE limpa_nome_pedidos SET docs_apagados = 1 WHERE id = ?').run(p.id);
    const f = fichaDe(p.id);
    if (f) {
      for (const a of [f.selfie, f.doc_extra]) if (a) await unlink(path.join(pastaDocsLimpaNome, path.basename(a))).catch(() => {});
      db.prepare("UPDATE rating_fichas SET senha_cript = NULL, selfie = NULL, doc_extra = NULL, apagado = 1, atualizado_em = datetime('now') WHERE pedido_id = ?").run(p.id);
    }
  }
  if (lista.length) registrar(null, 'Limpa Nome: documentos apagados (LGPD)', `${lista.length} pedido(s)`);
}
setTimeout(() => limparDocsLN().catch((e) => console.error('docs LN:', e.message)), 20000).unref();
setInterval(() => limparDocsLN().catch((e) => console.error('docs LN:', e.message)), 12 * 60 * 60 * 1000).unref();

// ======================= PAINEL FINANCEIRO (ADMIN) =======================
function periodoDe(url) {
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const d30 = new Date(Date.now() - 3 * 3600000 - 29 * 86400000).toISOString().slice(0, 10);
  let ini = url.searchParams.get('inicio'), fim = url.searchParams.get('fim');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ini || '')) ini = d30;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fim || '')) fim = hoje;
  if (ini > fim) [ini, fim] = [fim, ini];
  return { ini, fim };
}
rota('GET', '/admin/financeiro', exigeAdmin(async ({ res, usuario, url }) => {
  const { ini, fim } = periodoDe(url);
  // datas gravadas em UTC; o filtro usa o dia de Brasília
  const filtro = `date(c.criado_em, '-3 hours') BETWEEN ? AND ?`;
  const base = `FROM consultas c JOIN usuarios u ON u.id = c.usuario_id WHERE c.status = 'concluida' AND (u.admin = 0 AND u.interno = 0) AND ${filtro}`;
  const q = (sql) => db.prepare(sql).all(ini, fim);
  const g = (sql) => db.prepare(sql).get(ini, fim);
  const totais = g(`SELECT COUNT(*) n, COALESCE(SUM(c.preco_centavos),0) bruto, COALESCE(SUM(c.comissao_centavos),0) comissoes,
    COALESCE(SUM(c.custo_centavos),0) custo, COUNT(DISTINCT c.usuario_id) clientes ${base}`);
  const recargas = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(valor_centavos),0) total, COALESCE(SUM(bonus_centavos),0) bonus FROM recargas
    WHERE status = 'paga' AND date(pago_em, '-3 hours') BETWEEN ? AND ?`).get(ini, fim);
  const novos = db.prepare(`SELECT COUNT(*) n FROM usuarios WHERE date(criado_em, '-3 hours') BETWEEN ? AND ?`).get(ini, fim).n;
  const diario = q(`SELECT date(c.criado_em, '-3 hours') dia, SUM(c.preco_centavos - c.comissao_centavos) receita, SUM(c.custo_centavos) custo, COUNT(*) n ${base} GROUP BY dia ORDER BY dia`);
  const porProduto = q(`SELECT c.produto, COUNT(*) n, SUM(c.preco_centavos - c.comissao_centavos) receita, SUM(c.custo_centavos) custo ${base} GROUP BY c.produto ORDER BY (SUM(c.preco_centavos - c.comissao_centavos) - SUM(c.custo_centavos)) DESC`);
  const topGasto = q(`SELECT u.nome, u.email, COUNT(*) n, SUM(c.preco_centavos) gasto, SUM(c.preco_centavos - c.comissao_centavos - c.custo_centavos) lucro ${base} GROUP BY u.id ORDER BY gasto DESC LIMIT 10`);
  const topComissao = db.prepare(`SELECT u.nome, u.email, COUNT(*) n, SUM(k.valor_centavos) ganho FROM comissoes k JOIN usuarios u ON u.id = k.usuario_id
    WHERE k.tipo = 'comissao' AND date(k.criado_em, '-3 hours') BETWEEN ? AND ? GROUP BY u.id ORDER BY ganho DESC LIMIT 10`).all(ini, fim);
  const extrato = db.prepare(`
    SELECT * FROM (
      SELECT r.pago_em AS quando, 'Recarga' AS tipo, u.nome AS cliente, 'Pix' AS item, r.valor_centavos AS valor, NULL AS lucro FROM recargas r JOIN usuarios u ON u.id = r.usuario_id
        WHERE r.status = 'paga' AND date(r.pago_em, '-3 hours') BETWEEN ? AND ?
      UNION ALL
      SELECT c.criado_em, CASE WHEN (u.admin = 1 OR u.interno = 1) THEN 'Consulta interna' ELSE 'Consulta' END, u.nome, c.produto, c.preco_centavos,
        CASE WHEN (u.admin = 1 OR u.interno = 1) THEN NULL ELSE c.preco_centavos - c.comissao_centavos - c.custo_centavos END
        FROM consultas c JOIN usuarios u ON u.id = c.usuario_id WHERE c.status = 'concluida' AND date(c.criado_em, '-3 hours') BETWEEN ? AND ?
      UNION ALL
      SELECT k.criado_em, 'Comissão', u.nome, k.descricao, k.valor_centavos, NULL FROM comissoes k JOIN usuarios u ON u.id = k.usuario_id
        WHERE k.tipo = 'comissao' AND date(k.criado_em, '-3 hours') BETWEEN ? AND ?
      UNION ALL
      SELECT s.resolvido_em, 'Saque pago', u.nome, s.chave_pix, -(s.valor_centavos - s.taxa_centavos), NULL FROM saques s JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.status = 'pago' AND date(s.resolvido_em, '-3 hours') BETWEEN ? AND ?
    ) ORDER BY quando DESC LIMIT 300`).all(ini, fim, ini, fim, ini, fim, ini, fim);
  pagina(res, 'Admin · Financeiro', PD.adminFinanceiro({
    ini, fim, totais, recargas, novos, diario, porProduto, topGasto, topComissao, extrato,
    saldoApiFull: await saldoApiFull(), clientesTotal: db.prepare('SELECT COUNT(*) n FROM usuarios WHERE admin = 0 AND interno = 0').get().n,
    saldoCarteiras: db.prepare('SELECT COALESCE(SUM(valor_centavos),0) s FROM transacoes').get().s,
  }), usuario);
}));

// ======================= BACKUPS =======================
// Backup diário automático
setInterval(() => { try { fazerBackup('diario'); } catch (e) { console.error('backup diário:', e.message); } }, 24 * 60 * 60 * 1000).unref();

rota('GET', '/admin/backups', exigeAdmin(({ res, usuario, url }) => pagina(res, 'Admin · Backups', PD.adminBackups({
  backups: listarBackups(), ok: url.searchParams.get('ok') ? 'Backup criado.' : '', persistente: armazenamento.persistente,
}), usuario)));

rota('POST', '/admin/backups/criar', exigeAdmin(async ({ req, res, usuario }) => {
  await corpoForm(req);
  registrar(usuario, 'Fez backup manual', fazerBackup('manual') || '');
  redirecionar(res, '/admin/backups?ok=1');
}));

rota('GET', '/admin/backups/baixar', exigeAdmin(async ({ res, url, usuario }) => {
  const nome = String(url.searchParams.get('arquivo') || '');
  if (!/^backup-[\w-]+\.db$/.test(nome)) return redirecionar(res, '/admin/backups');
  try {
    const dados = await readFile(path.join(pastaBackups, nome));
    registrar(usuario, 'Baixou backup', nome);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${nome}"`, 'Cache-Control': 'no-store' });
    res.end(dados);
  } catch { redirecionar(res, '/admin/backups'); }
}));

// ======================= TERMOS E PRIVACIDADE =======================
rota('GET', '/termos', ({ res, usuario }) => pagina(res, 'Termos de uso', P.paginaTexto('Termos de uso', TERMOS), usuario));
rota('GET', '/privacidade', ({ res, usuario }) => pagina(res, 'Privacidade', P.paginaTexto('Política de privacidade', PRIVACIDADE), usuario));


rota('GET', '/saude', ({ res }) => json(res, { ok: true, discoPermanente: armazenamento.persistente }));

// ---------- servidor ----------
// ---------- Aplicativo (Android/iOS) ----------
// O app (Capacitor) abre o site com "SoftConsultasApp" no User-Agent; nesse modo o layout é de aplicativo e
// só ficam as áreas do próprio cliente (Meu CPF, Limpa Nome, Rating, conta), sem consultas de terceiros nem recargas.
const ctxReq = new AsyncLocalStorage();
const ehApp = (req) => /SoftConsultasApp/i.test(String(req.headers['user-agent'] || '')) || /(?:^|;\s*)sc_app=1/.test(String(req.headers.cookie || ''));
P.configurarModoApp(() => !!ctxReq.getStore()?.app);
const ROTAS_APP = /^\/(app|entrar|cadastro|sair|esqueci-senha|redefinir-senha|conta|monitoramento|limpa-nome\/(servico|ajuda)|rating|ln|consulta\/\d+|api|webhook|termos|privacidade|icone|app\.js|criativos)(\/|\.|$|\?)/;
const servidor = http.createServer((req, res) => ctxReq.run({ app: ehApp(req) }, () => atenderRequisicao(req, res)));
async function atenderRequisicao(req, res) {
  try {
    const url = new URL(req.url, 'http://local');
    // Subdomínio/domínio do Raio-X (ex.: raiox.softconsultas.com, softcredito.com.br): leva para a página do Raio-X
    const hostRx = String(req.headers.host || '').toLowerCase().split(':')[0];
    if ((process.env.HOSTS_RAIOX || 'raiox.softconsultas.com').split(',').map((h) => h.trim()).filter(Boolean).includes(hostRx)) {
      res.writeHead(301, { Location: `${process.env.URL_BASE || 'https://softconsultas.com'}/raio-x${url.search}` });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/rastreio.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
      return res.end(scriptRastreio());
    }
    // Imagens públicas de anúncios (pasta "criativos" do repositório): usadas pela Meta/Google para buscar os criativos
    const criativo = req.method === 'GET' && /^\/criativos\/([a-z0-9-]{1,80})\.(png|jpe?g|mp4)$/.exec(url.pathname);
    if (criativo) {
      try {
        const dados = await readFile(path.join(raiz, 'criativos', `${criativo[1]}.${criativo[2]}`));
        const tipo = { png: 'image/png', mp4: 'video/mp4' }[criativo[2]] || 'image/jpeg';
        // Vídeos: suporte a "Range" (o iPhone exige para tocar)
        const faixa = criativo[2] === 'mp4' && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
        if (faixa) {
          let ini = faixa[1] === '' ? Math.max(0, dados.length - Number(faixa[2])) : Number(faixa[1]);
          let fim = faixa[1] !== '' && faixa[2] !== '' ? Math.min(Number(faixa[2]), dados.length - 1) : dados.length - 1;
          if (ini > fim || ini >= dados.length) { res.writeHead(416, { 'Content-Range': `bytes */${dados.length}` }); return res.end(); }
          res.writeHead(206, { 'Content-Type': tipo, 'Content-Range': `bytes ${ini}-${fim}/${dados.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': fim - ini + 1, 'Cache-Control': 'public, max-age=86400' });
          return res.end(dados.subarray(ini, fim + 1));
        }
        res.writeHead(200, { 'Content-Type': tipo, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' });
        return res.end(dados);
      } catch { res.writeHead(404); return res.end(); }
    }
    if (req.method === 'GET' && ARQUIVOS[url.pathname]) {
      const dados = await readFile(path.join(raiz, url.pathname.slice(1)));
      res.writeHead(200, { 'Content-Type': ARQUIVOS[url.pathname], 'Cache-Control': 'public, max-age=86400' });
      return res.end(dados);
    }
    // Dentro do app: o que não faz parte dele volta para o início do app
    if (ctxReq.getStore()?.app && req.method === 'GET' && !ROTAS_APP.test(url.pathname + (url.pathname.endsWith('/') ? '' : '/'))) return redirecionar(res, '/app');
    const achou = acharRota(req.method, url.pathname);
    if (!achou) return pagina(res, 'Página não encontrada', P.paginaEmBreve('Página não encontrada', 'O endereço que você abriu não existe.'), null, 404);
    const { fn, params } = achou;
    if (req.method === 'POST' && !url.pathname.startsWith('/webhook/') && !origemValida(req)) return pagina(res, 'Erro', P.paginaEmBreve('Envio bloqueado', 'Recarregue a página e tente de novo.'), null, 403);
    // Origem da visita (campanhas): guarda por 30 dias até o cadastro
    const utm = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].reduce((o, k) => { const v = url.searchParams.get(k); if (v) o[k] = v.slice(0, 80); return o; }, {});
    const origemParam = url.searchParams.get('origem');
    if (req.method === 'GET' && (Object.keys(utm).length || (origemParam && PUBLICOS[origemParam]) || url.pathname.startsWith('/para/'))) {
      const existente = cookies(req).sc_origem;
      if (Object.keys(utm).length || !existente) {
        const dados = { ...utm, origem: (origemParam && PUBLICOS[origemParam]) ? origemParam : (url.pathname.startsWith('/para/') ? url.pathname.slice(6) : ''), pagina: url.pathname.slice(0, 80) };
        res.appendHeader?.('Set-Cookie', `sc_origem=${encodeURIComponent(JSON.stringify(dados))}; Path=/; Max-Age=${30 * 86400}; HttpOnly; SameSite=Lax${ehHttps(req) ? '; Secure' : ''}`);
      }
    }
    // Link de indicação: guarda o código por 30 dias até o cadastro
    const refParam = url.searchParams.get('ref');
    if (req.method === 'GET' && refParam && /^[A-Z2-9]{6,10}$/i.test(refParam)) {
      res.appendHeader('Set-Cookie', `sc_ref=${refParam.toUpperCase()}; Path=/; Max-Age=${30 * 86400}; HttpOnly; SameSite=Lax${ehHttps(req) ? '; Secure' : ''}`);
    }
    const token = cookies(req)[A.COOKIE];
    const usuario = A.usuarioDaSessao(token);
    // E-mails do ADMIN_EMAIL viram administradores; os de CONTAS_INTERNAS viram contas internas (aceitam vários, separados por vírgula)
    if (usuario) {
      const lista = (v) => String(v || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (!usuario.admin && lista(process.env.ADMIN_EMAIL).includes(usuario.email)) {
        db.prepare('UPDATE usuarios SET admin = 1 WHERE id = ?').run(usuario.id); usuario.admin = 1;
      }
      if (!usuario.interno && lista(process.env.CONTAS_INTERNAS).includes(usuario.email)) {
        db.prepare('UPDATE usuarios SET interno = 1 WHERE id = ?').run(usuario.id); usuario.interno = 1;
      }
      usuario.interno = usuario.admin || usuario.interno ? 1 : 0;
    }
    if (usuario && req.method === 'POST' && !url.pathname.startsWith('/api/')) guardarRastreio(req, `u-${usuario.id}`);
    await fn({ req, res, url, token, usuario, params });
  } catch (e) {
    console.error('erro:', e);
    if (!res.headersSent) pagina(res, 'Erro', P.paginaEmBreve('Algo deu errado', 'Tente de novo em instantes.'), null, 500);
  }
}

const porta = process.env.PORT || 3000;
servidor.listen(porta, () => {
  console.log(`Soft Consultas no ar na porta ${porta}`);
  console.log(`Banco de dados em: ${armazenamento.pasta} | DATA_DIR definido: ${armazenamento.definido ? 'sim' : 'NÃO'} | disco montado: ${armazenamento.montado ? 'sim' : 'NÃO'}`);
  if (!armazenamento.persistente) console.error('ATENÇÃO: os dados NÃO estão em disco permanente e serão perdidos no próximo deploy. Configure o disco (/var/data) e DATA_DIR no Render.');
});
