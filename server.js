// Soft Consultas: servidor principal (Node 22, sem dependências externas nesta etapa)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, saldoCentavos, saldoComissao, lerConfig, gravarConfig, precoDe, recalcularPrecos, pastaPdfs, armazenamento, fazerBackup, listarBackups, pastaBackups, registrar, pastaAnuncios } from './db.js';
import { writeFile, access, unlink } from 'node:fs/promises';
import * as AS from './asaas.js';
import { consultarApiFull, analisar, achatar, obterPdf, saldoApiFull, limparCacheSaldo } from './apifull.js';
import { pdfGenerico } from './pdf.js';
import * as PA from './paginas-app.js';
import * as PD from './paginas-admin.js';
import * as A from './auth.js';
import * as P from './paginas.js';
import { enviarEmail, emailRedefinicao, emailBoasVindas } from './email.js';
import { TERMOS, PRIVACIDADE } from './textos.js';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVOS = { '/icone.png': 'image/png', '/icone-branco.png': 'image/png', '/app.js': 'text/javascript; charset=utf-8' };

// ---------- utilidades HTTP ----------
function cookies(req) {
  const out = {};
  for (const p of String(req.headers.cookie || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return out;
}
const ehHttps = (req) => String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';
const ipDe = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
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
const CABECALHOS = {
  'Content-Security-Policy': `default-src 'self'; script-src 'self'${CF}; frame-src${CF || " 'none'"}; connect-src 'self'${CF}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'self'`,
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
const pagina = (res, titulo, corpo, usuario, status, extra) =>
  html(res, P.layout({ titulo, corpo: (usuario?.admin && !armazenamento.persistente ? AVISO_DISCO : '') + corpo, usuario }), status, extra);

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
const exigeLogin = (fn) => async (ctx) => (ctx.usuario ? fn(ctx) : redirecionar(ctx.res, '/entrar'));
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
  : pagina(res, 'Consultas para o seu negócio', P.paginaInicial({ anuncios: anunciosParaExibir(), contato: contatoAnuncie() }), null)));

// Cadastro
rota('GET', '/cadastro', ({ res, usuario }) => (usuario ? redirecionar(res, '/painel') : pagina(res, 'Criar conta', P.paginaCadastro({}), null)));
rota('POST', '/cadastro', async ({ req, res }) => {
  const f = await corpoForm(req);
  const v = {
    nome: String(f.nome || '').trim().slice(0, 120),
    email: String(f.email || '').trim().toLowerCase().slice(0, 160),
    documento: A.soNumeros(f.documento),
    telefone: A.soNumeros(f.telefone).replace(/^55(?=\d{10,11}$)/, ''),
  };
  const erro = (m) => pagina(res, 'Criar conta', P.paginaCadastro({ erro: m, v }), null, 400);
  if (!A.limitar(`cad:${ipDe(req)}`, 10, 60)) return erro('Muitas tentativas. Aguarde alguns minutos e tente de novo.');
  if (!(await passouNoRobo(req, f))) return erro('Confirme que você não é um robô.');
  if (v.nome.length < 3) return erro('Informe seu nome completo ou a razão social.');
  if (!A.emailValido(v.email)) return erro('Informe um e-mail válido.');
  if (!A.documentoValido(v.documento)) return erro('CPF ou CNPJ inválido.');
  if (v.telefone.length < 10 || v.telefone.length > 11) return erro('Informe seu WhatsApp com DDD.');
  if (String(f.senha || '').length < 8) return erro('A senha precisa ter pelo menos 8 caracteres.');
  if (f.aceite !== '1') return erro('Para continuar, aceite os Termos de uso e a Política de privacidade.');
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(v.email)) return erro('Já existe uma conta com esse e-mail. Faça login ou recupere a senha.');

  const admin = process.env.ADMIN_EMAIL && process.env.ADMIN_EMAIL.toLowerCase() === v.email ? 1 : 0;
  const ref = String(cookies(req).sc_ref || '').toUpperCase();
  const indicador = ref ? db.prepare('SELECT id FROM usuarios WHERE codigo_indicacao = ? AND ativo = 1').get(ref) : null;
  const r = db.prepare(`INSERT INTO usuarios (nome, email, documento, telefone, senha_hash, admin, aceite_termos, indicado_por, codigo_indicacao)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`).run(v.nome, v.email, v.documento, v.telefone, A.gerarHashSenha(f.senha), admin, indicador?.id ?? null, codigoUnico());
  const token = A.criarSessao(Number(r.lastInsertRowid));
  enviarEmail({ para: v.email, assunto: 'Bem-vindo à Soft Consultas', html: emailBoasVindas(v.nome, `${urlBase(req)}/painel`) })
    .catch((e) => console.error('e-mail boas-vindas:', e.message));
  redirecionar(res, '/painel', { 'Set-Cookie': [A.cookieSessao(token, ehHttps(req)), 'sc_ref=; Path=/; Max-Age=0'] });
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
  redirecionar(res, '/painel', { 'Set-Cookie': A.cookieSessao(A.criarSessao(u.id), ehHttps(req)) });
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
const bonusPara = (v) => { let p = 0; for (const f of faixasBonus()) if (v >= f.a_partir_de) p = Math.max(p, f.percentual); return Math.round((v * p) / 100); };
const VALOR_MAXIMO = 500000; // R$ 5.000 por recarga

// Credita uma recarga uma única vez (webhook e verificação manual podem chamar ao mesmo tempo)
function creditarRecarga(recargaId) {
  const r = db.prepare('SELECT * FROM recargas WHERE id = ?').get(recargaId);
  if (!r || r.status === 'paga') return false;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE recargas SET status = 'paga', pago_em = datetime('now') WHERE id = ? AND status <> 'paga'").run(r.id);
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

rota('GET', '/recarregar', exigeLogin(({ res, usuario }) => pagina(res, 'Recarregar',
  PA.paginaRecarregar({ minimo: Number(lerConfig('recarga_minima_centavos')), faixas: faixasBonus() }), usuario)));

rota('POST', '/recarregar', exigeLogin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const minimo = Number(lerConfig('recarga_minima_centavos'));
  const valor = String(f.outro || '').trim() ? centavos(f.outro) : centavos(f.valor);
  const erro = (m) => pagina(res, 'Recarregar', PA.paginaRecarregar({ minimo, faixas: faixasBonus(), erro: m }), usuario, 400);
  if (!Number.isFinite(valor) || valor < minimo) return erro(`O valor mínimo de recarga é ${P.reais(minimo)}.`);
  if (valor > VALOR_MAXIMO) return erro(`O valor máximo por recarga é ${P.reais(VALOR_MAXIMO)}.`);
  if (!A.limitar(`rec:${usuario.id}`, 10, 60)) return erro('Muitas recargas geradas em pouco tempo. Aguarde alguns minutos.');
  try {
    let clienteId = db.prepare('SELECT asaas_cliente_id FROM usuarios WHERE id = ?').get(usuario.id).asaas_cliente_id;
    if (!clienteId) {
      clienteId = (await AS.criarCliente(usuario)).id;
      db.prepare('UPDATE usuarios SET asaas_cliente_id = ? WHERE id = ?').run(clienteId, usuario.id);
    }
    const bonus = bonusPara(valor);
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
  if (r.status === 'paga') return json(res, { pago: true });
  if (r.asaas_id && A.limitar(`st:${r.id}`, 30, 5)) {
    try {
      const c = await AS.buscarCobranca(r.asaas_id);
      if (AS.STATUS_PAGO.includes(c.status)) { creditarRecarga(r.id); return json(res, { pago: true }); }
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
  if (!['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(event)) return;
  const ref = String(payment?.externalReference || '');
  if (!ref.startsWith(AS.PREFIXO)) return;
  const rid = Number(ref.slice(AS.PREFIXO.length));
  const r = db.prepare('SELECT * FROM recargas WHERE id = ?').get(rid);
  if (!r || r.asaas_id !== payment.id || Math.round(Number(payment.value) * 100) < r.valor_centavos) return;
  try { creditarRecarga(rid); } catch (e) { console.error('crédito recarga:', e.message); }
});

// Admin enxerga (e usa) o saldo real da APIFull; clientes, a carteira interna
const saldoExibido = async (usuario) => (usuario.admin ? await saldoApiFull() : saldoCentavos(usuario.id));

// ======================= RETENÇÃO DO HISTÓRICO =======================
const diasHistorico = () => Math.max(1, Number(lerConfig('dias_historico') || 10));
const expirou = (c) => c.status === 'concluida' && !c.resultado;
async function limparExpiradas() {
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
  if (!usuario?.indicado_por || usuario.admin) return null;
  const ind = db.prepare('SELECT id, comissao_percentual FROM usuarios WHERE id = ? AND ativo = 1').get(usuario.indicado_por);
  if (!ind || ind.id === usuario.id) return null;
  const max = Number(lerConfig('comissao_maxima') ?? 100);
  return { id: ind.id, pct: Math.max(0, Math.min(max, Number(ind.comissao_percentual) || 0)) };
}
const produtosPara = (usuario) => {
  const ind = comissaoDoIndicador(usuario);
  return produtosAtivos().map((p) => {
    if (usuario?.admin) return { ...p, preco_centavos: p.custo_centavos, precoCusto: true, comissao_centavos: 0, indicador_id: null };
    const com = ind ? Math.round((p.preco_centavos * ind.pct) / 100) : 0;
    return { ...p, preco_base: p.preco_centavos, preco_centavos: p.preco_centavos + com, comissao_centavos: com, indicador_id: com > 0 ? ind.id : null };
  });
};
const PLACA = /^[A-Z]{3}\d[A-Z0-9]\d{2}$/;
const PALAVRAS_SENSIVEIS = /mandado|antecedente|pessoas relacionadas|endere[cç]|telefone|celular|cpf completo|e-?mail|parente|grafo|contato|localiza|ve[ií]culos por cpf|radar|rastreamento/i;
// Pode fazer consultas sensíveis? Empresas (CNPJ) e admin sim; pessoa física só com liberação do admin
const podeSensivel = (u) => !!(u?.admin || u?.liberado_sensivel || String(u?.documento || '').length === 14);
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
  pagina(res, produto.nome, PA.paginaConsultar({ produto, saldo: await saldoExibido(usuario), admin: !!usuario.admin, bloqueada: produto.sensivel && !podeSensivel(usuario) }), usuario);
}));

rota('POST', '/consultas/:slug', exigeLogin(async ({ req, res, usuario, params }) => {
  const produto = produtosPara(usuario).find((p) => p.slug === params.slug);
  if (!produto) return redirecionar(res, '/consultas');
  const f = await corpoForm(req);
  const v = { valor: f.valor, finalidade: f.finalidade };
  const erro = async (m) => pagina(res, produto.nome, PA.paginaConsultar({ produto, saldo: await saldoExibido(usuario), admin: !!usuario.admin, erro: m, v }), usuario, 400);
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
    if (!usuario.admin && saldoCentavos(usuario.id) < produto.preco_centavos) { db.exec('ROLLBACK'); return erro('Saldo insuficiente. Faça uma recarga para continuar.'); }
    cid = Number(db.prepare(`INSERT INTO consultas (usuario_id, produto_id, produto, parametro, finalidade, status, preco_centavos, custo_centavos, indicador_id, comissao_centavos)
      VALUES (?, ?, ?, ?, ?, 'processando', ?, ?, ?, ?)`).run(usuario.id, produto.id, produto.nome, val.v, f.finalidade, produto.preco_centavos, produto.custo_centavos, produto.indicador_id, produto.comissao_centavos).lastInsertRowid);
    // Admin consulta direto no saldo da APIFull: nada é descontado da carteira interna
    if (!usuario.admin) {
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
    if (!usuario.admin) {
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
  pagina(res, 'Histórico', PA.paginaHistorico({ consultas, busca, dias: diasHistorico() }), usuario);
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
    saldo: saldoComissao(usuario.id), maximo: Number(lerConfig('comissao_maxima') ?? 100), minimoSaque: Number(lerConfig('saque_minimo_centavos') ?? 5000),
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
    const sid = Number(db.prepare('INSERT INTO saques (usuario_id, valor_centavos, chave_pix) VALUES (?, ?, ?)').run(usuario.id, valor, chave).lastInsertRowid);
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

rota('POST', '/admin/saques/resolver', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const s = db.prepare("SELECT * FROM saques WHERE id = ? AND status = 'pendente'").get(Number(f.id));
  if (!s) return redirecionar(res, '/admin/saques');
  // Pagar automaticamente pelo Asaas (Pix sai da conta Asaas para a chave do usuário)
  if (f.acao === 'asaas') {
    try {
      const t = await AS.transferirPix({ valorCentavos: s.valor_centavos, chave: s.chave_pix, descricao: `Saque de comissão Soft Consultas #${s.id}` });
      db.prepare("UPDATE saques SET status = 'pago', resolvido_em = datetime('now'), observacao = ?, asaas_transferencia_id = ? WHERE id = ? AND status = 'pendente'")
        .run(`Pix pelo Asaas (${t.status || 'enviado'})`, t.id || null, s.id);
      registrar(usuario, 'Pagou saque pelo Asaas', `Saque #${s.id} de ${P.reais(s.valor_centavos)} para ${s.chave_pix} · transferência ${t.id || '-'} (${t.status || '-'})`);
      return redirecionar(res, '/admin/saques?ok=1');
    } catch (e) {
      console.error('transferência asaas:', e.message);
      return redirecionar(res, `/admin/saques?erro=${encodeURIComponent(`Não foi possível pagar pelo Asaas: ${e.message}`)}`);
    }
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    if (f.acao === 'pagar') {
      db.prepare("UPDATE saques SET status = 'pago', resolvido_em = datetime('now'), observacao = ? WHERE id = ?").run(String(f.obs || '').slice(0, 200), s.id);
    } else {
      db.prepare("UPDATE saques SET status = 'recusado', resolvido_em = datetime('now'), observacao = ? WHERE id = ?").run(String(f.obs || '').slice(0, 200), s.id);
      db.prepare("INSERT OR IGNORE INTO comissoes (usuario_id, tipo, valor_centavos, descricao, referencia) VALUES (?, 'estorno_saque', ?, ?, ?)")
        .run(s.usuario_id, s.valor_centavos, `Saque #${s.id} recusado: valor devolvido`, `estsaque_${s.id}`);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  registrar(usuario, f.acao === 'pagar' ? 'Marcou saque como pago' : 'Recusou saque', `Saque #${s.id} de ${P.reais(s.valor_centavos)} para a chave ${s.chave_pix}${f.obs ? ` (${String(f.obs).slice(0, 200)})` : ''}`);
  redirecionar(res, '/admin/saques?ok=1');
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
    consultas: g("SELECT COUNT(*) n FROM consultas c JOIN usuarios u ON u.id=c.usuario_id WHERE c.status='concluida' AND u.admin=0").n,
    falhas: g("SELECT COUNT(*) n FROM consultas WHERE status='falhou'").n,
    faturamento: g("SELECT COALESCE(SUM(c.preco_centavos - c.comissao_centavos),0) s FROM consultas c JOIN usuarios u ON u.id=c.usuario_id WHERE c.status='concluida' AND u.admin=0").s,
    comissoes: g("SELECT COALESCE(SUM(comissao_centavos),0) s FROM consultas WHERE status='concluida'").s,
    saquesPendentes: g("SELECT COALESCE(SUM(valor_centavos),0) s FROM saques WHERE status='pendente'").s,
    qtdSaquesPendentes: g("SELECT COUNT(*) n FROM saques WHERE status='pendente'").n,
    custo: g("SELECT COALESCE(SUM(c.custo_centavos),0) s FROM consultas c JOIN usuarios u ON u.id=c.usuario_id WHERE c.status='concluida' AND u.admin=0").s,
    internas: g("SELECT COUNT(*) n FROM consultas c JOIN usuarios u ON u.id=c.usuario_id WHERE c.status='concluida' AND u.admin=1").n,
    custoInternas: g("SELECT COALESCE(SUM(c.custo_centavos),0) s FROM consultas c JOIN usuarios u ON u.id=c.usuario_id WHERE c.status='concluida' AND u.admin=1").s,
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
  };
  const erro = (m) => pagina(res, 'Admin · Editar consulta', PD.adminProdutoForm({ p, markup: lerConfig('markup_percentual'), erro: m }), usuario, 400);
  if (!p.nome || !p.categoria) return erro('Preencha o nome e a categoria.');
  if (!Number.isFinite(custo) || custo <= 0) return erro('Informe o custo da consulta na APIFull.');
  if (p.endpoint && !/^[\w.-]+$/.test(p.endpoint)) return erro('Endpoint inválido: use só letras, números, ponto, hífen ou sublinhado.');
  const preco = precoDe(custo);
  const antes = p.id ? db.prepare('SELECT nome, custo_centavos, ativo, endpoint FROM produtos WHERE id = ?').get(p.id) : null;
  registrar(usuario, p.id ? 'Editou consulta' : 'Criou consulta',
    `${p.nome}: custo ${P.reais(antes?.custo_centavos ?? 0)} → ${P.reais(custo)}, preço ${P.reais(preco)}, ${p.ativo ? 'ativa' : 'inativa'}${antes && antes.endpoint !== p.endpoint ? `, endpoint ${antes.endpoint || '—'} → ${p.endpoint}` : ''}`);
  if (p.id) {
    db.prepare(`UPDATE produtos SET nome=?, categoria=?, descricao=?, documento=?, endpoint=?, link=?, campo=?, custo_centavos=?, preco_centavos=?, ordem=?, ativo=?, sensivel=?, destaque_limpa_nome=? WHERE id=?`)
      .run(p.nome, p.categoria, p.descricao, p.documento, p.endpoint, p.link, p.campo, custo, preco, p.ordem, p.ativo, p.sensivel, p.destaque_limpa_nome, p.id);
  } else {
    let slug = p.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'consulta';
    while (db.prepare('SELECT 1 FROM produtos WHERE slug = ?').get(slug)) slug += '-2';
    db.prepare(`INSERT INTO produtos (slug, nome, categoria, descricao, documento, endpoint, link, campo, custo_centavos, preco_centavos, ordem, ativo, sensivel, destaque_limpa_nome) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(slug, p.nome, p.categoria, p.descricao, p.documento, p.endpoint, p.link, p.campo, custo, preco, p.ordem, p.ativo, p.sensivel, p.destaque_limpa_nome);
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
        db.prepare(`UPDATE produtos SET nome=?, categoria=?, documento=?, endpoint=?, link=?, campo=?, custo_centavos=?, preco_centavos=?, ativo=?,
          descricao=COALESCE(NULLIF(?, ''), descricao) WHERE id=?`)
          .run(nome, cat, doc, endpoint, endpoint, campo, c, precoDe(c), ativo, descricao || '', existente.id);
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
  minimo: Number(lerConfig('recarga_minima_centavos')), faixas: faixasBonus(), markup: lerConfig('markup_percentual'), dias: diasHistorico(), comissaoMax: lerConfig('comissao_maxima'), saqueMin: Number(lerConfig('saque_minimo_centavos')), alerta: Number(lerConfig('alerta_saldo_apifull_centavos')), ok: url.searchParams.get('ok') ? 'Configurações salvas e preços recalculados.' : '',
}), usuario)));

rota('POST', '/admin/config', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const minimo = centavos(f.minimo), markup = Number(String(f.markup || '').replace(',', '.'));
  const erro = (m) => pagina(res, 'Admin · Configurações', PD.adminConfig({ minimo: Number(lerConfig('recarga_minima_centavos')), faixas: faixasBonus(), markup: lerConfig('markup_percentual'), dias: diasHistorico(), comissaoMax: lerConfig('comissao_maxima'), saqueMin: Number(lerConfig('saque_minimo_centavos')), alerta: Number(lerConfig('alerta_saldo_apifull_centavos')), erro: m }), usuario, 400);
  const dias = Number(f.dias);
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) return erro('O prazo do histórico precisa ser entre 1 e 365 dias.');
  const comissaoMax = Number(f.comissao_maxima), saqueMin = centavos(f.saque_minimo);
  if (!Number.isInteger(comissaoMax) || comissaoMax < 0 || comissaoMax > 300) return erro('Comissão máxima inválida (0 a 300%).');
  if (!Number.isFinite(saqueMin) || saqueMin < 100) return erro('Saque mínimo inválido.');
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
  gravarConfig('alerta_saldo_apifull_centavos', alerta);
  gravarConfig('bonus_faixas', JSON.stringify(faixas.sort((a, b) => a.a_partir_de - b.a_partir_de)));
  recalcularPrecos();
  registrar(usuario, 'Alterou configurações', `margem ${markup}%, recarga mínima ${P.reais(minimo)}, bônus ${faixas.map((x) => `${P.reais(x.a_partir_de)}=${x.percentual}%`).join('; ') || 'nenhum'}, histórico ${dias} dias, comissão máx. ${comissaoMax}%, saque mín. ${P.reais(saqueMin)}, alerta APIFull ${P.reais(alerta)}`);
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

rota('POST', '/admin/clientes/sensivel', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const cli = db.prepare('SELECT id, nome, email FROM usuarios WHERE id = ?').get(Number(f.id));
  if (!cli) return redirecionar(res, '/admin/clientes');
  const valor = f.liberar === '1' ? 1 : 0;
  db.prepare('UPDATE usuarios SET liberado_sensivel = ? WHERE id = ?').run(valor, cli.id);
  registrar(usuario, valor ? 'Liberou consultas sensíveis' : 'Bloqueou consultas sensíveis', `${cli.nome} (${cli.email})`);
  redirecionar(res, '/admin/clientes?ok=1');
}));

rota('GET', '/admin/consultas', exigeAdmin(({ res, usuario }) => pagina(res, 'Admin · Consultas feitas', PD.adminConsultas({
  consultas: db.prepare('SELECT c.*, u.nome AS cliente, u.admin AS interno FROM consultas c JOIN usuarios u ON u.id = c.usuario_id ORDER BY c.id DESC LIMIT 300').all(),
}), usuario)));

rota('GET', '/admin/recargas', exigeAdmin(({ res, usuario }) => pagina(res, 'Admin · Recargas', PD.adminRecargas({
  recargas: db.prepare('SELECT r.*, u.nome AS cliente FROM recargas r JOIN usuarios u ON u.id = r.usuario_id ORDER BY r.id DESC LIMIT 300').all(),
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

// ======================= ÁREA LIMPA NOME =======================
rota('GET', '/limpa-nome', exigeLogin(async ({ res, usuario }) => {
  const todos = produtosPara(usuario);
  pagina(res, 'Área Limpa Nome', PA.paginaLimpaNome({
    economicas: todos.filter((p) => p.destaque_limpa_nome === 'economica').sort((a, b) => a.preco_centavos - b.preco_centavos),
    completas: todos.filter((p) => p.destaque_limpa_nome === 'completa').sort((a, b) => a.preco_centavos - b.preco_centavos),
    saldo: await saldoExibido(usuario), admin: !!usuario.admin,
  }), usuario);
}));

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
  const base = `FROM consultas c JOIN usuarios u ON u.id = c.usuario_id WHERE c.status = 'concluida' AND u.admin = 0 AND ${filtro}`;
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
      SELECT c.criado_em, CASE WHEN u.admin = 1 THEN 'Consulta interna' ELSE 'Consulta' END, u.nome, c.produto, c.preco_centavos,
        CASE WHEN u.admin = 1 THEN NULL ELSE c.preco_centavos - c.comissao_centavos - c.custo_centavos END
        FROM consultas c JOIN usuarios u ON u.id = c.usuario_id WHERE c.status = 'concluida' AND date(c.criado_em, '-3 hours') BETWEEN ? AND ?
      UNION ALL
      SELECT k.criado_em, 'Comissão', u.nome, k.descricao, k.valor_centavos, NULL FROM comissoes k JOIN usuarios u ON u.id = k.usuario_id
        WHERE k.tipo = 'comissao' AND date(k.criado_em, '-3 hours') BETWEEN ? AND ?
      UNION ALL
      SELECT s.resolvido_em, 'Saque pago', u.nome, s.chave_pix, -s.valor_centavos, NULL FROM saques s JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.status = 'pago' AND date(s.resolvido_em, '-3 hours') BETWEEN ? AND ?
    ) ORDER BY quando DESC LIMIT 300`).all(ini, fim, ini, fim, ini, fim, ini, fim);
  pagina(res, 'Admin · Financeiro', PD.adminFinanceiro({
    ini, fim, totais, recargas, novos, diario, porProduto, topGasto, topComissao, extrato,
    saldoApiFull: await saldoApiFull(), clientesTotal: db.prepare('SELECT COUNT(*) n FROM usuarios WHERE admin = 0').get().n,
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
    if (req.method === 'GET' && ARQUIVOS[url.pathname]) {
      const dados = await readFile(path.join(raiz, url.pathname.slice(1)));
      res.writeHead(200, { 'Content-Type': ARQUIVOS[url.pathname], 'Cache-Control': 'public, max-age=86400' });
      return res.end(dados);
    }
    const achou = acharRota(req.method, url.pathname);
    if (!achou) return pagina(res, 'Página não encontrada', P.paginaEmBreve('Página não encontrada', 'O endereço que você abriu não existe.'), null, 404);
    const { fn, params } = achou;
    if (req.method === 'POST' && !url.pathname.startsWith('/webhook/') && !origemValida(req)) return pagina(res, 'Erro', P.paginaEmBreve('Envio bloqueado', 'Recarregue a página e tente de novo.'), null, 403);
    // Link de indicação: guarda o código por 30 dias até o cadastro
    const refParam = url.searchParams.get('ref');
    if (req.method === 'GET' && refParam && /^[A-Z2-9]{6,10}$/i.test(refParam)) {
      res.setHeader('Set-Cookie', `sc_ref=${refParam.toUpperCase()}; Path=/; Max-Age=${30 * 86400}; HttpOnly; SameSite=Lax${ehHttps(req) ? '; Secure' : ''}`);
    }
    const token = cookies(req)[A.COOKIE];
    const usuario = A.usuarioDaSessao(token);
    // Quem tem o e-mail do ADMIN_EMAIL vira administrador (mesmo se a conta foi criada antes da variável)
    if (usuario && !usuario.admin && process.env.ADMIN_EMAIL && usuario.email === process.env.ADMIN_EMAIL.trim().toLowerCase()) {
      db.prepare('UPDATE usuarios SET admin = 1 WHERE id = ?').run(usuario.id);
      usuario.admin = 1;
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
