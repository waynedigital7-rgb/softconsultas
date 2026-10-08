// Páginas do painel administrativo
import { esc, reais, dt } from './paginas.js';
import { formatarDoc } from './pdf.js';

const menu = (ativo) => `<nav style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px" aria-label="Administração">
  ${[['/admin', 'Resumo'], ['/admin/financeiro', 'Financeiro'], ['/admin/produtos', 'Consultas e preços'], ['/admin/clientes', 'Clientes'], ['/admin/rede', 'Rede de clientes'], ['/admin/consultas', 'Consultas feitas'], ['/admin/recargas', 'Recargas'], ['/admin/saques', 'Saques de comissão'], ['/admin/campanhas', 'Campanhas'], ['/admin/anuncios', 'Anúncios'], ['/admin/backups', 'Backups'], ['/admin/registro', 'Registro'], ['/admin/config', 'Configurações']]
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
  ${num('Consultas internas (admin e contas internas)', m.internas, `custo ${reais(m.custoInternas)}, pago direto na APIFull`)}
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
  <tr><th>Consulta</th><th>Categoria</th><th>Endpoint</th><th>Custo</th><th>Preço</th><th>Lucro por consulta</th><th>Status</th><th></th></tr>
  ${produtos.map((p) => `<tr><td><strong>${esc(p.nome)}</strong>${p.custo_centavos ? '' : ' <span class="tag" style="color:var(--erro)">sem custo</span>'}${p.sensivel ? ' <span class="tag">sensível</span>' : ''}</td><td>${esc(p.categoria)}</td><td><code>${esc(p.endpoint || '—')}</code></td>
    <td>${reais(p.custo_centavos)}</td><td><strong>${reais(p.preco_centavos)}</strong></td>
    <td>${p.custo_centavos ? `<strong style="color:var(--ok)">${reais(p.preco_centavos - p.custo_centavos)}</strong><br><small class="muted">${Math.round(((p.preco_centavos - p.custo_centavos) / p.custo_centavos) * 100)}% sobre o custo</small>` : '—'}</td>
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
  <label class="check"><input type="checkbox" name="sensivel" value="1" ${p.sensivel ? 'checked' : ''}><span>Consulta sensível (só contas CNPJ ou clientes liberados por você)</span></label>
  <div class="campo"><label for="destaque_limpa_nome">Área Limpa Nome</label>
    <select id="destaque_limpa_nome" name="destaque_limpa_nome" style="font:inherit;padding:13px 15px;border:1.5px solid #D6CCE0;border-radius:12px;min-height:48px;background:#fff">
      ${[['', 'Não aparece'], ['economica', 'Mais em conta (triagem)'], ['completa', 'Mais completa (diagnóstico)']].map(([v, t]) => `<option value="${v}" ${(p.destaque_limpa_nome || '') === v ? 'selected' : ''}>${t}</option>`).join('')}
    </select></div>
  <button class="btn" type="submit">Salvar</button> <a class="btn sec" href="/admin/produtos">Cancelar</a>
</form>`;
}

export function adminConfig({ minimo, faixas, markup, dias = 10, comissaoMax = 100, saqueMin = 5000, alerta = 5000, primeira = { pct: 0, min: 0, ate: '' }, ok, erro }) {
  return `<h1 style="font-size:1.7rem">Configurações</h1>${menu('/admin/config')}${aviso(ok, erro)}
<form class="cartao" method="post" action="/admin/config" style="max-width:640px">
  <div class="campo"><label for="markup">Margem sobre o custo APIFull (%)</label><input id="markup" name="markup" type="text" inputmode="numeric" value="${markup}">
    <small class="muted">150 = preço de venda é o custo + 150% (custo x 2,5). Ao salvar, todos os preços são recalculados.</small></div>
  <div class="campo"><label for="minimo">Recarga mínima (R$)</label><input id="minimo" name="minimo" type="text" inputmode="decimal" value="${(minimo / 100).toFixed(2).replace('.', ',')}"></div>
  <div class="campo"><label for="faixas">Bônus de recarga</label>
    <input id="faixas" name="faixas" type="text" value="${esc(faixas.map((f) => `${f.a_partir_de / 100}=${f.percentual}`).join('; '))}">
    <small class="muted">Formato: valor=percentual, separados por ponto e vírgula. Ex.: <code>100=5; 300=10</code> (a partir de R$ 100 ganha 5%, a partir de R$ 300 ganha 10%). Deixe vazio para não dar bônus.</small></div>
  <fieldset style="border:1px solid var(--borda);border-radius:14px;padding:14px 16px;margin:0 0 16px"><legend style="font-weight:700;padding:0 6px">Oferta de primeira recarga</legend>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <div class="campo" style="flex:1 1 140px;margin:0"><label for="primeira_pct">Bônus (%)</label><input id="primeira_pct" name="primeira_pct" type="text" inputmode="numeric" value="${primeira.pct}"></div>
      <div class="campo" style="flex:1 1 160px;margin:0"><label for="primeira_min">A partir de (R$)</label><input id="primeira_min" name="primeira_min" type="text" inputmode="decimal" value="${(primeira.min / 100).toFixed(2).replace('.', ',')}"></div>
      <div class="campo" style="flex:1 1 180px;margin:0"><label for="primeira_ate">Válida até</label><input id="primeira_ate" name="primeira_ate" type="date" value="${primeira.ate || ''}" style="font:inherit;padding:11px 13px;border:1.5px solid #D6CCE0;border-radius:12px"></div>
    </div>
    <small class="muted">Vale só na primeira recarga paga de cada cliente e aparece nas páginas de campanha. Coloque 0% para desligar.</small></fieldset>
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
  <tr><th>Cliente</th><th>Documento</th><th>WhatsApp</th><th>Saldo</th><th>Desde</th><th>Consultas sensíveis</th><th>Ajustar saldo</th></tr>
  ${clientes.map((c) => `<tr><td><strong>${esc(c.nome)}</strong><br><span class="muted">${esc(c.email)}</span>${c.ativo ? '' : ' <span style="color:var(--erro)">(desativado)</span>'}</td>
    <td>${esc(formatarDoc(c.documento))}</td><td>${esc(c.telefone)}</td><td><strong>${reais(c.saldo)}</strong>${c.admin ? '<br><span class="tag">admin</span>' : c.interno ? '<br><span class="tag">interna · saldo APIFull</span>' : ''}
      ${c.admin ? '' : `<form method="post" action="/admin/clientes/interno" style="margin:6px 0 0"><input type="hidden" name="id" value="${c.id}"><input type="hidden" name="interno" value="${c.interno ? 0 : 1}"><button class="btn sec" style="min-height:30px;padding:4px 10px;font-size:.78rem">${c.interno ? 'Remover conta interna' : 'Tornar conta interna'}</button></form>`}</td><td>${dt(c.criado_em).slice(0, 10)}</td>
    <td>${c.documento.length === 14 ? '<span class="muted">liberadas (CNPJ)</span>' : `<form method="post" action="/admin/clientes/sensivel" style="margin:0"><input type="hidden" name="id" value="${c.id}"><input type="hidden" name="liberar" value="${c.liberado_sensivel ? 0 : 1}">
      <button class="btn ${c.liberado_sensivel ? 'sec' : ''}" style="min-height:36px;padding:6px 12px;font-size:.85rem">${c.liberado_sensivel ? 'Liberadas · bloquear' : 'Liberar'}</button></form>`}</td>
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
  <tr><th>#</th><th>Data</th><th>Cliente</th><th>Consulta</th><th>Documento</th><th>Finalidade</th><th>Cliente pagou</th><th>Custo APIFull</th><th>Comissão</th><th>Seu lucro</th><th>Status</th></tr>
  ${consultas.map((c) => `<tr><td>${c.id}</td><td>${dt(c.criado_em)}</td><td>${esc(c.cliente)}</td><td>${esc(c.produto)}</td><td>${esc(formatarDoc(c.parametro))}</td>
    <td style="max-width:200px">${esc(c.finalidade || '-')}</td>
    <td>${c.interno ? '<span class="muted">interna</span>' : reais(c.preco_centavos)}</td><td>${reais(c.custo_centavos || 0)}</td>
    <td>${c.comissao_centavos ? reais(c.comissao_centavos) : '—'}</td>
    <td>${c.status === 'concluida' && !c.interno ? `<strong style="color:var(--ok)">${reais(c.preco_centavos - (c.comissao_centavos || 0) - (c.custo_centavos || 0))}</strong>` : '—'}</td>
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

export function adminSaques({ saques, ok, erro }) {
  const st = { pendente: '<strong>Pendente</strong>', pago: '<span style="color:var(--ok);font-weight:700">Pago</span>', recusado: '<span style="color:var(--erro)">Recusado</span>' };
  return `<h1 style="font-size:1.7rem">Saques de comissão</h1>${menu('/admin/saques')}${aviso(ok, erro)}
<p class="muted"><strong>Pagar via Asaas</strong> envia o Pix automaticamente da sua conta Asaas para a chave do usuário. Se preferir pagar por outro banco, faça o Pix e clique em <strong>Já paguei</strong>. Se recusar, o valor volta para o saldo de comissões do usuário. Antes de pagar, confira se a chave Pix é do mesmo titular (CPF/CNPJ) da conta.</p>
<div class="cartao"><div class="rolar"><table class="tabela">
  <tr><th>#</th><th>Data</th><th>Usuário</th><th>Valor</th><th>Chave Pix</th><th>Status</th><th>Ação</th></tr>
  ${saques.map((x) => `<tr><td>${x.id}</td><td>${dt(x.criado_em)}</td><td>${esc(x.nome)}<br><span class="muted">${esc(formatarDoc(x.documento))}</span></td>
    <td><strong>${reais(x.valor_centavos)}</strong></td><td><code>${esc(x.chave_pix)}</code></td><td>${st[x.status]}${x.observacao ? `<br><small class="muted">${esc(x.observacao)}</small>` : ''}</td>
    <td>${x.status === 'pendente' ? `<form method="post" action="/admin/saques/resolver" style="display:flex;gap:6px;flex-wrap:wrap;margin:0">
      <input type="hidden" name="id" value="${x.id}"><input type="text" name="obs" placeholder="Observação" aria-label="Observação" style="width:130px;min-height:40px;padding:8px">
      <button class="btn" name="acao" value="asaas" style="min-height:40px;padding:8px 14px" data-confirmar="Enviar ${reais(x.valor_centavos)} por Pix pelo Asaas para a chave ${esc(x.chave_pix)}?">Pagar via Asaas</button>
      <button class="btn sec" name="acao" value="pagar" style="min-height:40px;padding:8px 14px">Já paguei</button>
      <button class="btn sec" name="acao" value="recusar" style="min-height:40px;padding:8px 14px">Recusar</button></form>` : '-'}</td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhum saque solicitado.</td></tr>'}
</table></div></div>`;
}

export function adminBackups({ backups, ok, persistente }) {
  const kb = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  return `<h1 style="font-size:1.7rem">Backups</h1>${menu('/admin/backups')}${aviso(ok)}
<div class="cartao" style="margin-bottom:18px">
  <p style="margin-top:0">O sistema faz uma cópia completa do banco de dados (clientes, saldos, recargas, consultas, comissões e configurações):</p>
  <ul class="muted"><li><strong>a cada atualização do site</strong>, antes de qualquer ajuste;</li><li><strong>uma vez por dia</strong>, automaticamente;</li><li>e quando você clicar em "Fazer backup agora".</li></ul>
  <p class="muted">Ficam guardadas as 30 cópias mais recentes. ${persistente ? '' : '<strong style="color:var(--erro)">Atenção: sem o disco permanente, os backups também são apagados nas atualizações.</strong>'}
  Baixe uma cópia de vez em quando (por exemplo, toda semana) e guarde num lugar seguro: o arquivo contém dados pessoais dos clientes.</p>
  <form method="post" action="/admin/backups/criar"><button class="btn" type="submit">Fazer backup agora</button></form>
</div>
<div class="cartao"><div class="rolar"><table class="tabela">
  <tr><th>Data</th><th>Arquivo</th><th>Tamanho</th><th></th></tr>
  ${backups.map((b) => `<tr><td>${esc(new Date(b.data).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}</td><td><code>${esc(b.nome)}</code></td><td>${kb(b.tamanho)}</td>
    <td><a href="/admin/backups/baixar?arquivo=${encodeURIComponent(b.nome)}">Baixar</a></td></tr>`).join('') || '<tr><td colspan="4" class="vazio">Nenhum backup ainda.</td></tr>'}
</table></div></div>`;
}

export function adminRede({ clientes, busca = '' }) {
  const porId = new Map(clientes.map((c) => [c.id, { ...c, filhos: [] }]));
  const raizes = [];
  for (const c of porId.values()) {
    const pai = c.indicado_por && porId.get(c.indicado_por);
    if (pai && pai.id !== c.id) pai.filhos.push(c); else raizes.push(c);
  }
  // Totais da rede (o próprio cliente + todos abaixo dele)
  const totais = (n) => n.filhos.reduce((t, f) => { const x = totais(f); return { pessoas: t.pessoas + x.pessoas, lucro: t.lucro + x.lucro, consultas: t.consultas + x.consultas }; },
    { pessoas: 1, lucro: n.lucro, consultas: n.consultas });
  const t = busca.toLowerCase();
  const casa = (n) => !t || `${n.nome} ${n.email} ${n.documento}`.toLowerCase().includes(t) || n.filhos.some(casa);
  const linha = (n, nivel) => {
    const tot = totais(n);
    const info = `<div style="display:flex;flex-wrap:wrap;gap:6px 18px;align-items:baseline">
        <strong>${esc(n.nome)}</strong>${n.admin ? ' <span class="tag">admin</span>' : ''}${n.ativo ? '' : ' <span class="tag" style="color:var(--erro)">desativado</span>'}
        <span class="muted">${esc(n.email)} · ${esc(formatarDoc(n.documento))} · ${esc(n.telefone)}</span></div>
      <div class="muted" style="font-size:.88rem;display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:4px">
        <span>Saldo: <strong>${reais(n.saldo)}</strong></span><span>Recarregou: ${reais(n.recarregado)}</span>
        <span>Consultas: ${n.consultas}</span><span>Seu lucro com ele: <strong style="color:var(--ok)">${reais(n.lucro)}</strong></span>
        ${n.filhos.length ? `<span>Indicados diretos: <strong>${n.filhos.length}</strong> (comissão ${n.comissao_percentual}%)</span>
        <span>Comissões ganhas: ${reais(n.comissoes_ganhas)} · a sacar: ${reais(n.comissoes_saldo)}</span>
        <span>Rede total: ${tot.pessoas - 1} pessoa(s), ${tot.consultas} consultas, lucro ${reais(tot.lucro)}</span>` : ''}
        <span>Desde ${dt(n.criado_em).slice(0, 10)}</span></div>`;
    const filhos = n.filhos.filter(casa);
    return filhos.length
      ? `<details ${nivel === 0 && !t ? '' : 'open'} style="border-left:3px solid ${nivel ? 'var(--borda)' : 'var(--roxo)'};padding:10px 0 10px 14px;margin:8px 0 8px ${nivel ? 18 : 0}px">
          <summary style="cursor:pointer;list-style:none">${info}</summary>${filhos.map((f) => linha(f, nivel + 1)).join('')}</details>`
      : `<div style="border-left:3px solid var(--borda);padding:10px 0 10px 14px;margin:8px 0 8px ${nivel ? 18 : 0}px">${info}</div>`;
  };
  const visiveis = raizes.filter(casa);
  const totalIndicados = clientes.filter((c) => c.indicado_por).length;
  return `<h1 style="font-size:1.7rem">Rede de clientes</h1>${menu('/admin/rede')}
<div class="grade" style="margin-bottom:18px">
  ${num('Clientes', clientes.length)}${num('Chegaram por indicação', totalIndicados, `${clientes.length ? Math.round((totalIndicados / clientes.length) * 100) : 0}% da base`)}
  ${num('Indicadores ativos', new Set(clientes.filter((c) => c.indicado_por).map((c) => c.indicado_por)).size)}
</div>
<form method="get" class="cartao" style="padding:16px;display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
  <input type="text" name="busca" value="${esc(busca)}" placeholder="Buscar por nome, e-mail ou documento" aria-label="Buscar na rede" style="flex:1 1 240px"><button class="btn">Buscar</button></form>
<div class="cartao"><p class="muted" style="margin-top:0">Clique num cliente com indicados para abrir a rede dele. A linha roxa marca quem chegou sem indicação.</p>
  ${visiveis.length ? visiveis.map((r) => linha(r, 0)).join('') : '<div class="vazio">Nenhum cliente encontrado.</div>'}
</div>`;
}

export function adminRegistro({ linhas }) {
  return `<h1 style="font-size:1.7rem">Registro de alterações</h1>${menu('/admin/registro')}
<p class="muted">Tudo o que é alterado no Admin fica registrado aqui, com data e responsável. Os 500 registros mais recentes são exibidos.</p>
<div class="cartao"><div class="rolar"><table class="tabela">
  <tr><th>Data</th><th>Quem</th><th>Ação</th><th>Detalhes</th></tr>
  ${linhas.map((l) => `<tr><td>${dt(l.criado_em)}</td><td>${esc(l.admin_email)}</td><td><strong>${esc(l.acao)}</strong></td><td>${esc(l.detalhe)}</td></tr>`).join('') || '<tr><td colspan="4" class="vazio">Nenhuma alteração registrada ainda.</td></tr>'}
</table></div></div>`;
}

// ---------- Painel financeiro ----------
function graficoDiario(dias, ini, fim) {
  // preenche dias sem movimento
  const mapa = new Map(dias.map((d) => [d.dia, d]));
  const lista = [];
  for (let t = new Date(ini + 'T12:00:00Z'); t <= new Date(fim + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1)) {
    const k = t.toISOString().slice(0, 10);
    const d = mapa.get(k) || { receita: 0, custo: 0, n: 0 };
    lista.push({ dia: k, receita: d.receita, lucro: d.receita - d.custo, n: d.n });
  }
  const W = 900, H = 260, E = 54, B = 34, T = 14;
  const max = Math.max(100, ...lista.map((d) => d.receita));
  const larg = (W - E - 10) / lista.length;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const linhas = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${E}" x2="${W - 10}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="#EEE6F5"/>
    <text x="${E - 6}" y="${y(max * f) + 4}" text-anchor="end" font-size="11" fill="#5B5466">${(max * f / 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</text>`).join('');
  const barras = lista.map((d, i) => `<rect x="${E + i * larg + larg * 0.15}" y="${y(d.receita)}" width="${Math.max(1, larg * 0.7)}" height="${H - B - y(d.receita)}" rx="3" fill="#E4CCF4"><title>${d.dia.split('-').reverse().join('/')}: faturamento ${(d.receita / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}, ${d.n} consulta(s)</title></rect>`).join('');
  const pontos = lista.map((d, i) => `${E + i * larg + larg / 2},${y(Math.max(0, d.lucro))}`).join(' ');
  const passo = Math.max(1, Math.ceil(lista.length / 10));
  const rotulos = lista.map((d, i) => (i % passo === 0 ? `<text x="${E + i * larg + larg / 2}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#5B5466">${d.dia.slice(8)}/${d.dia.slice(5, 7)}</text>` : '')).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Faturamento e lucro por dia">${linhas}${barras}
    <polyline points="${pontos}" fill="none" stroke="#9F31D3" stroke-width="2.5" stroke-linejoin="round"/>${rotulos}</svg>
    <div class="muted" style="font-size:.85rem;display:flex;gap:16px"><span><span style="display:inline-block;width:12px;height:12px;background:#E4CCF4;border-radius:3px;vertical-align:-1px"></span> Faturamento</span>
    <span><span style="display:inline-block;width:14px;height:3px;background:#9F31D3;vertical-align:3px"></span> Lucro</span><span>valores em R$</span></div>`;
}
function barrasH(itens, valor, rotulo, cor = '#9F31D3') {
  const max = Math.max(1, ...itens.map(valor));
  return itens.map((it) => `<div style="margin:10px 0">
    <div style="display:flex;justify-content:space-between;gap:10px;font-size:.92rem"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.nome || it.produto)}</span><strong>${rotulo(it)}</strong></div>
    <div style="height:8px;background:#F1E9F8;border-radius:999px;margin-top:5px;overflow:hidden"><div style="height:100%;width:${Math.max(2, (valor(it) / max) * 100)}%;background:${cor};border-radius:999px"></div></div></div>`).join('') || '<div class="vazio">Sem dados no período.</div>';
}
export function adminFinanceiro({ ini, fim, totais, recargas, novos, diario, porProduto, topGasto, topComissao, extrato, saldoApiFull, clientesTotal, saldoCarteiras }) {
  const receita = totais.bruto - totais.comissoes;
  const lucro = receita - totais.custo;
  const margem = receita ? Math.round((lucro / receita) * 100) : 0;
  const ticket = totais.n ? Math.round(receita / totais.n) : 0;
  const tipoCor = { Recarga: 'var(--ok)', Consulta: 'var(--roxo)', 'Consulta interna': 'var(--cinza)', 'Comissão': '#B7791F', 'Saque pago': 'var(--erro)' };
  return `<h1 style="font-size:1.7rem">Financeiro</h1>${menu('/admin/financeiro')}
<form method="get" class="cartao" style="padding:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:18px">
  <div class="campo" style="margin:0"><label for="inicio">Data inicial</label><input id="inicio" name="inicio" type="date" value="${ini}" style="font:inherit;padding:11px 13px;border:1.5px solid #D6CCE0;border-radius:12px"></div>
  <div class="campo" style="margin:0"><label for="fim">Data final</label><input id="fim" name="fim" type="date" value="${fim}" style="font:inherit;padding:11px 13px;border:1.5px solid #D6CCE0;border-radius:12px"></div>
  <button class="btn">Aplicar</button>
  <span class="muted" style="font-size:.85rem">Atalhos: <a href="?inicio=${fim}&fim=${fim}">hoje</a> · <a href="/admin/financeiro">30 dias</a></span>
</form>
<div class="grade" style="margin-bottom:18px">
  ${num('Recargas pagas', reais(recargas.total), `${recargas.n} recarga(s) · ${reais(recargas.bonus)} em bônus`)}
  ${num('Faturamento com consultas', reais(receita), `${totais.n} consultas · ticket médio ${reais(ticket)}`)}
  ${num('Custo APIFull', reais(totais.custo), saldoApiFull === null ? 'saldo APIFull indisponível' : `saldo atual na APIFull: ${reais(saldoApiFull)}`)}
  <div class="cartao"><div class="muted">Lucro no período</div><div style="font-family:Montserrat;font-size:1.8rem;font-weight:800;color:var(--ok)">${reais(lucro)}</div><div class="muted" style="font-size:.85rem">margem de ${margem}% sobre o faturamento</div></div>
</div>
<div class="grade" style="margin-bottom:18px">
  ${num('Clientes', clientesTotal, `${novos} novo(s) no período · ${totais.clientes} consultaram`)}
  ${num('Comissões de indicação', reais(totais.comissoes), 'pagas pelos indicados, acima do seu preço')}
  ${num('Saldo nas carteiras', reais(saldoCarteiras), 'créditos dos clientes ainda não usados')}
</div>
<div class="cartao" style="margin-bottom:18px"><h3>Evolução diária</h3>${graficoDiario(diario, ini, fim)}</div>
<div class="grade" style="margin-bottom:18px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
  <div class="cartao"><h3>Quem mais gasta</h3>${barrasH(topGasto, (x) => x.gasto, (x) => `${reais(x.gasto)} · ${x.n} consultas`)}</div>
  <div class="cartao"><h3>Quem mais ganha comissão</h3>${barrasH(topComissao, (x) => x.ganho, (x) => `${reais(x.ganho)} · ${x.n} consultas`, '#B7791F')}</div>
</div>
<div class="cartao" style="margin-bottom:18px"><h3>Lucro por consulta</h3><div class="rolar"><table class="tabela">
  <tr><th>Consulta</th><th>Qtde</th><th>Faturamento</th><th>Custo APIFull</th><th>Lucro</th><th>Lucro médio</th><th>Margem</th></tr>
  ${porProduto.map((p) => { const l = p.receita - p.custo; return `<tr><td><strong>${esc(p.produto)}</strong></td><td>${p.n}</td><td>${reais(p.receita)}</td><td>${reais(p.custo)}</td>
    <td><strong style="color:var(--ok)">${reais(l)}</strong></td><td>${reais(Math.round(l / p.n))}</td><td>${p.receita ? Math.round((l / p.receita) * 100) : 0}%</td></tr>`; }).join('') || '<tr><td colspan="7" class="vazio">Sem consultas no período.</td></tr>'}
</table></div></div>
<div class="cartao"><h3>Extrato detalhado</h3><p class="muted" style="margin-top:-6px">Até 300 movimentações mais recentes do período.</p><div class="rolar"><table class="tabela">
  <tr><th>Data</th><th>Tipo</th><th>Cliente</th><th>Detalhe</th><th style="text-align:right">Valor</th><th style="text-align:right">Seu lucro</th></tr>
  ${extrato.map((e) => `<tr><td>${dt(e.quando)}</td><td><span style="color:${tipoCor[e.tipo] || 'inherit'};font-weight:700">${esc(e.tipo)}</span></td><td>${esc(e.cliente)}</td><td>${esc(e.item)}</td>
    <td style="text-align:right">${e.valor < 0 ? '-' : ''}${reais(Math.abs(e.valor))}</td><td style="text-align:right">${e.lucro === null ? '—' : `<strong style="color:var(--ok)">${reais(e.lucro)}</strong>`}</td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Sem movimentações no período.</td></tr>'}
</table></div></div>`;
}

// ---------- Anúncios ----------
export function adminAnuncios({ anuncios, ok, erro }) {
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const status = (a) => (!a.ativo ? '<span class="muted">Pausado</span>' : a.fim && a.fim < hoje ? '<span style="color:var(--erro)">Encerrado</span>'
    : a.inicio && a.inicio > hoje ? 'Agendado' : '<span style="color:var(--ok);font-weight:700">No ar</span>');
  return `<h1 style="font-size:1.7rem">Anúncios</h1>${menu('/admin/anuncios')}${aviso(ok, erro)}
<div class="cartao" style="margin-bottom:18px">
  <h3>Novo anúncio</h3>
  <p class="muted">O banner aparece na página inicial e no painel dos clientes, alternando a cada 6 segundos. Use uma imagem horizontal de <strong>1600 × 400 px</strong> (proporção 4:1), em PNG, JPG ou WEBP, com até 3 MB. No celular, o banner é cortado nas laterais: deixe o texto importante no centro.</p>
  <form method="post" action="/admin/anuncios/criar" enctype="multipart/form-data" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px 16px;align-items:end">
    <div class="campo" style="margin:0"><label for="anunciante">Anunciante</label><input id="anunciante" name="anunciante" type="text" required></div>
    <div class="campo" style="margin:0"><label for="titulo">Texto alternativo (descrição do banner)</label><input id="titulo" name="titulo" type="text"></div>
    <div class="campo" style="margin:0"><label for="link">Link de destino</label><input id="link" name="link" type="text" placeholder="https://"></div>
    <div class="campo" style="margin:0"><label for="valor">Valor cobrado (R$, opcional)</label><input id="valor" name="valor" type="text" inputmode="decimal"></div>
    <div class="campo" style="margin:0"><label for="inicio">Início</label><input id="inicio" name="inicio" type="date" style="font:inherit;padding:11px 13px;border:1.5px solid #D6CCE0;border-radius:12px"></div>
    <div class="campo" style="margin:0"><label for="fim">Fim</label><input id="fim" name="fim" type="date" style="font:inherit;padding:11px 13px;border:1.5px solid #D6CCE0;border-radius:12px"></div>
    <div class="campo" style="margin:0"><label for="imagem">Imagem do banner</label><input id="imagem" name="imagem" type="file" accept="image/png,image/jpeg,image/webp" required></div>
    <button class="btn" type="submit">Publicar anúncio</button>
  </form>
</div>
<div class="cartao"><div class="rolar"><table class="tabela">
  <tr><th>Banner</th><th>Anunciante</th><th>Período</th><th>Exibições</th><th>Cliques</th><th>CTR</th><th>Valor</th><th>Status</th><th></th></tr>
  ${anuncios.map((a) => `<tr><td><img src="/anuncio-img/${a.id}" alt="" style="width:160px;aspect-ratio:4/1;object-fit:cover;border-radius:8px"></td>
    <td><strong>${esc(a.anunciante)}</strong><br><small class="muted">${esc(a.link || 'sem link')}</small></td>
    <td>${a.inicio ? a.inicio.split('-').reverse().join('/') : 'já'} → ${a.fim ? a.fim.split('-').reverse().join('/') : 'sem fim'}</td>
    <td>${a.impressoes}</td><td>${a.cliques}</td><td>${a.impressoes ? ((a.cliques / a.impressoes) * 100).toFixed(1) : '0.0'}%</td><td>${a.valor_centavos ? reais(a.valor_centavos) : '—'}</td><td>${status(a)}</td>
    <td><form method="post" action="/admin/anuncios/acao" style="display:flex;gap:6px;margin:0"><input type="hidden" name="id" value="${a.id}">
      <button class="btn sec" name="acao" value="alternar" style="min-height:36px;padding:6px 12px">${a.ativo ? 'Pausar' : 'Ativar'}</button>
      <button class="btn sec" name="acao" value="excluir" style="min-height:36px;padding:6px 12px" data-confirmar="Excluir o anúncio de ${esc(a.anunciante)}?">Excluir</button></form></td></tr>`).join('') || '<tr><td colspan="9" class="vazio">Nenhum anúncio cadastrado. Enquanto não houver, aparece o espaço "Anuncie aqui".</td></tr>'}
</table></div></div>`;
}

// ---------- Campanhas de tráfego pago ----------
export function adminCampanhas({ ini, fim, linhas, rastreio, base }) {
  const site = base || 'https://softconsultas.com';
  const paginas = [['limpa-nome', 'Profissionais de limpa nome'], ['advogados', 'Advogados'], ['empresas', 'Empresas']];
  const exemplo = (pub, fonte, meio) => `${site}/para/${pub}?utm_source=${fonte}&utm_medium=${meio}&utm_campaign=${pub}`;
  const tot = linhas.reduce((t, l) => ({ c: t.c + l.cadastros, p: t.p + l.pagantes, r: t.r + l.recarregado, l: t.l + l.lucro }), { c: 0, p: 0, r: 0, l: 0 });
  return `<h1 style="font-size:1.7rem">Campanhas</h1>${menu('/admin/campanhas')}
<form method="get" class="cartao" style="padding:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:18px">
  <div class="campo" style="margin:0"><label for="inicio">Cadastros de</label><input id="inicio" name="inicio" type="date" value="${ini}" style="font:inherit;padding:11px 13px;border:1.5px solid #D6CCE0;border-radius:12px"></div>
  <div class="campo" style="margin:0"><label for="fim">até</label><input id="fim" name="fim" type="date" value="${fim}" style="font:inherit;padding:11px 13px;border:1.5px solid #D6CCE0;border-radius:12px"></div>
  <button class="btn">Aplicar</button></form>
<div class="grade" style="margin-bottom:18px">
  ${num('Cadastros', tot.c)}${num('Viraram pagantes', tot.p, `${tot.c ? Math.round((tot.p / tot.c) * 100) : 0}% dos cadastros`)}
  ${num('Recarregado por eles', reais(tot.r))}${num('Seu lucro com eles', reais(tot.l))}
</div>
<div class="cartao" style="margin-bottom:18px"><h3>Resultado por campanha</h3>
  <p class="muted" style="margin-top:-6px">Clientes cadastrados no período, agrupados pela campanha de onde vieram. Compare o lucro de cada uma com o que você gastou em anúncios.</p>
  <div class="rolar"><table class="tabela"><tr><th>Campanha</th><th>Fonte</th><th>Cadastros</th><th>Pagantes</th><th>Conversão</th><th>Recarregado</th><th>Consultas</th><th>Seu lucro</th></tr>
  ${linhas.map((l) => `<tr><td><strong>${esc(l.campanha)}</strong></td><td>${esc(l.fonte)}</td><td>${l.cadastros}</td><td>${l.pagantes}</td><td>${l.cadastros ? Math.round((l.pagantes / l.cadastros) * 100) : 0}%</td>
    <td>${reais(l.recarregado)}</td><td>${l.consultas}</td><td><strong style="color:var(--ok)">${reais(l.lucro)}</strong></td></tr>`).join('') || '<tr><td colspan="8" class="vazio">Nenhum cadastro no período.</td></tr>'}
  </table></div></div>
<div class="cartao" style="margin-bottom:18px"><h3>Páginas de campanha e links prontos</h3>
  <p class="muted" style="margin-top:-6px">Use estes links nos anúncios. O sistema registra de onde cada cliente veio. Troque <code>utm_campaign</code> para separar anúncios diferentes (ex.: limpa-nome-video1).</p>
  ${paginas.map(([pub, nome]) => `<div style="border-top:1px solid var(--borda);padding:12px 0">
    <strong>${nome}</strong> · <a href="/para/${pub}" target="_blank" rel="noopener">ver página</a>
    <div class="muted" style="font-size:.85rem;margin-top:6px">Meta (Instagram/Facebook):</div><code style="word-break:break-all;font-size:.82rem">${esc(exemplo(pub, 'meta', 'pago'))}</code>
    <div class="muted" style="font-size:.85rem;margin-top:6px">Google Ads:</div><code style="word-break:break-all;font-size:.82rem">${esc(exemplo(pub, 'google', 'cpc'))}</code></div>`).join('')}
</div>
<div class="cartao"><h3>Pixel e tags</h3>
  <table class="tabela">
    <tr><td>Pixel da Meta (<code>META_PIXEL_ID</code>)</td><td>${rastreio.meta ? '<strong style="color:var(--ok)">ativo</strong>' : '<span class="muted">não configurado</span>'}</td></tr>
    <tr><td>Google Analytics / Ads (<code>GOOGLE_TAG_ID</code>)</td><td>${rastreio.google ? '<strong style="color:var(--ok)">ativo</strong>' : '<span class="muted">não configurado</span>'}</td></tr>
    <tr><td>Conversão Google Ads: cadastro (<code>GOOGLE_ADS_CONV_CADASTRO</code>)</td><td>${rastreio.convCadastro ? '<strong style="color:var(--ok)">ativo</strong>' : '<span class="muted">opcional</span>'}</td></tr>
    <tr><td>Conversão Google Ads: recarga (<code>GOOGLE_ADS_CONV_RECARGA</code>)</td><td>${rastreio.convRecarga ? '<strong style="color:var(--ok)">ativo</strong>' : '<span class="muted">opcional</span>'}</td></tr>
  </table>
  <p class="muted" style="font-size:.88rem;margin-bottom:0">Eventos enviados: visita de página, clique em "Criar conta" (Lead), cadastro concluído (CompleteRegistration / sign_up) e recarga paga com o valor (Purchase).</p>
</div>`;
}
