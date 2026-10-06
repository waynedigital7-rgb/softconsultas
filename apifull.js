// APIFull: execução das consultas e leitura do resultado
export async function consultarApiFull(produto, valor) {
  const r = await fetch(`${process.env.APIFULL_URL || 'https://api.apifull.com.br/api/'}${encodeURIComponent(produto.endpoint)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.APIFULL_TOKEN}`, Accept: '*/*', 'Content-Type': 'application/json' },
    body: JSON.stringify({ [produto.campo || 'document']: valor, link: produto.link || produto.endpoint, pdf: true }),
    signal: AbortSignal.timeout(90000),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok || dados.status !== 'sucesso') {
    const msg = dados.mensagem || dados.message || dados.status || '';
    throw new Error(`APIFull respondeu ${r.status} ${msg}`.trim());
  }
  return dados;
}

// ---------- utilidades ----------
function dinheiro(v) {
  if (typeof v === 'number') return v;
  if (!v) return 0;
  const t = String(v).trim();
  const n = /,\d{1,2}$/.test(t) ? Number(t.replace(/[^\d,-]/g, '').replace(',', '.')) : Number(t.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
export function dataBR(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
}
function acharChave(obj, nome) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (nome in obj) return obj[nome];
  for (const v of Object.values(obj)) {
    const r = acharChave(v, nome);
    if (r !== undefined) return r;
  }
  return undefined;
}
const primeiro = (o, ks) => { for (const k of ks) if (o?.[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return ''; };
const RESTRICOES = /d[eé]bito|^a[cç][oõ]es|cheque|fal[eê]ncia|recupera|devolu|protesto|pend[eê]ncia|negativ/i;

// Linhas legíveis de um JSON qualquer (para o "dados completos")
export function achatar(obj, prefixo = '', out = [], prof = 0) {
  if (prof > 6 || out.length > 400) return out;
  if (Array.isArray(obj)) {
    obj.slice(0, 50).forEach((v, i) => achatar(v, `${prefixo} ${i + 1}`, out, prof + 1));
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
      const rot = k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
      achatar(v, prefixo ? `${prefixo} › ${rot}` : rot, out, prof + 1);
    }
  } else if (obj !== undefined) {
    let v = String(obj);
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) v = dataBR(v);
    if (v === 'true') v = 'Sim';
    if (v === 'false') v = 'Não';
    out.push([prefixo, v]);
  }
  return out;
}

// ---------- PDF da fonte ----------
// Aceita: link no "aux" (padrão da APIFull), PDF embutido em base64, ou qualquer link .pdf na resposta
export function acharPdf(dados) {
  const aux = dados?.aux;
  if (aux && typeof aux.data === 'string') {
    if (/^https:\/\//.test(aux.data)) return aux.data;
    const b64 = aux.data.replace(/^data:application\/pdf;base64,/, '');
    if (b64.startsWith('JVBER')) return `base64:${b64}`;
  }
  let achado = null;
  const procurar = (o, prof = 0) => {
    if (achado || prof > 8 || !o) return;
    if (typeof o === 'string') { if (/^https:\/\/\S+\.pdf(\?\S*)?$/i.test(o)) achado = o; return; }
    if (typeof o === 'object') for (const v of Object.values(o)) procurar(v, prof + 1);
  };
  procurar(dados);
  return achado;
}

// Baixa (ou decodifica) o PDF da fonte. Devolve os bytes ou null.
export async function obterPdf(origem) {
  if (!origem) return null;
  try {
    if (origem.startsWith('base64:')) {
      const b = Buffer.from(origem.slice(7), 'base64');
      return b.subarray(0, 5).toString() === '%PDF-' ? b : null;
    }
    const r = await fetch(origem, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return b.subarray(0, 5).toString() === '%PDF-' ? b : null;
  } catch { return null; }
}

// ---------- análise (semáforo) ----------
export function analisar(dados) {
  const corpo = dados?.dados ?? dados;
  const scs = acharChave(corpo, 'Scores');
  const sc = Array.isArray(scs) ? scs[0] : null;
  let score = sc && sc.score != null && sc.score !== '' ? Number(sc.score) : null;
  if (score === null) {
    const s2 = acharChave(corpo, 'score');
    if (typeof s2 === 'number' || /^\d{1,4}$/.test(String(s2 ?? ''))) score = Number(s2);
  }
  const pagamento = sc?.probabilidade ? Math.round(100 - Number(sc.probabilidade)) : null;

  // Itens de restrição (listas conhecidas)
  const itens = [];
  const coletar = (obj, prof = 0) => {
    if (!obj || typeof obj !== 'object' || prof > 8) return;
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v) && /lista(debitos|protestos|acoes)|pendencias|protestos|negativa/i.test(k) && v.length && typeof v[0] === 'object') {
        const tipo = /protesto/i.test(k) ? 'Protesto' : /acoes/i.test(k) ? 'Ação cível' : 'Pendência financeira';
        for (const x of v) {
          itens.push({
            credor: primeiro(x, ['nomeInformante', 'informante', 'credor', 'nomeCredor', 'razaoSocial', 'empresa', 'nomeCartorio', 'cartorio', 'origem']) || 'Não informado',
            valor: dinheiro(primeiro(x, ['valor', 'valorDebito', 'valorProtesto', 'valorProtestado', 'valorTotal'])),
            data: dataBR(primeiro(x, ['dataOcorrencia', 'dataDebito', 'dataInclusao', 'dataProtesto', 'dataVencimento', 'data'])),
            tipo,
          });
        }
      } else if (v && typeof v === 'object') coletar(v, prof + 1);
    }
  };
  coletar(corpo);

  // Painel de ocorrências (quando a fonte fornece)
  const painelBruto = acharChave(corpo, 'ListaPainelControle');
  const painel = Array.isArray(painelBruto)
    ? painelBruto.map((p) => ({ tipo: p.ocorrencia, total: Number(p.total || 0), restricao: RESTRICOES.test(p.ocorrencia || '') }))
    : [];
  const deb = acharChave(corpo, 'RegistroDeDebitos') || {};
  const prot = acharChave(corpo, 'Protestos');
  const totalValor = dinheiro(deb.valorAcumulado) + dinheiro(prot && !Array.isArray(prot) ? prot.valorTotal : 0) || itens.reduce((s, i) => s + i.valor, 0);
  const qtdRestricoes = painel.filter((p) => p.restricao).reduce((s, p) => s + p.total, 0) || itens.length;
  const cons = acharChave(corpo, 'Consultas');
  const consultasRecentes = Number(cons?.totalConsultas ?? 0);

  const temDadosCredito = score !== null || painel.length > 0 || itens.length > 0;
  let cor = 'verde', titulo = 'Sem restrições encontradas';
  const motivos = [];
  if (qtdRestricoes > 0) { cor = 'vermelho'; titulo = 'Restrições encontradas'; motivos.push(`${qtdRestricoes} ${qtdRestricoes === 1 ? 'restrição' : 'restrições'}${totalValor ? ` somando ${(totalValor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''}`); }
  if (score !== null && score < 500) { if (cor === 'verde') { cor = 'amarelo'; titulo = 'Atenção ao perfil de crédito'; } motivos.push(`score baixo (${score})`); }
  if (consultasRecentes >= 4) { if (cor === 'verde') { cor = 'amarelo'; titulo = 'Atenção ao perfil de crédito'; } motivos.push(`${consultasRecentes} consultas recentes ao documento`); }
  if (!temDadosCredito) { cor = 'neutro'; titulo = 'Consulta concluída'; }

  return {
    cor, titulo, motivos, score, pagamento, rating: sc?.classificacaoAlfabetica || '',
    qtdRestricoes, totalValor, itens, painel, consultasRecentes, temDadosCredito,
    pdfOrigem: acharPdf(dados),
  };
}

// ---------- Saldo da conta na APIFull (GET /api/get-balance) ----------
let cacheSaldo = { em: 0, valor: null };
function numeroEm(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /\d/.test(v)) {
    const n = dinheiro(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function lerSaldo(obj, prof = 0) {
  if (prof > 5 || obj === null || obj === undefined) return null;
  const direto = numeroEm(obj);
  if (direto !== null) return direto;
  if (typeof obj === 'object') {
    for (const k of ['saldo', 'balance', 'creditos', 'credits', 'valor', 'value', 'amount', 'disponivel']) {
      if (k in obj) { const n = lerSaldo(obj[k], prof + 1); if (n !== null) return n; }
    }
    for (const v of Object.values(obj)) { const n = lerSaldo(v, prof + 1); if (n !== null) return n; }
  }
  return null;
}
// Devolve o saldo em centavos (ou null se não conseguir ler). Guarda por 60 segundos.
export async function saldoApiFull({ forcar = false } = {}) {
  if (!forcar && Date.now() - cacheSaldo.em < 60000) return cacheSaldo.valor;
  try {
    const base = process.env.APIFULL_URL || 'https://api.apifull.com.br/api/';
    const r = await fetch(`${base}get-balance`, {
      headers: { Authorization: `Bearer ${process.env.APIFULL_TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || (j.status && j.status !== 'sucesso')) throw new Error(j.message || j.mensagem || `HTTP ${r.status}`);
    const reais = lerSaldo(j.dados ?? j.data ?? j.saldo ?? j.balance ?? j);
    cacheSaldo = { em: Date.now(), valor: reais === null ? null : Math.round(reais * 100) };
  } catch (e) {
    console.warn('saldo APIFull:', e.message);
    cacheSaldo = { em: Date.now(), valor: null };
  }
  return cacheSaldo.valor;
}
export const limparCacheSaldo = () => { cacheSaldo.em = 0; };
