// Páginas da área do cliente: catálogo, consulta, resultado, histórico e recarga
import { esc, reais, dt } from './paginas.js';
import { formatarDoc } from './pdf.js';

const ROTULO_DOC = { cpf: 'CPF', cnpj: 'CNPJ', cpf_cnpj: 'CPF ou CNPJ', placa: 'Placa', cep: 'CEP' };
export const FINALIDADES = [
  'Consulta do meu próprio CPF/CNPJ',
  'Análise de crédito para venda a prazo',
  'Análise para locação de imóvel ou bem',
  'Cadastro ou validação de cliente/fornecedor',
  'Proteção ao crédito e cobrança',
  'Prevenção a fraudes',
  'Análise de mercado ou prospecção (consultas por CEP)',
];

// Ícones por categoria (SVG simples, sem dependências)
const ICONES = {
  'dividas-e-credito': '<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  'veiculos': '<path d="M5 17h14M3 13l2-6h14l2 6v4h-2M3 13v4h2M3 13h18"/><circle cx="7.5" cy="17" r="1.5"/><circle cx="16.5" cy="17" r="1.5"/>',
  'dados': '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17c.8-2 2-3 3.5-3s2.7 1 3.5 3M14 9h4M14 13h4"/>',
  'certidoes': '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h6M9 17h4"/>',
  'compliance': '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/><path d="M9 12l2 2 4-4"/>',
  'juridico': '<path d="M12 3v18M5 21h14M6 7h12M6 7l-3 7h6zM18 7l-3 7h6z"/>',
  'empresas': '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1"/>',
  'analise-de-mercado': '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  'ferramentas': '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
};
export const slugCategoria = (c) => String(c).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const icone = (cat, tam = 40) => `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[slugCategoria(cat)] || '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5"/>'}</svg>`;

// Ícone de cada consulta, pelo assunto do nome/descrição
const ICONES_ITEM = [
  [/placa|ve[ií]cul|renavam|crlv|leil[aã]o|roubo|furto|renajud|renainf|recall|bin |gravame|fipe|proprietário|atpv|rntrc|vip car/i, 'veiculos'],
  [/cnh|habilita/i, '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2.5"/><path d="M13 10h5M13 14h3"/>'],
  [/certid|nada consta|antecedente/i, 'certidoes'],
  [/score|rating|cr[eé]dito|serasa|spc|boa ?vista|quod|scr|bacen|negativ|d[ií]vida|cadin|pend[eê]ncia/i, '<path d="M4 14a8 8 0 0 1 16 0"/><path d="M12 14l4-4"/><circle cx="12" cy="14" r="1.2"/>'],
  [/^[^]*?(protesto nacional|cenprot|cart[oó]rio)/i, '<path d="M7 21h10M12 17v4M5 9l7-6 7 6M7 9v4a5 5 0 0 0 10 0V9"/>'],
  [/telefone|celular|whats/i, '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>'],
  [/e-?mail/i, '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>'],
  [/endere[cç]o|localiza|cep|geogr|im[oó]ve/i, '<path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>'],
  [/empresa|cnpj|societ|s[oó]cio|sintegra|suframa|quadro|corretor/i, 'empresas'],
  [/processo|judicial|mandado|pris[aã]o|a[cç][oõ]es/i, 'juridico'],
  [/compliance|pld|pep|san[cç]/i, 'compliance'],
  [/gasto|[ií]ndice|indicador|mercado|concorr|prospec|sociodem/i, 'analise-de-mercado'],
  [/renda|financeir|restitui|benef[ií]cio|inss|assist[eê]ncia|servidor|patrim/i, '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>'],
  [/[oó]bito|nome social|parente|pessoas relacionadas|grafo/i, '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3 20c.8-3 3.2-5 6-5s5.2 2 6 5M14.5 19c.5-2 1.8-3.3 3.5-3.3s3 1.3 3.5 3.3"/>'],
];
function iconeItem(p) {
  const texto = `${p.nome} ${p.descricao}`;
  for (const [re, ic] of ICONES_ITEM) {
    if (re.test(texto)) {
      const corpo = ic.startsWith('<') ? ic : ICONES[ic];
      return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
    }
  }
  return icone(p.categoria, 22);
}
// Descrição curta: corta no primeiro ponto/barra para caber numa linha
const resumo = (d) => String(d || '').split(/(?<=[.!?])\s|\s\|\s/)[0].replace(/\s+/g, ' ').trim();

const itemProduto = (p) => `
  <a class="item" href="/consultas/${esc(p.slug)}" title="${esc(p.descricao)}">
    <span class="ic">${iconeItem(p)}</span>
    <span class="tx"><strong>${esc(p.nome)}</strong>${resumo(p.descricao) ? `<span>${esc(resumo(p.descricao))}</span>` : ''}</span>
    <span class="pr"><strong>${reais(p.preco_centavos)}</strong><small>${ROTULO_DOC[p.documento]}</small></span>
    <span class="btn bt">Consultar</span>
  </a>`;
const listaProdutos = (lista) => `<div class="lista">${lista.map(itemProduto).join('')}</div>`;

const cabecalho = (titulo, sub, saldo, admin) => `
<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:18px">
  <div><h1 style="font-size:1.8rem;margin:0">${titulo}</h1><p class="muted" style="margin:4px 0 0">${sub}</p></div>
  <div style="display:flex;gap:8px;flex-wrap:wrap">${admin ? '<div class="tag" style="font-size:.9rem;padding:8px 14px">Admin: preços de custo</div>' : ''}<div class="tag" style="font-size:.9rem;padding:8px 14px">${admin ? 'Saldo APIFull' : 'Saldo'}: ${saldo === null ? 'indisponível' : reais(saldo)}</div></div>
</div>`;

const ORDEM_CATEGORIAS = ['Dívidas e Crédito', 'Veículos', 'Dados', 'Empresas', 'Análise de Mercado', 'Certidões', 'Compliance', 'Jurídico', 'Ferramentas'];

// Página inicial do catálogo: categorias + busca geral
export function paginaCategorias({ produtos, saldo, busca = '' }) {
  const form = `<form method="get" action="/consultas" class="cartao" style="padding:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:22px">
    <input type="text" name="busca" value="${esc(busca)}" placeholder="Buscar em todas as consultas (ex.: placa, Serasa, CNH)..." aria-label="Buscar consulta" style="flex:1 1 260px">
    <button class="btn" type="submit">Buscar</button></form>`;
  if (busca) {
    const t = busca.toLowerCase();
    const achados = produtos.filter((p) => `${p.nome} ${p.descricao} ${p.categoria}`.toLowerCase().includes(t));
    return cabecalho('Consultas', `Resultados para "${esc(busca)}"`, saldo, produtos[0]?.precoCusto) + form
      + `<p><a href="/consultas">← Ver todas as categorias</a></p>`
      +  (achados.length ? listaProdutos(achados) : '<div class="cartao vazio">Nenhuma consulta encontrada.</div>');
  }
  const grupos = {};
  for (const p of produtos) (grupos[p.categoria] ||= []).push(p);
  const cats = Object.keys(grupos).sort((a, b) => {
    const ia = ORDEM_CATEGORIAS.indexOf(a), ib = ORDEM_CATEGORIAS.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return cabecalho('Consultas', 'Escolha uma categoria.', saldo, produtos[0]?.precoCusto) + form
    + (cats.length ? `<div class="grade">${cats.map((c) => {
      const lista = grupos[c];
      const menor = Math.min(...lista.map((p) => p.preco_centavos));
      return `<a class="cartao" href="/consultas/categoria/${slugCategoria(c)}" style="text-decoration:none;color:inherit;display:flex;flex-direction:column;align-items:flex-start;gap:12px">
        <span style="color:var(--roxo);background:var(--fundo);border-radius:16px;padding:12px;display:inline-flex">${icone(c)}</span>
        <h3 style="margin:0">${esc(c)}</h3>
        <span class="muted">${lista.length} ${lista.length === 1 ? 'consulta' : 'consultas'} · a partir de ${reais(menor)}</span>
      </a>`;
    }).join('')}</div>` : '<div class="cartao vazio">Nenhuma consulta disponível no momento.</div>');
}

// Página de uma categoria
export function paginaCategoria({ categoria, produtos, saldo, busca = '' }) {
  const t = busca.toLowerCase();
  const lista = produtos.filter((p) => !busca || `${p.nome} ${p.descricao}`.toLowerCase().includes(t));
  return `<p style="margin:0 0 10px"><a href="/consultas" style="text-decoration:none">← Todas as categorias</a></p>`
    + `<div style="display:flex;align-items:center;gap:14px;margin-bottom:6px"><span style="color:var(--roxo)">${icone(categoria, 34)}</span></div>`
    + cabecalho(esc(categoria), `${produtos.length} ${produtos.length === 1 ? 'consulta disponível' : 'consultas disponíveis'}`, saldo, produtos[0]?.precoCusto)
    + `<form method="get" class="cartao" style="padding:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:18px">
      <input type="text" name="busca" value="${esc(busca)}" placeholder="Buscar em ${esc(categoria)}..." aria-label="Buscar nesta categoria" style="flex:1 1 220px">
      <button class="btn" type="submit">Buscar</button></form>`
 + (lista.length ? listaProdutos(lista) : '<div class="cartao vazio">Nenhuma consulta encontrada nesta categoria.</div>');
}

export function paginaConsultar({ produto, saldo, erro, v = {}, admin = false }) {
  const falta = saldo === null ? 0 : Math.max(0, produto.preco_centavos - saldo);
  return `
<div class="cartao estreito" style="max-width:560px">
  <a href="/consultas/categoria/${slugCategoria(produto.categoria)}" class="muted" style="text-decoration:none">← Voltar para ${esc(produto.categoria)}</a>
  <h1 style="font-size:1.6rem;margin-top:12px">${esc(produto.nome)}</h1>
  <p class="muted">${esc(produto.descricao)}</p>
  <div style="display:flex;justify-content:space-between;background:var(--fundo);border-radius:14px;padding:14px 16px;margin:16px 0">
    <div><div class="muted" style="font-size:.85rem">Valor da consulta${produto.precoCusto ? ' <span class="tag">preço de custo · admin</span>' : ''}</div><strong style="font-size:1.3rem;font-family:Montserrat">${reais(produto.preco_centavos)}</strong></div>
    <div style="text-align:right"><div class="muted" style="font-size:.85rem">${admin ? 'Saldo APIFull' : 'Seu saldo'}</div><strong style="font-size:1.3rem;font-family:Montserrat">${saldo === null ? '—' : reais(saldo)}</strong></div>
  </div>
  ${erro ? `<div class="aviso erro" role="alert">${esc(erro)}</div>` : ''}
  ${falta > 0 ? (admin
    ? `<div class="aviso erro">Saldo da APIFull insuficiente. Faltam ${reais(falta)}.</div><a class="btn largo" href="https://app.apifull.com.br" target="_blank" rel="noopener">Recarregar na APIFull</a>`
    : `<div class="aviso erro">Saldo insuficiente. Faltam ${reais(falta)}.</div><a class="btn largo" href="/recarregar">Recarregar agora</a>`) : `
  <div id="aviso-nova-aba" class="aviso ok" hidden>Sua consulta está abrindo em uma <strong>nova aba</strong>. Se não abrir, confira se o navegador bloqueou ou veja no <a href="/historico">Histórico</a>.</div>
  <form method="post" action="/consultas/${esc(produto.slug)}" target="_blank" data-consulta>
    <div class="campo"><label for="valor">${ROTULO_DOC[produto.documento]}</label>
      <input id="valor" name="valor" type="text" ${produto.documento === 'placa' ? 'autocapitalize="characters"' : 'inputmode="numeric"'} required value="${esc(v.valor)}"></div>
    <div class="campo"><label for="finalidade">Finalidade da consulta</label>
      <select id="finalidade" name="finalidade" required style="font:inherit;padding:13px 15px;border:1.5px solid #D6CCE0;border-radius:12px;min-height:48px;background:#fff">
        <option value="">Selecione...</option>
        ${FINALIDADES.map((f) => `<option ${v.finalidade === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}
      </select></div>
    <label class="check"><input type="checkbox" name="aceite" value="1" required><span>Declaro que a consulta tem a finalidade informada, com base legal conforme a LGPD, e que vou usar os dados somente para esse fim.</span></label>
    <button class="btn largo" type="submit">Consultar por ${reais(produto.preco_centavos)}</button>
    <p class="muted" style="font-size:.85rem;text-align:center;margin:10px 0 0">O relatório em PDF abre numa nova aba. ${admin ? 'Conta admin: a consulta é debitada direto do saldo da APIFull, sem passar pela carteira.' : 'Se a consulta falhar, o valor volta automaticamente para o seu saldo.'}</p>
  </form>`}
</div>`;
}

const COR = { verde: '#1E7B4D', amarelo: '#B7791F', vermelho: '#B3261E', neutro: '#9F31D3' };

export function paginaResultado({ c, a, linhas }) {
  if (c.status === 'falhou') {
    return `<div class="cartao estreito" style="text-align:center"><h1 style="font-size:1.5rem">Não foi possível concluir</h1>
      <p class="muted">A fonte não retornou o resultado desta consulta. O valor de ${reais(c.preco_centavos)} já voltou para o seu saldo.</p>
      <a class="btn" href="/consultas">Tentar de novo</a> <a class="btn sec" href="/historico">Ver histórico</a></div>`;
  }
  const cor = COR[a.cor] || COR.neutro;
  return `
<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:18px">
  <div><span class="tag">Protocolo #${c.id}</span><h1 style="font-size:1.7rem;margin:8px 0 0">${esc(c.produto)}</h1>
  <p class="muted" style="margin:4px 0 0">${esc(formatarDoc(c.parametro))} · ${dt(c.criado_em)}</p></div>
  <a class="btn" href="/consulta/${c.id}/pdf">Baixar PDF</a>
</div>
<div class="cartao" style="border-left:6px solid ${cor};margin-bottom:18px">
  <div style="display:flex;gap:14px;align-items:center">
    <span aria-hidden="true" style="width:22px;height:22px;border-radius:50%;background:${cor};flex:none"></span>
    <h2 style="margin:0;color:${cor};font-size:1.35rem">${esc(a.titulo)}</h2>
  </div>
  ${a.motivos.length ? `<ul style="margin:12px 0 0 36px;padding:0">${a.motivos.map((m) => `<li>${esc(m.charAt(0).toUpperCase() + m.slice(1))}</li>`).join('')}</ul>` : ''}
</div>
${a.temDadosCredito ? `<div class="grade" style="margin-bottom:18px">
  <div class="cartao"><div class="muted">Score</div><div style="font-family:Montserrat;font-size:2rem;font-weight:800;color:var(--roxo)">${a.score ?? '-'}</div>${a.pagamento !== null ? `<div class="muted" style="font-size:.85rem">${a.pagamento}% pagam em dia nos próximos 6 meses</div>` : ''}</div>
  <div class="cartao"><div class="muted">Restrições</div><div style="font-family:Montserrat;font-size:2rem;font-weight:800">${a.qtdRestricoes}</div><div class="muted" style="font-size:.85rem">${a.totalValor ? reais(Math.round(a.totalValor * 100)) : 'Nada consta'}</div></div>
  <div class="cartao"><div class="muted">Consultas recentes</div><div style="font-family:Montserrat;font-size:2rem;font-weight:800">${a.consultasRecentes}</div><div class="muted" style="font-size:.85rem">empresas que consultaram</div></div>
</div>` : ''}
${a.painel.length ? `<div class="cartao" style="margin-bottom:18px"><h3>Ocorrências por tipo</h3><div class="rolar"><table class="tabela">
  ${a.painel.map((p) => `<tr><td>${esc(p.tipo)}</td><td style="text-align:right;font-weight:700;color:${p.restricao && p.total ? 'var(--erro)' : 'var(--cinza)'}">${p.total ? `${p.total} registro(s)` : 'Nada consta'}</td></tr>`).join('')}
</table></div></div>` : ''}
${a.itens.length ? `<div class="cartao" style="margin-bottom:18px"><h3>Detalhamento das restrições</h3><div class="rolar"><table class="tabela">
  <tr><th>Credor / Cartório</th><th>Tipo</th><th>Data</th><th style="text-align:right">Valor</th></tr>
  ${a.itens.map((i) => `<tr><td>${esc(i.credor)}</td><td>${esc(i.tipo)}</td><td>${esc(i.data || '-')}</td><td style="text-align:right;font-weight:700">${reais(Math.round(i.valor * 100))}</td></tr>`).join('')}
</table></div></div>` : ''}
<details class="cartao"><summary style="cursor:pointer;font-weight:700">Ver todos os dados retornados</summary>
  <div class="rolar" style="margin-top:12px"><table class="tabela">${linhas.map(([k, v]) => `<tr><td class="muted" style="width:40%">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></div>
</details>`;
}

export function paginaHistorico({ consultas, busca = '', dias = 10 }) {
  const ate = (criado) => {
    const d = new Date(String(criado).replace(' ', 'T') + 'Z');
    d.setDate(d.getDate() + dias);
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  };
  const status = (c) => {
    if (c.status === 'falhou') return '<span class="muted">Falhou (valor estornado)</span>';
    if (c.status !== 'concluida') return 'Processando';
    if (!c.resultado) return '<span class="muted">Expirada</span>';
    return `<a class="btn" style="min-height:38px;padding:6px 16px" href="/consulta/${c.id}/pdf" target="_blank" rel="noopener">Abrir PDF</a><br><small class="muted">Disponível até ${ate(c.criado_em)}</small>`;
  };
  return `
<h1 style="font-size:1.8rem">Histórico de consultas</h1>
<p class="muted" style="margin-top:-4px">Os resultados e PDFs ficam disponíveis para baixar por <strong>${dias} dias</strong> após cada consulta. Depois disso, são removidos para proteger os dados consultados.</p>
<form method="get" action="/historico" class="cartao" style="padding:16px;display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
  <input type="text" name="busca" value="${esc(busca)}" placeholder="Buscar por documento ou consulta" aria-label="Buscar no histórico" style="flex:1 1 220px">
  <button class="btn" type="submit">Buscar</button>
</form>
<div class="cartao">${consultas.length ? `<div class="rolar"><table class="tabela">
  <tr><th>Data</th><th>Consulta</th><th>Documento</th><th>Valor</th><th>Resultado</th></tr>
  ${consultas.map((c) => `<tr><td>${dt(c.criado_em)}</td><td>${esc(c.produto)}</td><td>${esc(formatarDoc(c.parametro))}</td><td>${reais(c.preco_centavos)}</td><td>${status(c)}</td></tr>`).join('')}
</table></div>` : '<div class="vazio">Nenhuma consulta encontrada.</div>'}</div>`;
}

export function paginaRecarregar({ minimo, faixas, erro }) {
  const sugestoes = [3000, 5000, 10000, 20000, 30000, 50000].filter((v) => v >= minimo);
  const bonusDe = (v) => { let p = 0; for (const f of faixas) if (v >= f.a_partir_de) p = Math.max(p, f.percentual); return p; };
  return `
<div class="cartao estreito" style="max-width:600px">
  <h1 style="font-size:1.6rem">Recarregar créditos</h1>
  <p class="muted">Pague por Pix e o saldo cai na hora. Recarga mínima de ${reais(minimo)}.</p>
  ${faixas.length ? `<div class="aviso ok">${faixas.map((f) => `Recarregando a partir de ${reais(f.a_partir_de)}, ganhe <strong>+${f.percentual}%</strong> de bônus`).join('<br>')}</div>` : ''}
  ${erro ? `<div class="aviso erro" role="alert">${esc(erro)}</div>` : ''}
  <form method="post" action="/recarregar">
    <div class="grade" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px">
      ${sugestoes.map((v, i) => `<label class="cartao" style="padding:14px;cursor:pointer;display:flex;gap:10px;align-items:center">
        <input type="radio" name="valor" value="${v / 100}" ${i === 1 ? 'checked' : ''} style="accent-color:var(--roxo);width:18px;height:18px">
        <span><strong>${reais(v)}</strong>${bonusDe(v) ? `<br><small style="color:var(--ok);font-weight:700">+${reais(Math.round((v * bonusDe(v)) / 100))} bônus</small>` : ''}</span></label>`).join('')}
    </div>
    <div class="campo"><label for="outro">Ou digite outro valor (R$)</label><input id="outro" name="outro" type="text" inputmode="decimal" placeholder="Ex.: 75"></div>
    <button class="btn largo" type="submit">Gerar Pix</button>
  </form>
</div>`;
}

export function paginaPagarRecarga({ r }) {
  return `
<div class="cartao estreito" style="max-width:520px;text-align:center" data-recarga="${r.id}">
  <h1 style="font-size:1.5rem">Pague ${reais(r.valor_centavos)} com Pix</h1>
  ${r.bonus_centavos ? `<p class="aviso ok">Você vai receber ${reais(r.valor_centavos + r.bonus_centavos)} em créditos (bônus de ${reais(r.bonus_centavos)}).</p>` : ''}
  <div id="aguardando">
    ${r.pix_imagem ? `<img src="data:image/png;base64,${esc(r.pix_imagem)}" alt="QR Code Pix" style="width:230px;height:230px;max-width:100%">
    <textarea id="pix-codigo" readonly rows="3" aria-label="Código Pix copia e cola" style="width:100%;font:inherit;font-size:.8rem;padding:10px;border:1.5px solid #D6CCE0;border-radius:12px;resize:none">${esc(r.pix_codigo)}</textarea>
    <button class="btn" type="button" id="copiar" style="margin:12px 0">Copiar código Pix</button>` : ''}
    ${r.link_pagamento ? `<p><a href="${esc(r.link_pagamento)}" target="_blank" rel="noopener">${r.pix_imagem ? 'Prefiro pagar pela página do Asaas' : 'Abrir página de pagamento'}</a></p>` : ''}
    <p class="muted" aria-live="polite">Aguardando pagamento… esta página atualiza sozinha.</p>
  </div>
  <div id="pago" hidden>
    <h2 style="color:var(--ok)">Pagamento confirmado!</h2>
    <p class="muted">Seus créditos já estão disponíveis.</p>
    <a class="btn" href="/consultas">Fazer uma consulta</a>
  </div>
</div>`;
}

export function paginaIndicacoes({ link, usuario, indicados, extrato, saques, saldo, maximo, minimoSaque, ok, erro }) {
  const pct = usuario.comissao_percentual ?? 30;
  const exemplo = 1458;
  const tipoTxt = { comissao: 'Comissão', saque: 'Saque', conversao: 'Conversão em créditos', estorno_saque: 'Saque devolvido' };
  const statusSaque = { pendente: 'Aguardando aprovação', pago: '<span style="color:var(--ok);font-weight:700">Pago</span>', recusado: '<span style="color:var(--erro)">Recusado</span>' };
  const nomeCurto = (n) => { const p = String(n).trim().split(/\s+/); return p[0] + (p[1] ? ` ${p[1][0]}.` : ''); };
  return `
<h1 style="font-size:1.8rem">Indicações</h1>
<p class="muted" style="margin-top:-4px">Indique a Soft Consultas e ganhe comissão em <strong>todas as consultas</strong> dos seus indicados.</p>
${ok ? `<div class="aviso ok">${esc(ok)}</div>` : ''}${erro ? `<div class="aviso erro" role="alert">${esc(erro)}</div>` : ''}
<div class="grade" style="margin-bottom:18px">
  <div class="saldo">
    <div style="color:#D9B8F0;font-weight:600">Comissões disponíveis</div>
    <div class="valor">${reais(saldo)}</div>
    <form method="post" action="/indicacoes/converter" style="margin-top:14px"><button class="btn" type="submit" ${saldo > 0 ? '' : 'disabled'}>Converter em créditos</button></form>
  </div>
  <div class="cartao">
    <h3>Seu link de indicação</h3>
    <input type="text" readonly value="${esc(link)}" aria-label="Seu link de indicação" id="link-indicacao" style="margin-bottom:10px">
    <button class="btn sec" type="button" data-copiar="link-indicacao">Copiar link</button>
    <p class="muted" style="font-size:.9rem;margin:12px 0 0">Quem se cadastrar pelo seu link (válido por 30 dias no navegador da pessoa) vira seu indicado para sempre.</p>
  </div>
</div>
<div class="cartao" style="margin-bottom:18px">
  <h3>Sua comissão</h3>
  <p class="muted">Você escolhe quanto ganhar: o percentual é somado ao preço das consultas dos seus indicados. Exemplo: numa consulta de ${reais(exemplo)}, com ${pct}% o indicado paga ${reais(exemplo + Math.round((exemplo * pct) / 100))} e você ganha ${reais(Math.round((exemplo * pct) / 100))}.</p>
  <form method="post" action="/indicacoes/comissao" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
    <div class="campo" style="margin:0;flex:0 1 200px"><label for="percentual">Comissão (0% a ${maximo}%)</label><input id="percentual" name="percentual" type="text" inputmode="numeric" value="${pct}"></div>
    <button class="btn" type="submit">Salvar</button>
  </form>
  <p class="muted" style="font-size:.85rem;margin:10px 0 0">Comissões menores deixam o preço mais competitivo para os seus indicados. A mudança vale para as próximas consultas.</p>
</div>
<div class="cartao" style="margin-bottom:18px">
  <h3>Sacar por Pix</h3>
  <form method="post" action="/indicacoes/saque" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
    <div class="campo" style="margin:0;flex:1 1 220px"><label for="chave_pix">Sua chave Pix</label><input id="chave_pix" name="chave_pix" type="text" value="${esc(usuario.chave_pix || '')}"></div>
    <div class="campo" style="margin:0;flex:0 1 160px"><label for="valor">Valor (R$)</label><input id="valor" name="valor" type="text" inputmode="decimal" placeholder="${(minimoSaque / 100).toFixed(2).replace('.', ',')}"></div>
    <button class="btn" type="submit" ${saldo >= minimoSaque ? '' : 'disabled'}>Solicitar saque</button>
  </form>
  <p class="muted" style="font-size:.85rem;margin:10px 0 0">Saque mínimo de ${reais(minimoSaque)}. A chave Pix precisa ser do mesmo titular da conta.</p>
  ${saques.length ? `<div class="rolar" style="margin-top:14px"><table class="tabela"><tr><th>Data</th><th>Valor</th><th>Status</th></tr>
    ${saques.map((x) => `<tr><td>${dt(x.criado_em)}</td><td>${reais(x.valor_centavos)}</td><td>${statusSaque[x.status]}</td></tr>`).join('')}</table></div>` : ''}
</div>
<div class="cartao" style="margin-bottom:18px">
  <h3>Seus indicados (${indicados.length})</h3>
  ${indicados.length ? `<div class="rolar"><table class="tabela"><tr><th>Indicado</th><th>Desde</th><th>Consultas</th><th style="text-align:right">Você ganhou</th></tr>
    ${indicados.map((i) => `<tr><td>${esc(nomeCurto(i.nome))}</td><td>${dt(i.criado_em).slice(0, 10)}</td><td>${i.consultas}</td><td style="text-align:right;font-weight:700">${reais(i.gerado)}</td></tr>`).join('')}
  </table></div>` : '<div class="vazio">Ninguém se cadastrou pelo seu link ainda. Compartilhe com clientes, parceiros e grupos de negócio.</div>'}
</div>
<div class="cartao">
  <h3>Extrato de comissões</h3>
  ${extrato.length ? `<div class="rolar"><table class="tabela"><tr><th>Data</th><th>Descrição</th><th style="text-align:right">Valor</th></tr>
    ${extrato.map((e) => `<tr><td>${dt(e.criado_em)}</td><td>${esc(e.descricao)}</td><td style="text-align:right;font-weight:700;color:${e.valor_centavos < 0 ? 'var(--erro)' : 'var(--ok)'}">${e.valor_centavos < 0 ? '-' : '+'} ${reais(Math.abs(e.valor_centavos))}</td></tr>`).join('')}
  </table></div>` : '<div class="vazio">Nenhuma comissão ainda.</div>'}
</div>`;
}
