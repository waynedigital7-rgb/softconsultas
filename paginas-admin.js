// Páginas do painel administrativo
import { esc, reais, dt } from './paginas.js';
import { formatarDoc } from './pdf.js';

const menu = (ativo) => `<nav style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px" aria-label="Administração">
  ${[['/admin', 'Resumo'], ['/admin/produtos', 'Consultas e preços'], ['/admin/clientes', 'Clientes'], ['/admin/consultas', 'Consultas feitas'], ['/admin/recargas', 'Recargas'], ['/admin/config', 'Configurações']]
    .map(([h, t]) => `<a class="btn ${h === ativo ? '' : 'sec'}" style="min-height:40px;padding:8px 18px" href="${h}">${t}</a>`).join('')}
</nav>`;
const num = (rot, val, sub = '') => `<div class="cartao"><div class="muted">${rot}</div><div style="font-family:Montserrat;font-size:1.8rem;font-weight:800">${val}</div>${sub ? `<div class="muted" style="font-size:.85rem">${sub}</div>` : ''}</div>`;
const aviso = (ok, erro) => (ok ? `<div class="aviso ok">${esc(ok)}</div>` : '') + (erro ? `<div class="aviso erro">${esc(erro)}</div>` : '');

export function adminResumo({ m, ok }) {
  return `<h1 style="font-size:1.7rem">Administração</h1>${menu('/admin')}${aviso(ok)}
<div class="grade" style="margin-bottom:18px">
  ${num('Clientes', m.clientes, `${m.clientesMes} nos últimos 30 dias`)}
  ${num('Recargas pagas', reais(m.recargas), `${m.qtdRecargas} recargas · ${reais(m.bonus)} em bônus`)}
  ${num('Saldo em carteiras', reais(m.saldos), 'créditos ainda não usados')}
</div>
<div class="grade">
  ${num('Consultas concluídas', m.consultas, `${m.falhas} falharam e foram estornadas`)}
  ${num('Faturamento com consultas', reais(m.faturamento))}
  ${num('Custo APIFull', reais(m.custo), `Margem: ${reais(m.faturamento - m.custo)}`)}
</div>`;
}

export function adminProdutos({ produtos, markup, ok }) {
  return `<h1 style="font-size:1.7rem">Consultas e preços</h1>${menu('/admin/produtos')}${aviso(ok)}
<p class="muted">Preço de venda = custo APIFull + ${markup}% (ajuste a porcentagem em Configurações). Só aparecem para os clientes as consultas <strong>ativas</strong> e com endpoint preenchido.</p>
<div class="cartao"><div class="rolar"><table class="tabela">
  <tr><th>Consulta</th><th>Categoria</th><th>Endpoint</th><th>Custo</th><th>Preço</th><th>Status</th><th></th></tr>
  ${produtos.map((p) => `<tr><td><strong>${esc(p.nome)}</strong></td><td>${esc(p.categoria)}</td><td><code>${esc(p.endpoint || '—')}</code></td>
    <td>${reais(p.custo_centavos)}</td><td><strong>${reais(p.preco_centavos)}</strong></td>
    <td>${p.ativo && p.endpoint ? '<span style="color:var(--ok);font-weight:700">Ativa</span>' : '<span class="muted">Inativa</span>'}</td>
    <td><a href="/admin/produtos/editar?id=${p.id}">Editar</a></td></tr>`).join('')}
</table></div>
<a class="btn" href="/admin/produtos/editar" style="margin-top:16px">+ Nova consulta</a></div>`;
}

export function adminProdutoForm({ p = {}, markup, erro }) {
  const campo = (id, rot, val, extra = '') => `<div class="campo"><label for="${id}">${rot}</label><input id="${id}" name="${id}" type="text" value="${esc(val ?? '')}" ${extra}></div>`;
  return `<h1 style="font-size:1.7rem">${p.id ? 'Editar consulta' : 'Nova consulta'}</h1>${menu('/admin/produtos')}${aviso('', erro)}
<form class="cartao" method="post" action="/admin/produtos/salvar" style="max-width:640px">
  ${p.id ? `<input type="hidden" name="id" value="${p.id}">` : ''}
  ${campo('nome', 'Nome (como aparece para o cliente)', p.nome, 'required')}
  ${campo('categoria', 'Categoria', p.categoria || 'Dívidas e Crédito', 'required')}
  ${campo('descricao', 'Descrição curta', p.descricao)}
  <div class="campo"><label for="documento">O cliente informa</label>
    <select id="documento" name="documento" style="font:inherit;padding:13px 15px;border:1.5px solid #D6CCE0;border-radius:12px;min-height:48px;background:#fff">
      ${[['cpf_cnpj', 'CPF ou CNPJ'], ['cpf', 'Somente CPF'], ['cnpj', 'Somente CNPJ'], ['placa', 'Placa de veículo']].map(([v, t]) => `<option value="${v}" ${p.documento === v ? 'selected' : ''}>${t}</option>`).join('')}
    </select></div>
  ${campo('endpoint', 'Endpoint na APIFull (ex.: e-boavista)', p.endpoint)}
  ${campo('link', 'Link na APIFull (normalmente igual ao endpoint)', p.link)}
  ${campo('campo', 'Nome do campo enviado (padrão: document; para placa geralmente: placa)', p.campo || 'document')}
  ${campo('custo', 'Custo na APIFull (R$)', p.custo_centavos != null ? (p.custo_centavos / 100).toFixed(2).replace('.', ',') : '', 'inputmode="decimal" required')}
  <p class="muted" style="margin-top:-8px">Preço de venda calculado automaticamente: custo + ${markup}%.</p>
  ${campo('ordem', 'Ordem no catálogo (menor aparece primeiro)', p.ordem ?? 100, 'inputmode="numeric"')}
  <label class="check"><input type="checkbox" name="ativo" value="1" ${p.ativo ? 'checked' : ''}><span>Ativa (visível para os clientes)</span></label>
  <button class="btn" type="submit">Salvar</button> <a class="btn sec" href="/admin/produtos">Cancelar</a>
</form>`;
}

export function adminConfig({ minimo, faixas, markup, ok, erro }) {
  return `<h1 style="font-size:1.7rem">Configurações</h1>${menu('/admin/config')}${aviso(ok, erro)}
<form class="cartao" method="post" action="/admin/config" style="max-width:640px">
  <div class="campo"><label for="markup">Margem sobre o custo APIFull (%)</label><input id="markup" name="markup" type="text" inputmode="numeric" value="${markup}">
    <small class="muted">150 = preço de venda é o custo + 150% (custo x 2,5). Ao salvar, todos os preços são recalculados.</small></div>
  <div class="campo"><label for="minimo">Recarga mínima (R$)</label><input id="minimo" name="minimo" type="text" inputmode="decimal" value="${(minimo / 100).toFixed(2).replace('.', ',')}"></div>
  <div class="campo"><label for="faixas">Bônus de recarga</label>
    <input id="faixas" name="faixas" type="text" value="${esc(faixas.map((f) => `${f.a_partir_de / 100}=${f.percentual}`).join('; '))}">
    <small class="muted">Formato: valor=percentual, separados por ponto e vírgula. Ex.: <code>100=5; 300=10</code> (a partir de R$ 100 ganha 5%, a partir de R$ 300 ganha 10%). Deixe vazio para não dar bônus.</small></div>
  <button class="btn" type="submit">Salvar configurações</button>
</form>`;
}

export function adminClientes({ clientes, busca = '', ok, erro }) {
  return `<h1 style="font-size:1.7rem">Clientes</h1>${menu('/admin/clientes')}${aviso(ok, erro)}
<form method="get" class="cartao" style="padding:16px;display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
  <input type="text" name="busca" value="${esc(busca)}" placeholder="Nome, e-mail ou documento" aria-label="Buscar cliente" style="flex:1 1 220px"><button class="btn">Buscar</button></form>
<div class="cartao"><div class="rolar"><table class="tabela">
  <tr><th>Cliente</th><th>Documento</th><th>WhatsApp</th><th>Saldo</th><th>Desde</th><th>Ajustar saldo</th></tr>
  ${clientes.map((c) => `<tr><td><strong>${esc(c.nome)}</strong><br><span class="muted">${esc(c.email)}</span>${c.ativo ? '' : ' <span style="color:var(--erro)">(desativado)</span>'}</td>
    <td>${esc(formatarDoc(c.documento))}</td><td>${esc(c.telefone)}</td><td><strong>${reais(c.saldo)}</strong></td><td>${dt(c.criado_em).slice(0, 10)}</td>
    <td><form method="post" action="/admin/clientes/ajuste" style="display:flex;gap:6px;flex-wrap:wrap;margin:0">
      <input type="hidden" name="id" value="${c.id}">
      <input type="text" name="valor" placeholder="+10 ou -10" aria-label="Valor do ajuste" style="width:100px;min-height:40px;padding:8px">
      <input type="text" name="motivo" placeholder="Motivo" aria-label="Motivo" style="width:140px;min-height:40px;padding:8px">
      <button class="btn sec" style="min-height:40px;padding:8px 14px">Aplicar</button></form></td></tr>`).join('')}
</table></div></div>`;
}

export function adminConsultas({ consultas }) {
  return `<h1 style="font-size:1.7rem">Consultas feitas</h1>${menu('/admin/consultas')}
<div class="cartao"><div class="rolar"><table class="tabela">
  <tr><th>#</th><th>Data</th><th>Cliente</th><th>Consulta</th><th>Documento</th><th>Finalidade</th><th>Preço</th><th>Custo</th><th>Status</th></tr>
  ${consultas.map((c) => `<tr><td>${c.id}</td><td>${dt(c.criado_em)}</td><td>${esc(c.cliente)}</td><td>${esc(c.produto)}</td><td>${esc(formatarDoc(c.parametro))}</td>
    <td style="max-width:200px">${esc(c.finalidade || '-')}</td><td>${reais(c.preco_centavos)}</td><td>${reais(c.custo_centavos || 0)}</td>
    <td>${c.status === 'concluida' ? 'Concluída' : c.status === 'falhou' ? `<span style="color:var(--erro)" title="${esc(c.erro || '')}">Falhou</span>` : 'Processando'}</td></tr>`).join('')}
</table></div></div>`;
}

export function adminRecargas({ recargas }) {
  return `<h1 style="font-size:1.7rem">Recargas</h1>${menu('/admin/recargas')}
<div class="cartao"><div class="rolar"><table class="tabela">
  <tr><th>#</th><th>Data</th><th>Cliente</th><th>Valor</th><th>Bônus</th><th>Status</th><th>Pago em</th></tr>
  ${recargas.map((r) => `<tr><td>${r.id}</td><td>${dt(r.criado_em)}</td><td>${esc(r.cliente)}</td><td>${reais(r.valor_centavos)}</td><td>${reais(r.bonus_centavos)}</td>
    <td>${r.status === 'paga' ? '<span style="color:var(--ok);font-weight:700">Paga</span>' : 'Pendente'}</td><td>${dt(r.pago_em)}</td></tr>`).join('')}
</table></div></div>`;
}
