// Páginas do painel administrativo
import { esc, reais, dt } from './paginas.js';
import { formatarDoc } from './pdf.js';

const menu = (ativo) => `<nav style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px" aria-label="Administração">
  ${[['/admin', 'Resumo'], ['/admin/produtos', 'Consultas e preços'], ['/admin/clientes', 'Clientes'], ['/admin/consultas', 'Consultas feitas'], ['/admin/recargas', 'Recargas'], ['/admin/saques', 'Saques de comissão'], ['/admin/config', 'Configurações']]
    .map(([h, t]) => `<a class="btn ${h === ativo ? '' : 'sec'}" style="min-height:40px;padding:8px 18px" href="${h}">${t}</a>`).join('')}
</nav>`;
const num = (rot, val, sub = '') => `<div class="cartao"><div class="muted">${rot}</div><div style="font-family:Montserrat;font-size:1.8rem;font-weight:800">${val}</div>${sub ? `<div class="muted" style="font-size:.85rem">${sub}</div>` : ''}</div>`;
const aviso = (ok, erro) => (ok ? `<div class="aviso ok">${esc(ok)}</div>` : '') + (erro ? `<div class="aviso erro">${esc(erro)}</div>` : '');

export function adminResumo({ m, ok }) {
  const baixo = m.saldoApiFull !== null && m.saldoApiFull < m.alertaApiFull;
  return `<h1 style="font-size:1.7rem">Administração</h1>${menu('/admin')}${aviso(ok)}
${m.saldoApiFull === null ? '<div class="aviso erro">Não foi possível ler o saldo da APIFull agora. Confira o APIFULL_TOKEN no Render.</div>' : ''}
${baixo ? `<div class="aviso erro" role="alert"><strong>Saldo da APIFull baixo: ${reais(m.saldoApiFull)}.</strong> Se acabar, as consultas dos clientes falham. <a href="https://app.apifull.com.br" target="_blank" rel="noopener">Recarregar na APIFull</a></div>` : ''}
<div class="grade" style="margin-bottom:18px">
  <div class="cartao" style="${baixo ? 'border-color:var(--erro)' : ''}"><div class="muted">Saldo na APIFull</div>
    <div style="font-family:Montserrat;font-size:1.8rem;font-weight:800;color:${baixo ? 'var(--erro)' : 'inherit'}">${m.saldoApiFull === null ? '—' : reais(m.saldoApiFull)}</div>
    <div class="muted" style="font-size:.85rem">alerta abaixo de ${reais(m.alertaApiFull)} · <a href="https://app.apifull.com.br" target="_blank" rel="noopener">recarregar</a></div></div>
  ${num('Consultas internas (admin)', m.internas, `custo ${reais(m.custoInternas)}, pago direto na APIFull`)}
</div>
<div class="grade" style="margin-bottom:18px">
  ${num('Clientes', m.clientes, `${m.clientesMes} nos últimos 30 dias`)}
  ${num('Recargas pagas', reais(m.recargas), `${m.qtdRecargas} recargas · ${reais(m.bonus)} em bônus`)}
  ${num('Saldo em carteiras', reais(m.saldos), 'créditos ainda não usados')}
</div>
<div class="grade">
  ${num('Consultas concluídas', m.consultas, `${m.falhas} falharam e foram estornadas`)}
  ${num('Faturamento com consultas', reais(m.faturamento), 'sem as comissões de indicação')}
  ${num('Custo APIFull', reais(m.custo), `Margem: ${reais(m.faturamento - m.custo)}`)}
</div>
<div class="grade" style="margin-top:18px">
  ${num('Comissões de indicação', reais(m.comissoes), 'pagas pelos indicados, acima do seu preço')}
  ${num('Saques a pagar', reais(m.saquesPendentes), `${m.qtdSaquesPendentes} pedido(s) aguardando · <a href="/admin/saques">ver</a>`)}
</div>`;
}

export function adminProdutos({ produtos, markup, ok }) {
  return `<h1 style="font-size:1.7rem">Consultas e preços</h1>${menu('/admin/produtos')}${aviso(ok)}
<p class="muted">Preço de venda = custo APIFull + ${markup}% (ajuste a porcentagem em Configurações). Só aparecem para os clientes as consultas <strong>ativas</strong> e com endpoint preenchido.</p>
<div class="cartao"><div class="rolar"><table class="tabela">
  <tr><th>Consulta</th><th>Categoria</th><th>Endpoint</th><th>Custo</th><th>Preço</th><th>Status</th><th></th></tr>
  ${produtos.map((p) => `<tr><td><strong>${esc(p.nome)}</strong>${p.custo_centavos ? '' : ' <span class="tag" style="color:var(--erro)">sem custo</span>'}</td><td>${esc(p.categoria)}</td><td><code>${esc(p.endpoint || '—')}</code></td>
    <td>${reais(p.custo_centavos)}</td><td><strong>${reais(p.preco_centavos)}</strong></td>
    <td>${p.ativo && p.endpoint ? '<span style="color:var(--ok);font-weight:700">Ativa</span>' : '<span class="muted">Inativa</span>'}</td>
    <td><a href="/admin/produtos/editar?id=${p.id}">Editar</a></td></tr>`).join('')}
</table></div>
<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px"><a class="btn" href="/admin/produtos/editar">+ Nova consulta</a><a class="btn sec" href="/admin/produtos/importar">Importar em lote</a></div></div>`;
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
      ${[['cpf_cnpj', 'CPF ou CNPJ'], ['cpf', 'Somente CPF'], ['cnpj', 'Somente CNPJ'], ['placa', 'Placa de veículo'], ['cep', 'CEP']].map(([v, t]) => `<option value="${v}" ${p.documento === v ? 'selected' : ''}>${t}</option>`).join('')}
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

export function adminConfig({ minimo, faixas, markup, dias = 10, comissaoMax = 100, saqueMin = 5000, alerta = 5000, ok, erro }) {
  return `<h1 style="font-size:1.7rem">Configurações</h1>${menu('/admin/config')}${aviso(ok, erro)}
<form class="cartao" method="post" action="/admin/config" style="max-width:640px">
  <div class="campo"><label for="markup">Margem sobre o custo APIFull (%)</label><input id="markup" name="markup" type="text" inputmode="numeric" value="${markup}">
    <small class="muted">150 = preço de venda é o custo + 150% (custo x 2,5). Ao salvar, todos os preços são recalculados.</small></div>
  <div class="campo"><label for="minimo">Recarga mínima (R$)</label><input id="minimo" name="minimo" type="text" inputmode="decimal" value="${(minimo / 100).toFixed(2).replace('.', ',')}"></div>
  <div class="campo"><label for="faixas">Bônus de recarga</label>
    <input id="faixas" name="faixas" type="text" value="${esc(faixas.map((f) => `${f.a_partir_de / 100}=${f.percentual}`).join('; '))}">
    <small class="muted">Formato: valor=percentual, separados por ponto e vírgula. Ex.: <code>100=5; 300=10</code> (a partir de R$ 100 ganha 5%, a partir de R$ 300 ganha 10%). Deixe vazio para não dar bônus.</small></div>
  <div class="campo"><label for="dias">Dias de histórico disponível para o cliente</label><input id="dias" name="dias" type="text" inputmode="numeric" value="${dias}">
    <small class="muted">Depois desse prazo, o resultado e o PDF de cada consulta são apagados automaticamente (LGPD). O registro da consulta continua no Admin.</small></div>
  <div class="campo"><label for="comissao_maxima">Comissão máxima de indicação (%)</label><input id="comissao_maxima" name="comissao_maxima" type="text" inputmode="numeric" value="${comissaoMax}">
    <small class="muted">Limite que cada usuário pode somar ao preço das consultas dos indicados.</small></div>
  <div class="campo"><label for="alerta_apifull">Avisar quando o saldo da APIFull ficar abaixo de (R$)</label><input id="alerta_apifull" name="alerta_apifull" type="text" inputmode="decimal" value="${(alerta / 100).toFixed(2).replace('.', ',')}"></div>
  <div class="campo"><label for="saque_minimo">Saque mínimo de comissões (R$)</label><input id="saque_minimo" name="saque_minimo" type="text" inputmode="decimal" value="${(saqueMin / 100).toFixed(2).replace('.', ',')}"></div>
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

export function adminImportar({ texto = '', resultado, erro }) {
  return `<h1 style="font-size:1.7rem">Importar consultas em lote</h1>${menu('/admin/produtos')}${aviso('', erro)}
${resultado ? `<div class="aviso ok">${esc(resultado)}</div>` : ''}
<div class="cartao" style="margin-bottom:18px">
  <h3>Como preencher</h3>
  <p class="muted">Uma consulta por linha, com os campos separados por ponto e vírgula (;). Nome e endpoint são obrigatórios:</p>
  <p><code>Nome; Endpoint; Custo; Categoria; Documento; Descrição; Campo</code></p>
  <ul class="muted">
    <li><strong>Custo:</strong> valor na APIFull, ex.: <code>5,83</code>. O preço de venda é calculado sozinho. <strong>Sem custo, a consulta entra inativa</strong> até você informar o custo.</li>
    <li><strong>Campo</strong> (opcional): nome do campo enviado à APIFull. Padrão: <code>document</code> (ou <code>placa</code> para veículos).</li>
    <li><strong>Categoria</strong> (opcional): ex.: Dívidas e Crédito, Veículos, Empresas, Dados. Padrão: Dívidas e Crédito.</li>
    <li><strong>Documento</strong> (opcional): <code>cpf_cnpj</code> (padrão), <code>cpf</code>, <code>cnpj</code>, <code>placa</code> ou <code>cep</code>.</li>
    <li>Se o endpoint já estiver cadastrado, a consulta é <strong>atualizada</strong>. Se não, é criada (ativa quando tem custo).</li>
  </ul>
  <p class="muted" style="margin:0">Exemplo:<br><code>Serasa Premium; serasa-premium; 15,72; Dívidas e Crédito; cpf_cnpj; Score e negativações Serasa</code><br><code>Consulta Veicular Completa; veiculo-completo; 12,50; Veículos; placa</code></p>
</div>
<form class="cartao" method="post" action="/admin/produtos/importar">
  <label for="texto">Cole a lista aqui</label>
  <textarea id="texto" name="texto" rows="14" style="width:100%;font:inherit;font-family:monospace;font-size:.9rem;padding:12px;border:1.5px solid #D6CCE0;border-radius:12px;margin:8px 0 14px">${esc(texto)}</textarea>
  <button class="btn" type="submit">Importar</button>
</form>`;
}

export function adminSaques({ saques, ok }) {
  const st = { pendente: '<strong>Pendente</strong>', pago: '<span style="color:var(--ok);font-weight:700">Pago</span>', recusado: '<span style="color:var(--erro)">Recusado</span>' };
  return `<h1 style="font-size:1.7rem">Saques de comissão</h1>${menu('/admin/saques')}${aviso(ok)}
<p class="muted">Faça o Pix pelo seu banco ou pelo Asaas para a chave informada e depois marque como <strong>pago</strong>. Se recusar, o valor volta para o saldo de comissões do usuário. Confira se a chave Pix é do mesmo titular (CPF/CNPJ) da conta.</p>
<div class="cartao"><div class="rolar"><table class="tabela">
  <tr><th>#</th><th>Data</th><th>Usuário</th><th>Valor</th><th>Chave Pix</th><th>Status</th><th>Ação</th></tr>
  ${saques.map((x) => `<tr><td>${x.id}</td><td>${dt(x.criado_em)}</td><td>${esc(x.nome)}<br><span class="muted">${esc(formatarDoc(x.documento))}</span></td>
    <td><strong>${reais(x.valor_centavos)}</strong></td><td><code>${esc(x.chave_pix)}</code></td><td>${st[x.status]}${x.observacao ? `<br><small class="muted">${esc(x.observacao)}</small>` : ''}</td>
    <td>${x.status === 'pendente' ? `<form method="post" action="/admin/saques/resolver" style="display:flex;gap:6px;flex-wrap:wrap;margin:0">
      <input type="hidden" name="id" value="${x.id}"><input type="text" name="obs" placeholder="Observação" aria-label="Observação" style="width:130px;min-height:40px;padding:8px">
      <button class="btn" name="acao" value="pagar" style="min-height:40px;padding:8px 14px">Marcar pago</button>
      <button class="btn sec" name="acao" value="recusar" style="min-height:40px;padding:8px 14px">Recusar</button></form>` : '-'}</td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhum saque solicitado.</td></tr>'}
</table></div></div>`;
}
