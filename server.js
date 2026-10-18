// Soft Consultas: servidor principal (Node 22, sem dependências externas nesta etapa)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, saldoCentavos, saldoComissao, lerConfig, gravarConfig, precoDe, recalcularPrecos, pastaPdfs, armazenamento, fazerBackup, listarBackups, pastaBackups, registrar, pastaAnuncios, pastaDocsLimpaNome } from './db.js';
import { writeFile, access, unlink } from 'node:fs/promises';
import * as AS from './asaas.js';
import { consultarApiFull, analisar, achatar, obterPdf, saldoApiFull, limparCacheSaldo, gerarRecargaApiFull } from './apifull.js';
import { pdfGenerico } from './pdf.js';
import * as PA from './paginas-app.js';
import * as PD from './paginas-admin.js';
import * as SV from './paginas-servico.js';
import * as A from './auth.js';
import * as P from './paginas.js';
import { enviarEmail, emailRedefinicao, emailBoasVindas } from './email.js';
import { montarEmail, perfilDo, ETAPAS, PERFIS, CAMPANHAS, montarCampanha } from './emails-marketing.js';
import { createHmac, randomBytes } from 'node:crypto';
import { TERMOS, PRIVACIDADE } from './textos.js';
import { PUBLICOS, paginaLanding } from './landings.js';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVOS = { '/icone.png': 'image/png', '/icone-branco.png': 'image/png', '/app.js': 'text/javascript; charset=utf-8' };
// Script de rastreio gerado com os IDs do Render (sem código inline, compatível com a política de segurança)
function scriptRastreio() {
  return `(function(){
  var cfg = ${JSON.stringify(RASTREIO)};
  window.scEvento = function(nome, valor){
    try {
      if (cfg.meta && window.fbq) fbq('track', nome, valor ? { value: valor, currency: 'BRL' } : {});
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
const centavos = (v) => {
  const t = String(v ?? '').trim().replace(/[^\d,.-]/g, '');
  const n = /,\d{1,2}$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t);
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
  const ok = /^\/(consultas|recarregar|painel|indicacoes|historico|limpa-nome)[\w\/?=&%.-]*$/.test(destino) && destino.length < 300;
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
  redirecionar(res, placaConsulta ? `/consultas/categoria/veiculos?bemvindo=1&placa=${placaConsulta}` : docConsulta ? `/consultas?bemvindo=1&doc=${docConsulta}` : '/painel?bemvindo=1', { 'Set-Cookie': [A.cookieSessao(token, ehHttps(req)), 'sc_ref=; Path=/; Max-Age=0', 'sc_origem=; Path=/; Max-Age=0'] });
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
  const destinoOk = /^\/(consultas|recarregar|painel|indicacoes|historico|limpa-nome)[\w\/?=&%.-]*$/.test(voltar) ? voltar : '/painel';
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
const VALOR_MAXIMO = 500000; // R$ 5.000 por recarga

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
  if (!Number.isFinite(valor) || valor < minimo) return erro(`O valor mínimo de recarga é ${P.reais(minimo)}.`);
  if (valor > VALOR_MAXIMO) return erro(`O valor máximo por recarga é ${P.reais(VALOR_MAXIMO)}.`);
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
  pagina(res, 'Pagar recarga', PA.paginaPagarRecarga({ r }), usuario);
}));

rota('GET', '/api/recarga/:id/status', async ({ res, usuario, params }) => {
  if (!usuario) return json(res, { pago: false }, 401);
  const r = db.prepare('SELECT * FROM recargas WHERE id = ? AND usuario_id = ?').get(Number(params.id), usuario.id);
  if (!r) return json(res, { pago: false }, 404);
  if (r.status === 'paga') return json(res, { pago: true, valor: r.valor_centavos / 100 });
  if (r.asaas_id && A.limitar(`st:${r.id}`, 30, 5)) {
    try {
      const c = await AS.buscarCobranca(r.asaas_id);
      if (AS.STATUS_PAGO.includes(c.status)) { if (creditarRecarga(r.id)) processarRepasse().catch((e) => console.error('repasse:', e.message)); return json(res, { pago: true, valor: r.valor_centavos / 100 }); }
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
    }
    return;
  }
  if (!['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(event)) return;
  const ref = String(payment?.externalReference || '');
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
  const dias = diasHistorico();
  const lista = db.prepare(`SELECT id FROM consultas WHERE status = 'concluida' AND resultado IS NOT NULL AND criado_em < datetime('now', ?)`).all(`-${dias} days`);
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
  if (!PA.FINALIDADES.includes(f.finalidade)) return erro('Selecione a finalidade da consulta.');
  if (f.aceite !== '1') return erro('Confirme a declaração de finalidade para continuar.');
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
  ? ` AND NOT EXISTS (SELECT 1 FROM limpa_nome_pedidos lp WHERE lp.usuario_id = u.id AND lp.status IN ('pago','em_lote','em_andamento','concluido'))` : '');
const listaCampanha = (chave, publico, limite = 100000) => db.prepare(`SELECT u.* FROM usuarios u
  WHERE u.ativo = 1 AND u.admin = 0 AND u.interno = 0 AND u.aceita_emails = 1 AND (${PUBLICOS_CAMPANHA[publico].sql})${filtroCampanha(chave)}
    AND NOT EXISTS (SELECT 1 FROM emails_enviados e WHERE e.usuario_id = u.id AND e.etapa = ?)
  ORDER BY u.id LIMIT ?`).all(etapaCampanha(chave), limite);
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
    const produto = produtoCampanha(chave), bonus = bonusPrimeira(), etapa = etapaCampanha(chave), servico = servicoCampanha(chave);
    for (const u of listaCampanha(chave, publico)) {
      if (!podeMarketing()) { parou = true; break; }
      if (db.prepare('INSERT OR IGNORE INTO emails_enviados (usuario_id, etapa, status) VALUES (?, ?, ?)').run(u.id, etapa, 'enviando').changes !== 1) continue;
      try {
        const m = montarCampanha({ chave, nome: u.nome, produto, servico, bonus: publico === 'com_recarga' ? null : bonus, base: baseEmails(), sair: linkSair(u.id), podeResponder: !!process.env.EMAIL_RESPOSTA });
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
  const m = montarCampanha({ chave, nome: 'Maria Silva', produto: produtoCampanha(chave), servico: servicoCampanha(chave), bonus: bonusPrimeira(), base: baseEmails(), sair: '#', podeResponder: !!process.env.EMAIL_RESPOSTA });
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
      const m = montarCampanha({ chave, nome: usuario.nome, produto: produtoCampanha(chave), servico: servicoCampanha(chave), bonus: bonusPrimeira(), base: baseEmails(), sair: '#', podeResponder: !!process.env.EMAIL_RESPOSTA });
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
  minimo: Number(lerConfig('recarga_minima_centavos')), faixas: faixasBonus(), markup: lerConfig('markup_percentual'), dias: diasHistorico(), comissaoMax: lerConfig('comissao_maxima'), saqueMin: Number(lerConfig('saque_minimo_centavos')), taxaSaque: taxaSaque(), alerta: Number(lerConfig('alerta_saldo_apifull_centavos')), primeira: bonusPrimeira(), ok: url.searchParams.get('ok') ? 'Configurações salvas e preços recalculados.' : '',
}), usuario)));

rota('POST', '/admin/config', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const minimo = centavos(f.minimo), markup = Number(String(f.markup || '').replace(',', '.'));
  const erro = (m) => pagina(res, 'Admin · Configurações', PD.adminConfig({ minimo: Number(lerConfig('recarga_minima_centavos')), faixas: faixasBonus(), markup: lerConfig('markup_percentual'), dias: diasHistorico(), comissaoMax: lerConfig('comissao_maxima'), saqueMin: Number(lerConfig('saque_minimo_centavos')), taxaSaque: taxaSaque(), alerta: Number(lerConfig('alerta_saldo_apifull_centavos')), primeira: bonusPrimeira(), erro: m }), usuario, 400);
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
  if (!Number.isFinite(markup) || markup < 0 || markup > 1000) return erro('Margem inválida.');
  const faixas = [];
  for (const parte of String(f.faixas || '').split(';').map((x) => x.trim()).filter(Boolean)) {
    const [v, pct] = parte.split('=').map((x) => x.trim());
    const vc = centavos(v), pc = Number(String(pct).replace(',', '.'));
    if (!Number.isFinite(vc) || !Number.isFinite(pc) || pc <= 0 || pc > 50) return erro(`Faixa de bônus inválida: "${parte}". Use o formato 100=5.`);
    faixas.push({ a_partir_de: vc, percentual: pc });
  }
  gravarConfig('recarga_minima_centavos', minimo);
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
  registrar(usuario, 'Alterou configurações', `margem ${markup}%, recarga mínima ${P.reais(minimo)}, bônus ${faixas.map((x) => `${P.reais(x.a_partir_de)}=${x.percentual}%`).join('; ') || 'nenhum'}, histórico ${dias} dias, comissão máx. ${comissaoMax}%, saque mín. ${P.reais(saqueMin)}, taxa de saque ${taxaS}%, alerta APIFull ${P.reais(alerta)}`);
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
const anunciosAtivos = () => db.prepare(`SELECT * FROM anuncios WHERE ativo = 1
  AND (inicio IS NULL OR inicio = '' OR inicio <= date('now', '-3 hours'))
  AND (fim IS NULL OR fim = '' OR fim >= date('now', '-3 hours')) ORDER BY id DESC LIMIT 8`).all();
function anunciosParaExibir() {
  const lista = anunciosAtivos();
  if (lista.length) db.prepare(`UPDATE anuncios SET impressoes = impressoes + 1 WHERE id IN (${lista.map(() => '?').join(',')})`).run(...lista.map((a) => a.id));
  return lista;
}
const contatoAnuncie = () => process.env.CONTATO_ANUNCIE || 'https://wa.me/5547997400955?text=Quero%20anunciar%20na%20Soft%20Consultas';

rota('GET', '/anuncio-img/:id', async ({ res, params }) => {
  const a = db.prepare('SELECT imagem FROM anuncios WHERE id = ?').get(Number(params.id));
  if (!a) { res.writeHead(404); return res.end(); }
  try {
    const dados = await readFile(path.join(pastaAnuncios, a.imagem));
    const ext = a.imagem.split('.').pop();
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
  anuncios: db.prepare('SELECT * FROM anuncios ORDER BY id DESC').all(),
  ok: url.searchParams.get('ok') ? 'Anúncio salvo.' : '', erro: url.searchParams.get('erro') || '',
}), usuario)));

rota('POST', '/admin/anuncios/criar', exigeAdmin(async ({ req, res, usuario }) => {
  const erro = (m) => redirecionar(res, `/admin/anuncios?erro=${encodeURIComponent(m)}`);
  let form;
  try { form = await corpoMultipart(req); } catch (e) { return erro(e.message === 'arquivo grande demais' ? 'Imagem grande demais (máximo 3 MB).' : 'Não foi possível ler o formulário.'); }
  const { campos, arquivos } = form;
  const anunciante = String(campos.anunciante || '').trim().slice(0, 120);
  const link = String(campos.link || '').trim().slice(0, 500);
  const img = arquivos.imagem;
  if (!anunciante) return erro('Informe o nome do anunciante.');
  if (link && !/^https?:\/\/[^\s]+$/i.test(link)) return erro('O link precisa começar com http:// ou https://');
  if (!img) return erro('Envie a imagem do banner.');
  const ext = tipoImagem(img.dados);
  if (!ext) return erro('A imagem precisa ser PNG, JPG ou WEBP.');
  const arquivo = `anuncio-${Date.now()}.${ext}`;
  await writeFile(path.join(pastaAnuncios, arquivo), img.dados);
  const dataOk = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : null);
  const valor = centavos(campos.valor || '0');
  db.prepare('INSERT INTO anuncios (anunciante, titulo, link, imagem, inicio, fim, valor_centavos) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(anunciante, String(campos.titulo || '').trim().slice(0, 160), link, arquivo, dataOk(campos.inicio), dataOk(campos.fim), Number.isFinite(valor) ? valor : 0);
  registrar(usuario, 'Criou anúncio', `${anunciante} · ${link || 'sem link'} · ${campos.inicio || 'já'} até ${campos.fim || 'sem fim'}`);
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

// ======================= SERVIÇO LIMPA NOME (lote semanal, Pix separado) =======================
const lnCfg = () => ({
  ativo: lerConfig('lns_ativo') === '1', preco: Number(lerConfig('lns_preco_centavos') || 0),
  dia: Math.min(6, Math.max(0, Number(lerConfig('lns_dia_lote') ?? 5))),
  prazo: lerConfig('lns_prazo') || '', executor: lerConfig('lns_executor') || '', garantia: lerConfig('lns_garantia') || '',
  resumo: lerConfig('lns_resumo') || '', video: lerConfig('lns_video') || '',
  whatsapp: (lerConfig('lns_whatsapp') || '').replace(/\D/g, ''), atendimento: lerConfig('lns_atendimento') || '',
  parcelas: Math.min(12, Math.max(1, Number(lerConfig('lns_parcelas') || 10))),
  juros: Math.min(15, Math.max(0, Number(lerConfig('lns_juros_mensal') ?? 2.99))),
  antecipar: lerConfig('lns_antecipar') !== '0',
});
const lnCfgComTabela = () => { const c = lnCfg(); return { ...c, tabela: SV.tabelaParcelas(c.preco, c.parcelas, c.juros) }; };
// Próximo dia de lote (horário de Brasília), sempre a partir de amanhã: quem paga no dia do lote entra no seguinte
function proximoLoteLN(dia = lnCfg().dia) {
  const d = new Date(Date.now() - 3 * 3600000);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== dia) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const ATIVOS_LN = "('aguardando_pagamento','pago','em_lote','em_andamento')";
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
<tr><td style="background:#0F0C14;padding:20px 28px;color:#fff;font-weight:bold;font-size:18px">Soft <span style="color:#C98BEB;font-weight:normal">Consultas</span> · Limpa Nome</td></tr>
<tr><td style="padding:28px;font-size:16px;line-height:1.55"><h1 style="font-size:21px;margin:0 0 12px">${P.esc(titulo)}</h1>
<p>Olá, ${P.esc(String(p.nome).split(/\s+/)[0])}! ${texto}</p>
<p style="margin:24px 0"><a href="${base}/limpa-nome/servico/${p.id}" style="display:inline-block;background:#9F31D3;color:#fff;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:bold">Acompanhar meu pedido</a></p>
<p style="font-size:14px">Dúvidas? <a href="${base}/limpa-nome/ajuda?p=${p.id}&e=email" style="color:#1FA855;font-weight:bold">Fale com a gente no WhatsApp</a></p>
<p style="font-size:13px;color:#7A7285">Pedido #${p.id} · documento final ${P.esc(String(p.cpf).slice(-4))}</p></td></tr></table></td></tr></table></body></html>`;
  enviarEmail({ para: p.email, assunto: `${titulo} · Pedido #${p.id}`, html }).catch((e) => console.error('e-mail limpa nome:', e.message));
}
const TEXTO_STATUS_LN = {
  pago: (p) => [`Pagamento confirmado`, `Recebemos o seu pagamento. O seu nome será incluído na ação coletiva de <strong>${P.esc(p.lote?.split('-').reverse().join('/') || '')}</strong>.`],
  em_lote: (p) => [`Você foi incluído na ação coletiva`, `O seu pedido foi incluído na ação judicial coletiva de ${P.esc(p.lote?.split('-').reverse().join('/') || '')}. Agora é aguardar o andamento; avisamos a cada etapa.`],
  em_andamento: () => [`Sua ação está em andamento`, 'A ação com o seu pedido está em andamento.'],
  concluido: () => [`Seu nome está limpo`, 'O seu pedido de Limpa Nome foi concluído. Faça uma consulta do seu CPF ou CNPJ na plataforma para conferir o "nada consta".'],
  cancelado: () => [`Seu pedido foi cancelado`, 'O seu pedido foi cancelado.'],
  reembolsado: () => [`Seu pagamento foi reembolsado`, 'O valor do seu pedido foi devolvido.'],
};
function avisarStatusLN(p) {
  const f = TEXTO_STATUS_LN[p.status];
  if (!f) return;
  const [t, x] = f(p);
  emailPedidoLN(p, t, x + (p.obs_admin ? `<br><br><strong>Mensagem da equipe:</strong> ${P.esc(p.obs_admin)}` : ''));
}
// Confirma o pagamento (webhook ou consulta de status). Retorna true só na primeira vez.
function confirmarPedidoLN(id) {
  const lote = proximoLoteLN();
  const ok = db.prepare("UPDATE limpa_nome_pedidos SET status = 'pago', pago_em = datetime('now'), lote = ?, atualizado_em = datetime('now') WHERE id = ? AND status = 'aguardando_pagamento'").run(lote, id).changes === 1;
  if (ok) {
    const p = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE id = ?').get(id);
    registrar(null, 'Limpa Nome: pedido pago', `#${id} · ${p.nome} · ${P.reais(p.valor_centavos)}${p.forma_pagamento === 'cartao' ? ` (cartão ${p.parcelas}x)` : ''} · lote ${lote}`);
    avisarStatusLN(p);
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

rota('GET', '/limpa-nome/servico', exigeLogin(({ res, usuario }) => {
  const cfg = lnCfgComTabela();
  const pedidos = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE usuario_id = ? ORDER BY id DESC').all(usuario.id);
  if (!cfg.ativo && !usuario.admin && !pedidos.length) return pagina(res, 'Limpa Nome', P.paginaEmBreve('Limpa Nome', 'O serviço de Limpa Nome estará disponível em breve.'), usuario);
  pagina(res, 'Serviço Limpa Nome', (!cfg.ativo ? '<div class="aviso">Serviço desligado para novos pedidos' + (usuario.admin ? ' (você vê esta página por ser admin).' : '.') + '</div>' : '') +
    SV.paginaServicoLN({ cfg, proximoLote: proximoLoteLN(cfg.dia), pedidos, usuario }), usuario);
}));

rota('POST', '/limpa-nome/servico', exigeLogin(async ({ req, res, usuario }) => {
  const cfg = lnCfgComTabela();
  const pedidos = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE usuario_id = ? ORDER BY id DESC').all(usuario.id);
  let v = {};
  const erro = (m) => pagina(res, 'Serviço Limpa Nome', SV.paginaServicoLN({ cfg, proximoLote: proximoLoteLN(cfg.dia), pedidos, usuario, erro: m, v }), usuario, 400);
  if (!cfg.ativo && !usuario.admin) return erro('O serviço não está recebendo pedidos no momento.');
  if (cfg.preco < 500) return erro('O serviço ainda não está configurado. Tente novamente mais tarde.');
  let form;
  try { form = await corpoMultipart(req, 11 * 1024 * 1024); } catch (e) { return erro(e.message === 'arquivo grande demais' ? 'Arquivos grandes demais (até 5 MB cada).' : 'Não foi possível ler o formulário.'); }
  v = form.campos;
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
  if (db.prepare(`SELECT 1 FROM limpa_nome_pedidos WHERE cpf = ? AND status IN ('pago','em_lote','em_andamento')`).get(cpf)) return erro('Já existe um pedido em andamento para este CPF/CNPJ.');
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
  const antigo = db.prepare("SELECT id FROM limpa_nome_pedidos WHERE usuario_id = ? AND cpf = ? AND status = 'aguardando_pagamento'").get(usuario.id, cpf);
  if (antigo) db.prepare("UPDATE limpa_nome_pedidos SET status = 'cancelado', obs_admin = 'Substituído por um novo pedido', atualizado_em = datetime('now') WHERE id = ?").run(antigo.id);
  const id = Number(db.prepare(`INSERT INTO limpa_nome_pedidos (usuario_id, nome, cpf, nascimento, telefone, email, doc_tipo, titular_proprio, aceite_em, aceite_ip, valor_centavos, forma_pagamento, parcelas, juros_centavos)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?)`).run(usuario.id, nome, cpf, nasc, tel, email, docTipo, v.proprio === '1' ? 1 : 0, ipDe(req), totalCobrado, forma, parcelas, totalCobrado - cfg.preco).lastInsertRowid);
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
    const cob = await AS.criarCobrancaServico({ clienteId, valorCentavos: totalCobrado, pedidoId: id, forma, parcelas });
    let pix = null;
    if (forma === 'pix') { try { pix = await AS.pixQrCode(cob.id); } catch (e) { console.warn('Pix indisponível:', e.message); } }
    db.prepare("UPDATE limpa_nome_pedidos SET asaas_id = ?, asaas_parcelamento = ?, pix_codigo = ?, pix_imagem = ?, link_pagamento = ?, atualizado_em = datetime('now') WHERE id = ?")
      .run(cob.id, cob.installment || null, pix?.payload || null, pix?.encodedImage || null, cob.invoiceUrl || null, id);
    // Cartão: vai direto para a página segura do Asaas
    if (forma === 'cartao' && cob.invoiceUrl) return redirecionar(res, cob.invoiceUrl);
    redirecionar(res, `/limpa-nome/servico/${id}`);
  } catch (e) {
    console.error('limpa nome:', e.message);
    db.prepare("UPDATE limpa_nome_pedidos SET status = 'cancelado', obs_admin = 'Falha ao gerar o Pix', atualizado_em = datetime('now') WHERE id = ?").run(id);
    erro('Não foi possível gerar o Pix agora. Tente de novo em instantes.');
  }
}));

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

rota('GET', '/limpa-nome/servico/:id', exigeLogin(({ res, usuario, params }) => {
  const p = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE id = ? AND usuario_id = ?').get(Number(params.id), usuario.id);
  if (!p) return redirecionar(res, '/limpa-nome/servico');
  pagina(res, `Pedido #${p.id}`, SV.paginaPedidoLN({ p, cfg: lnCfg() }), usuario);
}));

rota('GET', '/api/limpa-nome/:id/status', async ({ res, usuario, params }) => {
  if (!usuario) return json(res, { pago: false }, 401);
  const p = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE id = ? AND usuario_id = ?').get(Number(params.id), usuario.id);
  if (!p) return json(res, { pago: false }, 404);
  if (p.status !== 'aguardando_pagamento') return json(res, { pago: true, valor: p.valor_centavos / 100 });
  if (p.asaas_id && A.limitar(`stln:${p.id}`, 30, 5)) {
    try {
      const c = await AS.buscarCobranca(p.asaas_id);
      if (AS.STATUS_PAGO.includes(c.status) && (p.asaas_parcelamento || Math.round(Number(c.value) * 100) >= p.valor_centavos)) { confirmarPedidoLN(p.id); return json(res, { pago: true, valor: p.valor_centavos / 100 }); }
    } catch (e) { console.warn('status limpa nome:', e.message); }
  }
  json(res, { pago: false });
});

// ---------- Admin ----------
rota('GET', '/admin/limpa-nome', exigeAdmin(({ res, usuario, url }) => {
  const cfg = lnCfg(), lote = proximoLoteLN(cfg.dia);
  const f = ['lote', 'ativos', 'aguardando', 'todos'].includes(url.searchParams.get('f')) ? url.searchParams.get('f') : 'lote';
  const onde = { lote: "p.status = 'pago'", ativos: "p.status IN ('pago','em_lote','em_andamento')", aguardando: "p.status = 'aguardando_pagamento'", todos: '1=1' }[f];
  const pedidos = db.prepare(`SELECT p.*, u.email AS cliente FROM limpa_nome_pedidos p JOIN usuarios u ON u.id = p.usuario_id WHERE ${onde} ORDER BY p.id DESC LIMIT 500`).all();
  const lotes = {
    proximo: db.prepare("SELECT COUNT(*) n FROM limpa_nome_pedidos WHERE status = 'pago'").get().n,
    pagos: db.prepare("SELECT COUNT(*) n FROM limpa_nome_pedidos WHERE pago_em IS NOT NULL AND status <> 'reembolsado'").get().n,
    receita: db.prepare("SELECT COALESCE(SUM(valor_centavos),0) s FROM limpa_nome_pedidos WHERE pago_em IS NOT NULL AND status <> 'reembolsado'").get().s,
    aguardando: db.prepare("SELECT COUNT(*) n FROM limpa_nome_pedidos WHERE status = 'aguardando_pagamento'").get().n,
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
    lns_whatsapp: A.soNumeros(f.whatsapp).slice(0, 15), lns_atendimento: String(f.atendimento || '').trim().slice(0, 100), lns_parcelas: String(Math.min(12, Math.max(1, Math.floor(Number(f.parcelas) || 1)))),
    lns_juros_mensal: String(Math.min(15, Math.max(0, Number(String(f.juros ?? '').replace(',', '.')) || 0))), lns_antecipar: f.antecipar === '1' ? '1' : '0', lns_resumo: String(f.resumo || '').trim().slice(0, 300), lns_video: video };
  const mudou = Object.entries(novos).filter(([k, val]) => (lerConfig(k) || '') !== val).map(([k, val]) => `${k.slice(4)}: ${val || '(vazio)'}`);
  for (const [k, val] of Object.entries(novos)) gravarConfig(k, val);
  registrar(usuario, 'Limpa Nome: configuração', mudou.join(' · ') || 'sem mudanças');
  volta('Configuração salva.', true);
}));

rota('POST', '/admin/limpa-nome/status', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const volta = (m, ok) => redirecionar(res, `/admin/limpa-nome?f=todos&${ok ? 'ok' : 'erro'}=${encodeURIComponent(m)}`);
  const p = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE id = ?').get(Number(f.id));
  if (!p) return volta('Pedido não encontrado.');
  if (!SV.STATUS_LN[f.status]) return volta('Status inválido.');
  if (f.status !== 'aguardando_pagamento' && f.status !== 'cancelado' && !p.pago_em) return volta('Este pedido ainda não foi pago. Use "Conferir" ou aguarde a confirmação do Pix.');
  const obs = String(f.obs || '').trim().slice(0, 300);
  const lote = p.lote || (f.status === 'pago' ? proximoLoteLN() : null);
  db.prepare("UPDATE limpa_nome_pedidos SET status = ?, obs_admin = ?, lote = ?, atualizado_em = datetime('now') WHERE id = ?").run(f.status, obs || null, lote, p.id);
  registrar(usuario, 'Limpa Nome: status', `#${p.id} · ${p.nome} · ${p.status} → ${f.status}${obs ? ` · "${obs}"` : ''}`);
  if (f.status !== p.status || (obs && obs !== (p.obs_admin || ''))) avisarStatusLN({ ...p, status: f.status, obs_admin: obs, lote });
  volta(`Pedido #${p.id} atualizado.`, true);
}));

rota('POST', '/admin/limpa-nome/fechar-lote', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const lista = db.prepare("SELECT * FROM limpa_nome_pedidos WHERE status = 'pago'").all();
  for (const p of lista) {
    if (db.prepare("UPDATE limpa_nome_pedidos SET status = 'em_lote', lote = COALESCE(?, lote), atualizado_em = datetime('now') WHERE id = ? AND status = 'pago'").run(/^\d{4}-\d{2}-\d{2}$/.test(f.lote || '') ? f.lote : null, p.id).changes === 1)
      avisarStatusLN({ ...p, status: 'em_lote', lote: f.lote || p.lote, obs_admin: null });
  }
  registrar(usuario, 'Limpa Nome: lote enviado', `lote ${f.lote} · ${lista.length} pedido(s): ${lista.map((p) => `#${p.id}`).join(', ')}`);
  redirecionar(res, `/admin/limpa-nome?f=ativos&ok=${encodeURIComponent(`${lista.length} pedido(s) marcados como enviados no lote.`)}`);
}));

rota('GET', '/admin/limpa-nome/lote.csv', exigeAdmin(({ res, usuario }) => {
  const lista = db.prepare("SELECT * FROM limpa_nome_pedidos WHERE status IN ('pago','em_lote','em_andamento') ORDER BY lote, id").all();
  const c = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const linhas = [['pedido', 'lote', 'status', 'nome', 'cpf', 'nascimento', 'telefone', 'email', 'documento', 'titular_proprio', 'pagamento', 'pago_em'].join(';'),
    ...lista.map((p) => [p.id, p.lote, p.status, p.nome, p.cpf, p.nascimento, p.telefone, p.email, p.doc_tipo, p.titular_proprio ? 'sim' : 'não (autorizado)', p.forma_pagamento === 'cartao' ? `cartão ${p.parcelas}x` : 'pix', p.pago_em].map(c).join(';'))];
  registrar(usuario, 'Limpa Nome: baixou planilha', `${lista.length} pedido(s)`);
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="limpa-nome-${proximoLoteLN()}.csv"`, 'Cache-Control': 'no-store' });
  res.end('﻿' + linhas.join('\r\n'));
}));

rota('GET', '/admin/limpa-nome/doc/:id/:lado', exigeAdmin(async ({ res, usuario, params }) => {
  const p = db.prepare('SELECT * FROM limpa_nome_pedidos WHERE id = ?').get(Number(params.id));
  const arq = p && (params.lado === 'frente' ? p.doc_frente : params.lado === 'verso' ? p.doc_verso : null);
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
const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
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
    await fn({ req, res, url, token, usuario, params });
  } catch (e) {
    console.error('erro:', e);
    if (!res.headersSent) pagina(res, 'Erro', P.paginaEmBreve('Algo deu errado', 'Tente de novo em instantes.'), null, 500);
  }
});

const porta = process.env.PORT || 3000;
servidor.listen(porta, () => {
  console.log(`Soft Consultas no ar na porta ${porta}`);
  console.log(`Banco de dados em: ${armazenamento.pasta} | DATA_DIR definido: ${armazenamento.definido ? 'sim' : 'NÃO'} | disco montado: ${armazenamento.montado ? 'sim' : 'NÃO'}`);
  if (!armazenamento.persistente) console.error('ATENÇÃO: os dados NÃO estão em disco permanente e serão perdidos no próximo deploy. Configure o disco (/var/data) e DATA_DIR no Render.');
});
