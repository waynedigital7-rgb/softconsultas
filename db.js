// Banco de dados (SQLite embutido no Node 22, salvo no disco persistente do Render)
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

// Se o DATA_DIR não puder ser usado (ex.: disco não conectado), o site continua no ar numa pasta temporária, com aviso no Admin
let pastaEscolhida = process.env.DATA_DIR || './dados';
let erroDisco = '';
try { mkdirSync(pastaEscolhida, { recursive: true }); }
catch (e) {
  erroDisco = `Não foi possível usar ${pastaEscolhida} (${e.code || e.message}). O disco provavelmente não está conectado ao serviço.`;
  console.error(`ATENÇÃO: ${erroDisco} Usando pasta temporária ./dados.`);
  pastaEscolhida = './dados';
  mkdirSync(pastaEscolhida, { recursive: true });
}
export const pasta = pastaEscolhida;
const pastaJaExistia = existsSync(pasta);
// É um disco montado de verdade? (dispositivo diferente da pasta-mãe)
function ehDiscoMontado(dir) {
  try { return statSync(dir).dev !== statSync(path.dirname(path.resolve(dir))).dev; } catch { return false; }
}
export const armazenamento = {
  pasta: path.resolve(pasta),
  definido: !!process.env.DATA_DIR,
  pastaJaExistia,
  montado: ehDiscoMontado(pasta),
};
// No Render (variável RENDER=true), só é seguro se o DATA_DIR apontar para um disco montado
armazenamento.erro = erroDisco;
armazenamento.persistente = !erroDisco && (process.env.RENDER ? armazenamento.definido && armazenamento.montado : true);
export const pastaPdfs = path.join(pasta, 'pdfs');
mkdirSync(pastaPdfs, { recursive: true });
export const pastaAnuncios = path.join(pasta, 'anuncios');
mkdirSync(pastaAnuncios, { recursive: true });
export const db = new DatabaseSync(path.join(pasta, 'softconsultas.db'));

// ---------- Backups (cópia completa do banco, sem parar o sistema) ----------
export const pastaBackups = path.join(pasta, 'backups');
mkdirSync(pastaBackups, { recursive: true });
const MANTER_BACKUPS = 30;
export function fazerBackup(motivo = 'manual') {
  const tabelas = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='usuarios'").get().n;
  if (!tabelas) return null; // banco novo, nada para guardar
  const carimbo = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const nome = `backup-${carimbo}-${motivo.replace(/[^a-z0-9-]/gi, '')}.db`;
  const destino = path.join(pastaBackups, nome);
  db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  // Mantém só os mais recentes
  const lista = readdirSync(pastaBackups).filter((f) => f.endsWith('.db')).sort();
  for (const antigo of lista.slice(0, Math.max(0, lista.length - MANTER_BACKUPS))) {
    try { unlinkSync(path.join(pastaBackups, antigo)); } catch {}
  }
  return nome;
}
export const listarBackups = () => readdirSync(pastaBackups).filter((f) => f.endsWith('.db')).sort().reverse()
  .map((f) => ({ nome: f, tamanho: statSync(path.join(pastaBackups, f)).size, data: statSync(path.join(pastaBackups, f)).mtime }));

// Toda inicialização (ou seja, toda atualização do site) faz uma cópia ANTES de qualquer ajuste no banco
try { const b = fazerBackup('antes-da-atualizacao'); if (b) console.log(`Backup automático criado: ${b}`); }
catch (e) { console.error('Falha no backup inicial:', e.message); }

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
    documento TEXT NOT NULL DEFAULT 'cpf_cnpj' CHECK (documento IN ('cpf', 'cnpj', 'cpf_cnpj', 'placa', 'cep')),
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

// Migração: permitir o tipo 'cep' em bancos criados antes dessa opção
const sqlProdutos = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='produtos'").get()?.sql || '';
if (sqlProdutos && !sqlProdutos.includes("'cep'")) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(sqlProdutos.replace(/CREATE TABLE "?produtos"?/, 'CREATE TABLE produtos_novo').replace("'placa'))", "'placa', 'cep'))"));
    db.exec('INSERT INTO produtos_novo SELECT * FROM produtos');
    db.exec('DROP TABLE produtos');
    db.exec('ALTER TABLE produtos_novo RENAME TO produtos');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; } finally { db.exec('PRAGMA foreign_keys = ON'); }
}

// Colunas novas em tabelas antigas
const colunas = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
if (!colunas('usuarios').includes('asaas_cliente_id')) db.exec('ALTER TABLE usuarios ADD COLUMN asaas_cliente_id TEXT');
if (!colunas('consultas').includes('produto_id')) db.exec('ALTER TABLE consultas ADD COLUMN produto_id INTEGER');
if (!colunas('consultas').includes('pdf_origem')) db.exec('ALTER TABLE consultas ADD COLUMN pdf_origem TEXT');
if (!colunas('consultas').includes('erro')) db.exec('ALTER TABLE consultas ADD COLUMN erro TEXT');
// Consultas sensíveis (dados que permitem localizar/expor pessoas)
if (!colunas('produtos').includes('sensivel')) {
  db.exec('ALTER TABLE produtos ADD COLUMN sensivel INTEGER NOT NULL DEFAULT 0');
  db.exec(`UPDATE produtos SET sensivel = 1 WHERE lower(nome) GLOB '*mandado*' OR lower(nome) GLOB '*antecedente*' OR lower(nome) GLOB '*pessoas relacionadas*'
    OR lower(nome) GLOB '*endere*' OR lower(nome) GLOB '*telefone*' OR lower(nome) GLOB '*celular*' OR lower(nome) GLOB '*cpf completo*' OR lower(nome) GLOB '*e-mail*'
    OR lower(nome) GLOB '*parente*' OR lower(nome) GLOB '*grafo*' OR lower(nome) GLOB '*contato*' OR lower(nome) GLOB '*localiza*' OR lower(nome) GLOB '*veículos por cpf*'
    OR lower(nome) GLOB '*radar*' OR lower(nome) GLOB '*rastreamento*'`);
}
// Área Limpa Nome: destaque 'economica' ou 'completa'
if (!colunas('produtos').includes('destaque_limpa_nome')) {
  db.exec("ALTER TABLE produtos ADD COLUMN destaque_limpa_nome TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE produtos SET destaque_limpa_nome = 'economica' WHERE endpoint IN ('e-boavista', 'ap-boavista', 'r-cadastrais-score-dividas', 'cadin', 'protesto-nacional', 'cp-cadastrais-score-dividas')");
  db.exec("UPDATE produtos SET destaque_limpa_nome = 'completa' WHERE endpoint IN ('serasa-premium', 'serasa-premium-v2', 'spc-brasil', 'scr-premium', 'bacen', 'pf-credito-completo', 'credito-positivo')");
}
// Anúncios (banner da página inicial)
db.exec(`
  CREATE TABLE IF NOT EXISTS anuncios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anunciante TEXT NOT NULL,
    titulo TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    imagem TEXT NOT NULL,
    ativo INTEGER NOT NULL DEFAULT 1,
    inicio TEXT,
    fim TEXT,
    impressoes INTEGER NOT NULL DEFAULT 0,
    cliques INTEGER NOT NULL DEFAULT 0,
    valor_centavos INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
// Origem do cliente (campanhas de tráfego pago)
if (!colunas('usuarios').includes('origem')) db.exec("ALTER TABLE usuarios ADD COLUMN origem TEXT NOT NULL DEFAULT ''");
if (!colunas('usuarios').includes('utm_source')) db.exec("ALTER TABLE usuarios ADD COLUMN utm_source TEXT NOT NULL DEFAULT ''");
if (!colunas('usuarios').includes('utm_medium')) db.exec("ALTER TABLE usuarios ADD COLUMN utm_medium TEXT NOT NULL DEFAULT ''");
if (!colunas('usuarios').includes('utm_campaign')) db.exec("ALTER TABLE usuarios ADD COLUMN utm_campaign TEXT NOT NULL DEFAULT ''");
if (!colunas('usuarios').includes('utm_content')) db.exec("ALTER TABLE usuarios ADD COLUMN utm_content TEXT NOT NULL DEFAULT ''");
if (!colunas('usuarios').includes('pagina_entrada')) db.exec("ALTER TABLE usuarios ADD COLUMN pagina_entrada TEXT NOT NULL DEFAULT ''");
if (!colunas('usuarios').includes('liberado_sensivel')) db.exec('ALTER TABLE usuarios ADD COLUMN liberado_sensivel INTEGER NOT NULL DEFAULT 0');
// Programa de indicação
if (!colunas('usuarios').includes('codigo_indicacao')) db.exec('ALTER TABLE usuarios ADD COLUMN codigo_indicacao TEXT');
if (!colunas('usuarios').includes('indicado_por')) db.exec('ALTER TABLE usuarios ADD COLUMN indicado_por INTEGER');
if (!colunas('usuarios').includes('comissao_percentual')) db.exec('ALTER TABLE usuarios ADD COLUMN comissao_percentual INTEGER NOT NULL DEFAULT 30');
if (!colunas('usuarios').includes('chave_pix')) db.exec('ALTER TABLE usuarios ADD COLUMN chave_pix TEXT');
if (!colunas('consultas').includes('indicador_id')) db.exec('ALTER TABLE consultas ADD COLUMN indicador_id INTEGER');
if (!colunas('consultas').includes('comissao_centavos')) db.exec('ALTER TABLE consultas ADD COLUMN comissao_centavos INTEGER NOT NULL DEFAULT 0');
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_codigo_indicacao ON usuarios(codigo_indicacao) WHERE codigo_indicacao IS NOT NULL;
  -- Extrato de comissões: créditos (+) por consultas de indicados e débitos (-) por saque ou conversão em créditos
  CREATE TABLE IF NOT EXISTS comissoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('comissao', 'saque', 'conversao', 'estorno_saque')),
    valor_centavos INTEGER NOT NULL,
    descricao TEXT NOT NULL,
    referencia TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_comissao_ref ON comissoes(tipo, referencia) WHERE referencia IS NOT NULL;
  CREATE TABLE IF NOT EXISTS saques (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    valor_centavos INTEGER NOT NULL,
    chave_pix TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'recusado')),
    observacao TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    resolvido_em TEXT
  );
`);
if (!colunas('saques').includes('asaas_transferencia_id')) db.exec('ALTER TABLE saques ADD COLUMN asaas_transferencia_id TEXT');
// Registro de alterações feitas no Admin (auditoria)
db.exec(`
  CREATE TABLE IF NOT EXISTS registro_admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_email TEXT NOT NULL,
    acao TEXT NOT NULL,
    detalhe TEXT NOT NULL DEFAULT '',
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
export const registrar = (usuario, acao, detalhe = '') =>
  db.prepare('INSERT INTO registro_admin (admin_email, acao, detalhe) VALUES (?, ?, ?)').run(usuario?.email || 'sistema', acao, String(detalhe).slice(0, 1000));

export const saldoComissao = (usuarioId) =>
  db.prepare('SELECT COALESCE(SUM(valor_centavos), 0) AS s FROM comissoes WHERE usuario_id = ?').get(usuarioId).s;

// Configurações padrão (editáveis no admin)
const padrao = {
  recarga_minima_centavos: '3000',
  markup_percentual: '150',
  dias_historico: '10',
  comissao_maxima: '100',
  alerta_saldo_apifull_centavos: '5000',
  saque_minimo_centavos: '5000',
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
