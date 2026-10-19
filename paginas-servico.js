// Serviço de Limpa Nome: páginas do cliente e do Admin
import { esc, reais, dt } from './paginas.js';
import { formatarDoc } from './pdf.js';

export const STATUS_LN = {
  aguardando_pagamento: { t: 'Aguardando pagamento', c: '#9A6B00' },
  pago: { t: 'Pago · aguardando o lote', c: '#1E7B4D' },
  em_analise: { t: 'Em análise documental', c: '#5B2D8E' },
  em_lote: { t: 'Incluído na ação', c: '#5B2D8E' },
  em_andamento: { t: 'Aguardando decisão judicial', c: '#5B2D8E' },
  decisao: { t: 'Decisão obtida · baixas em andamento', c: '#5B2D8E' },
  concluido: { t: 'Concluído · nome limpo', c: '#1E7B4D' },
  cancelado: { t: 'Cancelado', c: '#7A7285' },
  reembolsado: { t: 'Reembolsado', c: '#7A7285' },
};
// Órgãos acompanhados um a um (o cliente vê cada baixa)
export const ORGAOS_LN = [['serasa', 'Serasa Experian'], ['spc', 'SPC Brasil'], ['boavista', 'Boa Vista (SCPC)'], ['cenprot', 'Protestos em cartório (CENPROT)']];
export const lerBaixas = (p) => { try { return JSON.parse(p.baixas || '{}') || {}; } catch { return {}; } };
const etiqueta = (s) => `<span style="display:inline-block;padding:4px 12px;border-radius:999px;font-size:.82rem;font-weight:700;background:${STATUS_LN[s]?.c || '#555'}1A;color:${STATUS_LN[s]?.c || '#555'}">${esc(STATUS_LN[s]?.t || s)}</span>`;
const dataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
// Vídeo explicativo: link do YouTube/Vimeo ou arquivo .mp4 (ex.: /criativos/limpa-nome.mp4)
export function blocoVideo(link) {
  const l = String(link || '').trim();
  if (!l) return '';
  const yt = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(l);
  const vm = /vimeo\.com\/(?:video\/)?(\d+)/.exec(l);
  const vertical = /shorts\//.test(l);
  const caixa = (inner) => `<div style="position:relative;width:100%;${vertical ? 'max-width:360px;aspect-ratio:9/16' : 'aspect-ratio:16/9'};border-radius:14px;overflow:hidden;background:#000;margin:0 auto">${inner}</div>`;
  if (yt) return caixa(`<iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0" title="Vídeo explicativo do Limpa Nome" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>`);
  if (vm) return caixa(`<iframe src="https://player.vimeo.com/video/${vm[1]}" title="Vídeo explicativo do Limpa Nome" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>`);
  if (/^\/criativos\/[a-z0-9-]{1,80}\.mp4$/.test(l)) return `<video controls playsinline preload="metadata" style="width:100%;max-height:640px;border-radius:14px;background:#000" src="${esc(l)}"></video>`;
  return '';
}
// Parcelamento com juros repassados ao cliente (Tabela Price). 1x no cartão sai pelo preço à vista.
export function tabelaParcelas(preco, max, jurosPct) {
  const i = Math.max(0, Number(jurosPct) || 0) / 100;
  return Array.from({ length: Math.max(1, max) }, (_, k) => {
    const n = k + 1;
    const parcela = n === 1 || !i ? Math.ceil(preco / n) : Math.ceil((preco * i) / (1 - (1 + i) ** -n));
    return { n, parcela, total: parcela * n };
  });
}
// Atendimento humano (WhatsApp): discreto, para quem não conseguir sozinho
const ajudaFlutuante = (cfg, q = '') => (cfg.whatsapp ? `<div style="height:64px" aria-hidden="true"></div><a href="/limpa-nome/ajuda${q}" target="_blank" rel="noopener" aria-label="Falar com o atendimento no WhatsApp" style="position:fixed;right:16px;bottom:16px;z-index:50;display:flex;align-items:center;gap:8px;background:#1FA855;color:#fff;text-decoration:none;font-weight:700;padding:12px 16px;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.25)"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4a.5.5 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.7a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg><span>Ajuda</span></a>` : '');
const ajudaCartao = (cfg, q = '') => (cfg.whatsapp ? `<div class="cartao" style="margin-bottom:18px;display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap">
  <div><h2 style="font-size:1.1rem;margin:0 0 4px">Não conseguiu fazer sozinho?</h2><p class="muted" style="margin:0">Nossa equipe te ajuda pelo WhatsApp${cfg.atendimento ? ` · ${esc(cfg.atendimento)}` : ''}.</p></div>
  <a class="btn sec" href="/limpa-nome/ajuda${q}" target="_blank" rel="noopener">Falar com o atendimento</a></div>` : '');
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

// ---------- Cliente ----------
export function paginaServicoLN({ cfg, proximoLote, pedidos, usuario, erro, v = {} }) {
  const p = (t) => esc(t || '');
  return `
<span class="tag">Serviço</span>
<h1 style="font-size:1.9rem;margin:10px 0 4px">${cfg.prazo ? p(cfg.prazo) : 'Limpa Nome'}</h1>
<p class="muted" style="margin:0 0 18px;max-width:760px">${p(cfg.resumo) || 'Ação judicial coletiva, amparada pelo Código de Defesa do Consumidor, para retirar as negativações do seu CPF ou CNPJ e garantir o "nada consta".'}</p>
${erro ? `<div class="aviso erro" role="alert">${esc(erro)}</div>` : ''}
${pedidos.length ? `<div class="cartao" style="margin-bottom:18px"><h2 style="font-size:1.2rem;margin-top:0">Seus pedidos</h2><div class="rolar"><table class="tabela">
  <tr><th>#</th><th>Titular</th><th>Lote</th><th>Status</th><th></th></tr>
  ${pedidos.map((x) => `<tr><td>${x.id}</td><td>${esc(x.nome)}<br><span class="muted">${esc(formatarDoc(x.cpf))}</span></td><td>${x.lote ? dataBR(x.lote) : '—'}</td><td>${etiqueta(x.status)}</td><td><a href="/limpa-nome/servico/${x.id}">Ver</a></td></tr>`).join('')}
</table></div></div>` : ''}
<div class="grade" style="margin-bottom:18px">
  <div class="saldo"><div style="color:#D9B8F0;font-weight:600">Valor do serviço</div><div class="valor">${reais(cfg.preco)}</div><div style="color:#D9B8F0;margin-top:6px">no Pix${cfg.parcelas > 1 ? ` ou em até ${cfg.parcelas}x de ${reais(cfg.tabela.at(-1).parcela)} no cartão` : ''}</div></div>
  <div class="cartao"><h3 style="margin-top:0">Próxima inclusão na ação</h3><p style="margin:0;font-size:1.3rem;font-weight:700">${dataBR(proximoLote)}</p><p class="muted" style="margin:6px 0 0">Os pedidos pagos entram na ação toda ${DIAS[cfg.dia]}.</p></div>
</div>
${blocoVideo(cfg.video) ? `<div class="cartao" style="margin-bottom:18px"><h2 style="font-size:1.2rem;margin-top:0">Assista: como funciona o Limpa Nome</h2>${blocoVideo(cfg.video)}</div>` : ''}
<div class="cartao" style="margin-bottom:18px">
  <h2 style="font-size:1.2rem;margin-top:0">Como funciona a ação</h2>
  <p style="margin:8px 0">Realizamos nossas ações por meio de <strong>processos judiciais amparados pelo CDC (Código de Defesa do Consumidor)</strong>, com ações protetivas em nome dos nossos clientes, através de um <strong>processo coletivo por associação</strong>. O objetivo é normalizar as suas pendências nos cadastros de crédito, com a devida <strong>remoção das negativações nos órgãos de proteção ao crédito</strong>.</p>
  <h3 style="font-size:1.05rem;margin:18px 0 6px">Ordem judicial contra os órgãos de proteção ao crédito</h3>
  <p style="margin:6px 0">O processo por ordem judicial tem como foco <strong>retirar todas as negativações do seu nome (CPF) e/ou da sua empresa (CNPJ)</strong> e garantir o <strong>"NADA CONSTA"</strong>, para que, com o nome reabilitado, você possa voltar ao mercado e buscar crédito.</p>
  <h3 style="font-size:1.05rem;margin:18px 0 6px">Qual a vantagem dessa ação?</h3>
  <p style="margin:6px 0">Você, pessoa física ou empresário, passa a ter <strong>"NADA CONSTA"</strong> nos órgãos de proteção ao crédito: as restrições desaparecem do relatório, e as outras empresas deixam de ver os seus débitos anteriores quando consultam o seu CPF ou CNPJ.</p>
  <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px">
    <div style="flex:1 1 180px;background:#F6ECFC;border-radius:12px;padding:12px 14px"><strong style="color:#5B2D8E">Prazo</strong><br>${cfg.prazo ? p(cfg.prazo) : 'até 30 dias'}</div>
    <div style="flex:1 1 180px;background:#F6ECFC;border-radius:12px;padding:12px 14px"><strong style="color:#5B2D8E">Abrangência</strong><br>Serasa, SPC, Boa Vista e protestos (CENPROT)</div>
    ${cfg.blindagem ? `<div style="flex:1 1 180px;background:#F6ECFC;border-radius:12px;padding:12px 14px"><strong style="color:#5B2D8E">Blindagem</strong><br>${cfg.blindagem} meses de acompanhamento</div>` : ''}
    <div style="flex:1 1 180px;background:#F6ECFC;border-radius:12px;padding:12px 14px"><strong style="color:#5B2D8E">Para quem</strong><br>CPF e CNPJ</div>
  </div>
  ${cfg.garantia ? `<p style="margin:16px 0 0"><strong>Garantia:</strong> ${p(cfg.garantia)}</p>` : ''}
  ${cfg.executor ? `<p class="muted" style="margin:8px 0 0">Ação conduzida por: <strong>${p(cfg.executor)}</strong></p>` : ''}
</div>
<div class="cartao" style="margin-bottom:18px">
  <h2 style="font-size:1.2rem;margin-top:0">Passo a passo</h2>
  <p style="margin:8px 0"><strong>1. Você faz o pedido.</strong> Preenche os dados do titular (CPF ou CNPJ) e envia a foto do RG ou da CNH. Leva uns 3 minutos.</p>
  <p style="margin:8px 0"><strong>2. Você paga.</strong> No Pix (confirmado na hora)${cfg.parcelas > 1 ? ` ou parcelado em até ${cfg.parcelas}x no cartão, na página segura do Asaas` : ''}. O pagamento é separado do saldo de consultas.</p>
  <p style="margin:8px 0"><strong>3. Você entra na ação coletiva da semana.</strong> Toda ${DIAS[cfg.dia]} os pedidos pagos são incluídos no processo coletivo. Próxima inclusão: <strong>${dataBR(proximoLote)}</strong>.</p>
  <p style="margin:8px 0"><strong>4. Acompanhe por aqui.</strong> Cada etapa aparece nesta página e chega no seu e-mail.</p>
  <p style="margin:8px 0"><strong>5. Confira o "nada consta".</strong> Quando o pedido for concluído, consulte o seu CPF ou CNPJ aqui na plataforma e veja o nome limpo.</p>
</div>
<div class="cartao" style="margin-bottom:18px">
  <h2 style="font-size:1.2rem;margin-top:0">Perguntas frequentes</h2>
  <details style="padding:10px 0;border-bottom:1px solid #EEE7F4"><summary style="cursor:pointer;font-weight:700">É garantido?</summary><p style="margin:8px 0 0">${cfg.garantia ? p(cfg.garantia) : 'Garantimos a retirada das negativações nos órgãos de proteção ao crédito.'} <strong>Não prometemos crédito:</strong> a aprovação de cartão, empréstimo ou financiamento depende da análise de cada empresa.</p></details>
  ${cfg.blindagem ? `<details style="padding:10px 0;border-bottom:1px solid #EEE7F4"><summary style="cursor:pointer;font-weight:700">O que é a blindagem de ${cfg.blindagem} meses?</summary><p style="margin:8px 0 0">Depois que o seu nome fica limpo, acompanhamos o seu CPF/CNPJ por ${cfg.blindagem} meses. Se alguma das negativações abrangidas pela ação voltar a aparecer nesse período, fazemos o reprotocolo <strong>sem custo adicional</strong>: é só chamar o atendimento. A blindagem não impede negativações de dívidas novas, feitas depois do pedido.</p></details>` : ''}
  <details style="padding:10px 0;border-bottom:1px solid #EEE7F4"><summary style="cursor:pointer;font-weight:700">Como acompanho o andamento?</summary><p style="margin:8px 0 0">Pela página do seu pedido. Você vê cada etapa (análise, inclusão na ação, decisão judicial) e a baixa em <strong>cada órgão separadamente</strong>: Serasa, SPC, Boa Vista e protestos. A cada atualização você também recebe um e-mail.</p></details>
  <details style="padding:10px 0;border-bottom:1px solid #EEE7F4"><summary style="cursor:pointer;font-weight:700">Quanto tempo demora?</summary><p style="margin:8px 0 0">${cfg.prazo ? p(cfg.prazo) : 'Até 30 dias'}. O prazo é contado a partir da inclusão do seu pedido na ação coletiva, que acontece toda ${DIAS[cfg.dia]}.</p></details>
  <details style="padding:10px 0;border-bottom:1px solid #EEE7F4"><summary style="cursor:pointer;font-weight:700">A minha dívida deixa de existir?</summary><p style="margin:8px 0 0">Não. A ação retira as <strong>negativações</strong> dos órgãos de proteção ao crédito (o "nome sujo") e você fica com "nada consta". A dívida em si continua com o credor, que ainda pode cobrá-la pelos meios legais. Se puder, negocie com ele também.</p></details>
  <details style="padding:10px 0;border-bottom:1px solid #EEE7F4"><summary style="cursor:pointer;font-weight:700">O que é o processo coletivo por associação?</summary><p style="margin:8px 0 0">É uma ação judicial movida por uma associação em nome de vários consumidores ao mesmo tempo, com base no Código de Defesa do Consumidor. Você não precisa contratar advogado nem ir ao fórum: basta fazer o pedido aqui e enviar o documento.</p></details>
  <details style="padding:10px 0;border-bottom:1px solid #EEE7F4"><summary style="cursor:pointer;font-weight:700">Meu nome pode voltar a ficar sujo?</summary><p style="margin:8px 0 0">Dívidas novas, que você fizer e não pagar depois do pedido, podem gerar novas negativações. E, como toda decisão judicial, ela segue o andamento do processo. Por isso recomendamos manter as contas em dia e, quando possível, negociar os débitos antigos.</p></details>
  <details style="padding:10px 0;border-bottom:1px solid #EEE7F4"><summary style="cursor:pointer;font-weight:700">Serve para empresa (CNPJ)?</summary><p style="margin:8px 0 0">Sim. Informe o CNPJ e envie o RG ou a CNH do sócio responsável.</p></details>
  <details style="padding:10px 0;border-bottom:1px solid #EEE7F4"><summary style="cursor:pointer;font-weight:700">Por que precisam do meu RG ou CNH?</summary><p style="margin:8px 0 0">Para incluir você na ação com segurança e confirmar que o pedido é do próprio titular (ou feito com autorização dele). Os documentos ficam com acesso restrito, são usados só neste serviço e são apagados automaticamente 90 dias depois de o pedido terminar.</p></details>
  <details style="padding:10px 0;border-bottom:1px solid #EEE7F4"><summary style="cursor:pointer;font-weight:700">Posso pedir para outra pessoa?</summary><p style="margin:8px 0 0">Pode, desde que você tenha autorização por escrito do titular. Envie os dados e o documento <strong>dele</strong> e desmarque a opção "meu próprio CPF/CNPJ".</p></details>
  <details style="padding:10px 0"><summary style="cursor:pointer;font-weight:700">Como sei se meu nome está negativado?</summary><p style="margin:8px 0 0">Faça uma consulta do seu CPF ou CNPJ aqui na plataforma antes do pedido. <a href="/limpa-nome">Ver consultas recomendadas</a>.</p></details>
</div>
${ajudaCartao(cfg, '?e=duvida')}
${ajudaFlutuante(cfg, erro ? '?e=erro-formulario' : '?e=pagina')}
<form class="cartao" method="post" action="/limpa-nome/servico" enctype="multipart/form-data" style="max-width:720px">
  <h2 style="font-size:1.2rem;margin-top:0">Fazer o pedido</h2>
  <div class="campo"><label for="ln-nome">Nome completo do titular (ou razão social da empresa)</label><input id="ln-nome" type="text" name="nome" required maxlength="120" value="${p(v.nome ?? usuario.nome)}"></div>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <div class="campo" style="flex:1 1 200px"><label for="ln-cpf">CPF ou CNPJ</label><input id="ln-cpf" type="text" name="cpf" required inputmode="numeric" maxlength="18" value="${p(v.cpf ?? (usuario.documento?.length === 11 ? usuario.documento : ''))}"></div>
    <div class="campo" style="flex:1 1 180px"><label for="ln-nasc">Data de nascimento (do titular ou do sócio)</label><input id="ln-nasc" name="nascimento" type="date" required value="${p(v.nascimento)}" style="font:inherit;padding:11px 13px;border:1.5px solid #D6CCE0;border-radius:12px"></div>
  </div>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <div class="campo" style="flex:1 1 200px"><label for="ln-tel">WhatsApp do titular</label><input id="ln-tel" type="tel" name="telefone" required inputmode="tel" maxlength="20" value="${p(v.telefone ?? usuario.telefone)}"></div>
    <div class="campo" style="flex:1 1 240px"><label for="ln-email">E-mail do titular</label><input id="ln-email" name="email" type="email" required maxlength="120" value="${p(v.email ?? usuario.email)}"></div>
  </div>
  <div class="campo"><label for="ln-tipo">Documento com foto (do titular ou, se for CNPJ, do sócio responsável)</label>
    <select id="ln-tipo" name="doc_tipo" required style="min-height:46px"><option value="RG" ${v.doc_tipo === 'RG' ? 'selected' : ''}>RG</option><option value="CNH" ${v.doc_tipo === 'CNH' ? 'selected' : ''}>CNH</option></select></div>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <div class="campo" style="flex:1 1 220px"><label for="ln-frente">Foto da frente</label><input id="ln-frente" name="doc_frente" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></div>
    <div class="campo" style="flex:1 1 220px"><label for="ln-verso">Foto do verso</label><input id="ln-verso" name="doc_verso" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></div>
  </div>
  <small class="muted" style="display:block;margin:-6px 0 14px">JPG, PNG ou PDF, até 5 MB cada. Na CNH digital (PDF), a frente basta.</small>
  <label style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px"><input type="checkbox" name="proprio" value="1" ${v.proprio === '0' ? '' : 'checked'} style="width:20px;height:20px;margin-top:3px"> <span>O pedido é para o <strong>meu próprio CPF/CNPJ</strong> (ou empresa da qual sou sócio). Se desmarcar, você declara ter autorização por escrito do titular.</span></label>
  <label style="display:flex;gap:10px;align-items:flex-start;margin-bottom:16px"><input type="checkbox" name="aceite" value="1" required style="width:20px;height:20px;margin-top:3px"> <span>Autorizo a minha inclusão, como associado(a), na ação judicial coletiva${cfg.executor ? ` conduzida por ${p(cfg.executor)}` : ''}, e o uso destes dados e documentos exclusivamente para este serviço. Entendo que a ação retira as negativações, que a dívida continua com o credor e que o serviço não garante aprovação de crédito.</span></label>
  <fieldset style="border:1.5px solid #D6CCE0;border-radius:14px;padding:12px 16px;margin:0 0 16px"><legend style="font-weight:700;padding:0 6px">Forma de pagamento</legend>
    <label style="display:flex;gap:10px;align-items:center;margin:6px 0"><input type="radio" name="forma" value="pix" ${v.forma === 'cartao' ? '' : 'checked'} style="width:20px;height:20px"> <span><strong>Pix</strong> · ${reais(cfg.preco)} à vista</span></label>
    ${cfg.parcelas >= 1 ? `<label style="display:flex;gap:10px;align-items:center;margin:6px 0;flex-wrap:wrap"><input type="radio" name="forma" value="cartao" ${v.forma === 'cartao' ? 'checked' : ''} style="width:20px;height:20px"> <span><strong>Cartão de crédito</strong> em</span>
      <select name="parcelas" aria-label="Número de parcelas" style="min-height:40px">${Array.from({ length: cfg.parcelas }, (_, i) => i + 1).map((n) => `<option value="${n}" ${Number(v.parcelas || cfg.parcelas) === n ? 'selected' : ''}>${n}x de ${reais(cfg.tabela[n - 1].parcela)}${n > 1 && cfg.juros > 0 ? ` (total ${reais(cfg.tabela[n - 1].total)})` : ' sem juros'}</option>`).join('')}</select></label>
      ${cfg.juros > 0 && cfg.parcelas > 1 ? `<small class="muted" style="display:block;margin:2px 0 0 30px">Parcelado a partir de 2x com juros de ${String(cfg.juros).replace('.', ',')}% ao mês, já incluídos no valor das parcelas.</small>` : ''}` : ''}
  </fieldset>
  <button class="btn" type="submit">Continuar para o pagamento</button>
</form>`;
}

export function paginaPedidoLN({ p, cfg }) {
  const passos = [
    ['aguardando_pagamento', 'Pedido criado'],
    ['pago', `Pagamento confirmado${p.pago_em ? ` em ${dt(p.pago_em)}` : ''}`],
    ['em_analise', 'Análise dos documentos'],
    ['em_lote', `Incluído na ação coletiva de ${dataBR(p.lote) || '—'}`],
    ['em_andamento', 'Aguardando decisão judicial'],
    ['decisao', 'Decisão obtida · órgãos dando baixa'],
    ['concluido', 'Concluído · nome limpo'],
  ];
  const baixas = lerBaixas(p);
  const mostraBaixas = ['em_andamento', 'decisao', 'concluido'].includes(p.status) || Object.keys(baixas).length;
  const ordem = passos.map((x) => x[0]);
  const atual = ordem.indexOf(p.status);
  const final = ['cancelado', 'reembolsado'].includes(p.status);
  return `
<p><a href="/limpa-nome/servico">← Limpa Nome</a></p>
<h1 style="font-size:1.6rem;margin:6px 0">Pedido #${p.id} · ${esc(p.nome)}</h1>
<p style="margin:0 0 18px">${etiqueta(p.status)} <span class="muted">CPF ${esc(formatarDoc(p.cpf))}</span></p>
${p.status === 'aguardando_pagamento' && p.forma_pagamento === 'cartao' ? `
<div class="cartao estreito" style="max-width:520px;text-align:center;margin-bottom:18px" data-pedido-ln="${p.id}">
  <h2 style="font-size:1.3rem;margin-top:0">Pague ${reais(p.valor_centavos)} no cartão${p.parcelas > 1 ? ` em ${p.parcelas}x` : ''}</h2>
  ${p.link_pagamento ? `<p><a class="btn" href="${esc(p.link_pagamento)}">Abrir pagamento seguro</a></p>` : ''}
  <p class="muted pulsando" aria-live="polite">Aguardando a confirmação do cartão… esta página atualiza sozinha.</p>
</div>` : ''}
${p.status === 'aguardando_pagamento' && p.forma_pagamento !== 'cartao' ? `
<div class="cartao estreito" style="max-width:520px;text-align:center;margin-bottom:18px" data-pedido-ln="${p.id}">
  <h2 style="font-size:1.3rem;margin-top:0">Pague ${reais(p.valor_centavos)} com Pix</h2>
  ${p.pix_imagem ? `<img src="data:image/png;base64,${esc(p.pix_imagem)}" alt="QR Code Pix" style="width:230px;height:230px;max-width:100%">
  <textarea id="pix-codigo" readonly rows="3" aria-label="Código Pix copia e cola" style="width:100%;font:inherit;font-size:.8rem;padding:10px;border:1.5px solid #D6CCE0;border-radius:12px;resize:none">${esc(p.pix_codigo)}</textarea>
  <button class="btn" type="button" id="copiar" style="margin:12px 0">Copiar código Pix</button>` : ''}
  ${p.link_pagamento ? `<p><a href="${esc(p.link_pagamento)}" target="_blank" rel="noopener">${p.pix_imagem ? 'Prefiro pagar pela página do Asaas' : 'Abrir página de pagamento'}</a></p>` : ''}
  <p class="muted pulsando" aria-live="polite">Aguardando pagamento… esta página atualiza sozinha.</p>
</div>` : ''}
<div class="cartao" style="max-width:620px">
  <h2 style="font-size:1.2rem;margin-top:0">Andamento</h2>
  ${final ? `<p>${etiqueta(p.status)}</p>` : passos.map(([k, t], i) => `<div style="display:flex;gap:12px;align-items:center;padding:8px 0;opacity:${i <= atual ? 1 : .45}">
    <span style="width:26px;height:26px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;background:${i <= atual ? 'var(--roxo)' : '#C9BFD4'}">${i < atual || (i === atual && k === 'concluido') ? '✓' : i + 1}</span><span>${esc(t)}</span></div>`).join('')}
  ${p.obs_admin ? `<div class="aviso" style="margin-top:12px"><strong>Atualização:</strong> ${esc(p.obs_admin)}</div>` : ''}
  ${cfg.prazo ? `<p class="muted" style="margin:12px 0 0">${esc(cfg.prazo)}</p>` : ''}
</div>
${mostraBaixas && !final ? `<div class="cartao" style="max-width:620px;margin-top:18px">
  <h2 style="font-size:1.2rem;margin-top:0">Baixa em cada órgão</h2>
  ${ORGAOS_LN.map(([k, n]) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid #EEE7F4"><span>${esc(n)}</span>${baixas[k] ? `<strong style="color:#1E7B4D">✓ Baixa em ${dataBR(baixas[k])}</strong>` : '<span class="muted">aguardando</span>'}</div>`).join('')}
  <p class="muted" style="margin:10px 0 0;font-size:.88rem">Cada órgão cumpre a decisão no seu próprio prazo. Depois da última baixa, consulte o seu CPF/CNPJ aqui na plataforma para conferir.</p>
</div>` : ''}
${p.status === 'concluido' && p.blindagem_ate ? `<div class="cartao" style="max-width:620px;margin-top:18px;border:2px solid #1E7B4D">
  <h2 style="font-size:1.2rem;margin-top:0">🛡️ Blindagem ativa até ${dataBR(p.blindagem_ate)}</h2>
  <p style="margin:0">Se alguma das negativações abrangidas pela ação voltar a aparecer até essa data, chame o atendimento: fazemos o reprotocolo sem custo.</p>
  ${cfg.whatsapp ? `<p style="margin:12px 0 0"><a class="btn sec" href="/limpa-nome/ajuda?p=${p.id}&e=blindagem" target="_blank" rel="noopener">Uma negativação voltou</a></p>` : ''}
</div>` : ''}
<div style="max-width:620px;margin-top:18px">${ajudaCartao(cfg, `?p=${p.id}&e=${p.status}`)}</div>
${ajudaFlutuante(cfg, `?p=${p.id}&e=${p.status}`)}`;
}

// ---------- Admin ----------
export function adminServicoLN({ menu, cfg, pedidos, lotes, filtro, proximoLote, ok, erro }) {
  const aviso = (ok ? `<div class="aviso ok">${esc(ok)}</div>` : '') + (erro ? `<div class="aviso erro">${esc(erro)}</div>` : '');
  const sel = (k) => (filtro === k ? '' : 'sec');
  return `<h1 style="font-size:1.7rem">Serviço Limpa Nome</h1>${menu}${aviso}
<div class="grade" style="margin-bottom:18px">
  <div class="cartao"><div class="muted">Próximo lote</div><div style="font-family:Montserrat;font-size:1.6rem;font-weight:800">${dataBR(proximoLote)}</div><div class="muted">${lotes.proximo} pedido(s) pago(s) para ele</div></div>
  <div class="cartao"><div class="muted">Pedidos pagos (total)</div><div style="font-family:Montserrat;font-size:1.6rem;font-weight:800">${lotes.pagos}</div><div class="muted">${reais(lotes.receita)} recebidos</div></div>
  <div class="cartao"><div class="muted">Aguardando pagamento</div><div style="font-family:Montserrat;font-size:1.6rem;font-weight:800">${lotes.aguardando}</div><div class="muted">${lotes.ajuda} pedido(s) de ajuda no WhatsApp em 30 dias (veja no Registro)</div></div>
</div>
<form class="cartao" method="post" action="/admin/limpa-nome/config" style="max-width:760px;margin-bottom:18px">
  <h2 style="font-size:1.2rem;margin-top:0">Configuração do serviço</h2>
  <label style="display:flex;gap:10px;align-items:center;margin-bottom:14px;font-weight:700"><input type="checkbox" name="ativo" value="1" ${cfg.ativo ? 'checked' : ''} style="width:22px;height:22px"> Serviço disponível para os clientes</label>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <div class="campo" style="flex:1 1 160px"><label for="c-preco">Preço (R$)</label><input id="c-preco" type="text" name="preco" inputmode="decimal" value="${(cfg.preco / 100).toFixed(2).replace('.', ',')}"></div>
    <div class="campo" style="flex:1 1 140px"><label for="c-parc">Parcelas no cartão (máx.)</label><input id="c-parc" type="text" name="parcelas" inputmode="numeric" value="${cfg.parcelas}"></div>
    <div class="campo" style="flex:1 1 140px"><label for="c-blind">Blindagem (meses, 0 = sem)</label><input id="c-blind" type="text" name="blindagem" inputmode="numeric" value="${cfg.blindagem}"></div>
    <div class="campo" style="flex:1 1 140px"><label for="c-juros">Juros ao mês no cartão (%)</label><input id="c-juros" type="text" name="juros" inputmode="decimal" value="${String(cfg.juros).replace('.', ',')}"></div>
    <div class="campo" style="flex:1 1 200px"><label for="c-dia">Dia do lote</label><select id="c-dia" name="dia" style="min-height:46px">${DIAS.map((d, i) => `<option value="${i}" ${cfg.dia === i ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
  </div>
  <div class="campo"><label for="c-resumo">Resumo do serviço (aparece no topo da página do cliente)</label><input id="c-resumo" type="text" name="resumo" maxlength="300" value="${esc(cfg.resumo)}"></div>
  <div class="campo"><label for="c-prazo">Prazo / promessa (vira o título da página do cliente)</label><input id="c-prazo" type="text" name="prazo" maxlength="150" value="${esc(cfg.prazo)}" placeholder="Ex.: de 30 a 90 dias após o envio do lote"></div>
  <div class="campo"><label for="c-exec">Quem conduz a ação (associação / escritório)</label><input id="c-exec" type="text" name="executor" maxlength="150" value="${esc(cfg.executor)}" placeholder="Ex.: Soft Crédito / escritório parceiro"></div>
  <div class="campo"><label for="c-gar">Garantia / reembolso</label><input id="c-gar" type="text" name="garantia" maxlength="300" value="${esc(cfg.garantia)}" placeholder="Ex.: se o nome não sair em 90 dias, devolvemos o valor"></div>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <div class="campo" style="flex:1 1 200px"><label for="c-wpp">WhatsApp do atendimento (com DDI e DDD)</label><input id="c-wpp" type="text" name="whatsapp" inputmode="numeric" value="${esc(cfg.whatsapp)}" placeholder="5547999999999"><small class="muted">Vazio = esconde o botão de ajuda.</small></div>
    <div class="campo" style="flex:1 1 240px"><label for="c-hor">Horário do atendimento</label><input id="c-hor" type="text" name="atendimento" maxlength="100" value="${esc(cfg.atendimento)}"></div>
  </div>
  <div class="campo"><label for="c-video">Vídeo explicativo (link do YouTube/Vimeo ou /criativos/limpa-nome.mp4)</label><input id="c-video" type="text" name="video" maxlength="300" value="${esc(cfg.video)}" placeholder="https://youtu.be/..."><small class="muted">Recomendado: suba no YouTube como "Não listado" e cole o link aqui.</small></div>
  <label style="display:flex;gap:10px;align-items:flex-start;margin-bottom:14px"><input type="checkbox" name="antecipar" value="1" ${cfg.antecipar ? 'checked' : ''} style="width:20px;height:20px;margin-top:3px"> <span><strong>Antecipar automaticamente os pagamentos no cartão</strong><br><span class="muted">Assim que o Asaas confirma o cartão, pedimos a antecipação do parcelamento inteiro: o valor (menos a taxa do Asaas) cai na conta em geral no próximo dia útil, em vez de mês a mês.</span></span></label>
  <p class="muted" style="margin-top:-4px">Tabela atual: ${cfg.tabela.filter((t) => t.n === 1 || t.n === 3 || t.n === 6 || t.n === cfg.parcelas).map((t) => `${t.n}x ${reais(t.parcela)} (total ${reais(t.total)})`).join(' · ')}</p>
  <button class="btn">Salvar configuração</button>
  <p class="muted" style="margin:10px 0 0">Página do cliente: <a href="/limpa-nome/servico" target="_blank" rel="noopener">/limpa-nome/servico</a></p>
</form>
<div class="cartao" style="margin-bottom:18px">
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
    <a class="btn ${sel('lote')}" style="min-height:36px;padding:6px 14px;font-size:.85rem" href="/admin/limpa-nome?f=lote">Próximo lote (${lotes.proximo})</a>
    <a class="btn ${sel('ativos')}" style="min-height:36px;padding:6px 14px;font-size:.85rem" href="/admin/limpa-nome?f=ativos">Em andamento</a>
    <a class="btn ${sel('aguardando')}" style="min-height:36px;padding:6px 14px;font-size:.85rem" href="/admin/limpa-nome?f=aguardando">Aguardando pagamento</a>
    <a class="btn ${sel('todos')}" style="min-height:36px;padding:6px 14px;font-size:.85rem" href="/admin/limpa-nome?f=todos">Todos</a>
    <span style="flex:1"></span>
    <a class="btn sec" style="min-height:36px;padding:6px 14px;font-size:.85rem" href="/admin/limpa-nome/lote.csv?lote=${proximoLote}">Baixar planilha do próximo lote (CSV)</a>
  </div>
  <form method="post" action="/admin/limpa-nome/fechar-lote" style="margin:0 0 14px">
    <input type="hidden" name="lote" value="${proximoLote}">
    <button class="btn" ${lotes.proximo ? '' : 'disabled'} data-confirmar="Marcar os ${lotes.proximo} pedido(s) do lote ${dataBR(proximoLote)} como INCLUÍDOS NA AÇÃO? Os clientes recebem um e-mail.">Marcar lote ${dataBR(proximoLote)} como incluído na ação</button>
  </form>
  <div class="rolar"><table class="tabela">
    <tr><th>#</th><th>Data</th><th>Titular</th><th>Contato</th><th>Documentos</th><th>Lote</th><th>Status</th><th>Baixas e status</th></tr>
    ${pedidos.map((x) => `<tr><td>${x.id}</td><td>${dt(x.criado_em)}</td>
      <td><strong>${esc(x.nome)}</strong><br>${esc(formatarDoc(x.cpf))}<br><span class="muted">nasc. ${dataBR(x.nascimento)}${x.titular_proprio ? '' : ' · <strong>terceiro</strong>'}</span><br><span class="muted">cliente: ${esc(x.cliente)}</span></td>
      <td>${esc(x.telefone)}<br><span class="muted">${esc(x.email)}</span></td>
      <td>${x.docs_apagados ? '<span class="muted">apagados</span>' : `${esc(x.doc_tipo)}: ${x.doc_frente ? `<a href="/admin/limpa-nome/doc/${x.id}/frente" target="_blank" rel="noopener">frente</a>` : ''}${x.doc_verso ? ` · <a href="/admin/limpa-nome/doc/${x.id}/verso" target="_blank" rel="noopener">verso</a>` : ''}`}</td>
      <td>${x.lote ? dataBR(x.lote) : '—'}</td><td>${etiqueta(x.status)}<br><span class="muted">${reais(x.valor_centavos)} · ${x.forma_pagamento === 'cartao' ? `cartão ${x.parcelas}x` : 'Pix'}</span>
      ${x.forma_pagamento === 'cartao' && x.pago_em ? `<br><span class="muted">Antecipação: <strong>${esc({ PENDING: 'em análise', CREDITED: 'creditada', DENIED: 'negada', CANCELLED: 'cancelada', OVERDUE: 'vencida', DEBITED: 'debitada', SCHEDULED: 'agendada' }[x.antecipacao_status] || x.antecipacao_status || (x.antecipacao_erro ? 'falhou' : 'aguardando'))}</strong>${x.antecipacao_liquido_centavos ? ` · líquido ${reais(x.antecipacao_liquido_centavos)}` : ''}${x.antecipacao_erro && !x.antecipacao_id ? `<br>${esc(x.antecipacao_erro)}` : ''}</span>
      ${!x.antecipacao_id ? `<form method="post" action="/admin/limpa-nome/antecipar" style="margin:4px 0 0"><input type="hidden" name="id" value="${x.id}"><button class="btn sec" style="min-height:30px;padding:2px 10px;font-size:.78rem" data-confirmar="Pedir ao Asaas a antecipação deste parcelamento agora?">Antecipar agora</button></form>` : ''}` : ''}</td>
      <td>${['em_lote', 'em_andamento', 'decisao', 'concluido'].includes(x.status) ? `<form method="post" action="/admin/limpa-nome/baixas" style="margin:0 0 8px;font-size:.82rem"><input type="hidden" name="id" value="${x.id}">
        ${ORGAOS_LN.map(([k, n]) => `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="b_${k}" value="1" ${lerBaixas(x)[k] ? 'checked' : ''}> ${esc(n.split(' (')[0])}${lerBaixas(x)[k] ? ` <span class="muted">${dataBR(lerBaixas(x)[k])}</span>` : ''}</label>`).join('')}
        <button class="btn sec" style="min-height:30px;padding:2px 10px;font-size:.78rem;margin-top:4px">Salvar baixas</button></form>` : ''}
      <form method="post" action="/admin/limpa-nome/status" style="display:flex;gap:6px;flex-wrap:wrap;margin:0">
        <input type="hidden" name="id" value="${x.id}">
        <select name="status" aria-label="Novo status" style="min-height:36px">${Object.entries(STATUS_LN).map(([k, s]) => `<option value="${k}" ${k === x.status ? 'selected' : ''}>${s.t}</option>`).join('')}</select>
        <input name="obs" maxlength="300" placeholder="Mensagem ao cliente (opcional)" aria-label="Mensagem ao cliente" value="${esc(x.obs_admin || '')}" style="width:200px;min-height:36px;padding:6px 8px">
        <button class="btn sec" style="min-height:36px;padding:4px 12px;font-size:.82rem">Salvar</button></form></td></tr>`).join('') || '<tr><td colspan="8" class="vazio">Nenhum pedido.</td></tr>'}
  </table></div>
  <p class="muted" style="margin:12px 0 0">Pagamentos no cartão aparecem como pagos quando o Asaas confirma a transação. Reembolso: faça o estorno no painel do Asaas e depois mude o status para "Reembolsado". Os documentos são apagados automaticamente 90 dias depois de o pedido ser concluído, cancelado ou reembolsado (LGPD).</p>
</div>`;
}

// ======================= MONITORAMENTO DE CPF/CNPJ =======================
const ST_MON = {
  aguardando: ['Aguardando pagamento', '#9A6B00'], ativo: ['Ativo', '#1E7B4D'], inadimplente: ['Pausado (renovação não paga)', '#B3261E'], cancelado: ['Cancelado', '#7A7285'],
};
const etqMon = (m) => {
  const [t, c] = m.status === 'ativo' && m.cancelado_em ? ['Ativo · não renova', '#9A6B00'] : ST_MON[m.status] || [m.status, '#555'];
  return `<span style="display:inline-block;padding:4px 12px;border-radius:999px;font-size:.82rem;font-weight:700;background:${c}1A;color:${c}">${esc(t)}</span>`;
};
const docMon = (d) => `${String(d).length === 14 ? 'CNPJ' : 'CPF'} ${esc(formatarDoc(d))}`;
const resumoMon = (m) => { try { return JSON.parse(m.ultimo_resumo || 'null'); } catch { return null; } };

export function paginaMonitoramento({ cfg, lista, usuario, ok, erro }) {
  const economia = Math.round((1 - cfg.anual / (cfg.mensal * 12)) * 100);
  const ativos = lista.filter((m) => m.status !== 'cancelado' || m.ultima_checagem);
  return `
<span class="tag">Proteção</span>
<h1 style="font-size:2rem;margin:10px 0 6px">Monitoramento de CPF e CNPJ</h1>
<p class="muted" style="margin:0 0 18px;max-width:760px">A gente vigia o seu documento e avisa por e-mail quando aparecer <strong>negativação nova, protesto ou queda no score</strong>. Você descobre antes de ser surpreendido no banco, na loja ou no aluguel.</p>
${ok ? `<div class="aviso ok">${esc(ok)}</div>` : ''}${erro ? `<div class="aviso erro" role="alert">${esc(erro)}</div>` : ''}
${ativos.length ? `<div class="cartao" style="margin-bottom:18px"><h2 style="font-size:1.2rem;margin-top:0">Seus monitoramentos</h2><div class="rolar"><table class="tabela">
  <tr><th>Documento</th><th>Plano</th><th>Status</th><th>Última checagem</th><th></th></tr>
  ${ativos.map((m) => { const r = resumoMon(m); return `<tr><td>${docMon(m.documento)}</td><td>${m.plano === 'anual' ? 'Anual' : 'Mensal'} · ${reais(m.valor_centavos)}</td><td>${etqMon(m)}${m.ativo_ate && m.status === 'ativo' ? `<br><span class="muted">até ${dataBR(m.ativo_ate)}</span>` : ''}</td>
    <td>${m.ultima_checagem ? `${dataBR(m.ultima_checagem)}<br><span class="muted">score ${r?.score ?? '—'} · ${r?.qtd ?? 0} restrição(ões)</span>${m.ultima_consulta_id ? `<br><a href="/consulta/${m.ultima_consulta_id}">Ver relatório</a>` : ''}` : m.status === 'ativo' ? 'em andamento…' : '—'}</td>
    <td>${m.status === 'aguardando' ? `<a class="btn sec" style="min-height:34px;padding:4px 12px;font-size:.82rem" href="/monitoramento/${m.id}">Pagar</a>` : ''}
      ${!m.cancelado_em && m.status !== 'cancelado' ? `<form method="post" action="/monitoramento/cancelar" style="margin:6px 0 0"><input type="hidden" name="id" value="${m.id}"><button class="btn sec" style="min-height:30px;padding:2px 10px;font-size:.78rem" data-confirmar="Cancelar a renovação? O monitoramento continua até o fim do período já pago.">Cancelar renovação</button></form>` : ''}</td></tr>`; }).join('')}
</table></div></div>` : ''}
<div class="grade" style="margin-bottom:18px">
  <div class="cartao"><div style="font-size:2rem">🚨</div><h3 style="margin:6px 0">Alerta de negativação</h3><p class="muted" style="margin:0">Apareceu dívida nova no seu nome? Você recebe o aviso com credor, valor e data.</p></div>
  <div class="cartao"><div style="font-size:2rem">📉</div><h3 style="margin:6px 0">Queda de score</h3><p class="muted" style="margin:0">Se o seu score cair ${cfg.quedaScore} pontos ou mais, avisamos e explicamos o que costuma causar isso.</p></div>
  <div class="cartao"><div style="font-size:2rem">🕵️</div><h3 style="margin:6px 0">Proteção contra fraude</h3><p class="muted" style="margin:0">Dívida que você não reconhece pode ser golpe com o seu CPF. Quanto antes souber, mais fácil resolver.</p></div>
  <div class="cartao"><div style="font-size:2rem">📄</div><h3 style="margin:6px 0">Relatório completo</h3><p class="muted" style="margin:0">A cada ${cfg.freq} dias, uma checagem completa em PDF: score, restrições, protestos e consultas ao seu documento.</p></div>
</div>
<form class="cartao" method="post" action="/monitoramento" style="max-width:720px;margin-bottom:18px">
  <h2 style="font-size:1.3rem;margin-top:0">Escolha seu plano</h2>
  <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
    <label style="flex:1 1 220px;border:2px solid var(--roxo);border-radius:16px;padding:16px;cursor:pointer;display:flex;gap:12px;align-items:flex-start">
      <input type="radio" name="plano" value="anual" checked style="width:20px;height:20px;margin-top:4px">
      <span><strong>Anual</strong> ${economia > 0 ? `<span class="tag">economize ${economia}%</span>` : ''}<br><span style="font-family:Montserrat,sans-serif;font-size:1.6rem;font-weight:800">${reais(cfg.anual)}</span><span class="muted">/ano</span><br><span class="muted">equivale a ${reais(Math.round(cfg.anual / 12))} por mês</span></span></label>
    <label style="flex:1 1 220px;border:1.5px solid #D6CCE0;border-radius:16px;padding:16px;cursor:pointer;display:flex;gap:12px;align-items:flex-start">
      <input type="radio" name="plano" value="mensal" style="width:20px;height:20px;margin-top:4px">
      <span><strong>Mensal</strong><br><span style="font-family:Montserrat,sans-serif;font-size:1.6rem;font-weight:800">${reais(cfg.mensal)}</span><span class="muted">/mês</span><br><span class="muted">cancele quando quiser</span></span></label>
  </div>
  <div class="campo"><label for="mon-doc">CPF ou CNPJ a monitorar</label><input id="mon-doc" type="text" name="documento" required inputmode="numeric" maxlength="18" value="${esc(usuario.documento || '')}">
    <small class="muted">Pela LGPD, só é possível monitorar o seu próprio CPF (o do cadastro) ou o CNPJ de uma empresa da qual você é responsável.</small></div>
  <label style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px"><input type="checkbox" name="responsavel" value="1" style="width:20px;height:20px;margin-top:3px"> <span>Se for CNPJ: declaro que sou sócio ou responsável pela empresa.</span></label>
  <fieldset style="border:1.5px solid #D6CCE0;border-radius:14px;padding:12px 16px;margin:0 0 14px"><legend style="font-weight:700;padding:0 6px">Pagamento</legend>
    <label style="display:flex;gap:10px;align-items:center;margin:6px 0"><input type="radio" name="forma" value="cartao" checked style="width:20px;height:20px"> <span><strong>Cartão de crédito</strong> · renova sozinho, sem você precisar lembrar</span></label>
    <label style="display:flex;gap:10px;align-items:center;margin:6px 0"><input type="radio" name="forma" value="pix" style="width:20px;height:20px"> <span><strong>Pix</strong> · enviamos o Pix por e-mail a cada renovação</span></label>
  </fieldset>
  <label style="display:flex;gap:10px;align-items:flex-start;margin-bottom:16px"><input type="checkbox" name="aceite" value="1" required style="width:20px;height:20px;margin-top:3px"> <span>Autorizo as consultas periódicas do documento informado para este monitoramento e aceito os <a href="/termos" target="_blank" rel="noopener">Termos de Uso</a>. Posso cancelar a renovação a qualquer momento.</span></label>
  <button class="btn" type="submit">Ativar meu monitoramento</button>
  <p class="muted" style="margin:12px 0 0;font-size:.88rem">O monitoramento avisa sobre mudanças; ele não impede que uma empresa negative o seu nome nem garante crédito.</p>
</form>`;
}

export function paginaPagarMonitoramento({ m }) {
  return `<div class="cartao estreito" style="max-width:520px;text-align:center" data-mon="${m.id}">
  <h1 style="font-size:1.4rem;margin-top:0">Pague ${reais(m.valor_centavos)} e ative seu monitoramento</h1>
  <p class="muted">${docMon(m.documento)} · plano ${m.plano}</p>
  ${m.pix_imagem ? `<img src="data:image/png;base64,${esc(m.pix_imagem)}" alt="QR Code Pix" style="width:230px;height:230px;max-width:100%">
  <textarea id="pix-codigo" readonly rows="3" aria-label="Código Pix copia e cola" style="width:100%;font:inherit;font-size:.8rem;padding:10px;border:1.5px solid #D6CCE0;border-radius:12px;resize:none">${esc(m.pix_codigo)}</textarea>
  <button class="btn" type="button" id="copiar" style="margin:12px 0">Copiar código Pix</button>` : ''}
  ${m.link_pagamento ? `<p><a href="${esc(m.link_pagamento)}" target="_blank" rel="noopener">${m.pix_imagem ? 'Prefiro pagar pela página do Asaas' : 'Abrir página de pagamento'}</a></p>` : ''}
  <p class="muted pulsando" aria-live="polite">Aguardando pagamento… esta página atualiza sozinha.</p>
</div>`;
}

export function adminMonitoramento({ menu, cfg, lista, ativos, mrr, produto, produtos, ok, erro }) {
  return `<h1 style="font-size:1.7rem">Monitoramento de CPF/CNPJ</h1>${menu}${ok ? `<div class="aviso ok">${esc(ok)}</div>` : ''}${erro ? `<div class="aviso erro">${esc(erro)}</div>` : ''}
<div class="grade" style="margin-bottom:18px">
  <div class="cartao"><div class="muted">Assinaturas ativas</div><div style="font-family:Montserrat,sans-serif;font-size:1.6rem;font-weight:800">${ativos}</div></div>
  <div class="cartao"><div class="muted">Receita recorrente (por mês)</div><div style="font-family:Montserrat,sans-serif;font-size:1.6rem;font-weight:800">${reais(mrr)}</div></div>
  <div class="cartao"><div class="muted">Custo por checagem</div><div style="font-family:Montserrat,sans-serif;font-size:1.6rem;font-weight:800">${produto ? reais(produto.custo_centavos) : '—'}</div><div class="muted">${produto ? esc(produto.nome) : 'configure a consulta'}</div></div>
</div>
<form class="cartao" method="post" action="/admin/monitoramento/config" style="max-width:760px;margin-bottom:18px">
  <h2 style="font-size:1.2rem;margin-top:0">Configuração</h2>
  <label style="display:flex;gap:10px;align-items:center;margin-bottom:14px;font-weight:700"><input type="checkbox" name="ativo" value="1" ${cfg.ativo ? 'checked' : ''} style="width:22px;height:22px"> Produto disponível para os clientes</label>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <div class="campo" style="flex:1 1 150px"><label for="m-men">Mensal (R$)</label><input id="m-men" type="text" name="mensal" inputmode="decimal" value="${(cfg.mensal / 100).toFixed(2).replace('.', ',')}"></div>
    <div class="campo" style="flex:1 1 150px"><label for="m-anu">Anual (R$)</label><input id="m-anu" type="text" name="anual" inputmode="decimal" value="${(cfg.anual / 100).toFixed(2).replace('.', ',')}"></div>
    <div class="campo" style="flex:1 1 150px"><label for="m-freq">Checar a cada (dias)</label><input id="m-freq" type="text" name="freq" inputmode="numeric" value="${cfg.freq}"></div>
    <div class="campo" style="flex:1 1 150px"><label for="m-q">Alerta de queda de score (pontos)</label><input id="m-q" type="text" name="queda" inputmode="numeric" value="${cfg.quedaScore}"></div>
  </div>
  <div class="campo"><label for="m-prod">Consulta usada na checagem</label><select id="m-prod" name="produto" style="min-height:46px">${produtos.map((p) => `<option value="${esc(p.slug)}" ${p.slug === cfg.produto ? 'selected' : ''}>${esc(p.nome)} · custo ${reais(p.custo_centavos)}</option>`).join('')}</select>
    <small class="muted">Escolha uma consulta com score e negativações (ex.: Cred Completa Plus). O custo sai do saldo da APIFull a cada checagem.</small></div>
  <button class="btn">Salvar</button>
  <p class="muted" style="margin:10px 0 0">Página do cliente: <a href="/monitoramento" target="_blank" rel="noopener">/monitoramento</a> · No Asaas, deixe ligado no webhook o evento <strong>"Cobrança criada"</strong> para o cliente do Pix receber o link de renovação.</p>
</form>
<div class="cartao"><div class="rolar"><table class="tabela">
  <tr><th>#</th><th>Cliente</th><th>Documento</th><th>Plano</th><th>Status</th><th>Checagens</th><th>Ações</th></tr>
  ${lista.map((m) => { const r = resumoMon(m); return `<tr><td>${m.id}</td><td>${esc(m.cliente)}<br><span class="muted">${dt(m.criado_em)}</span></td><td>${docMon(m.documento)}</td>
    <td>${m.plano} · ${m.forma}<br>${reais(m.valor_centavos)} · ${m.pagamentos} pagto(s)</td><td>${etqMon(m)}${m.ativo_ate ? `<br><span class="muted">até ${dataBR(m.ativo_ate)}</span>` : ''}</td>
    <td>${m.checagens}${m.ultima_checagem ? `<br><span class="muted">última ${dataBR(m.ultima_checagem)} · score ${r?.score ?? '—'} · ${r?.qtd ?? 0} restr.</span>` : ''}${m.proxima_checagem && m.status === 'ativo' ? `<br><span class="muted">próxima ${dataBR(m.proxima_checagem)}</span>` : ''}</td>
    <td><form method="post" action="/admin/monitoramento/acao" style="display:flex;gap:6px;flex-wrap:wrap;margin:0"><input type="hidden" name="id" value="${m.id}">
      ${m.status === 'ativo' ? '<button class="btn sec" name="acao" value="checar" style="min-height:32px;padding:4px 10px;font-size:.8rem">Checar agora</button>' : ''}
      ${m.asaas_sub_id ? '<button class="btn sec" name="acao" value="conferir" style="min-height:32px;padding:4px 10px;font-size:.8rem">Conferir no Asaas</button>' : ''}
      ${!m.cancelado_em && m.status !== 'cancelado' ? '<button class="btn sec" name="acao" value="cancelar" style="min-height:32px;padding:4px 10px;font-size:.8rem" data-confirmar="Cancelar esta assinatura?">Cancelar</button>' : ''}</form></td></tr>`; }).join('') || '<tr><td colspan="7" class="vazio">Nenhuma assinatura ainda.</td></tr>'}
</table></div></div>`;
}

// ======================= EBOOK =======================
const CAPS_EBOOK = [
  ['Raio-X do seu nome', 'Onde consultar tudo o que existe contra o seu CPF, inclusive o que ainda não foi negativado.'],
  ['Como a negativação funciona', 'A diferença entre dívida, negativação e protesto, e por que pagar nem sempre limpa o nome.'],
  ['Seus direitos', 'Aviso prévio, limite de 5 anos, baixa em 5 dias úteis: o que a lei garante e onde reclamar.'],
  ['Dívida antiga, prescrita ou indevida', 'Quando não pagar, quando contestar e o que fazer se for fraude.'],
  ['Negociação que funciona', 'A ordem certa de pagar, onde negociar e o roteiro pronto para conseguir desconto.'],
  ['Pagou? Cobre a baixa', 'O passo a passo para garantir que o nome realmente saiu dos cadastros.'],
  ['Score de verdade', 'Como a nota é calculada e os 15 hábitos que fazem ela subir.'],
  ['Cadastro Positivo', 'O aliado que quase ninguém usa direito.'],
  ['Crédito sem recusa', 'Como pedir cartão e empréstimo sem tomar "não" e derrubar o score.'],
  ['Golpes', 'Os golpes que miram quem está negativado e como proteger o seu CPF.'],
  ['Plano de 30, 60 e 90 dias', 'Checklists prontos para você sair da leitura e partir para a ação.'],
];

export function paginaVendaEbook({ cfg, comprou }) {
  const cta = (txt = 'Quero o guia agora') => comprou ? '<a class="btn" href="/ebook/baixar" style="font-size:1.05rem">Você já comprou: baixar meu guia</a>' : `<a class="btn" href="/ebook/comprar" style="font-size:1.05rem">${txt} · ${reais(cfg.preco)}</a>`;
  return `<div style="max-width:1000px;margin:0 auto">
<div style="display:flex;gap:32px;align-items:center;flex-wrap:wrap;background:#0F0C14;color:#fff;border-radius:24px;padding:32px;margin-bottom:22px;background-image:radial-gradient(600px 400px at 90% 0%,#5B2D8E 0%,transparent 70%)">
  <div style="flex:1 1 360px">
    <span class="tag" style="background:#2A2233;color:#D9B8F0">GUIA PRÁTICO · PDF</span>
    <h1 style="font-size:2.3rem;line-height:1.1;margin:14px 0 10px;color:#fff">Nome limpo e score alto, <span style="color:#C98BEB">do jeito certo</span></h1>
    <p style="color:#E2D3EE;font-size:1.1rem;margin:0 0 18px">O passo a passo para sair da lista de negativados, negociar suas dívidas pagando menos e voltar a ter crédito. Sem promessa milagrosa: só o que funciona.</p>
    <p style="margin:0 0 6px">${cfg.precoDe > cfg.preco ? `<s style="color:#9A8FA8">${reais(cfg.precoDe)}</s> ` : ''}<span style="font-family:Montserrat,sans-serif;font-size:2.2rem;font-weight:800">${reais(cfg.preco)}</span> <span style="color:#C9BFD4">no Pix ou cartão</span></p>
    <p style="margin:12px 0 0">${cta()}</p>
    <p style="color:#C9BFD4;font-size:.88rem;margin:10px 0 0">📩 Entrega imediata no seu e-mail · 🔒 Garantia de 7 dias</p>
  </div>
  <div style="flex:0 1 260px;text-align:center"><img src="/criativos/ebook-capa.png" alt="Capa do guia Nome Limpo e Score Alto" style="width:100%;max-width:260px;border-radius:10px;box-shadow:0 24px 60px rgba(0,0,0,.55);transform:rotate(-3deg)"></div>
</div>
<div class="grade" style="margin-bottom:22px">
  <div class="cartao"><div style="font-size:1.8rem">💳</div><h3 style="margin:6px 0">Cartão negado?</h3><p class="muted" style="margin:0">Descubra exatamente o que as empresas veem quando consultam o seu CPF.</p></div>
  <div class="cartao"><div style="font-size:1.8rem">📉</div><h3 style="margin:6px 0">Dívidas acumuladas?</h3><p class="muted" style="margin:0">Saiba qual pagar primeiro, qual contestar e como conseguir até 90% de desconto.</p></div>
  <div class="cartao"><div style="font-size:1.8rem">✅</div><h3 style="margin:6px 0">Pagou e o nome não saiu?</h3><p class="muted" style="margin:0">A lei dá 5 dias úteis para a baixa. Veja como cobrar o seu direito.</p></div>
</div>
<div class="cartao" style="margin-bottom:22px">
  <h2 style="font-size:1.4rem;margin-top:0">O que você vai aprender</h2>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px 22px">
    ${CAPS_EBOOK.map(([t, d], i) => `<div style="display:flex;gap:12px"><span style="flex:none;width:30px;height:30px;border-radius:50%;background:var(--roxo);color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:.85rem">${i + 1}</span><div><strong>${esc(t)}</strong><br><span class="muted">${esc(d)}</span></div></div>`).join('')}
  </div>
</div>
<div class="grade" style="margin-bottom:22px">
  <div class="cartao"><h3 style="margin-top:0">📝 Roteiros prontos</h3><p class="muted" style="margin:0">As frases exatas para negociar desconto por telefone ou chat.</p></div>
  <div class="cartao"><h3 style="margin-top:0">☑️ Checklists em cada capítulo</h3><p class="muted" style="margin:0">Você não só lê: marca o que já fez e vê o progresso.</p></div>
  <div class="cartao"><h3 style="margin-top:0">⚖️ Baseado na lei</h3><p class="muted" style="margin:0">Código de Defesa do Consumidor e decisões do STJ, explicados em linguagem simples.</p></div>
</div>
<div class="cartao" style="margin-bottom:22px">
  <h2 style="font-size:1.4rem;margin-top:0">É para você se…</h2>
  <p style="margin:6px 0">✓ seu nome está sujo e você não sabe por onde começar;</p>
  <p style="margin:6px 0">✓ você já tentou negociar e se perdeu nas propostas;</p>
  <p style="margin:6px 0">✓ precisa do nome limpo para financiar, alugar ou abrir empresa;</p>
  <p style="margin:6px 0">✓ quer subir o score de forma real, sem cair em golpe.</p>
</div>
<div class="cartao" style="margin-bottom:22px;text-align:center;border:2px solid var(--roxo)">
  <h2 style="font-size:1.5rem;margin-top:0">Garantia de 7 dias</h2>
  <p class="muted" style="max-width:620px;margin:0 auto 16px">Leia o guia inteiro. Se não achar que valeu cada centavo, peça o reembolso em até 7 dias respondendo o e-mail de entrega. Simples assim.</p>
  ${cta('Quero limpar meu nome')}
</div>
<div class="cartao" style="margin-bottom:22px">
  <h2 style="font-size:1.3rem;margin-top:0">Perguntas frequentes</h2>
  <details style="padding:10px 0;border-bottom:1px solid #EEE7F4"><summary style="cursor:pointer;font-weight:700">Como recebo o guia?</summary><p style="margin:8px 0 0">Assim que o pagamento é confirmado, o PDF chega no seu e-mail e fica disponível para baixar na sua conta da Soft Consultas.</p></details>
  <details style="padding:10px 0;border-bottom:1px solid #EEE7F4"><summary style="cursor:pointer;font-weight:700">Preciso criar conta?</summary><p style="margin:8px 0 0">Sim, é grátis e leva 30 segundos. É por ela que você baixa o guia quando quiser.</p></details>
  <details style="padding:10px 0;border-bottom:1px solid #EEE7F4"><summary style="cursor:pointer;font-weight:700">O guia limpa meu nome sozinho?</summary><p style="margin:8px 0 0">Não. Ele mostra o caminho certo, passo a passo, para você mesmo resolver. Quem segue os passos economiza dinheiro e evita armadilhas.</p></details>
  <details style="padding:10px 0;border-bottom:1px solid #EEE7F4"><summary style="cursor:pointer;font-weight:700">Quantas páginas tem?</summary><p style="margin:8px 0 0">São 26 páginas diretas ao ponto, com tabelas, roteiros e checklists. Dá para ler em cerca de 1 hora.</p></details>
  <details style="padding:10px 0"><summary style="cursor:pointer;font-weight:700">Posso pagar no cartão?</summary><p style="margin:8px 0 0">Pode: Pix (confirmado na hora) ou cartão de crédito, na página segura do Asaas.</p></details>
</div>
<p style="text-align:center;margin-bottom:10px">${cta()}</p>
</div>`;
}

export function paginaCheckoutEbook({ cfg, usuario, erro }) {
  return `<div class="cartao estreito" style="max-width:560px">
  <div style="display:flex;gap:16px;align-items:center;margin-bottom:12px"><img src="/criativos/ebook-capa.png" alt="" style="width:80px;border-radius:6px"><div><h1 style="font-size:1.3rem;margin:0">Nome Limpo e Score Alto</h1><p class="muted" style="margin:4px 0 0">Guia prático em PDF · entrega imediata</p>
  <div style="font-family:Montserrat,sans-serif;font-size:1.6rem;font-weight:800;margin-top:4px">${reais(cfg.preco)}</div></div></div>
  ${erro ? `<div class="aviso erro" role="alert">${esc(erro)}</div>` : ''}
  <form method="post" action="/ebook/comprar">
    ${usuario.documento ? '' : '<div class="campo"><label for="eb-doc">Seu CPF (para emitir o pagamento)</label><input id="eb-doc" type="text" name="documento" inputmode="numeric" required></div>'}
    <fieldset style="border:1.5px solid #D6CCE0;border-radius:14px;padding:12px 16px;margin:0 0 16px"><legend style="font-weight:700;padding:0 6px">Pagamento</legend>
      <label style="display:flex;gap:10px;align-items:center;margin:6px 0"><input type="radio" name="forma" value="pix" checked style="width:20px;height:20px"> <span><strong>Pix</strong> · confirmado na hora</span></label>
      <label style="display:flex;gap:10px;align-items:center;margin:6px 0"><input type="radio" name="forma" value="cartao" style="width:20px;height:20px"> <span><strong>Cartão de crédito</strong></span></label>
    </fieldset>
    <button class="btn largo" type="submit">Finalizar compra</button>
    <p class="muted" style="font-size:.85rem;text-align:center;margin:10px 0 0">O guia chega no e-mail ${esc(usuario.email)} · Garantia de 7 dias</p>
  </form></div>`;
}

export function paginaPagarEbook({ c }) {
  return `<div class="cartao estreito" style="max-width:520px;text-align:center" data-ebook="${c.id}">
  <h1 style="font-size:1.4rem;margin-top:0">Pague ${reais(c.valor_centavos)} e receba o guia</h1>
  ${c.pix_imagem ? `<img src="data:image/png;base64,${esc(c.pix_imagem)}" alt="QR Code Pix" style="width:230px;height:230px;max-width:100%">
  <textarea id="pix-codigo" readonly rows="3" aria-label="Código Pix copia e cola" style="width:100%;font:inherit;font-size:.8rem;padding:10px;border:1.5px solid #D6CCE0;border-radius:12px;resize:none">${esc(c.pix_codigo)}</textarea>
  <button class="btn" type="button" id="copiar" style="margin:12px 0">Copiar código Pix</button>` : ''}
  ${c.link_pagamento ? `<p><a href="${esc(c.link_pagamento)}" target="_blank" rel="noopener">${c.pix_imagem ? 'Prefiro pagar pela página do Asaas' : 'Abrir página de pagamento'}</a></p>` : ''}
  <p class="muted pulsando" aria-live="polite">Aguardando pagamento… esta página atualiza sozinha.</p>
</div>`;
}

export function paginaBaixarEbook({ c }) {
  return `<div class="cartao estreito" style="max-width:560px;text-align:center">
  <img src="/criativos/ebook-capa.png" alt="" style="width:150px;border-radius:8px;box-shadow:0 12px 30px rgba(0,0,0,.25)">
  <h1 style="font-size:1.5rem">Seu guia está pronto 📘</h1>
  <p class="muted">${c ? `Comprado em ${dt(c.pago_em)}. Também enviamos o PDF para o seu e-mail.` : 'Visualização de admin.'}</p>
  <p><a class="btn" href="/ebook/arquivo">Baixar o PDF</a></p>
  <div class="aviso" style="text-align:left;margin-top:18px"><strong>Comece pelo capítulo 1:</strong> descubra tudo o que existe no seu CPF. <a href="/consultas/cred-completa-plus">Consultar meu CPF agora →</a></div>
</div>`;
}

export function adminEbook({ menu, cfg, compras, vendas, receita, tamanho, ok, erro }) {
  return `<h1 style="font-size:1.7rem">Ebook · Nome Limpo e Score Alto</h1>${menu}${ok ? `<div class="aviso ok">${esc(ok)}</div>` : ''}${erro ? `<div class="aviso erro">${esc(erro)}</div>` : ''}
<div class="grade" style="margin-bottom:18px">
  <div class="cartao"><div class="muted">Vendas</div><div style="font-family:Montserrat,sans-serif;font-size:1.6rem;font-weight:800">${vendas}</div></div>
  <div class="cartao"><div class="muted">Receita</div><div style="font-family:Montserrat,sans-serif;font-size:1.6rem;font-weight:800">${reais(receita)}</div></div>
  <div class="cartao"><div class="muted">Arquivo</div><div style="font-weight:700">${tamanho ? `PDF enviado (${(tamanho / 1024 / 1024).toFixed(1)} MB)` : '<span style="color:var(--erro)">Nenhum PDF enviado</span>'}</div></div>
</div>
<form class="cartao" method="post" action="/admin/ebook" enctype="multipart/form-data" style="max-width:720px;margin-bottom:18px">
  <h2 style="font-size:1.2rem;margin-top:0">Configuração</h2>
  <label style="display:flex;gap:10px;align-items:center;margin-bottom:14px;font-weight:700"><input type="checkbox" name="ativo" value="1" ${cfg.ativo ? 'checked' : ''} style="width:22px;height:22px"> À venda</label>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <div class="campo" style="flex:1 1 160px"><label for="e-p">Preço (R$)</label><input id="e-p" type="text" name="preco" inputmode="decimal" value="${(cfg.preco / 100).toFixed(2).replace('.', ',')}"></div>
    <div class="campo" style="flex:1 1 160px"><label for="e-d">Preço "de" riscado (R$, opcional)</label><input id="e-d" type="text" name="preco_de" inputmode="decimal" value="${cfg.precoDe ? (cfg.precoDe / 100).toFixed(2).replace('.', ',') : ''}"></div>
  </div>
  <div class="campo"><label for="e-pdf">PDF do guia ${tamanho ? '(envie só se quiser trocar)' : ''}</label><input id="e-pdf" type="file" name="pdf" accept="application/pdf"><small class="muted">O arquivo fica guardado no servidor e só quem comprou consegue baixar.</small></div>
  <button class="btn">Salvar</button>
  <p class="muted" style="margin:10px 0 0">Página de vendas: <a href="/ebook" target="_blank" rel="noopener">/ebook</a></p>
</form>
<div class="cartao"><div class="rolar"><table class="tabela"><tr><th>#</th><th>Data</th><th>Cliente</th><th>Valor</th><th>Status</th><th>Downloads</th><th></th></tr>
${compras.map((c) => `<tr><td>${c.id}</td><td>${dt(c.criado_em)}</td><td>${esc(c.cliente)}</td><td>${reais(c.valor_centavos)} · ${c.forma}</td><td>${c.status === 'paga' ? '<strong style="color:var(--ok)">Paga</strong>' : esc(c.status)}</td><td>${c.downloads}</td>
  <td>${c.status === 'paga' ? `<form method="post" action="/admin/ebook/reenviar" style="margin:0"><input type="hidden" name="id" value="${c.id}"><button class="btn sec" style="min-height:30px;padding:2px 10px;font-size:.78rem">Reenviar e-mail</button></form>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhuma venda ainda.</td></tr>'}
</table></div></div>`;
}
