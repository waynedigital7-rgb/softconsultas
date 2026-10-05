// Páginas da área do cliente: catálogo, consulta, resultado, histórico e recarga
import { esc, reais, dt } from './paginas.js';
import { formatarDoc } from './pdf.js';

const ROTULO_DOC = { cpf: 'CPF', cnpj: 'CNPJ', cpf_cnpj: 'CPF ou CNPJ', placa: 'Placa' };
export const FINALIDADES = [
  'Consulta do meu próprio CPF/CNPJ',
  'Análise de crédito para venda a prazo',
  'Análise para locação de imóvel ou bem',
  'Cadastro ou validação de cliente/fornecedor',
  'Proteção ao crédito e cobrança',
  'Prevenção a fraudes',
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
  'ferramentas': '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
};
export const slugCategoria = (c) => String(c).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const icone = (cat, tam = 40) => `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[slugCategoria(cat)] || '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5"/>'}</svg>`;

const cartaoProduto = (p) => `
  <a class="cartao" href="/consultas/${esc(p.slug)}" style="text-decoration:none;color:inherit;display:flex;flex-direction:column;gap:10px">
    <h3 style="margin:0">${esc(p.nome)}</h3>
    <p class="muted" style="margin:0;flex:1">${esc(p.descricao)}</p>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <strong style="font-family:Montserrat;font-size:1.25rem">${reais(p.preco_centavos)}</strong>
      <span class="muted" style="font-size:.85rem">${ROTULO_DOC[p.documento]}</span>
    </div>
  </a>`;

const cabecalho = (titulo, sub, saldo) => `
<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:18px">
  <div><h1 style="font-size:1.8rem;margin:0">${titulo}</h1><p class="muted" style="margin:4px 0 0">${sub}</p></div>
  <div class="tag" style="font-size:.9rem;padding:8px 14px">Saldo: ${reais(saldo)}</div>
</div>`;

const ORDEM_CATEGORIAS = ['Dívidas e Crédito', 'Veículos', 'Dados', 'Empresas', 'Certidões', 'Compliance', 'Jurídico', 'Ferramentas'];

// Página inicial do catálogo: categorias + busca geral
export function paginaCategorias({ produtos, saldo, busca = '' }) {
  const form = `<form method="get" action="/consultas" class="cartao" style="padding:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:22px">
    <input type="text" name="busca" value="${esc(busca)}" placeholder="Buscar em todas as consultas (ex.: placa, Serasa, CNH)..." aria-label="Buscar consulta" style="flex:1 1 260px">
    <button class="btn" type="submit">Buscar</button></form>`;
  if (busca) {
    const t = busca.toLowerCase();
    const achados = produtos.filter((p) => `${p.nome} ${p.descricao} ${p.categoria}`.toLowerCase().includes(t));
    return cabecalho('Consultas', `Resultados para "${esc(busca)}"`, saldo) + form
      + `<p><a href="/consultas">← Ver todas as categorias</a></p>`
      + (achados.length ? `<div class="grade">${achados.map(cartaoProduto).join('')}</div>` : '<div class="cartao vazio">Nenhuma consulta encontrada.</div>');
  }
  const grupos = {};
  for (const p of produtos) (grupos[p.categoria] ||= []).push(p);
  const cats = Object.keys(grupos).sort((a, b) => {
    const ia = ORDEM_CATEGORIAS.indexOf(a), ib = ORDEM_CATEGORIAS.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return cabecalho('Consultas', 'Escolha uma categoria.', saldo) + form
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
    + cabecalho(esc(categoria), `${produtos.length} ${produtos.length === 1 ? 'consulta disponível' : 'consultas disponíveis'}`, saldo)
    + `<form method="get" class="cartao" style="padding:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:18px">
      <input type="text" name="busca" value="${esc(busca)}" placeholder="Buscar em ${esc(categoria)}..." aria-label="Buscar nesta categoria" style="flex:1 1 220px">
      <button class="btn" type="submit">Buscar</button></form>`
    + (lista.length ? `<div class="grade">${lista.map(cartaoProduto).join('')}</div>` : '<div class="cartao vazio">Nenhuma consulta encontrada nesta categoria.</div>');
}

export function paginaConsultar({ produto, saldo, erro, v = {} }) {
  const falta = Math.max(0, produto.preco_centavos - saldo);
  return `
<div class="cartao estreito" style="max-width:560px">
  <a href="/consultas/categoria/${slugCategoria(produto.categoria)}" class="muted" style="text-decoration:none">← Voltar para ${esc(produto.categoria)}</a>
  <h1 style="font-size:1.6rem;margin-top:12px">${esc(produto.nome)}</h1>
  <p class="muted">${esc(produto.descricao)}</p>
  <div style="display:flex;justify-content:space-between;background:var(--fundo);border-radius:14px;padding:14px 16px;margin:16px 0">
    <div><div class="muted" style="font-size:.85rem">Valor da consulta</div><strong style="font-size:1.3rem;font-family:Montserrat">${reais(produto.preco_centavos)}</strong></div>
    <div style="text-align:right"><div class="muted" style="font-size:.85rem">Seu saldo</div><strong style="font-size:1.3rem;font-family:Montserrat">${reais(saldo)}</strong></div>
  </div>
  ${erro ? `<div class="aviso erro" role="alert">${esc(erro)}</div>` : ''}
  ${falta > 0 ? `<div class="aviso erro">Saldo insuficiente. Faltam ${reais(falta)}.</div><a class="btn largo" href="/recarregar">Recarregar agora</a>` : `
  <form method="post" action="/consultas/${esc(produto.slug)}" data-consulta>
    <div class="campo"><label for="valor">${ROTULO_DOC[produto.documento]}</label>
      <input id="valor" name="valor" type="text" ${produto.documento === 'placa' ? 'autocapitalize="characters"' : 'inputmode="numeric"'} required value="${esc(v.valor)}"></div>
    <div class="campo"><label for="finalidade">Finalidade da consulta</label>
      <select id="finalidade" name="finalidade" required style="font:inherit;padding:13px 15px;border:1.5px solid #D6CCE0;border-radius:12px;min-height:48px;background:#fff">
        <option value="">Selecione...</option>
        ${FINALIDADES.map((f) => `<option ${v.finalidade === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}
      </select></div>
    <label class="check"><input type="checkbox" name="aceite" value="1" required><span>Declaro que a consulta tem a finalidade informada, com base legal conforme a LGPD, e que vou usar os dados somente para esse fim.</span></label>
    <button class="btn largo" type="submit">Consultar por ${reais(produto.preco_centavos)}</button>
    <p class="muted" style="font-size:.85rem;text-align:center;margin:10px 0 0">Se a consulta falhar, o valor volta automaticamente para o seu saldo.</p>
  </form>`}
</div>`;
}

const COR = { verde: '#1E7B4D', amarelo: '#B7791F', vermelho: '#B3261E', neutro: '#9F31D3' };

export function paginaResultado({ c, a, linhas }) {
  if (c.status === 'falhou') {
    return `<div class="cartao estreito" style="text-align:center"><h1 style="font-size:1.5rem">Não foi possível concluir</h1>
      <p class="muted">A fonte não retornou o resultado desta consulta. O valor de ${reais(c.preco_centavos)} já voltou para o seu saldo.</p>
      <a class="btn" href="/consultas">Tentar de novo</a></div>`;
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

export function paginaHistorico({ consultas, busca = '' }) {
  return `
<h1 style="font-size:1.8rem">Histórico de consultas</h1>
<form method="get" action="/historico" class="cartao" style="padding:16px;display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
  <input type="text" name="busca" value="${esc(busca)}" placeholder="Buscar por documento ou consulta" aria-label="Buscar no histórico" style="flex:1 1 220px">
  <button class="btn" type="submit">Buscar</button>
</form>
<div class="cartao">${consultas.length ? `<div class="rolar"><table class="tabela">
  <tr><th>Data</th><th>Consulta</th><th>Documento</th><th>Valor</th><th>Status</th><th></th></tr>
  ${consultas.map((c) => `<tr><td>${dt(c.criado_em)}</td><td>${esc(c.produto)}</td><td>${esc(formatarDoc(c.parametro))}</td><td>${reais(c.preco_centavos)}</td>
    <td>${c.status === 'concluida' ? 'Concluída' : c.status === 'falhou' ? 'Falhou (estornada)' : 'Processando'}</td>
    <td>${c.status === 'concluida' ? `<a href="/consulta/${c.id}">Ver</a> · <a href="/consulta/${c.id}/pdf">PDF</a>` : ''}</td></tr>`).join('')}
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
