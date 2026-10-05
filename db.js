// Banco de dados (SQLite embutido no Node 22, salvo no disco persistente do Render)
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const pasta = process.env.DATA_DIR || './dados';
mkdirSync(pasta, { recursive: true });
export const db = new DatabaseSync(path.join(pasta, 'softconsultas.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    documento TEXT NOT NULL,
    telefone TEXT NOT NULL,
    senha_hash TEXT NOT NULL,
    admin INTEGER NOT NULL DEFAULT 0,
    ativo INTEGER NOT NULL DEFAULT 1,
    aceite_termos TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessoes (
    token_hash TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira_em TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS redefinicoes_senha (
    token_hash TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira_em TEXT NOT NULL,
    usado INTEGER NOT NULL DEFAULT 0
  );

  -- Carteira: cada movimento é uma linha; o saldo é a soma (valores em centavos)
  CREATE TABLE IF NOT EXISTS transacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('recarga', 'consulta', 'estorno', 'ajuste')),
    valor_centavos INTEGER NOT NULL,
    descricao TEXT NOT NULL,
    referencia TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_transacao_ref ON transacoes(tipo, referencia) WHERE referencia IS NOT NULL;

  -- Histórico de consultas (preenchido na etapa 3)
  CREATE TABLE IF NOT EXISTS consultas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    produto TEXT NOT NULL,
    parametro TEXT NOT NULL,
    finalidade TEXT,
    status TEXT NOT NULL,
    preco_centavos INTEGER NOT NULL,
    custo_centavos INTEGER,
    resultado TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS produtos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    nome TEXT NOT NULL,
    categoria TEXT NOT NULL,
    descricao TEXT NOT NULL DEFAULT '',
    documento TEXT NOT NULL DEFAULT 'cpf_cnpj' CHECK (documento IN ('cpf', 'cnpj', 'cpf_cnpj', 'placa')),
    endpoint TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    campo TEXT NOT NULL DEFAULT 'document',
    preco_centavos INTEGER NOT NULL,
    custo_centavos INTEGER NOT NULL DEFAULT 0,
    ativo INTEGER NOT NULL DEFAULT 0,
    ordem INTEGER NOT NULL DEFAULT 100
  );

  CREATE TABLE IF NOT EXISTS recargas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    valor_centavos INTEGER NOT NULL,
    bonus_centavos INTEGER NOT NULL DEFAULT 0,
    asaas_id TEXT,
    pix_codigo TEXT,
    pix_imagem TEXT,
    link_pagamento TEXT,
    status TEXT NOT NULL DEFAULT 'pendente',
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    pago_em TEXT
  );
`);

// Colunas novas em tabelas antigas
const colunas = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
if (!colunas('usuarios').includes('asaas_cliente_id')) db.exec('ALTER TABLE usuarios ADD COLUMN asaas_cliente_id TEXT');
if (!colunas('consultas').includes('produto_id')) db.exec('ALTER TABLE consultas ADD COLUMN produto_id INTEGER');
if (!colunas('consultas').includes('pdf_origem')) db.exec('ALTER TABLE consultas ADD COLUMN pdf_origem TEXT');
if (!colunas('consultas').includes('erro')) db.exec('ALTER TABLE consultas ADD COLUMN erro TEXT');

// Configurações padrão (editáveis no admin)
const padrao = {
  recarga_minima_centavos: '3000',
  markup_percentual: '150',
  bonus_faixas: JSON.stringify([{ a_partir_de: 10000, percentual: 5 }, { a_partir_de: 30000, percentual: 10 }]),
};
for (const [k, v] of Object.entries(padrao)) db.prepare('INSERT OR IGNORE INTO config (chave, valor) VALUES (?, ?)').run(k, v);
export const lerConfig = (k) => db.prepare('SELECT valor FROM config WHERE chave = ?').get(k)?.valor;
export const gravarConfig = (k, v) => db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(k, String(v));

// Preço de venda = custo + markup (padrão 150%, ou seja, custo x 2,5)
export const precoDe = (custoCentavos, markup = Number(db.prepare("SELECT valor FROM config WHERE chave = 'markup_percentual'").get()?.valor ?? 150)) =>
  Math.round(Number(custoCentavos) * (1 + markup / 100));
export function recalcularPrecos() {
  const m = Number(lerConfig('markup_percentual') ?? 150);
  for (const p of db.prepare('SELECT id, custo_centavos FROM produtos').all()) {
    db.prepare('UPDATE produtos SET preco_centavos = ? WHERE id = ?').run(precoDe(p.custo_centavos, m), p.id);
  }
}

// Catálogo inicial (endpoint vazio = desativado até ser configurado no admin)
if (db.prepare('SELECT COUNT(*) AS n FROM produtos').get().n === 0) {
  const ins = db.prepare(`INSERT INTO produtos (slug, nome, categoria, descricao, documento, endpoint, link, preco_centavos, custo_centavos, ativo, ordem)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const lista = [
    ['cred-completa-plus', 'Cred Completa Plus', 'Dívidas e Crédito', 'Score, rating, negativações, protestos, ações, cheques, cadastro positivo e histórico de consultas.', 'cpf_cnpj', 'e-boavista', 'e-boavista', 1990, 583, 1, 10],
    ['serasa-premium', 'Serasa Premium', 'Dívidas e Crédito', 'Score e negativações Serasa, protestos e cheques sem fundos.', 'cpf_cnpj', '', '', 3490, 1572, 0, 20],
    ['spc-brasil', 'SPC Brasil', 'Dívidas e Crédito', 'Pendências financeiras SPC, ações cíveis, cheques sem fundo e protesto nacional.', 'cpf_cnpj', '', '', 3490, 1788, 0, 30],
    ['scr-score-bacen', 'SCR e Score (BACEN)', 'Dívidas e Crédito', 'Dívidas bancárias registradas no Banco Central e score.', 'cpf_cnpj', '', '', 3490, 1474, 0, 40],
    ['protesto-nacional', 'Protesto Nacional', 'Dívidas e Crédito', 'Protestos em cartório em todo o Brasil.', 'cpf_cnpj', '', '', 1990, 800, 0, 50],
    ['quod-flag-pf', 'QUOD Negativo Flag - Pessoa Física', 'Dívidas e Crédito', 'Indica se o CPF tem negativação, com situação cadastral (QUOD).', 'cpf', '', '', 1490, 681, 0, 60],
    ['cadin', 'CADIN', 'Dívidas e Crédito', 'Dívidas com órgãos federais em tempo real.', 'cpf_cnpj', '', '', 690, 187, 0, 70],
    ['quod-empresa', 'QUOD Consulta - Empresa', 'Empresas', 'Dados cadastrais, contatos, negativações, protestos e score empresarial.', 'cnpj', '', '', 5990, 2979, 0, 80],
  ];
  for (const p of lista) ins.run(...p);
  recalcularPrecos();
}

export const saldoCentavos = (usuarioId) =>
  db.prepare('SELECT COALESCE(SUM(valor_centavos), 0) AS s FROM transacoes WHERE usuario_id = ?').get(usuarioId).s;

// Limpeza periódica de sessões e links vencidos
setInterval(() => {
  db.prepare("DELETE FROM sessoes WHERE expira_em < datetime('now')").run();
  db.prepare("DELETE FROM redefinicoes_senha WHERE expira_em < datetime('now') OR usado = 1").run();
}, 60 * 60 * 1000).unref();
