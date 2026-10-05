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

export function paginaCatalogo({ produtos, saldo, busca = '', categoria = '' }) {
  const cats = [...new Set(produtos.map((p) => p.categoria))];
  const filtrados = produtos.filter((p) => (!categoria || p.categoria === categoria)
    && (!busca || `${p.nome} ${p.descricao}`.toLowerCase().includes(busca.toLowerCase())));
  return `
<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:18px">
  <div><h1 style="font-size:1.8rem;margin:0">Consultas</h1><p class="muted" style="margin:4px 0 0">Escolha o que você precisa consultar.</p></div>
  <div class="tag" style="font-size:.9rem;padding:8px 14px">Saldo: ${reais(saldo)}</div>
</div>
<form method="get" action="/consultas" class="cartao" style="padding:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:18px">
  <input type="text" name="busca" value="${esc(busca)}" placeholder="Buscar consulta..." aria-label="Buscar consulta" style="flex:1 1 220px">
  <button class="btn" type="submit">Buscar</button>
</form>
<nav style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px" aria-label="Categorias">
  <a class="btn ${categoria ? 'sec' : ''}" style="min-height:40px;padding:8px 18px" href="/consultas">Todas</a>
  ${cats.map((c) => `<a class="btn ${c === categoria ? '' : 'sec'}" style="min-height:40px;padding:8px 18px" href="/consultas?categoria=${encodeURIComponent(c)}">${esc(c)}</a>`).join('')}
</nav>
${filtrados.length ? `<div class="grade">${filtrados.map((p) => `
  <a class="cartao" href="/consultas/${esc(p.slug)}" style="text-decoration:none;color:inherit;display:flex;flex-direction:column;gap:10px">
    <span class="tag">${esc(p.categoria)}</span>
    <h3 style="margin:0">${esc(p.nome)}</h3>
    <p class="muted" style="margin:0;flex:1">${esc(p.descricao)}</p>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <strong style="font-family:Montserrat;font-size:1.25rem">${reais(p.preco_centavos)}</strong>
      <span class="muted" style="font-size:.85rem">${ROTULO_DOC[p.documento]}</span>
    </div>
  </a>`).join('')}</div>` : '<div class="cartao vazio">Nenhuma consulta encontrada.</div>'}`;
}

export function paginaConsultar({ produto, saldo, erro, v = {} }) {
  const falta = Math.max(0, produto.preco_centavos - saldo);
  return `
<div class="cartao estreito" style="max-width:560px">
  <a href="/consultas" class="muted" style="text-decoration:none">← Voltar às consultas</a>
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
