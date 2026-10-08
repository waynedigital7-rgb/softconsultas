// Senhas, sessões, limite de tentativas e validações
import crypto from 'node:crypto';
import { db } from './db.js';

// ---------- Senhas (scrypt, nativo do Node) ----------
export function gerarHashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, sal, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}
export function conferirSenha(senha, guardado) {
  const [alg, salHex, hashHex] = String(guardado).split('$');
  if (alg !== 'scrypt' || !salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const hash = crypto.scryptSync(senha, Buffer.from(salHex, 'hex'), esperado.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(hash, esperado);
}

// ---------- Tokens ----------
const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');
const novoToken = () => crypto.randomBytes(32).toString('base64url');

// ---------- Sessões (cookie HttpOnly; no banco só fica o hash) ----------
const DIAS_SESSAO = 30;
export const COOKIE = 'sc_sessao';

export function criarSessao(usuarioId) {
  const token = novoToken();
  db.prepare(`INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?, ?, datetime('now', '+${DIAS_SESSAO} days'))`)
    .run(sha256(token), usuarioId);
  return token;
}
export function usuarioDaSessao(token) {
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.nome, u.email, u.documento, u.telefone, u.admin, u.indicado_por, u.codigo_indicacao, u.comissao_percentual, u.chave_pix, u.liberado_sensivel, u.interno
    FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token_hash = ? AND s.expira_em > datetime('now') AND u.ativo = 1`).get(sha256(token)) || null;
}
export function encerrarSessao(token) {
  if (token) db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(sha256(token));
}
export function encerrarTodasSessoes(usuarioId) {
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(usuarioId);
}
export function cookieSessao(token, seguro) {
  const partes = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${DIAS_SESSAO * 86400}`];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}
export const cookieApagar = (seguro) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${seguro ? '; Secure' : ''}`;

// ---------- Redefinição de senha ----------
export function criarTokenRedefinicao(usuarioId) {
  const token = novoToken();
  db.prepare(`INSERT INTO redefinicoes_senha (token_hash, usuario_id, expira_em) VALUES (?, ?, datetime('now', '+1 hour'))`)
    .run(sha256(token), usuarioId);
  return token;
}
export function usarTokenRedefinicao(token) {
  const linha = db.prepare(`SELECT usuario_id FROM redefinicoes_senha
    WHERE token_hash = ? AND usado = 0 AND expira_em > datetime('now')`).get(sha256(String(token || '')));
  return linha ? linha.usuario_id : null;
}
export function marcarTokenUsado(token) {
  db.prepare('UPDATE redefinicoes_senha SET usado = 1 WHERE token_hash = ?').run(sha256(String(token || '')));
}

// ---------- Limite de tentativas (memória) ----------
const tentativas = new Map();
export function limitar(chave, max, minutos) {
  const agora = Date.now();
  const lista = (tentativas.get(chave) || []).filter((t) => agora - t < minutos * 60000);
  if (lista.length >= max) { tentativas.set(chave, lista); return false; }
  lista.push(agora);
  tentativas.set(chave, lista);
  return true;
}
export const limparLimite = (chave) => tentativas.delete(chave);
setInterval(() => {
  const agora = Date.now();
  for (const [k, l] of tentativas) if (!l.some((t) => agora - t < 3600000)) tentativas.delete(k);
}, 600000).unref();

// ---------- Validações ----------
export const soNumeros = (v = '') => String(v).replace(/\D/g, '');
export function cpfValido(cpf) {
  cpf = soNumeros(cpf);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  for (let t = 9; t < 11; t++) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(cpf[i]) * (t + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(cpf[t])) return false;
  }
  return true;
}
export function cnpjValido(cnpj) {
  cnpj = soNumeros(cnpj);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const calc = (base) => {
    let soma = 0, peso = base.length - 7;
    for (let i = 0; i < base.length; i++) { soma += Number(base[i]) * peso--; if (peso < 2) peso = 9; }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(cnpj.slice(0, 12));
  return cnpj.endsWith(`${d1}${calc(cnpj.slice(0, 12) + d1)}`);
}
export const documentoValido = (d) => (soNumeros(d).length === 11 ? cpfValido(d) : cnpjValido(d));
export const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || ''));

// Código de indicação curto e legível (sem letras/números que se confundem)
export function novoCodigoIndicacao() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (const b of crypto.randomBytes(7)) c += alfabeto[b % alfabeto.length];
  return c;
}
