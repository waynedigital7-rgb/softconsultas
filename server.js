// Soft Consultas: servidor principal (Node 22, sem dependências externas nesta etapa)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, saldoCentavos, lerConfig, gravarConfig, precoDe, recalcularPrecos } from './db.js';
import * as AS from './asaas.js';
import { consultarApiFull, analisar, achatar } from './apifull.js';
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
function json(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
const centavos = (v) => {
  const t = String(v ?? '').trim().replace(/[^\d,.-]/g, '');
  const n = /,\d{1,2}$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

const CABECALHOS = {
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};
function html(res, conteudo, status = 200, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...CABECALHOS, ...extra });
  res.end(conteudo);
}
function redirecionar(res, para, extra = {}) {
  res.writeHead(303, { Location: para, 'Cache-Control': 'no-store', ...extra });
  res.end();
}
const pagina = (res, titulo, corpo, usuario, status, extra) => html(res, P.layout({ titulo, corpo, usuario }), status, extra);

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

rota('GET', '/', ({ res, usuario }) => (usuario ? redirecionar(res, '/painel') : pagina(res, 'Consultas para o seu negócio', P.paginaInicial(), null)));

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
  if (v.nome.length < 3) return erro('Informe seu nome completo ou a razão social.');
  if (!A.emailValido(v.email)) return erro('Informe um e-mail válido.');
  if (!A.documentoValido(v.documento)) return erro('CPF ou CNPJ inválido.');
  if (v.telefone.length < 10 || v.telefone.length > 11) return erro('Informe seu WhatsApp com DDD.');
  if (String(f.senha || '').length < 8) return erro('A senha precisa ter pelo menos 8 caracteres.');
  if (f.aceite !== '1') return erro('Para continuar, aceite os Termos de uso e a Política de privacidade.');
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(v.email)) return erro('Já existe uma conta com esse e-mail. Faça login ou recupere a senha.');

  const admin = process.env.ADMIN_EMAIL && process.env.ADMIN_EMAIL.toLowerCase() === v.email ? 1 : 0;
  const r = db.prepare(`INSERT INTO usuarios (nome, email, documento, telefone, senha_hash, admin, aceite_termos)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`).run(v.nome, v.email, v.documento, v.telefone, A.gerarHashSenha(f.senha), admin);
  const token = A.criarSessao(Number(r.lastInsertRowid));
  enviarEmail({ para: v.email, assunto: 'Bem-vindo à Soft Consultas', html: emailBoasVindas(v.nome, `${urlBase(req)}/painel`) })
    .catch((e) => console.error('e-mail boas-vindas:', e.message));
  redirecionar(res, '/painel', { 'Set-Cookie': A.cookieSessao(token, ehHttps(req)) });
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
rota('GET', '/painel', exigeLogin(({ res, usuario }) => {
  const transacoes = db.prepare('SELECT * FROM transacoes WHERE usuario_id = ? ORDER BY id DESC LIMIT 20').all(usuario.id);
  const consultas = db.prepare('SELECT * FROM consultas WHERE usuario_id = ? ORDER BY id DESC LIMIT 10').all(usuario.id);
  pagina(res, 'Painel', P.paginaPainel({ usuario, saldo: saldoCentavos(usuario.id), transacoes, consultas }), usuario);
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

// ======================= CONSULTAS =======================
const produtosAtivos = () => db.prepare("SELECT * FROM produtos WHERE ativo = 1 AND endpoint <> '' ORDER BY ordem, nome").all();
const PLACA = /^[A-Z]{3}\d[A-Z0-9]\d{2}$/;
function validarValor(tipo, bruto) {
  if (tipo === 'placa') {
    const v = String(bruto || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return PLACA.test(v) ? { v } : { erro: 'Placa inválida. Use o formato ABC1234 ou ABC1D23.' };
  }
  const v = A.soNumeros(bruto);
  if (tipo === 'cpf' && !(v.length === 11 && A.cpfValido(v))) return { erro: 'CPF inválido.' };
  if (tipo === 'cnpj' && !(v.length === 14 && A.cnpjValido(v))) return { erro: 'CNPJ inválido.' };
  if (tipo === 'cpf_cnpj' && !A.documentoValido(v)) return { erro: 'CPF ou CNPJ inválido.' };
  return { v };
}

rota('GET', '/consultas', exigeLogin(({ res, usuario, url }) => {
  // compatibilidade com links antigos ?categoria=
  const cat = url.searchParams.get('categoria');
  if (cat) return redirecionar(res, `/consultas/categoria/${PA.slugCategoria(cat)}`);
  pagina(res, 'Consultas', PA.paginaCategorias({ produtos: produtosAtivos(), saldo: saldoCentavos(usuario.id), busca: url.searchParams.get('busca') || '' }), usuario);
}));

rota('GET', '/consultas/categoria/:cat', exigeLogin(({ res, usuario, url, params }) => {
  const todos = produtosAtivos();
  const produtos = todos.filter((p) => PA.slugCategoria(p.categoria) === params.cat);
  if (!produtos.length) return redirecionar(res, '/consultas');
  pagina(res, produtos[0].categoria, PA.paginaCategoria({ categoria: produtos[0].categoria, produtos, saldo: saldoCentavos(usuario.id), busca: url.searchParams.get('busca') || '' }), usuario);
}));

rota('GET', '/consultas/:slug', exigeLogin(({ res, usuario, params }) => {
  const produto = produtosAtivos().find((p) => p.slug === params.slug);
  if (!produto) return redirecionar(res, '/consultas');
  pagina(res, produto.nome, PA.paginaConsultar({ produto, saldo: saldoCentavos(usuario.id) }), usuario);
}));

rota('POST', '/consultas/:slug', exigeLogin(async ({ req, res, usuario, params }) => {
  const produto = produtosAtivos().find((p) => p.slug === params.slug);
  if (!produto) return redirecionar(res, '/consultas');
  const f = await corpoForm(req);
  const v = { valor: f.valor, finalidade: f.finalidade };
  const erro = (m) => pagina(res, produto.nome, PA.paginaConsultar({ produto, saldo: saldoCentavos(usuario.id), erro: m, v }), usuario, 400);
  const val = validarValor(produto.documento, f.valor);
  if (val.erro) return erro(val.erro);
  if (!PA.FINALIDADES.includes(f.finalidade)) return erro('Selecione a finalidade da consulta.');
  if (f.aceite !== '1') return erro('Confirme a declaração de finalidade para continuar.');
  if (!A.limitar(`con:${usuario.id}`, 30, 10)) return erro('Muitas consultas em pouco tempo. Aguarde alguns minutos.');

  // Reserva o valor (bloco síncrono: sem risco de gastar o mesmo saldo duas vezes)
  let cid;
  db.exec('BEGIN IMMEDIATE');
  try {
    if (saldoCentavos(usuario.id) < produto.preco_centavos) { db.exec('ROLLBACK'); return erro('Saldo insuficiente. Faça uma recarga para continuar.'); }
    cid = Number(db.prepare(`INSERT INTO consultas (usuario_id, produto_id, produto, parametro, finalidade, status, preco_centavos, custo_centavos)
      VALUES (?, ?, ?, ?, ?, 'processando', ?, ?)`).run(usuario.id, produto.id, produto.nome, val.v, f.finalidade, produto.preco_centavos, produto.custo_centavos).lastInsertRowid);
    db.prepare("INSERT INTO transacoes (usuario_id, tipo, valor_centavos, descricao, referencia) VALUES (?, 'consulta', ?, ?, ?)")
      .run(usuario.id, -produto.preco_centavos, `Consulta: ${produto.nome}`, `con_${cid}`);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  try {
    const dados = await consultarApiFull(produto, val.v);
    const a = analisar(dados);
    db.prepare("UPDATE consultas SET status = 'concluida', resultado = ?, pdf_origem = ? WHERE id = ?").run(JSON.stringify(dados), a.pdfOrigem, cid);
  } catch (e) {
    console.error('consulta falhou', cid, e.message);
    db.prepare("UPDATE consultas SET status = 'falhou', erro = ?, custo_centavos = 0 WHERE id = ?").run(String(e.message).slice(0, 500), cid);
    db.prepare("INSERT OR IGNORE INTO transacoes (usuario_id, tipo, valor_centavos, descricao, referencia) VALUES (?, 'estorno', ?, ?, ?)")
      .run(usuario.id, produto.preco_centavos, `Estorno: ${produto.nome}`, `est_${cid}`);
  }
  redirecionar(res, `/consulta/${cid}`);
}));

const dadosLegiveis = (dados) => dados?.dados?.data?.saida ?? dados?.dados?.data ?? dados?.dados ?? {};
const consultaDo = (id, usuario) => db.prepare(`SELECT * FROM consultas WHERE id = ? ${usuario.admin ? '' : 'AND usuario_id = ?'}`)
  .get(...(usuario.admin ? [Number(id)] : [Number(id), usuario.id]));

rota('GET', '/consulta/:id', exigeLogin(({ res, usuario, params }) => {
  const c = consultaDo(params.id, usuario);
  if (!c) return redirecionar(res, '/historico');
  const dados = c.resultado ? JSON.parse(c.resultado) : {};
  const a = analisar(dados);
  pagina(res, `Consulta #${c.id}`, PA.paginaResultado({ c, a, linhas: achatar(dadosLegiveis(dados)) }), usuario);
}));

rota('GET', '/consulta/:id/pdf', exigeLogin(async ({ res, usuario, params }) => {
  const c = consultaDo(params.id, usuario);
  if (!c || c.status !== 'concluida') return redirecionar(res, '/historico');
  const nome = `consulta-${c.id}.pdf`;
  let bytes = null;
  if (c.pdf_origem) {
    try {
      const r = await fetch(c.pdf_origem, { signal: AbortSignal.timeout(30000) });
      if (r.ok) bytes = Buffer.from(await r.arrayBuffer());
    } catch (e) { console.warn('pdf origem:', e.message); }
  }
  if (!bytes) {
    const dados = JSON.parse(c.resultado || '{}');
    bytes = await pdfGenerico({ id: c.id, produto: c.produto, parametro: c.parametro, dataHora: P.dt(c.criado_em) }, achatar(dadosLegiveis(dados)));
  }
  res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nome}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(bytes);
}));

rota('GET', '/historico', exigeLogin(({ res, usuario, url }) => {
  const busca = url.searchParams.get('busca') || '';
  const termo = `%${busca.replace(/[%_]/g, '')}%`;
  const doc = `%${A.soNumeros(busca) || '@@'}%`;
  const consultas = busca
    ? db.prepare('SELECT * FROM consultas WHERE usuario_id = ? AND (produto LIKE ? OR parametro LIKE ? OR parametro LIKE ?) ORDER BY id DESC LIMIT 200').all(usuario.id, termo, termo.toUpperCase(), doc)
    : db.prepare('SELECT * FROM consultas WHERE usuario_id = ? ORDER BY id DESC LIMIT 200').all(usuario.id);
  pagina(res, 'Histórico', PA.paginaHistorico({ consultas, busca }), usuario);
}));

// ======================= ADMIN =======================
rota('GET', '/admin', exigeAdmin(({ res, usuario }) => {
  const g = (sql, ...a) => db.prepare(sql).get(...a);
  const m = {
    clientes: g('SELECT COUNT(*) n FROM usuarios').n,
    clientesMes: g("SELECT COUNT(*) n FROM usuarios WHERE criado_em > datetime('now','-30 days')").n,
    recargas: g("SELECT COALESCE(SUM(valor_centavos),0) s FROM recargas WHERE status='paga'").s,
    qtdRecargas: g("SELECT COUNT(*) n FROM recargas WHERE status='paga'").n,
    bonus: g("SELECT COALESCE(SUM(bonus_centavos),0) s FROM recargas WHERE status='paga'").s,
    saldos: g('SELECT COALESCE(SUM(valor_centavos),0) s FROM transacoes').s,
    consultas: g("SELECT COUNT(*) n FROM consultas WHERE status='concluida'").n,
    falhas: g("SELECT COUNT(*) n FROM consultas WHERE status='falhou'").n,
    faturamento: g("SELECT COALESCE(SUM(preco_centavos),0) s FROM consultas WHERE status='concluida'").s,
    custo: g("SELECT COALESCE(SUM(custo_centavos),0) s FROM consultas WHERE status='concluida'").s,
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
    documento: ['cpf', 'cnpj', 'cpf_cnpj', 'placa'].includes(f.documento) ? f.documento : 'cpf_cnpj',
    endpoint: String(f.endpoint || '').trim(), link: String(f.link || '').trim(), campo: String(f.campo || 'document').trim() || 'document',
    custo_centavos: custo, ordem: Number(f.ordem) || 100, ativo: f.ativo === '1' ? 1 : 0,
  };
  const erro = (m) => pagina(res, 'Admin · Editar consulta', PD.adminProdutoForm({ p, markup: lerConfig('markup_percentual'), erro: m }), usuario, 400);
  if (!p.nome || !p.categoria) return erro('Preencha o nome e a categoria.');
  if (!Number.isFinite(custo) || custo <= 0) return erro('Informe o custo da consulta na APIFull.');
  if (p.endpoint && !/^[\w.-]+$/.test(p.endpoint)) return erro('Endpoint inválido: use só letras, números, ponto, hífen ou sublinhado.');
  const preco = precoDe(custo);
  if (p.id) {
    db.prepare(`UPDATE produtos SET nome=?, categoria=?, descricao=?, documento=?, endpoint=?, link=?, campo=?, custo_centavos=?, preco_centavos=?, ordem=?, ativo=? WHERE id=?`)
      .run(p.nome, p.categoria, p.descricao, p.documento, p.endpoint, p.link, p.campo, custo, preco, p.ordem, p.ativo, p.id);
  } else {
    let slug = p.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'consulta';
    while (db.prepare('SELECT 1 FROM produtos WHERE slug = ?').get(slug)) slug += '-2';
    db.prepare(`INSERT INTO produtos (slug, nome, categoria, descricao, documento, endpoint, link, campo, custo_centavos, preco_centavos, ordem, ativo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(slug, p.nome, p.categoria, p.descricao, p.documento, p.endpoint, p.link, p.campo, custo, preco, p.ordem, p.ativo);
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
  const tipos = ['cpf', 'cnpj', 'cpf_cnpj', 'placa'];
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
      const campo = /^[\w]+$/.test(campoTxt || '') ? campoTxt : (doc === 'placa' ? 'placa' : 'document');
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
        db.prepare(`INSERT INTO produtos (slug, nome, categoria, descricao, documento, endpoint, link, campo, custo_centavos, preco_centavos, ativo, ordem)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,100)`).run(slug, nome, cat, descricao || '', doc, endpoint, endpoint, campo, c, precoDe(c), temCusto ? 1 : 0);
        criadas++;
        if (!temCusto) inativas++;
      }
    });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  const resultado = `${criadas} consulta(s) criada(s) e ${atualizadas} atualizada(s). ${inativas} ficaram inativas aguardando o custo: edite e informe o custo para ativar.`;
  pagina(res, 'Admin · Importar', PD.adminImportar({ texto: erros.length ? texto : '', resultado, erro: erros.slice(0, 15).join(' ') }), usuario);
}));

rota('GET', '/admin/config', exigeAdmin(({ res, usuario, url }) => pagina(res, 'Admin · Configurações', PD.adminConfig({
  minimo: Number(lerConfig('recarga_minima_centavos')), faixas: faixasBonus(), markup: lerConfig('markup_percentual'), ok: url.searchParams.get('ok') ? 'Configurações salvas e preços recalculados.' : '',
}), usuario)));

rota('POST', '/admin/config', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const minimo = centavos(f.minimo), markup = Number(String(f.markup || '').replace(',', '.'));
  const erro = (m) => pagina(res, 'Admin · Configurações', PD.adminConfig({ minimo: Number(lerConfig('recarga_minima_centavos')), faixas: faixasBonus(), markup: lerConfig('markup_percentual'), erro: m }), usuario, 400);
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
  gravarConfig('bonus_faixas', JSON.stringify(faixas.sort((a, b) => a.a_partir_de - b.a_partir_de)));
  recalcularPrecos();
  redirecionar(res, '/admin/config?ok=1');
}));

rota('GET', '/admin/clientes', exigeAdmin(({ res, usuario, url }) => {
  const busca = url.searchParams.get('busca') || '';
  const t = `%${busca.replace(/[%_]/g, '')}%`;
  const clientes = db.prepare(`SELECT u.*, COALESCE((SELECT SUM(valor_centavos) FROM transacoes WHERE usuario_id = u.id), 0) AS saldo FROM usuarios u
    WHERE ? = '' OR u.nome LIKE ? OR u.email LIKE ? OR u.documento LIKE ? ORDER BY u.id DESC LIMIT 200`).all(busca, t, t, `%${A.soNumeros(busca) || '@@'}%`);
  const ok = url.searchParams.get('ok') ? 'Saldo ajustado.' : '';
  pagina(res, 'Admin · Clientes', PD.adminClientes({ clientes, busca, ok }), usuario);
}));

rota('POST', '/admin/clientes/ajuste', exigeAdmin(async ({ req, res, usuario }) => {
  const f = await corpoForm(req);
  const valor = centavos(f.valor);
  const motivo = String(f.motivo || '').trim().slice(0, 120);
  if (!Number.isFinite(valor) || valor === 0 || !motivo || !db.prepare('SELECT 1 FROM usuarios WHERE id = ?').get(Number(f.id))) return redirecionar(res, '/admin/clientes');
  db.prepare("INSERT INTO transacoes (usuario_id, tipo, valor_centavos, descricao) VALUES (?, 'ajuste', ?, ?)").run(Number(f.id), valor, `Ajuste: ${motivo} (por ${usuario.email})`);
  redirecionar(res, '/admin/clientes?ok=1');
}));

rota('GET', '/admin/consultas', exigeAdmin(({ res, usuario }) => pagina(res, 'Admin · Consultas feitas', PD.adminConsultas({
  consultas: db.prepare('SELECT c.*, u.nome AS cliente FROM consultas c JOIN usuarios u ON u.id = c.usuario_id ORDER BY c.id DESC LIMIT 300').all(),
}), usuario)));

rota('GET', '/admin/recargas', exigeAdmin(({ res, usuario }) => pagina(res, 'Admin · Recargas', PD.adminRecargas({
  recargas: db.prepare('SELECT r.*, u.nome AS cliente FROM recargas r JOIN usuarios u ON u.id = r.usuario_id ORDER BY r.id DESC LIMIT 300').all(),
}), usuario)));

// ======================= TERMOS E PRIVACIDADE =======================
rota('GET', '/termos', ({ res, usuario }) => pagina(res, 'Termos de uso', P.paginaTexto('Termos de uso', TERMOS), usuario));
rota('GET', '/privacidade', ({ res, usuario }) => pagina(res, 'Privacidade', P.paginaTexto('Política de privacidade', PRIVACIDADE), usuario));


rota('GET', '/saude', ({ res }) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); });

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
servidor.listen(porta, () => console.log(`Soft Consultas no ar na porta ${porta}`));
