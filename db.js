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
// Anúncios: versão para celular, plano vendido, exclusividade e contato do anunciante
for (const [c, def] of [['imagem_mobile', 'TEXT'], ['plano', "TEXT NOT NULL DEFAULT ''"], ['exclusivo', 'INTEGER NOT NULL DEFAULT 0'], ['contato', "TEXT NOT NULL DEFAULT ''"]]) {
  if (!colunas('anuncios').includes(c)) db.exec(`ALTER TABLE anuncios ADD COLUMN ${c} ${def}`);
}
// Monitoramento de CPF/CNPJ (assinatura)
db.exec(`
  CREATE TABLE IF NOT EXISTS monitoramentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    documento TEXT NOT NULL,
    plano TEXT NOT NULL DEFAULT 'mensal',
    forma TEXT NOT NULL DEFAULT 'pix',
    valor_centavos INTEGER NOT NULL,
    asaas_sub_id TEXT,
    pagamento_atual TEXT,
    link_pagamento TEXT,
    pix_codigo TEXT,
    pix_imagem TEXT,
    status TEXT NOT NULL DEFAULT 'aguardando',
    ativo_ate TEXT,
    proxima_checagem TEXT,
    ultima_checagem TEXT,
    ultimo_resumo TEXT,
    ultima_consulta_id INTEGER,
    checagens INTEGER NOT NULL DEFAULT 0,
    pagamentos INTEGER NOT NULL DEFAULT 0,
    aceite_em TEXT,
    aceite_ip TEXT,
    cancelado_em TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_mon_usuario ON monitoramentos(usuario_id);
  CREATE INDEX IF NOT EXISTS idx_mon_sub ON monitoramentos(asaas_sub_id);
`);
// Raio-X do CPF: venda avulsa, sem conta (o cliente recebe o PDF direto no e-mail)
db.exec(`
  CREATE TABLE IF NOT EXISTS raiox_pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    nome TEXT NOT NULL,
    email TEXT NOT NULL,
    whatsapp TEXT,
    documento TEXT NOT NULL,
    valor_centavos INTEGER NOT NULL,
    forma TEXT NOT NULL DEFAULT 'pix',
    asaas_id TEXT,
    pix_codigo TEXT,
    pix_imagem TEXT,
    link_pagamento TEXT,
    status TEXT NOT NULL DEFAULT 'pendente',
    pago_em TEXT,
    entregue_em TEXT,
    consulta_id INTEGER,
    resumo TEXT,
    erro TEXT,
    tentativas INTEGER NOT NULL DEFAULT 0,
    downloads INTEGER NOT NULL DEFAULT 0,
    aceite_ip TEXT,
    origem TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_rx_asaas ON raiox_pedidos(asaas_id);
`);
// Meta (API de Conversões): cookies do pixel e navegador de quem comprou, para o servidor avisar a compra
db.exec(`CREATE TABLE IF NOT EXISTS rastreio_meta (
  chave TEXT PRIMARY KEY, fbp TEXT, fbc TEXT, ip TEXT, ua TEXT, url TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
)`);
// Raio-X: data em que o e-mail com o PDF saiu (os já entregues antes desta coluna contam como enviados)
if (!colunas('raiox_pedidos').includes('email_enviado_em')) {
  db.exec('ALTER TABLE raiox_pedidos ADD COLUMN email_enviado_em TEXT');
  db.exec('UPDATE raiox_pedidos SET email_enviado_em = entregue_em WHERE entregue_em IS NOT NULL');
}
// Produtos digitais (ebook)
db.exec(`
  CREATE TABLE IF NOT EXISTS compras_digitais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    produto TEXT NOT NULL,
    valor_centavos INTEGER NOT NULL,
    forma TEXT NOT NULL DEFAULT 'pix',
    asaas_id TEXT,
    pix_codigo TEXT,
    pix_imagem TEXT,
    link_pagamento TEXT,
    status TEXT NOT NULL DEFAULT 'pendente',
    pago_em TEXT,
    downloads INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_cd_usuario ON compras_digitais(usuario_id);
`);
for (const [c, def] of [['documento', 'TEXT'], ['consulta_id', 'INTEGER'], ['entregue_em', 'TEXT'], ['erro', 'TEXT'], ['resumo', 'TEXT'], ['tentativas', 'INTEGER NOT NULL DEFAULT 0']]) {
  if (!colunas('compras_digitais').includes(c)) db.exec(`ALTER TABLE compras_digitais ADD COLUMN ${c} ${def}`);
}
export const pastaProdutos = path.join(pasta, 'produtos');
try { mkdirSync(pastaProdutos, { recursive: true }); } catch {}
// Origem do cliente (campanhas de tráfego pago)
if (!colunas('usuarios').includes('origem')) db.exec("ALTER TABLE usuarios ADD COLUMN origem TEXT NOT NULL DEFAULT ''");
if (!colunas('usuarios').includes('utm_source')) db.exec("ALTER TABLE usuarios ADD COLUMN utm_source TEXT NOT NULL DEFAULT ''");
if (!colunas('usuarios').includes('utm_medium')) db.exec("ALTER TABLE usuarios ADD COLUMN utm_medium TEXT NOT NULL DEFAULT ''");
if (!colunas('usuarios').includes('utm_campaign')) db.exec("ALTER TABLE usuarios ADD COLUMN utm_campaign TEXT NOT NULL DEFAULT ''");
if (!colunas('usuarios').includes('utm_content')) db.exec("ALTER TABLE usuarios ADD COLUMN utm_content TEXT NOT NULL DEFAULT ''");
if (!colunas('usuarios').includes('pagina_entrada')) db.exec("ALTER TABLE usuarios ADD COLUMN pagina_entrada TEXT NOT NULL DEFAULT ''");
// Conta interna: usa o saldo da APIFull e consulta a preço de custo (como o admin), sem acesso ao painel administrativo
// Margem própria por consulta (vazia = usa a margem geral)
if (!colunas('produtos').includes('markup_percentual')) db.exec('ALTER TABLE produtos ADD COLUMN markup_percentual REAL');
if (!colunas('usuarios').includes('interno')) db.exec('ALTER TABLE usuarios ADD COLUMN interno INTEGER NOT NULL DEFAULT 0');
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
// Taxa cobrada no saque de comissão (o Pix enviado é o valor menos a taxa)
// Repasse automático de parceiro (Pix sai sozinho quando o cliente paga)
for (const [c, def] of [['automatico', 'INTEGER NOT NULL DEFAULT 0'], ['pedido_id', 'INTEGER'], ['liberar_em', 'TEXT'], ['tentativas', 'INTEGER NOT NULL DEFAULT 0']]) {
  if (!colunas('saques').includes(c)) db.exec(`ALTER TABLE saques ADD COLUMN ${c} ${def}`);
}
if (!colunas('saques').includes('taxa_centavos')) db.exec('ALTER TABLE saques ADD COLUMN taxa_centavos INTEGER NOT NULL DEFAULT 0');
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
// Repasse automático para a APIFull (parte de cada recarga paga vira saldo na APIFull)
db.exec(`
  CREATE TABLE IF NOT EXISTS repasses_apifull (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    valor_centavos INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'processando',
    recargas TEXT NOT NULL DEFAULT '',
    apifull_ref TEXT,
    asaas_id TEXT,
    erro TEXT,
    origem TEXT NOT NULL DEFAULT 'automatico',
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    pago_em TEXT
  );
`);
if (!colunas('recargas').includes('repasse_id')) db.exec('ALTER TABLE recargas ADD COLUMN repasse_id INTEGER');
// E-mails automáticos (sequência para quem ainda não recarregou)
db.exec(`
  CREATE TABLE IF NOT EXISTS emails_enviados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    etapa TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'enviado',
    erro TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_email_etapa ON emails_enviados(usuario_id, etapa);
`);
if (!colunas('usuarios').includes('aceita_emails')) db.exec('ALTER TABLE usuarios ADD COLUMN aceita_emails INTEGER NOT NULL DEFAULT 1');
// Serviço de Limpa Nome (pedido pago por Pix, enviado em lote semanal)
db.exec(`
  CREATE TABLE IF NOT EXISTS limpa_nome_pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    nome TEXT NOT NULL,
    cpf TEXT NOT NULL,
    nascimento TEXT NOT NULL DEFAULT '',
    telefone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    doc_tipo TEXT NOT NULL DEFAULT '',
    doc_frente TEXT,
    doc_verso TEXT,
    titular_proprio INTEGER NOT NULL DEFAULT 1,
    aceite_em TEXT,
    aceite_ip TEXT,
    valor_centavos INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'aguardando_pagamento',
    lote TEXT,
    asaas_id TEXT,
    pix_codigo TEXT,
    pix_imagem TEXT,
    link_pagamento TEXT,
    obs_admin TEXT,
    docs_apagados INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    pago_em TEXT,
    atualizado_em TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_lnp_usuario ON limpa_nome_pedidos(usuario_id);
  CREATE INDEX IF NOT EXISTS idx_lnp_lote ON limpa_nome_pedidos(lote);
`);
for (const [c, def] of [['forma_pagamento', "TEXT NOT NULL DEFAULT 'pix'"], ['parcelas', 'INTEGER NOT NULL DEFAULT 1'], ['asaas_parcelamento', 'TEXT'], ['juros_centavos', 'INTEGER NOT NULL DEFAULT 0'], ['antecipacao_id', 'TEXT'], ['antecipacao_status', 'TEXT'], ['antecipacao_erro', 'TEXT'], ['antecipacao_liquido_centavos', 'INTEGER'], ['antecipacao_tentativas', 'INTEGER NOT NULL DEFAULT 0'], ['baixas', "TEXT NOT NULL DEFAULT '{}'"], ['blindagem_ate', 'TEXT'], ['concluido_em', 'TEXT']]) {
  if (!colunas('limpa_nome_pedidos').includes(c)) db.exec(`ALTER TABLE limpa_nome_pedidos ADD COLUMN ${c} ${def}`);
}
// Área de parceiros (Limpa Nome): o parceiro cadastra clientes e ganha comissão (cliente paga) ou paga o preço de atacado
for (const [c, def] of [['parceiro_id', 'INTEGER'], ['parceiro_modelo', 'TEXT'], ['parceiro_comissao_centavos', 'INTEGER NOT NULL DEFAULT 0'], ['token', 'TEXT'], ['preco_venda_centavos', 'INTEGER'], ['servico', "TEXT NOT NULL DEFAULT 'limpa_nome'"], ['combo_de', 'INTEGER'], ['cliente_aceite_em', 'TEXT'], ['cliente_aceite_ip', 'TEXT']]) {
  if (!colunas('limpa_nome_pedidos').includes(c)) db.exec(`ALTER TABLE limpa_nome_pedidos ADD COLUMN ${c} ${def}`);
}
if (!colunas('usuarios').includes('exclusao_solicitada_em')) db.exec('ALTER TABLE usuarios ADD COLUMN exclusao_solicitada_em TEXT');
if (!colunas('usuarios').includes('parceiro')) db.exec('ALTER TABLE usuarios ADD COLUMN parceiro INTEGER NOT NULL DEFAULT 0');
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_lnp_parceiro ON limpa_nome_pedidos(parceiro_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_lnp_token ON limpa_nome_pedidos(token) WHERE token IS NOT NULL;
  CREATE TABLE IF NOT EXISTS parceiros (
    usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id),
    ativo INTEGER NOT NULL DEFAULT 1,
    comissao_tipo TEXT,
    comissao_valor INTEGER,
    atacado_centavos INTEGER,
    obs TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT
  );
`);
// Mensalidade do parceiro (assinatura no Asaas)
for (const [c, def] of [['repasse_auto', 'INTEGER NOT NULL DEFAULT 0'], ['repasse_pix', 'TEXT'], ['mostrar_nome', 'INTEGER NOT NULL DEFAULT 0'], ['preco_minimo_centavos', 'INTEGER'], ['preco_centavos', 'INTEGER'], ['valores_servicos', "TEXT NOT NULL DEFAULT '{}'"], ['mensalidade_centavos', 'INTEGER'], ['isento', 'INTEGER NOT NULL DEFAULT 0'], ['assinatura_id', 'TEXT'], ['assinatura_forma', 'TEXT'], ['assinatura_link', 'TEXT'], ['pago_ate', 'TEXT'], ['ultimo_pagamento', 'TEXT']]) {
  if (!colunas('parceiros').includes(c)) db.exec(`ALTER TABLE parceiros ADD COLUMN ${c} ${def}`);
}
// White label do parceiro: marca própria, página de vendas e recebimento na subconta Asaas dele (com split da nossa parte)
for (const [c, def] of [['marca_ativa', 'INTEGER NOT NULL DEFAULT 0'], ['marca_nome', 'TEXT'], ['marca_logo', 'TEXT'], ['marca_cor', 'TEXT'], ['marca_whatsapp', 'TEXT'], ['marca_email', 'TEXT'],
  ['marca_slug', 'TEXT'], ['marca_precos', "TEXT NOT NULL DEFAULT '{}'"], ['marca_texto', 'TEXT'],
  ['sub_dados', 'TEXT'], ['sub_id', 'TEXT'], ['sub_wallet', 'TEXT'], ['sub_chave', 'TEXT'], ['sub_status', 'TEXT'], ['sub_criada_em', 'TEXT'], ['sub_aprovada_em', 'TEXT'], ['sub_erro', 'TEXT'], ['sub_webhook', 'INTEGER NOT NULL DEFAULT 0']]) {
  if (!colunas('parceiros').includes(c)) db.exec(`ALTER TABLE parceiros ADD COLUMN ${c} ${def}`);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_parc_slug ON parceiros(marca_slug) WHERE marca_slug IS NOT NULL');
for (const [c, def] of [['asaas_sub', 'INTEGER'], ['split_centavos', 'INTEGER'], ['origem_pagina', 'INTEGER NOT NULL DEFAULT 0']]) {
  if (!colunas('limpa_nome_pedidos').includes(c)) db.exec(`ALTER TABLE limpa_nome_pedidos ADD COLUMN ${c} ${def}`);
}
// Ficha cadastral do Rating Bancário (dados do cliente; a senha do Serasa fica criptografada)
db.exec(`
  CREATE TABLE IF NOT EXISTS rating_fichas (
    pedido_id INTEGER PRIMARY KEY REFERENCES limpa_nome_pedidos(id),
    dados TEXT NOT NULL DEFAULT '{}',
    senha_cript TEXT,
    selfie TEXT,
    doc_extra TEXT,
    preenchido_por TEXT,
    apagado INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT
  );
`);
// Adesão à área de parceiros (taxa única paga pelo próprio cliente)
db.exec(`
  CREATE TABLE IF NOT EXISTS parceiro_adesoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    valor_centavos INTEGER NOT NULL,
    forma TEXT NOT NULL DEFAULT 'pix',
    parcelas INTEGER NOT NULL DEFAULT 1,
    asaas_id TEXT,
    asaas_parcelamento TEXT,
    pix_codigo TEXT,
    pix_imagem TEXT,
    link_pagamento TEXT,
    status TEXT NOT NULL DEFAULT 'pendente',
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    pago_em TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_adesao_usuario ON parceiro_adesoes(usuario_id);
`);
// Aparelhos do aplicativo (para notificações push)
db.exec(`
  CREATE TABLE IF NOT EXISTS app_dispositivos (
    token TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    plataforma TEXT NOT NULL DEFAULT '',
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_appdisp_usuario ON app_dispositivos(usuario_id);
`);
export const pastaDocsLimpaNome = path.join(pasta, 'limpa-nome-docs');
try { mkdirSync(pastaDocsLimpaNome, { recursive: true }); } catch {}
export const registrar = (usuario, acao, detalhe = '') =>
  db.prepare('INSERT INTO registro_admin (admin_email, acao, detalhe) VALUES (?, ?, ?)').run(usuario?.email || 'sistema', acao, String(detalhe).slice(0, 1000));

export const saldoComissao = (usuarioId) =>
  db.prepare('SELECT COALESCE(SUM(valor_centavos), 0) AS s FROM comissoes WHERE usuario_id = ?').get(usuarioId).s;

// Configurações padrão (editáveis no admin)
const padrao = {
  recarga_minima_centavos: '3000',
  recarga_maxima_centavos: '100000',
  markup_percentual: '150',
  dias_historico: '10',
  bonus_primeira_percentual: '20',
  bonus_primeira_minimo_centavos: '5000',
  bonus_primeira_ate: '2026-12-05',
  comissao_maxima: '100',
  alerta_saldo_apifull_centavos: '5000',
  saque_minimo_centavos: '5000',
  saque_taxa_percentual: '5',
  repasse_ativo: '0',
  repasse_percentual: '20',
  repasse_minimo_centavos: '5000',
  repasse_desde: '',
  aviso_geral: '',
  consultas_pausadas: '0',
  emails_ativo: '0',
  emails_limite_diario: '80',
  emails_pausa_ate: '',
  campanhas_fila: '[]',
  anuncio_planos: JSON.stringify([
    { k: 'semanal', n: 'Semanal', dias: 7, v: 14900 },
    { k: 'mensal', n: 'Mensal', dias: 30, v: 39700 },
    { k: 'trimestral', n: 'Trimestral', dias: 90, v: 99700 },
    { k: 'exclusivo', n: 'Destaque exclusivo (sem rotação)', dias: 30, v: 79700, exclusivo: true },
  ]),
  anuncio_arte_centavos: '9700',
  anuncio_max_simultaneos: '4',
  anuncio_mostrar_numeros: '0',
  raiox_ativo: '0',
  parceiro_comissao_tipo: 'percentual',
  parceiro_comissao_valor: '20',
  parceiro_atacado_centavos: '',
  parceiro_mensalidade_centavos: '9900',
  parceiro_adesao_centavos: '99900',
  parceiro_preco_centavos: '150000',
  parceiro_preco_minimo_centavos: '100000',
  // Rating bancário (venda direta) e combo Limpa Nome + Rating
  rtg_ativo: '0',
  rtg_preco_centavos: '0',
  rtg_prazo: 'Acompanhamento de 90 dias',
  rtg_resumo: '',
  cmb_preco_centavos: '0',
  // Parceiros: rating e combo (preço sugerido ao cliente, comissão e atacado)
  parceiro_rating_preco_centavos: '',
  parceiro_rating_comissao_tipo: 'percentual',
  parceiro_rating_comissao_valor: '20',
  parceiro_rating_atacado_centavos: '',
  parceiro_combo_preco_centavos: '',
  parceiro_combo_comissao_tipo: 'percentual',
  parceiro_combo_comissao_valor: '20',
  parceiro_combo_atacado_centavos: '',
  raiox_preco: '3790',
  raiox_preco_de: '',
  raiox_produto: 'cred-completa-plus',
  ebook_ativo: '0',
  ebook_preco: '2700',
  ebook_preco_de: '4700',
  ebook_arquivo: '',
  mon_ativo: '0',
  mon_preco_mensal: '1490',
  mon_preco_anual: '12900',
  mon_produto: 'cred-completa-plus',
  mon_frequencia_dias: '30',
  mon_queda_score: '50',
  lns_ativo: '0',
  lns_preco_centavos: '129900',
  lns_dia_lote: '5',
  lns_prazo: 'Nome limpo em até 30 dias',
  lns_parcelas: '10',
  lns_juros_mensal: '2.99',
  lns_antecipar: '1',
  lns_executor: '',
  lns_garantia: 'Garantimos a retirada das negativações abrangidas pela ação nos órgãos de proteção ao crédito (nome limpo), com blindagem de 6 meses: se alguma dessas negativações voltar nesse período, reprotocolamos sem custo. Não garantimos a aprovação de crédito, que depende da análise de cada empresa.',
  lns_blindagem_meses: '6',
  lns_resumo: '',
  lns_video: '',
  lns_whatsapp: '5547997400955',
  lns_atendimento: 'Segunda a sexta, das 9h às 18h',
  emails_desde: '',
  emails_etapas: 'd1,d3,d7',
  bonus_faixas: JSON.stringify([{ a_partir_de: 10000, percentual: 5 }, { a_partir_de: 30000, percentual: 10 }]),
};
for (const [k, v] of Object.entries(padrao)) db.prepare('INSERT OR IGNORE INTO config (chave, valor) VALUES (?, ?)').run(k, v);
// Limpa Nome: textos da ação judicial coletiva (só troca o que ainda está no padrão antigo ou vazio; o que o admin editou fica)
{
  const troca = (k, antigo, novo) => db.prepare('UPDATE config SET valor = ? WHERE chave = ? AND valor = ?').run(novo, k, antigo);
  troca('lns_prazo', 'Nome limpo em até 15 dias', 'Nome limpo em até 30 dias');
  troca('lns_garantia', 'Garantimos a retirada das negativações do seu nome nos órgãos de proteção ao crédito (nome limpo). Não garantimos a aprovação de crédito, que depende da análise de cada empresa.', 'Garantimos a retirada das negativações abrangidas pela ação nos órgãos de proteção ao crédito (nome limpo), com blindagem de 6 meses: se alguma dessas negativações voltar nesse período, reprotocolamos sem custo. Não garantimos a aprovação de crédito, que depende da análise de cada empresa.');
  troca('lns_garantia', '', 'Garantimos a retirada das negativações abrangidas pela ação nos órgãos de proteção ao crédito (nome limpo), com blindagem de 6 meses: se alguma dessas negativações voltar nesse período, reprotocolamos sem custo. Não garantimos a aprovação de crédito, que depende da análise de cada empresa.');
}
export const lerConfig = (k) => db.prepare('SELECT valor FROM config WHERE chave = ?').get(k)?.valor;
export const gravarConfig = (k, v) => db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(k, String(v));

// Preço de venda = custo + markup (padrão 150%, ou seja, custo x 2,5)
export const precoDe = (custoCentavos, markup = Number(db.prepare("SELECT valor FROM config WHERE chave = 'markup_percentual'").get()?.valor ?? 150)) =>
  Math.round(Number(custoCentavos) * (1 + markup / 100));
export function recalcularPrecos() {
  const m = Number(lerConfig('markup_percentual') ?? 150);
  const temColuna = db.prepare('PRAGMA table_info(produtos)').all().some((c) => c.name === 'markup_percentual');
  for (const p of db.prepare(`SELECT id, custo_centavos${temColuna ? ', markup_percentual' : ''} FROM produtos`).all()) {
    const mk = p.markup_percentual !== null && p.markup_percentual !== undefined ? Number(p.markup_percentual) : m;
    db.prepare('UPDATE produtos SET preco_centavos = ? WHERE id = ?').run(precoDe(p.custo_centavos, mk), p.id);
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
