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
export const SERVICOS = { limpa_nome: 'Limpa Nome', rating: 'Rating Bancário', combo: 'Limpa Nome + Rating Bancário' };
// Rating: mesmos status, nomes próprios (não tem lote nem baixa por órgão)
const STATUS_RTG = { pago: 'Pago · início em breve', em_analise: 'Análise do perfil bancário', em_andamento: 'Rating em andamento', decisao: 'Reavaliação do perfil', concluido: 'Concluído' };
// Órgãos acompanhados um a um (o cliente vê cada baixa)
export const ORGAOS_LN = [['serasa', 'Serasa Experian'], ['spc', 'SPC Brasil'], ['boavista', 'Boa Vista (SCPC)'], ['cenprot', 'Protestos em cartório (CENPROT)']];
export const lerBaixas = (p) => { try { return JSON.parse(p.baixas || '{}') || {}; } catch { return {}; } };
const etiqueta = (s, svc) => `<span style="display:inline-block;padding:4px 12px;border-radius:999px;font-size:.82rem;font-weight:700;background:${STATUS_LN[s]?.c || '#555'}1A;color:${STATUS_LN[s]?.c || '#555'}">${esc((svc === 'rating' && STATUS_RTG[s]) || STATUS_LN[s]?.t || s)}</span>`;
const tagServico = (svc) => (svc && svc !== 'limpa_nome' ? ` <span class="tag" style="font-size:.72rem">${esc(SERVICOS[svc] || svc)}</span>` : '');
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
// Combo Limpa Nome + Rating: opção no formulário (o valor final aparece na página de pagamento)
const blocoCombo = (combo, v = {}) => `<label style="display:flex;gap:12px;align-items:flex-start;margin:0 0 16px;padding:14px 16px;border:2px solid #9F31D3;border-radius:14px;background:#FBF6FE">
  <input type="checkbox" name="combo" value="1" ${v.combo === '1' ? 'checked' : ''} style="width:22px;height:22px;margin-top:2px">
  <span><strong>Quero o combo Limpa Nome + Rating Bancário por ${reais(combo.preco)}</strong>${combo.precoSeparado > combo.preco ? ` <span style="color:#1E7B4D;font-weight:700">(economize ${reais(combo.precoSeparado - combo.preco)})</span>` : ''}<br>
  <span class="muted">Primeiro limpamos o nome; assim que concluir, começamos o trabalho no seu perfil junto aos bancos${combo.prazoRating ? ` (${esc(combo.prazoRating.toLowerCase())})` : ''}.</span></span></label>`;
// Atendimento humano (WhatsApp): discreto, para quem não conseguir sozinho
const ajudaFlutuante = (cfg, q = '') => (cfg.whatsapp ? `<div style="height:64px" aria-hidden="true"></div><a href="${cfg.ajudaUrl || '/limpa-nome/ajuda'}${q}" target="_blank" rel="noopener" aria-label="Falar com o atendimento no WhatsApp" style="position:fixed;right:16px;bottom:16px;z-index:50;display:flex;align-items:center;gap:8px;background:#1FA855;color:#fff;text-decoration:none;font-weight:700;padding:12px 16px;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.25)"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4a.5.5 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.7a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg><span>Ajuda</span></a>` : '');
const ajudaCartao = (cfg, q = '') => (cfg.whatsapp ? `<div class="cartao" style="margin-bottom:18px;display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap">
  <div><h2 style="font-size:1.1rem;margin:0 0 4px">Não conseguiu fazer sozinho?</h2><p class="muted" style="margin:0">Nossa equipe te ajuda pelo WhatsApp${cfg.atendimento ? ` · ${esc(cfg.atendimento)}` : ''}.</p></div>
  <a class="btn sec" href="${cfg.ajudaUrl || '/limpa-nome/ajuda'}${q}" target="_blank" rel="noopener">Falar com o atendimento</a></div>` : '');
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

// ---------- Cliente ----------
export function paginaServicoLN({ cfg, combo = null, proximoLote, pedidos, usuario, erro, v = {} }) {
  const p = (t) => esc(t || '');
  return `
<span class="tag">Serviço</span>
<h1 style="font-size:1.9rem;margin:10px 0 4px">${cfg.prazo ? p(cfg.prazo) : 'Limpa Nome'}</h1>
<p class="muted" style="margin:0 0 18px;max-width:760px">${p(cfg.resumo) || 'Ação judicial coletiva, amparada pelo Código de Defesa do Consumidor, para retirar as negativações do seu CPF ou CNPJ e garantir o "nada consta".'}</p>
${erro ? `<div class="aviso erro" role="alert">${esc(erro)}</div>` : ''}
${pedidos.length ? `<div class="cartao" style="margin-bottom:18px"><h2 style="font-size:1.2rem;margin-top:0">Seus pedidos</h2><div class="rolar"><table class="tabela">
  <tr><th>#</th><th>Titular</th><th>Lote</th><th>Status</th><th></th></tr>
  ${pedidos.map((x) => `<tr><td>${x.id}</td><td>${esc(x.nome)}${tagServico(x.servico)}<br><span class="muted">${esc(formatarDoc(x.cpf))}</span></td><td>${x.lote ? dataBR(x.lote) : '—'}</td><td>${etiqueta(x.status, x.servico)}</td><td><a href="/limpa-nome/servico/${x.id}">Ver</a></td></tr>`).join('')}
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
  ${combo?.ativo ? blocoCombo(combo, v) : ''}
  <fieldset style="border:1.5px solid #D6CCE0;border-radius:14px;padding:12px 16px;margin:0 0 16px"><legend style="font-weight:700;padding:0 6px">Forma de pagamento</legend>
    <label style="display:flex;gap:10px;align-items:center;margin:6px 0"><input type="radio" name="forma" value="pix" ${v.forma === 'cartao' ? '' : 'checked'} style="width:20px;height:20px"> <span><strong>Pix</strong> · ${reais(cfg.preco)} à vista${combo?.ativo ? ` <span class="muted">(combo: ${reais(combo.preco)})</span>` : ''}</span></label>
    ${cfg.parcelas >= 1 ? `<label style="display:flex;gap:10px;align-items:center;margin:6px 0;flex-wrap:wrap"><input type="radio" name="forma" value="cartao" ${v.forma === 'cartao' ? 'checked' : ''} style="width:20px;height:20px"> <span><strong>Cartão de crédito</strong> em</span>
      <select name="parcelas" aria-label="Número de parcelas" style="min-height:40px">${Array.from({ length: cfg.parcelas }, (_, i) => i + 1).map((n) => `<option value="${n}" ${Number(v.parcelas || cfg.parcelas) === n ? 'selected' : ''}>${n}x de ${reais(cfg.tabela[n - 1].parcela)}${n > 1 && cfg.juros > 0 ? ` (total ${reais(cfg.tabela[n - 1].total)})` : ' sem juros'}</option>`).join('')}</select></label>
      ${cfg.juros > 0 && cfg.parcelas > 1 ? `<small class="muted" style="display:block;margin:2px 0 0 30px">Parcelado a partir de 2x com juros de ${String(cfg.juros).replace('.', ',')}% ao mês, já incluídos no valor das parcelas.</small>` : ''}` : ''}
  </fieldset>
  <button class="btn" type="submit">Continuar para o pagamento</button>
</form>`;
}

export function paginaPedidoLN({ p, cfg, voltar = ['/limpa-nome/servico', '← Limpa Nome'], statusUrl = '', semPagamento = false, topo = '', filho = null, pai = null }) {
  const rating = p.servico === 'rating';
  const linkRel = (x) => (x.token ? `/ln/${x.token}` : x.servico === 'rating' ? `/rating/${x.id}` : `/limpa-nome/servico/${x.id}`);
  const passos = rating ? [
    ['aguardando_pagamento', 'Pedido criado'],
    ['pago', p.combo_de ? 'Garantido no combo · começa após o Limpa Nome' : `Pagamento confirmado${p.pago_em ? ` em ${dt(p.pago_em)}` : ''}`],
    ['em_analise', 'Análise do seu perfil bancário (Registrato/SCR, score, Cadastro Positivo)'],
    ['em_andamento', 'Trabalho no seu rating: cadastro, Cadastro Positivo e relacionamento'],
    ['decisao', 'Reavaliação do perfil'],
    ['concluido', 'Concluído'],
  ] : [
    ['aguardando_pagamento', 'Pedido criado'],
    ['pago', `Pagamento confirmado${p.pago_em ? ` em ${dt(p.pago_em)}` : ''}`],
    ['em_analise', 'Análise dos documentos'],
    ['em_lote', `Incluído na ação coletiva de ${dataBR(p.lote) || '—'}`],
    ['em_andamento', 'Aguardando decisão judicial'],
    ['decisao', 'Decisão obtida · órgãos dando baixa'],
    ['concluido', 'Concluído · nome limpo'],
  ];
  const baixas = lerBaixas(p);
  const mostraBaixas = !rating && (['em_andamento', 'decisao', 'concluido'].includes(p.status) || Object.keys(baixas).length);
  const ordem = passos.map((x) => x[0]);
  const atual = ordem.indexOf(p.status);
  const final = ['cancelado', 'reembolsado'].includes(p.status);
  return `
${voltar ? `<p><a href="${esc(voltar[0])}">${esc(voltar[1])}</a></p>` : ''}
<h1 style="font-size:1.6rem;margin:6px 0">${esc(SERVICOS[p.servico] || 'Limpa Nome')} · Pedido #${p.id}</h1>
<p style="margin:0 0 18px">${etiqueta(p.status, p.servico)} <span class="muted">${esc(p.nome)} · ${String(p.cpf).length === 14 ? 'CNPJ' : 'CPF'} ${esc(formatarDoc(p.cpf))}</span></p>
${filho ? `<div class="aviso" style="max-width:620px">Este pedido é um <strong>combo</strong>: o seu <strong>Rating Bancário</strong> (pedido #${filho.id}) começa assim que o Limpa Nome for concluído. <a href="${esc(linkRel(filho))}">Acompanhar o Rating</a></div>` : ''}
${pai ? `<div class="aviso" style="max-width:620px">Este Rating faz parte do <strong>combo</strong> do pedido #${pai.id} (Limpa Nome). <a href="${esc(linkRel(pai))}">Ver o Limpa Nome</a></div>` : ''}
${topo}
${p.status === 'aguardando_pagamento' && semPagamento ? `<div class="cartao estreito" style="max-width:520px;text-align:center;margin-bottom:18px" data-pedido-ln="${p.id}"${statusUrl ? ` data-status-url="${esc(statusUrl)}"` : ''}><p style="margin:0">Aguardando a confirmação do pagamento. Esta página atualiza sozinha.</p></div>` : ''}
${p.status === 'aguardando_pagamento' && !semPagamento && p.forma_pagamento === 'cartao' ? `
<div class="cartao estreito" style="max-width:520px;text-align:center;margin-bottom:18px" data-pedido-ln="${p.id}"${statusUrl ? ` data-status-url="${esc(statusUrl)}"` : ''}>
  <h2 style="font-size:1.3rem;margin-top:0">Pague ${reais(p.valor_centavos)} no cartão${p.parcelas > 1 ? ` em ${p.parcelas}x` : ''}</h2>
  ${p.link_pagamento ? `<p><a class="btn" href="${esc(p.link_pagamento)}">Abrir pagamento seguro</a></p>` : ''}
  <p class="muted pulsando" aria-live="polite">Aguardando a confirmação do cartão… esta página atualiza sozinha.</p>
</div>` : ''}
${p.status === 'aguardando_pagamento' && !semPagamento && p.forma_pagamento !== 'cartao' ? `
<div class="cartao estreito" style="max-width:520px;text-align:center;margin-bottom:18px" data-pedido-ln="${p.id}"${statusUrl ? ` data-status-url="${esc(statusUrl)}"` : ''}>
  <h2 style="font-size:1.3rem;margin-top:0">Pague ${reais(p.valor_centavos)} com Pix</h2>
  ${p.pix_imagem ? `<img src="data:image/png;base64,${esc(p.pix_imagem)}" alt="QR Code Pix" style="width:230px;height:230px;max-width:100%">
  <textarea id="pix-codigo" readonly rows="3" aria-label="Código Pix copia e cola" style="width:100%;font:inherit;font-size:.8rem;padding:10px;border:1.5px solid #D6CCE0;border-radius:12px;resize:none">${esc(p.pix_codigo)}</textarea>
  <button class="btn" type="button" id="copiar" style="margin:12px 0">Copiar código Pix</button>` : ''}
  ${p.link_pagamento ? `<p><a href="${esc(p.link_pagamento)}" target="_blank" rel="noopener">${p.pix_imagem ? 'Prefiro pagar pela página do Asaas' : 'Abrir página de pagamento'}</a></p>` : ''}
  <p class="muted pulsando" aria-live="polite">Aguardando pagamento… esta página atualiza sozinha.</p>
</div>` : ''}
<div class="cartao" style="max-width:620px">
  <h2 style="font-size:1.2rem;margin-top:0">Andamento</h2>
  ${final ? `<p>${etiqueta(p.status, p.servico)}</p>` : passos.map(([k, t], i) => `<div style="display:flex;gap:12px;align-items:center;padding:8px 0;opacity:${i <= atual ? 1 : .45}">
    <span style="width:26px;height:26px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;background:${i <= atual ? 'var(--roxo)' : '#C9BFD4'}">${i < atual || (i === atual && k === 'concluido') ? '✓' : i + 1}</span><span>${esc(t)}</span></div>`).join('')}
  ${p.obs_admin ? `<div class="aviso" style="margin-top:12px"><strong>Atualização:</strong> ${esc(p.obs_admin)}</div>` : ''}
  ${cfg.prazo ? `<p class="muted" style="margin:12px 0 0">${esc(cfg.prazo)}</p>` : ''}
</div>
${mostraBaixas && !final ? `<div class="cartao" style="max-width:620px;margin-top:18px">
  <h2 style="font-size:1.2rem;margin-top:0">Baixa em cada órgão</h2>
  ${ORGAOS_LN.map(([k, n]) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid #EEE7F4"><span>${esc(n)}</span>${baixas[k] ? `<strong style="color:#1E7B4D">✓ Baixa em ${dataBR(baixas[k])}</strong>` : '<span class="muted">aguardando</span>'}</div>`).join('')}
  <p class="muted" style="margin:10px 0 0;font-size:.88rem">Cada órgão cumpre a decisão no seu próprio prazo. Depois da última baixa, consulte o seu CPF/CNPJ aqui na plataforma para conferir.</p>
</div>` : ''}
${!rating && p.status === 'concluido' && p.blindagem_ate ? `<div class="cartao" style="max-width:620px;margin-top:18px;border:2px solid #1E7B4D">
  <h2 style="font-size:1.2rem;margin-top:0">🛡️ Blindagem ativa até ${dataBR(p.blindagem_ate)}</h2>
  <p style="margin:0">Se alguma das negativações abrangidas pela ação voltar a aparecer até essa data, chame o atendimento: fazemos o reprotocolo sem custo.</p>
  ${cfg.whatsapp ? `<p style="margin:12px 0 0"><a class="btn sec" href="${cfg.ajudaUrl || '/limpa-nome/ajuda'}?p=${p.id}&e=blindagem" target="_blank" rel="noopener">Uma negativação voltou</a></p>` : ''}
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
      <td><strong>${esc(x.nome)}</strong>${tagServico(x.servico)}<br>${esc(formatarDoc(x.cpf))}<br><span class="muted">nasc. ${dataBR(x.nascimento)}${x.titular_proprio ? '' : ' · <strong>terceiro</strong>'}</span><br><span class="muted">${x.parceiro_id ? `<strong style="color:#5B2D8E">parceiro: ${esc(x.parceiro_nome || '')}</strong> · ${x.parceiro_modelo === 'atacado' ? 'atacado' : `comissão ${reais(x.parceiro_comissao_centavos)}`}` : `cliente: ${esc(x.cliente)}`}</span></td>
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

export function paginaPagarEbook({ c, titulo = '', destino = '' }) {
  return `<div class="cartao estreito" style="max-width:520px;text-align:center" data-ebook="${c.id}" ${destino ? `data-destino="${esc(destino)}"` : ''}>
  <h1 style="font-size:1.4rem;margin-top:0">${titulo ? esc(titulo) : `Pague ${reais(c.valor_centavos)} e receba o guia`}</h1>
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

// ======================= RAIO-X DO CPF (venda avulsa, sem cadastro) =======================
export function paginaVendaRaioX({ cfg, v = {}, erro = '' }) {
  const f = (k) => esc(v[k] ?? '');
  return `<div style="max-width:1000px;margin:0 auto">
<div style="background:#0F0C14;color:#fff;border-radius:24px;padding:32px;margin-bottom:22px;background-image:radial-gradient(600px 400px at 90% 0%,#5B2D8E 0%,transparent 70%)">
  <span class="tag" style="background:#2A2233;color:#D9B8F0">RAIO-X DO CPF · NO SEU E-MAIL EM MINUTOS</span>
  <h1 style="font-size:2.3rem;line-height:1.1;margin:14px 0 10px;color:#fff;max-width:760px">Descubra por que seu crédito é negado <span style="color:#C98BEB">e o que fazer, passo a passo</span></h1>
  <p style="color:#E2D3EE;font-size:1.1rem;margin:0 0 18px;max-width:720px">Não é só uma consulta: o Raio-X analisa o seu CPF ou CNPJ e envia para o seu e-mail um PDF com diagnóstico em linguagem simples e um plano de ação feito para o seu caso.</p>
  <p style="margin:0 0 6px">${cfg.precoDe > cfg.preco ? `<s style="color:#9A8FA8">${reais(cfg.precoDe)}</s> ` : ''}<span style="font-family:Montserrat,sans-serif;font-size:2.2rem;font-weight:800">${reais(cfg.preco)}</span> <span style="color:#C9BFD4">pagamento único · Pix ou cartão · sem cadastro</span></p>
  <p style="margin:12px 0 0"><a class="btn" href="#pedido" style="font-size:1.05rem">Quero meu Raio-X</a></p>
</div>
<div class="grade" style="margin-bottom:22px">
  <div class="cartao"><div style="font-size:1.8rem">🔎</div><h3 style="margin:6px 0">Tudo o que aparece no seu nome</h3><p class="muted" style="margin:0">Score, restrições, protestos, ações, cheques e quem consultou o seu documento.</p></div>
  <div class="cartao"><div style="font-size:1.8rem">🩺</div><h3 style="margin:6px 0">Diagnóstico claro</h3><p class="muted" style="margin:0">O que está travando o seu crédito: dívidas antigas, consultas demais, cadastro positivo desligado, score baixo.</p></div>
  <div class="cartao"><div style="font-size:1.8rem">🗺️</div><h3 style="margin:6px 0">Plano de ação</h3><p class="muted" style="margin:0">O que fazer agora, em 30 e em 90 dias, na ordem certa, com base na lei e no seu resultado.</p></div>
  <div class="cartao"><div style="font-size:1.8rem">📩</div><h3 style="margin:6px 0">Direto no e-mail</h3><p class="muted" style="margin:0">Pagou, recebeu: o PDF chega no seu e-mail em poucos minutos. Sem criar conta.</p></div>
</div>
<div style="display:flex;gap:22px;flex-wrap:wrap;align-items:flex-start;margin-bottom:22px">
  <div class="cartao" style="flex:1 1 320px">
    <h2 style="font-size:1.3rem;margin-top:0">Exemplos do que o Raio-X aponta</h2>
    <p style="margin:8px 0">⚠️ <strong>"1 registro tem mais de 5 anos"</strong>: pela lei, ele não pode mais aparecer. Você pode pedir a retirada.</p>
    <p style="margin:8px 0">📉 <strong>"6 consultas ao seu CPF"</strong>: pedir crédito em vários lugares derruba o score. Espere 90 dias.</p>
    <p style="margin:8px 0">✅ <strong>"Cadastro Positivo desligado"</strong>: ative de graça e o mercado passa a ver o que você paga em dia.</p>
    <p style="margin:8px 0">🧭 <strong>Próximo passo recomendado</strong>: negociar, Limpa Nome ou trabalhar o score, conforme o seu caso.</p>
  </div>
  <form id="pedido" class="cartao" method="post" action="/raio-x" style="flex:1 1 380px">
    <h2 style="font-size:1.3rem;margin-top:0">Fazer meu Raio-X · ${reais(cfg.preco)}</h2>
    ${erro ? `<div class="aviso erro" role="alert">${esc(erro)}</div>` : ''}
    <div class="campo"><label for="rx-nome">Nome completo</label><input id="rx-nome" type="text" name="nome" required maxlength="120" value="${f('nome')}"></div>
    <div class="campo"><label for="rx-doc">CPF ou CNPJ</label><input id="rx-doc" type="text" name="documento" inputmode="numeric" maxlength="18" required value="${f('documento')}"></div>
    <div class="campo"><label for="rx-email">E-mail (o Raio-X chega aqui)</label><input id="rx-email" type="email" name="email" required maxlength="120" value="${f('email')}"></div>
    <div class="campo"><label for="rx-wpp">WhatsApp (opcional)</label><input id="rx-wpp" type="tel" name="whatsapp" inputmode="tel" maxlength="20" value="${f('whatsapp')}"></div>
    <fieldset style="border:1.5px solid #D6CCE0;border-radius:14px;padding:12px 16px;margin:0 0 14px"><legend style="font-weight:700;padding:0 6px">Pagamento</legend>
      <label style="display:flex;gap:10px;align-items:center;margin:6px 0"><input type="radio" name="forma" value="pix" ${v.forma === 'cartao' ? '' : 'checked'} style="width:20px;height:20px"> <span><strong>Pix</strong> · confirmado na hora</span></label>
      <label style="display:flex;gap:10px;align-items:center;margin:6px 0"><input type="radio" name="forma" value="cartao" ${v.forma === 'cartao' ? 'checked' : ''} style="width:20px;height:20px"> <span><strong>Cartão de crédito</strong></span></label>
    </fieldset>
    <label style="display:flex;gap:10px;align-items:flex-start;margin-bottom:16px"><input type="checkbox" name="aceite" value="1" required style="width:20px;height:20px;margin-top:3px"> <span>Declaro que sou o titular do CPF (ou responsável pela empresa do CNPJ) e autorizo a consulta para gerar o meu Raio-X, conforme a LGPD e os <a href="/termos" target="_blank" rel="noopener">Termos de Uso</a>.</span></label>
    <button class="btn largo" type="submit">Pagar e receber meu Raio-X</button>
    <p class="muted" style="font-size:.82rem;margin:10px 0 0;text-align:center">O Raio-X é informativo: ajuda você a entender e agir, mas não garante aprovação de crédito.</p>
  </form>
</div>
<div class="cartao" style="margin-bottom:22px">
  <h2 style="font-size:1.3rem;margin-top:0">Perguntas frequentes</h2>
  <details style="padding:10px 0;border-bottom:1px solid #EEE7F4"><summary style="cursor:pointer;font-weight:700">Qual a diferença para uma consulta comum?</summary><p style="margin:8px 0 0">A consulta mostra os dados. O Raio-X explica o que eles significam para o seu crédito e diz o que fazer, na ordem certa.</p></details>
  <details style="padding:10px 0;border-bottom:1px solid #EEE7F4"><summary style="cursor:pointer;font-weight:700">Preciso criar conta?</summary><p style="margin:8px 0 0">Não. Você preenche os dados, paga e recebe o PDF no e-mail informado.</p></details>
  <details style="padding:10px 0;border-bottom:1px solid #EEE7F4"><summary style="cursor:pointer;font-weight:700">Consultar o meu CPF baixa o meu score?</summary><p style="margin:8px 0 0">Não. Consultar o próprio documento não conta como pedido de crédito.</p></details>
  <details style="padding:10px 0"><summary style="cursor:pointer;font-weight:700">Posso fazer de outra pessoa?</summary><p style="margin:8px 0 0">Não. Pela LGPD, o Raio-X é do seu próprio CPF ou do CNPJ de uma empresa pela qual você responde.</p></details>
</div>
</div>`;
}

export function paginaPedidoRaioX({ p }) {
  if (p.status === 'expirada') return `<div class="cartao estreito" style="max-width:520px;text-align:center"><h1 style="font-size:1.4rem">Esse pagamento expirou</h1><p class="muted">O Pix não foi pago no prazo. É só fazer um novo pedido.</p><p><a class="btn" href="/raio-x">Fazer meu Raio-X</a></p></div>`;
  if (p.status !== 'paga') return `<div class="cartao estreito" style="max-width:520px;text-align:center" data-raiox="${esc(p.token)}">
  <h1 style="font-size:1.4rem;margin-top:0">Pague ${reais(p.valor_centavos)} e receba seu Raio-X</h1>
  ${p.pix_imagem ? `<img src="data:image/png;base64,${esc(p.pix_imagem)}" alt="QR Code Pix" style="width:230px;height:230px;max-width:100%">
  <textarea id="pix-codigo" readonly rows="3" aria-label="Código Pix copia e cola" style="width:100%;font:inherit;font-size:.8rem;padding:10px;border:1.5px solid #D6CCE0;border-radius:12px;resize:none">${esc(p.pix_codigo)}</textarea>
  <button class="btn" type="button" id="copiar" style="margin:12px 0">Copiar código Pix</button>` : ''}
  ${p.link_pagamento ? `<p><a href="${esc(p.link_pagamento)}" target="_blank" rel="noopener">${p.pix_imagem ? 'Prefiro pagar pela página do Asaas' : 'Abrir página de pagamento'}</a></p>` : ''}
  <p class="muted pulsando" aria-live="polite">Aguardando pagamento… esta página atualiza sozinha.</p>
  <p class="muted" style="font-size:.85rem">O Raio-X será enviado para <strong>${esc(p.email)}</strong>.</p></div>`;
  let r = {}; try { r = JSON.parse(p.resumo || '{}'); } catch {}
  if (!p.entregue_em) return `<div class="cartao estreito" style="max-width:520px;text-align:center" ${p.erro ? '' : `data-raiox="${esc(p.token)}"`}>
    <h1 style="font-size:1.4rem">Pagamento confirmado ✅</h1>
    <p>${p.erro ? 'A fonte de dados demorou para responder. Tentamos de novo automaticamente e o Raio-X chega no seu e-mail assim que ficar pronto.' : 'Estamos gerando o seu Raio-X. Em instantes ele chega no seu e-mail.'}</p>
    <p class="muted">E-mail: <strong>${esc(p.email)}</strong></p></div>`;
  const cor = { critico: '#C62828', atencao: '#B26A00', bom: '#1E7B4D' }[r.nivel] || '#5B2D8E';
  return `<div class="cartao estreito" style="max-width:600px">
  <span class="tag">Raio-X #${p.id}</span>
  <h1 style="font-size:1.6rem;margin:10px 0 6px;color:${cor}">${esc(r.titulo || 'Seu Raio-X está pronto')}</h1>
  <p class="muted">${r.score != null ? `Score ${r.score} · ` : ''}${r.qtd ? `${r.qtd} restrição(ões)` : 'Sem restrições'} · enviado para ${esc(p.email)}</p>
  <p><a class="btn" href="/raio-x/r/${esc(p.token)}/pdf" target="_blank" rel="noopener">Abrir o relatório completo (PDF)</a></p>
  <p class="muted" style="font-size:.9rem">O PDF tem o diagnóstico, tudo o que aparece no seu documento e o plano de ação para agora, 30 e 90 dias.</p>
  <div class="aviso" style="margin-top:14px">Quer acompanhar a evolução do seu CPF? Conheça o <a href="/monitoramento">Monitoramento da Soft Consultas</a>.</div>
</div>`;
}

export function adminRaioX({ menu, cfg, vendas, receita, produto, produtos, ok, erro }) {
  return `<h1 style="font-size:1.7rem">Raio-X do CPF · Configuração</h1>${menu}${ok ? `<div class="aviso ok">${esc(ok)}</div>` : ''}${erro ? `<div class="aviso erro">${esc(erro)}</div>` : ''}
<div class="grade" style="margin-bottom:18px">
  <div class="cartao"><div class="muted">Vendas (total)</div><div style="font-family:Montserrat,sans-serif;font-size:1.6rem;font-weight:800">${vendas}</div><a href="/admin/raio-x/vendas">Ver vendas</a></div>
  <div class="cartao"><div class="muted">Receita (total)</div><div style="font-family:Montserrat,sans-serif;font-size:1.6rem;font-weight:800">${reais(receita)}</div></div>
  <div class="cartao"><div class="muted">Custo por Raio-X</div><div style="font-family:Montserrat,sans-serif;font-size:1.6rem;font-weight:800">${produto ? reais(produto.custo_centavos) : '—'}</div><div class="muted">${produto ? esc(produto.nome) : 'configure a consulta'}</div></div>
</div>
<form class="cartao" method="post" action="/admin/raio-x" style="max-width:720px;margin-bottom:18px">
  <h2 style="font-size:1.2rem;margin-top:0">Configuração</h2>
  <label style="display:flex;gap:10px;align-items:center;margin-bottom:14px;font-weight:700"><input type="checkbox" name="ativo" value="1" ${cfg.ativo ? 'checked' : ''} style="width:22px;height:22px"> À venda</label>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <div class="campo" style="flex:1 1 160px"><label for="rx-p">Preço (R$)</label><input id="rx-p" type="text" name="preco" inputmode="decimal" value="${(cfg.preco / 100).toFixed(2).replace('.', ',')}"></div>
    <div class="campo" style="flex:1 1 160px"><label for="rx-d">Preço "de" riscado (opcional)</label><input id="rx-d" type="text" name="preco_de" inputmode="decimal" value="${cfg.precoDe ? (cfg.precoDe / 100).toFixed(2).replace('.', ',') : ''}"></div>
  </div>
  <div class="campo"><label for="rx-prod">Consulta usada</label><select id="rx-prod" name="produto" style="min-height:46px">${produtos.map((p) => `<option value="${esc(p.slug)}" ${p.slug === cfg.produto ? 'selected' : ''}>${esc(p.nome)} · custo ${reais(p.custo_centavos)}</option>`).join('')}</select>
    <small class="muted">Use uma consulta Boa Vista com score e restrições (ex.: Cred Completa Plus).</small></div>
  <button class="btn">Salvar</button>
  <p class="muted" style="margin:10px 0 0">Página de vendas: <a href="/raio-x" target="_blank" rel="noopener">/raio-x</a> · também abre por raiox.softconsultas.com depois de apontar o subdomínio.</p>
</form>`;
}

const ST_RX = { paga: ['Pago', '#1E7B4D'], pendente: ['Aguardando pagamento', '#B26A00'], expirada: ['Expirado', '#6B6475'], cancelada: ['Cancelado', '#6B6475'] };
export function adminVendasRaioX({ menu, pedidos, f, k, dias, ok, erro }) {
  const kpi = (rot, val, sub = '') => `<div class="cartao"><div class="muted">${rot}</div><div style="font-family:Montserrat,sans-serif;font-size:1.6rem;font-weight:800">${val}</div>${sub ? `<div class="muted" style="font-size:.85rem">${sub}</div>` : ''}</div>`;
  const opt = (v, t, cur) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${t}</option>`;
  const qs = new URLSearchParams({ periodo: f.periodo, status: f.status, q: f.q }).toString();
  const btnP = 'min-height:30px;padding:2px 10px;font-size:.78rem';
  const max = Math.max(1, ...dias.map((d) => d.receita));
  return `<h1 style="font-size:1.7rem">Vendas do Raio-X</h1>${menu}${ok ? `<div class="aviso ok">${esc(ok)}</div>` : ''}${erro ? `<div class="aviso erro">${esc(erro)}</div>` : ''}
<form class="cartao" method="get" action="/admin/raio-x/vendas" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:18px">
  <div class="campo" style="flex:1 1 160px;margin:0"><label for="vf-p">Período</label><select id="vf-p" name="periodo" style="min-height:46px">${opt('hoje', 'Hoje', f.periodo)}${opt('ontem', 'Ontem', f.periodo)}${opt('7', 'Últimos 7 dias', f.periodo)}${opt('30', 'Últimos 30 dias', f.periodo)}${opt('mes', 'Este mês', f.periodo)}${opt('mes_ant', 'Mês passado', f.periodo)}${opt('tudo', 'Tudo', f.periodo)}</select></div>
  <div class="campo" style="flex:1 1 160px;margin:0"><label for="vf-s">Status</label><select id="vf-s" name="status" style="min-height:46px">${opt('', 'Todos', f.status)}${opt('paga', 'Pagos', f.status)}${opt('nao_entregue', 'Pagos, não entregues', f.status)}${opt('pendente', 'Aguardando pagamento', f.status)}${opt('expirada', 'Expirados', f.status)}</select></div>
  <div class="campo" style="flex:2 1 220px;margin:0"><label for="vf-q">Buscar</label><input id="vf-q" type="text" name="q" placeholder="Nome, e-mail, CPF/CNPJ ou nº" value="${esc(f.q)}"></div>
  <button class="btn">Filtrar</button>
  <a class="btn sec" href="/admin/raio-x/vendas.csv?${esc(qs)}">Baixar planilha (CSV)</a>
</form>
<div class="grade" style="margin-bottom:18px">
  ${kpi('Vendas pagas', k.pagos, `${k.pedidos} pedido(s) · conversão ${k.conversao}%`)}
  ${kpi('Receita', reais(k.receita), `ticket médio ${reais(k.ticket)}`)}
  ${kpi('Custo das consultas', reais(k.custo), 'APIFull')}
  ${kpi('Lucro bruto', reais(k.receita - k.custo), 'antes da taxa do Asaas e anúncios')}
  ${kpi('Pix x Cartão', `${k.pix} / ${k.cartao}`, 'vendas pagas')}
  ${kpi('Pendências', k.naoEntregues, k.naoEntregues ? '<strong style="color:var(--erro)">pagos sem entrega: confira abaixo</strong>' : 'tudo entregue')}
</div>
${dias.length > 1 ? `<div class="cartao" style="margin-bottom:18px"><h2 style="font-size:1.1rem;margin-top:0">Por dia</h2><div class="rolar"><table class="tabela"><tr><th>Dia</th><th>Vendas</th><th>Receita</th><th style="width:45%"></th></tr>
${dias.map((d) => `<tr><td>${d.dia.split('-').reverse().join('/')}</td><td>${d.vendas}</td><td>${reais(d.receita)}</td><td><div style="height:10px;border-radius:5px;background:#9F31D3;width:${Math.round((d.receita / max) * 100)}%" aria-hidden="true"></div></td></tr>`).join('')}</table></div></div>` : ''}
<div class="cartao"><div class="rolar"><table class="tabela"><tr><th>#</th><th>Data</th><th>Cliente</th><th>Documento</th><th>Valor</th><th>Status</th><th>Resultado</th><th>Ações</th></tr>
${pedidos.map((p) => { let r = {}; try { r = JSON.parse(p.resumo || '{}'); } catch {} const [st, cor] = ST_RX[p.status] || [p.status, '#555'];
  return `<tr><td>${p.id}</td><td>${dt(p.criado_em)}${p.pago_em ? `<br><span class="muted">pago ${dt(p.pago_em)}</span>` : ''}</td><td>${esc(p.nome)}<br><span class="muted">${esc(p.email)}${p.whatsapp ? ` · <a href="https://wa.me/55${esc(String(p.whatsapp).replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''))}" target="_blank" rel="noopener">${esc(p.whatsapp)}</a>` : ''}</span>${p.origem ? `<br><span class="muted" style="font-size:.78rem">${esc(p.origem)}</span>` : ''}</td>
  <td>${esc(formatarDoc(p.documento))}</td><td>${reais(p.valor_centavos)}<br><span class="muted">${p.forma === 'cartao' ? 'cartão' : 'pix'}</span></td>
  <td><strong style="color:${cor}">${st}</strong>${p.status === 'paga' ? (p.entregue_em ? `<br><span class="muted">entregue ${dt(p.entregue_em)}${p.downloads ? ` · ${p.downloads} download(s)` : ''}</span>` : `<br><strong style="color:var(--erro)">não entregue</strong>${p.erro ? `<br><span class="muted">${esc(p.erro)}</span>` : ''}`) : ''}</td>
  <td>${r.titulo ? `${esc(r.titulo)}<br><span class="muted">${r.score != null ? `score ${r.score} · ` : ''}${r.qtd || 0} restrição(ões)${r.total ? ` · ${reais(Math.round(r.total * 100))}` : ''}</span>` : '<span class="muted">—</span>'}</td>
  <td><form method="post" action="/admin/raio-x" style="display:flex;gap:6px;flex-wrap:wrap;margin:0"><input type="hidden" name="id" value="${p.id}"><input type="hidden" name="volta" value="/admin/raio-x/vendas?${esc(qs)}">
    ${p.status === 'pendente' && p.asaas_id ? `<button class="btn sec" name="acao" value="conferir" style="${btnP}">Conferir no Asaas</button>` : ''}
    ${p.status === 'paga' && p.entregue_em ? `<a class="btn sec" style="${btnP}" href="/raio-x/r/${esc(p.token)}/pdf" target="_blank" rel="noopener">PDF</a><button class="btn sec" name="acao" value="reenviar" style="${btnP}">Reenviar</button>` : ''}
    ${p.status === 'paga' ? `<button class="btn sec" name="acao" value="refazer" style="${btnP}" data-confirmar="Refazer a consulta (gasta 1 consulta na APIFull) e reenviar?">Refazer</button>` : ''}</form></td></tr>`; }).join('') || '<tr><td colspan="8" class="vazio">Nenhuma venda neste filtro.</td></tr>'}
</table></div>${pedidos.length >= 500 ? '<p class="muted">Mostrando os 500 mais recentes. Use o filtro ou baixe a planilha para ver tudo.</p>' : ''}</div>`;
}

// ======================= ÁREA DE PARCEIROS (Limpa Nome) =======================
const kpiP = (rot, val, sub = '') => `<div class="cartao"><div class="muted">${rot}</div><div style="font-family:Montserrat,sans-serif;font-size:1.6rem;font-weight:800">${val}</div>${sub ? `<div class="muted" style="font-size:.85rem">${sub}</div>` : ''}</div>`;
const btnPeq = 'min-height:32px;padding:4px 12px;font-size:.8rem';
export const textoComissao = (r) => (r.comissaoTipo === 'nossa_parte' ? `${reais(r.comissaoCentavos)} (nossa parte fixa ${reais(r.comissaoValor)})` : r.comissaoTipo === 'fixo' ? reais(r.comissaoValor) : `${r.comissaoValor}% (${reais(r.comissaoCentavos)})`);
const ehReais = (t) => t === 'fixo' || t === 'nossa_parte';
const optNossa = (sel) => `<option value="nossa_parte" ${sel === 'nossa_parte' ? 'selected' : ''}>Nossa parte fixa (R$): o resto é do parceiro</option>`;
const txtTipo = (t, v) => (t === 'nossa_parte' ? `nossa parte ${reais(v)}` : t === 'fixo' ? reais(v) : `${v}%`);

export function paginaParceiro({ usuario, r, regras = [r], cfg, pedidos, k, saldo, base, ok, erro, repasse = null }) {
  const disp = regras.filter((x) => x.disponivel);
  const linkCliente = (p) => `${base}/ln/${p.token}`;
  const wpp = (p) => {
    const tel = String(p.telefone || '').replace(/\D/g, '');
    const msg = `Olá, ${String(p.nome).split(' ')[0]}! Segue o link para concluir o seu Limpa Nome (pedido #${p.id}). Você paga com Pix ou cartão e acompanha cada etapa por ele: ${linkCliente(p)}`;
    return `https://wa.me/${tel.length <= 11 ? '55' + tel : tel}?text=${encodeURIComponent(msg)}`;
  };
  return `<h1 style="font-size:1.7rem;margin-bottom:4px">Área do parceiro</h1>
<p class="muted" style="margin:0 0 18px">Limpa Nome · olá, ${esc(String(usuario.nome).split(' ')[0])}</p>
${ok ? `<div class="aviso ok">${esc(ok)}</div>` : ''}${erro ? `<div class="aviso erro">${esc(erro)}</div>` : ''}
${!disp.length ? '<div class="aviso">Os serviços estão pausados para novos pedidos no momento. Você continua acompanhando os seus clientes.</div>' : ''}
<div class="grade" style="margin-bottom:18px">
  ${kpiP('Clientes cadastrados', k.total, `${k.aguardando} aguardando pagamento`)}
  ${kpiP('Pagos', k.pagos, `${k.andamento} em andamento · ${k.concluidos} concluído(s)`)}
  ${kpiP('Comissões geradas', reais(k.comissoes), 'nas vendas em que o cliente paga')}
  ${repasse ? kpiP('Repasse automático', 'Ligado', `cai no Pix ${esc(repasse)} quando o cliente paga`) : kpiP('Saldo para sacar', reais(saldo), '<a href="/indicacoes#saque">Sacar pelo Pix</a>')}
</div>
<div class="cartao" style="margin-bottom:18px;display:flex;gap:18px;flex-wrap:wrap;align-items:center;justify-content:space-between">
  <div style="flex:1 1 420px">
    <h2 style="font-size:1.15rem;margin:0 0 8px">Como você ganha</h2>
    <p class="muted" style="margin:0 0 8px">O cliente paga pelo link que você envia (Pix ou até ${cfg.parcelas}x no cartão). Você pode cobrar o preço sugerido ou mais: a nossa parte é fixa e <strong>tudo o que passar dela é seu</strong>.</p>
    <div class="rolar"><table class="tabela" style="font-size:.92rem"><tr><th>Serviço</th><th>Nossa parte</th><th>Preço sugerido</th><th>Sua comissão no sugerido</th></tr>
    ${disp.map((x) => `<tr><td><strong>${esc(x.nomeServico)}</strong></td><td>${reais(x.nossaParte)}</td><td>${reais(x.preco)}</td><td><strong>${reais(x.comissaoCentavos)}</strong></td></tr>`).join('')}</table></div>
  </div>
  ${disp.length ? '<a class="btn" href="/parceiro/novo" style="flex:none">+ Cadastrar cliente</a>' : ''}
</div>
<div class="cartao"><h2 style="font-size:1.15rem;margin-top:0">Meus clientes</h2><div class="rolar"><table class="tabela"><tr><th>#</th><th>Cliente</th><th>Modelo</th><th>Valor</th><th>Status</th><th>Baixas</th><th>Ações</th></tr>
${pedidos.map((p) => { const b = Object.keys(lerBaixas(p)).length; const pend = p.status === 'aguardando_pagamento';
  return `<tr><td>${p.id}</td><td><strong>${esc(p.nome)}</strong>${tagServico(p.servico)}${p.combo_de ? ` <span class="muted" style="font-size:.78rem">(do combo #${p.combo_de})</span>` : ''}<br><span class="muted">${esc(formatarDoc(p.cpf))}${p.telefone ? ` · ${esc(p.telefone)}` : ''}</span></td>
  <td>${p.parceiro_modelo === 'atacado' ? 'Atacado (você paga)' : `Cliente paga<br><span class="muted">comissão ${reais(p.parceiro_comissao_centavos)}</span>`}</td>
  <td>${reais(p.valor_centavos)}${p.forma_pagamento === 'cartao' && p.parcelas > 1 ? `<br><span class="muted">${p.parcelas}x cartão</span>` : ''}</td>
  <td>${etiqueta(p.status, p.servico)}${p.lote && !pend ? `<br><span class="muted">lote ${dataBR(p.lote)}</span>` : ''}</td>
  <td>${p.pago_em && p.servico !== 'rating' ? `${b}/${ORGAOS_LN.length}` : '—'}</td>
  <td style="min-width:200px"><div style="display:flex;gap:6px;flex-wrap:wrap"><a class="btn sec" style="${btnPeq}" href="/parceiro/cliente/${p.id}">${pend && p.parceiro_modelo === 'atacado' ? 'Pagar' : 'Ver'}</a>
    ${pend && p.parceiro_modelo !== 'atacado' ? `<a class="btn" style="${btnPeq};background:#1FA855" href="${esc(wpp(p))}" target="_blank" rel="noopener">Enviar no WhatsApp</a><button class="btn sec" type="button" style="${btnPeq}" data-copiar-texto="${esc(linkCliente(p))}">Copiar link</button>` : ''}
    ${pend ? `<form method="post" action="/parceiro/cliente/${p.id}/cancelar" style="margin:0"><button class="btn sec" style="${btnPeq}" data-confirmar="Cancelar o pedido #${p.id}?">Cancelar</button></form>` : ''}
    ${!pend ? `<button class="btn sec" type="button" style="${btnPeq}" data-copiar-texto="${esc(linkCliente(p))}">Link do cliente</button>` : ''}</div></td></tr>`; }).join('') || '<tr><td colspan="7" class="vazio">Nenhum cliente ainda. Clique em "Cadastrar cliente" para começar.</td></tr>'}
</table></div>
<p class="muted" style="margin:12px 0 0;font-size:.88rem">O cliente recebe por e-mail cada etapa do processo e também acompanha pelo link dele. As comissões entram no seu saldo assim que o cliente paga.</p></div>`;
}

export function paginaParceiroNovo({ cfg, regras = [], v = {}, erro = '' }) {
  const f = (k) => esc(v[k] ?? '');
  const disp = regras.filter((x) => x.disponivel);
  const r = disp.find((x) => x.servico === v.servico) || disp[0] || regras[0];
  const modelo = v.modelo === 'atacado' && r.atacado ? 'atacado' : 'comissao';
  const temAtacado = false; // o cliente sempre paga o valor cheio para a Soft Consultas; o atacado é a nossa parte
  return `<p><a href="/parceiro">← Área do parceiro</a></p>
<h1 style="font-size:1.6rem">Cadastrar cliente</h1>
${erro ? `<div class="aviso erro" role="alert">${esc(erro)}</div>` : ''}
<form class="cartao" method="post" action="/parceiro/novo" enctype="multipart/form-data" style="max-width:760px">
  <div class="campo"><label for="pc-servico">Serviço</label><select id="pc-servico" name="servico" style="min-height:46px">${disp.map((x) => `<option value="${x.servico}" ${x.servico === r.servico ? 'selected' : ''} data-preco="${x.preco}" data-nossa="${x.nossaParte}" data-max="${x.precoMaximo}" data-atacado="${x.atacado || ''}">${esc(x.nomeServico)} · sugerido ${reais(x.preco)}</option>`).join('')}</select></div>
  <fieldset style="border:1.5px solid #D6CCE0;border-radius:14px;padding:12px 16px;margin:0 0 18px;min-width:0"><legend style="font-weight:700;padding:0 6px">Quem paga?</legend>
    <label style="display:flex;gap:10px;align-items:flex-start;margin:8px 0"><input type="radio" name="modelo" value="comissao" ${modelo === 'comissao' ? 'checked' : ''} style="width:20px;height:20px;margin-top:3px"> <span><strong>O cliente paga</strong> (Pix ou até ${cfg.parcelas}x no cartão) por um link que você envia no WhatsApp. Você recebe a comissão quando ele pagar.</span></label>
    <div style="margin:4px 0 12px 30px;display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end">
      <div class="campo" style="margin:0;flex:0 1 220px"><label for="pc-venda">Valor que o cliente vai pagar (R$)</label><input id="pc-venda" type="text" name="preco_venda" inputmode="decimal" value="${esc(v.preco_venda ?? (r.preco / 100).toFixed(2).replace('.', ','))}" data-venda-nossa="${r.nossaParte}" data-venda-min="${r.preco}" data-venda-max="${r.precoMaximo}"></div>
      <p style="margin:0 0 10px;flex:1 1 240px" id="pc-comissao" aria-live="polite">Sugerido ${reais(r.preco)} · sua comissão: <strong>${reais(r.comissaoCentavos)}</strong></p>
    </div>
    <small class="muted" id="pc-regra" style="display:block;margin:-6px 0 8px 30px">Mínimo ${reais(r.preco)}. A nossa parte é ${reais(r.nossaParte)}; tudo acima disso é comissão sua.</small>
    ${temAtacado ? `<label id="pc-atac-op" style="display:${r.atacado ? 'flex' : 'none'};gap:10px;align-items:flex-start;margin:8px 0"><input type="radio" name="modelo" value="atacado" ${modelo === 'atacado' ? 'checked' : ''} style="width:20px;height:20px;margin-top:3px"> <span><strong>Eu pago o atacado de <span id="pc-atac-valor">${r.atacado ? reais(r.atacado) : ''}</span></strong> agora e cobro do cliente por fora.
      <select name="forma" aria-label="Forma de pagamento do atacado" style="min-height:38px;margin-left:6px"><option value="pix">Pix</option><option value="cartao" ${v.forma === 'cartao' ? 'selected' : ''}>Cartão (à vista)</option></select></span></label>` : ''}
  </fieldset>
  <h2 style="font-size:1.15rem;margin:0 0 10px">Dados do cliente (titular)</h2>
  <div class="campo"><label for="pc-nome">Nome completo do titular (ou razão social)</label><input id="pc-nome" type="text" name="nome" required maxlength="120" value="${f('nome')}"></div>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <div class="campo" style="flex:1 1 200px"><label for="pc-cpf">CPF ou CNPJ</label><input id="pc-cpf" type="text" name="cpf" required inputmode="numeric" maxlength="18" value="${f('cpf')}"></div>
    <div class="campo" style="flex:1 1 180px"><label for="pc-nasc">Nascimento (titular ou sócio)</label><input id="pc-nasc" name="nascimento" type="date" required value="${f('nascimento')}" style="font:inherit;padding:11px 13px;border:1.5px solid #D6CCE0;border-radius:12px"></div>
  </div>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <div class="campo" style="flex:1 1 200px"><label for="pc-tel">WhatsApp do cliente</label><input id="pc-tel" type="tel" name="telefone" required inputmode="tel" maxlength="20" value="${f('telefone')}"></div>
    <div class="campo" style="flex:1 1 240px"><label for="pc-email">E-mail do cliente (recebe as atualizações)</label><input id="pc-email" name="email" type="email" required maxlength="120" value="${f('email')}"></div>
  </div>
  <div class="campo"><label for="pc-tipo">Documento com foto do titular (ou do sócio, se CNPJ)</label>
    <select id="pc-tipo" name="doc_tipo" required style="min-height:46px"><option value="RG">RG</option><option value="CNH" ${v.doc_tipo === 'CNH' ? 'selected' : ''}>CNH</option></select></div>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <div class="campo" style="flex:1 1 220px"><label for="pc-frente">Foto da frente</label><input id="pc-frente" name="doc_frente" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></div>
    <div class="campo" style="flex:1 1 220px"><label for="pc-verso">Foto do verso</label><input id="pc-verso" name="doc_verso" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></div>
  </div>
  <small class="muted" style="display:block;margin:-6px 0 14px">JPG, PNG ou PDF, até 5 MB cada.</small>
  <label style="display:flex;gap:10px;align-items:flex-start;margin-bottom:16px"><input type="checkbox" name="aceite" value="1" required style="width:20px;height:20px;margin-top:3px"> <span>Declaro que tenho <strong>autorização por escrito do titular</strong> para contratar o serviço em nome dele (no Limpa Nome, a inclusão como associado(a) na ação judicial coletiva${cfg.executor ? ` conduzida por ${esc(cfg.executor)}` : ''}) e para usar estes dados e documentos só neste serviço. Expliquei ao cliente que o Limpa Nome retira as negativações mas a dívida continua com o credor, e que nenhum serviço garante aprovação de crédito.</span></label>
  <button class="btn" type="submit">Cadastrar cliente</button>
</form>`;
}

// Página pública do cliente (link enviado pelo parceiro): escolher a forma de pagamento
export function paginaPagarClienteLN({ p, cfg, parceiro, erro = '' }) {
  return `<div style="max-width:640px;margin:0 auto">
<span class="tag">Limpa Nome · pedido #${p.id}</span>
<h1 style="font-size:1.7rem;margin:10px 0 6px">${esc(String(p.nome).split(' ')[0])}, falta só o pagamento</h1>
<p class="muted" style="margin:0 0 16px">Cadastro feito por ${esc(parceiro)} · ${String(p.cpf).length === 14 ? 'CNPJ' : 'CPF'} ${esc(formatarDoc(p.cpf))}</p>
${erro ? `<div class="aviso erro" role="alert">${esc(erro)}</div>` : ''}
<div class="cartao" style="margin-bottom:16px">
  <h2 style="font-size:1.15rem;margin-top:0">O que você está contratando: ${esc(SERVICOS[p.servico] || 'Limpa Nome')}</h2>
  ${p.servico !== 'rating' ? `<p style="margin:6px 0">✅ Inclusão do seu ${String(p.cpf).length === 14 ? 'CNPJ' : 'CPF'} na <strong>ação judicial coletiva</strong> que pede a retirada das negativações (Serasa, SPC, Boa Vista e protestos).</p>
  ${cfg.prazo ? `<p style="margin:6px 0">⏱️ ${esc(cfg.prazo)}</p>` : ''}
  ${cfg.blindagem ? `<p style="margin:6px 0">🛡️ Blindagem de ${cfg.blindagem} meses depois de concluído.</p>` : ''}` : ''}
  ${p.servico !== 'limpa_nome' ? `<p style="margin:6px 0">🏦 <strong>Rating Bancário</strong>${p.servico === 'combo' ? ' (começa depois que o nome estiver limpo)' : ''}: análise do seu histórico no Banco Central (Registrato/SCR), score e Cadastro Positivo, ajustes cadastrais e estratégia de relacionamento com os bancos.</p>` : ''}
  <p style="margin:6px 0">📩 Você acompanha cada etapa por e-mail e por este link.</p>
  <p class="muted" style="margin:10px 0 0;font-size:.88rem">${p.servico !== 'rating' ? 'A ação retira as negativações; a dívida continua com o credor. ' : ''}Nenhum serviço garante aprovação de crédito: a decisão é sempre de cada instituição.</p>
</div>
<form class="cartao" method="post" action="/ln/${esc(p.token)}/pagar">
  <fieldset style="border:1.5px solid #D6CCE0;border-radius:14px;padding:12px 16px;margin:0 0 16px;min-width:0"><legend style="font-weight:700;padding:0 6px">Forma de pagamento</legend>
    <label style="display:flex;gap:10px;align-items:center;margin:6px 0"><input type="radio" name="forma" value="pix" checked style="width:20px;height:20px"> <span><strong>Pix</strong> · ${reais(cfg.preco)} à vista</span></label>
    <label style="display:flex;gap:10px;align-items:center;margin:6px 0;flex-wrap:wrap"><input type="radio" name="forma" value="cartao" style="width:20px;height:20px"> <span><strong>Cartão de crédito</strong> em</span>
      <select name="parcelas" aria-label="Número de parcelas" style="min-height:40px;max-width:100%">${cfg.tabela.map((t) => `<option value="${t.n}" ${t.n === cfg.parcelas ? 'selected' : ''}>${t.n}x de ${reais(t.parcela)}${t.n > 1 && cfg.juros > 0 ? ` (total ${reais(t.total)})` : ' sem juros'}</option>`).join('')}</select></label>
  </fieldset>
  <label style="display:flex;gap:10px;align-items:flex-start;margin-bottom:16px"><input type="checkbox" name="aceite" value="1" required style="width:20px;height:20px;margin-top:3px"> <span>Sou o titular (ou responsável pela empresa), confirmo os dados acima e autorizo ${p.servico === 'rating' ? 'a análise do meu histórico de crédito para o Rating Bancário' : `a minha inclusão, como associado(a), na ação judicial coletiva${cfg.executor ? ` conduzida por ${esc(cfg.executor)}` : ''}${p.servico === 'combo' ? ' e a análise do meu histórico de crédito para o Rating Bancário' : ''}`}, conforme os <a href="/termos" target="_blank" rel="noopener">Termos de Uso</a>.</span></label>
  <button class="btn largo" type="submit">Continuar para o pagamento</button>
</form></div>`;
}

export function adminParceiros({ menu, padrao, parceiros, cfg, ok, erro }) {
  const rs = (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
  return `<h1 style="font-size:1.7rem">Parceiros · Limpa Nome</h1>${menu}${ok ? `<div class="aviso ok">${esc(ok)}</div>` : ''}${erro ? `<div class="aviso erro">${esc(erro)}</div>` : ''}
<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;margin-bottom:18px">
<form class="cartao" method="post" action="/admin/parceiros/padrao" style="flex:1 1 320px">
  <h2 style="font-size:1.15rem;margin-top:0">Regra padrão</h2>
  <p class="muted" style="margin-top:0">Vale para quem não tiver regra própria. A comissão em % é calculada sobre o preço de venda ao cliente.</p>
  <h3 style="font-size:1rem;margin:0 0 8px">Limpa Nome</h3>
  <div class="campo"><label for="pp-preco">Preço de venda ao cliente final (R$) · vazio = igual ao do site</label><input id="pp-preco" type="text" name="preco" inputmode="decimal" value="${rs(padrao.preco)}"></div>
  <div style="display:flex;gap:10px;flex-wrap:wrap">
    <div class="campo" style="flex:1 1 140px"><label for="pp-tipo">Comissão</label><select id="pp-tipo" name="tipo" style="min-height:46px"><option value="percentual">% do preço</option><option value="fixo" ${padrao.comissaoTipo === 'fixo' ? 'selected' : ''}>Valor fixo (R$)</option>${optNossa(padrao.comissaoTipo)}</select></div>
    <div class="campo" style="flex:1 1 120px"><label for="pp-valor">Valor</label><input id="pp-valor" type="text" name="valor" inputmode="decimal" value="${ehReais(padrao.comissaoTipo) ? rs(padrao.comissaoValor) : padrao.comissaoValor}"></div>
  </div>
  <div style="display:flex;gap:10px;flex-wrap:wrap">
    <div class="campo" style="flex:1 1 160px"><label for="pp-atac">Atacado = nossa parte (R$) · vazio = usa a comissão</label><input id="pp-atac" type="text" name="atacado" inputmode="decimal" value="${rs(padrao.atacado || null)}"></div>
    <div class="campo" style="flex:1 1 160px"><label for="pp-mens">Mensalidade (R$) · 0 = grátis</label><input id="pp-mens" type="text" name="mensalidade" inputmode="decimal" value="${rs(padrao.mensalidade || 0)}"></div>
  </div>
  ${['rating', 'combo'].map((sv) => { const d = padrao[sv] || {}; return `<details style="margin:4px 0 14px;border:1.5px solid #EEE7F4;border-radius:12px;padding:8px 12px"><summary style="cursor:pointer;font-weight:700">${esc(SERVICOS[sv])}</summary>
    <div class="campo" style="margin-top:10px"><label for="pp-${sv}-preco">Preço ao cliente (R$) · vazio = do site (${reais(d.precoSite || 0)})</label><input id="pp-${sv}-preco" type="text" name="${sv}_preco" inputmode="decimal" value="${rs(d.preco)}"></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div class="campo" style="flex:1 1 130px"><label for="pp-${sv}-tipo">Comissão</label><select id="pp-${sv}-tipo" name="${sv}_tipo" style="min-height:46px"><option value="percentual">% do preço</option><option value="fixo" ${d.comissaoTipo === 'fixo' ? 'selected' : ''}>R$ fixo</option>${optNossa(d.comissaoTipo)}</select></div>
      <div class="campo" style="flex:1 1 100px"><label for="pp-${sv}-valor">Valor</label><input id="pp-${sv}-valor" type="text" name="${sv}_valor" inputmode="decimal" value="${ehReais(d.comissaoTipo) ? rs(d.comissaoValor) : (d.comissaoValor ?? '')}"></div>
      <div class="campo" style="flex:1 1 130px"><label for="pp-${sv}-atac">Atacado = nossa parte (R$)</label><input id="pp-${sv}-atac" type="text" name="${sv}_atacado" inputmode="decimal" value="${rs(d.atacado)}"></div>
    </div></details>`; }).join('')}
  <button class="btn">Salvar regra padrão</button>
</form>
<form class="cartao" method="post" action="/admin/parceiros/novo" style="flex:1 1 380px">
  <h2 style="font-size:1.15rem;margin-top:0">Cadastrar parceiro</h2>
  <p class="muted" style="margin-top:0">Se o e-mail já tiver conta, ela vira parceira. Se não tiver, criamos a conta e enviamos um e-mail para ele definir a senha.</p>
  <div class="campo"><label for="np-nome">Nome</label><input id="np-nome" type="text" name="nome" maxlength="120"></div>
  <div style="display:flex;gap:10px;flex-wrap:wrap">
    <div class="campo" style="flex:1 1 200px"><label for="np-email">E-mail</label><input id="np-email" type="email" name="email" required maxlength="120"></div>
    <div class="campo" style="flex:1 1 160px"><label for="np-tel">WhatsApp</label><input id="np-tel" type="tel" name="telefone" maxlength="20"></div>
  </div>
  <label style="display:flex;gap:10px;align-items:center;margin:0 0 14px"><input type="checkbox" name="isento" value="1" style="width:20px;height:20px"> Isento de mensalidade (fica ativo sem pagar)</label>
  <button class="btn">Cadastrar parceiro</button>
</form></div>
<div class="cartao"><h2 style="font-size:1.15rem;margin-top:0">Parceiros (${parceiros.length})</h2><div class="rolar"><table class="tabela"><tr><th>Parceiro</th><th>Mensalidade</th><th>Clientes</th><th>Pagos</th><th>Receita</th><th>Comissões</th><th>Saldo</th><th>Valores</th></tr>
${parceiros.map((x) => `<tr><td><strong>${esc(x.nome)}</strong>${x.ativo ? '' : ' <span class="tag">inativo</span>'}${x.repasse_auto ? ' <span class="tag" style="font-size:.7rem">repasse automático</span>' : ''}<br><span class="muted">${esc(x.email)}${x.telefone ? ` · ${esc(x.telefone)}` : ''}</span><br><span class="muted" style="font-size:.8rem">desde ${dataBR(x.criado_em)}</span></td>
  <td>${x.isento ? '<strong style="color:var(--ok)">isento</strong>' : x.mens.isento ? '<span class="muted">grátis</span>' : x.mens.emDia ? `<strong style="color:var(--ok)">em dia</strong><br><span class="muted">até ${dataBR(x.mens.pagoAte)}</span>` : `<strong style="color:var(--erro)">${x.mens.assinatura ? 'aguardando pagamento' : 'não ativou'}</strong>`}<br><span class="muted">${x.mens.isento ? '' : reais(x.mens.valor)}${x.mens.forma ? ` · ${x.mens.forma}` : ''}</span></td>
  <td>${x.clientes}</td><td>${x.pagos}</td><td>${reais(x.receita)}</td><td>${reais(x.comissoes)}</td><td>${reais(x.saldo)}</td>
  <td style="min-width:240px"><span style="font-size:.85rem">${(x.regras || [x.regra]).filter((g) => g.disponivel).map((g) => `${esc(g.nomeServico || 'Limpa Nome')}: <strong>${reais(g.preco)}</strong> · comissão <strong>${reais(g.comissaoCentavos)}</strong>${g.atacado ? ` · atacado ${reais(g.atacado)}` : ''}`).join('<br>')}<br>${[x.preco_centavos, x.comissao_tipo, x.atacado_centavos, x.mensalidade_centavos].some((v) => v != null) || x.isento || Object.values(x.proprios || {}).some((o) => Object.values(o).some((v) => v != null)) ? ' · <span class="tag">valores próprios</span>' : ' · <span class="muted">padrão</span>'}</span>
    <div style="margin-top:6px"><a class="btn sec" style="${btnPeq}" href="/admin/parceiros/${x.usuario_id}">Editar valores</a></div></td></tr>`).join('') || '<tr><td colspan="8" class="vazio">Nenhum parceiro ainda.</td></tr>'}
</table></div><p class="muted" style="margin:10px 0 0;font-size:.88rem">Os pedidos dos parceiros aparecem também em Limpa Nome (serviço), com o nome do parceiro. Os saques das comissões seguem em "Saques de comissão".</p></div>`;
}

export function blocoMensalidadeParceiro({ m }) {
  if (m.isento) return '';
  if (m.emDia) return `<div class="aviso ok" style="display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap"><span>Mensalidade de parceiro em dia${m.pagoAte ? ` até <strong>${dataBR(m.pagoAte)}</strong>` : ''}${m.assinatura ? ` · renova todo mês (${reais(m.valor)}${m.forma === 'cartao' ? ', no cartão' : ', por Pix: enviamos o link por e-mail'})` : ''}.</span>
    ${m.assinatura ? `<form method="post" action="/parceiro/mensalidade" style="margin:0"><button class="btn sec" name="acao" value="cancelar" style="${btnPeq}" data-confirmar="Cancelar a renovação da mensalidade? Seu acesso continua até ${dataBR(m.pagoAte)}.">Cancelar renovação</button></form>` : ''}</div>`;
  return `<div class="cartao" style="margin-bottom:18px;border:2px solid #9F31D3">
  <h2 style="font-size:1.2rem;margin-top:0">${m.pagoAte ? 'Sua mensalidade venceu' : 'Ative sua área de parceiro'}</h2>
  <p style="margin:0 0 12px">Por <strong>${reais(m.valor)}/mês</strong> você cadastra quantos clientes quiser no Limpa Nome, ganha comissão em cada venda e acompanha tudo por aqui. ${m.pagoAte ? '' : 'Os clientes que você já cadastrou continuam sendo acompanhados normalmente.'}</p>
  ${m.assinatura && m.link ? `<p style="margin:0 0 10px"><a class="btn" href="${esc(m.link)}" target="_blank" rel="noopener">Pagar a mensalidade</a></p><p class="muted" style="margin:0;font-size:.88rem">Depois de pagar, a liberação é automática (atualize a página em alguns instantes).</p>`
    : `<form method="post" action="/parceiro/mensalidade" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0">
    <label style="display:flex;gap:8px;align-items:center"><input type="radio" name="forma" value="pix" checked style="width:20px;height:20px"> Pix todo mês</label>
    <label style="display:flex;gap:8px;align-items:center"><input type="radio" name="forma" value="cartao" style="width:20px;height:20px"> Cartão (renova sozinho)</label>
    <button class="btn">Ativar por ${reais(m.valor)}/mês</button></form>`}
</div>`;
}

export function adminParceiroEditar({ menu, x, padrao, cfg, pedidos, ok, erro }) {
  const rs = (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
  const pad = (t) => `<small class="muted">vazio = padrão (${t})</small>`;
  const comPad = txtTipo(padrao.comissaoTipo, padrao.comissaoValor);
  return `<h1 style="font-size:1.7rem">Parceiro · ${esc(x.nome)}</h1>${menu}${ok ? `<div class="aviso ok">${esc(ok)}</div>` : ''}${erro ? `<div class="aviso erro">${esc(erro)}</div>` : ''}
<p><a href="/admin/parceiros">← Todos os parceiros</a></p>
<div class="grade" style="margin-bottom:18px">
  ${kpiP('Clientes', x.clientes, `${x.pagos} pago(s)`)}${kpiP('Receita', reais(x.receita))}${kpiP('Comissões', reais(x.comissoes), `saldo ${reais(x.saldo)}`)}
  ${kpiP('Mensalidade', x.mens.isento ? 'Isento' : x.mens.emDia ? 'Em dia' : 'Pendente', x.mens.pagoAte ? `até ${dataBR(x.mens.pagoAte)}` : '')}
</div>
<form class="cartao" method="post" action="/admin/parceiros/salvar" style="max-width:820px;margin-bottom:18px">
  <input type="hidden" name="id" value="${x.usuario_id}">
  <p class="muted" style="margin-top:0">${esc(x.email)}${x.telefone ? ` · ${esc(x.telefone)}` : ''} · parceiro desde ${dataBR(x.criado_em)}. Deixe um campo vazio para usar a regra padrão. Mudanças valem para os próximos clientes cadastrados.</p>
  <label style="display:flex;gap:10px;align-items:center;margin-bottom:16px;font-weight:700"><input type="checkbox" name="ativo" value="1" ${x.ativo ? 'checked' : ''} style="width:22px;height:22px"> Parceiro ativo</label>
  <h2 style="font-size:1.1rem;margin:0 0 10px">Limpa Nome · venda (o cliente paga pelo link)</h2>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <div class="campo" style="flex:1 1 200px"><label for="pe-preco">Preço ao cliente final (R$)</label><input id="pe-preco" type="text" name="preco" inputmode="decimal" placeholder="${rs(padrao.preco || cfg.preco)}" value="${rs(x.preco_centavos)}">${pad(reais(padrao.preco || cfg.preco))}</div>
    <div class="campo" style="flex:1 1 160px"><label for="pe-tipo">Comissão</label><select id="pe-tipo" name="tipo" style="min-height:46px"><option value="">Padrão (${esc(comPad)})</option><option value="percentual" ${x.comissao_tipo === 'percentual' ? 'selected' : ''}>% do preço</option><option value="fixo" ${x.comissao_tipo === 'fixo' ? 'selected' : ''}>Valor fixo (R$)</option>${optNossa(x.comissao_tipo)}</select></div>
    <div class="campo" style="flex:1 1 140px"><label for="pe-valor">Valor da comissão</label><input id="pe-valor" type="text" name="valor" inputmode="decimal" placeholder="ex.: 20 ou 300,00" value="${ehReais(x.comissao_tipo) ? rs(x.comissao_valor) : (x.comissao_valor ?? '')}"></div>
  </div>
  <h2 style="font-size:1.1rem;margin:6px 0 10px">Limpa Nome · preço de atacado (nossa parte)</h2>
  <div class="campo" style="max-width:260px"><label for="pe-atac">Preço de atacado = nossa parte (R$)</label><input id="pe-atac" type="text" name="atacado" inputmode="decimal" value="${rs(x.atacado_centavos)}"><small class="muted">Com atacado, a comissão é tudo o que o parceiro cobrar acima dele (a % é ignorada). Vazio = padrão (${padrao.atacado ? reais(padrao.atacado) : 'sem atacado'}) · 0 = sem atacado</small></div>
  ${['rating', 'combo'].map((sv) => { const d = padrao[sv] || {}, o = x.proprios?.[sv] || {}; const cp = txtTipo(d.comissaoTipo, d.comissaoValor); return `<h2 style="font-size:1.1rem;margin:6px 0 10px">${esc(SERVICOS[sv])}</h2>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <div class="campo" style="flex:1 1 170px"><label for="pe-${sv}-p">Preço ao cliente (R$)</label><input id="pe-${sv}-p" type="text" name="${sv}_preco" inputmode="decimal" value="${rs(o.preco)}">${pad(reais(d.preco || d.precoSite || 0))}</div>
    <div class="campo" style="flex:1 1 150px"><label for="pe-${sv}-t">Comissão</label><select id="pe-${sv}-t" name="${sv}_tipo" style="min-height:46px"><option value="">Padrão (${esc(cp)})</option><option value="percentual" ${o.comissao_tipo === 'percentual' ? 'selected' : ''}>% do preço</option><option value="fixo" ${o.comissao_tipo === 'fixo' ? 'selected' : ''}>R$ fixo</option>${optNossa(o.comissao_tipo)}</select></div>
    <div class="campo" style="flex:1 1 120px"><label for="pe-${sv}-v">Valor</label><input id="pe-${sv}-v" type="text" name="${sv}_valor" inputmode="decimal" value="${ehReais(o.comissao_tipo) ? rs(o.comissao_valor) : (o.comissao_valor ?? '')}"></div>
    <div class="campo" style="flex:1 1 140px"><label for="pe-${sv}-a">Atacado = nossa parte (R$)</label><input id="pe-${sv}-a" type="text" name="${sv}_atacado" inputmode="decimal" value="${rs(o.atacado)}">${pad(d.atacado ? reais(d.atacado) : 'sem')}</div>
  </div>`; }).join('')}
  <h2 style="font-size:1.1rem;margin:6px 0 10px">Repasse automático da comissão</h2>
  <label style="display:flex;gap:10px;align-items:center;margin-bottom:10px"><input type="checkbox" name="repasse_auto" value="1" ${x.repasse_auto ? 'checked' : ''} style="width:20px;height:20px"> Enviar a comissão sozinha para o Pix do parceiro quando o cliente pagar</label>
  <div class="campo" style="max-width:420px"><label for="pe-pix">Chave Pix do parceiro</label><input id="pe-pix" type="text" name="repasse_pix" maxlength="140" value="${esc(x.repasse_pix || '')}" placeholder="CPF, CNPJ, e-mail, celular ou chave aleatória">
    <small class="muted">Pix: o repasse sai na hora. Cartão: sai quando o dinheiro do cartão cair (antecipação). Sem taxa de saque. Aparece em "Saques de comissão".</small></div>
  <h2 style="font-size:1.1rem;margin:6px 0 10px">Mensalidade</h2>
  <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start">
    <div class="campo" style="flex:1 1 180px"><label for="pe-mens">Mensalidade (R$)</label><input id="pe-mens" type="text" name="mensalidade" inputmode="decimal" value="${rs(x.mensalidade_centavos)}">${pad(reais(padrao.mensalidade))}</div>
    <div class="campo" style="flex:1 1 180px"><label for="pe-ate">Acesso pago até</label><input id="pe-ate" type="date" name="pago_ate" value="${esc(x.pago_ate || '')}" style="font:inherit;padding:11px 13px;border:1.5px solid #D6CCE0;border-radius:12px"><small class="muted">use para liberar manualmente</small></div>
    <label style="display:flex;gap:10px;align-items:center;margin-top:34px"><input type="checkbox" name="isento" value="1" ${x.isento ? 'checked' : ''} style="width:20px;height:20px"> Isento de mensalidade</label>
  </div>
  <div class="campo"><label for="pe-obs">Observações internas</label><textarea id="pe-obs" name="obs" rows="2" maxlength="500" style="width:100%;font:inherit;padding:10px;border:1.5px solid #D6CCE0;border-radius:12px">${esc(x.obs || '')}</textarea></div>
  <div class="muted" style="margin:0 0 12px">Em uso agora:<br>${(x.regras || [x.regra]).map((g) => `${esc(g.nomeServico || 'Limpa Nome')}: cliente paga <strong>${reais(g.preco)}</strong> · comissão <strong>${reais(g.comissaoCentavos)}</strong> · ${g.atacado ? `atacado <strong>${reais(g.atacado)}</strong>` : 'sem atacado'}${g.disponivel === false ? ' <em>(serviço desligado)</em>' : ''}`).join('<br>')}<br>Mensalidade <strong>${x.mens.isento ? 'isento' : reais(x.mens.valor)}</strong></div>
  <button class="btn">Salvar valores do parceiro</button>
</form>
<div class="cartao"><h2 style="font-size:1.1rem;margin-top:0">Clientes deste parceiro</h2><div class="rolar"><table class="tabela"><tr><th>#</th><th>Data</th><th>Cliente</th><th>Modelo</th><th>Valor</th><th>Comissão</th><th>Status</th></tr>
${pedidos.map((p) => `<tr><td>${p.id}</td><td>${dt(p.criado_em)}</td><td>${esc(p.nome)}${tagServico(p.servico)}<br><span class="muted">${esc(formatarDoc(p.cpf))}</span></td><td>${p.parceiro_modelo === 'atacado' ? 'atacado' : 'cliente paga'}</td><td>${reais(p.valor_centavos)}</td><td>${p.parceiro_modelo === 'atacado' ? '—' : reais(p.parceiro_comissao_centavos)}</td><td>${etiqueta(p.status, p.servico)}</td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhum cliente ainda.</td></tr>'}
</table></div></div>`;
}

// ======================= RATING BANCÁRIO =======================
export function paginaServicoRating({ cfg, combo = null, pedidos = [], usuario, erro = '', v = {} }) {
  const p = (t) => esc(t || '');
  const ult = cfg.tabela?.at(-1);
  const form = usuario ? `<form id="pedido" class="cartao" method="post" action="/rating" enctype="multipart/form-data" style="max-width:720px">
  <h2 style="font-size:1.2rem;margin-top:0">Contratar o Rating Bancário</h2>
  ${erro ? `<div class="aviso erro" role="alert">${esc(erro)}</div>` : ''}
  <div class="campo"><label for="rt-nome">Nome completo do titular (ou razão social)</label><input id="rt-nome" type="text" name="nome" required maxlength="120" value="${p(v.nome ?? usuario.nome)}"></div>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <div class="campo" style="flex:1 1 200px"><label for="rt-cpf">CPF ou CNPJ</label><input id="rt-cpf" type="text" name="cpf" required inputmode="numeric" maxlength="18" value="${p(v.cpf ?? (usuario.documento || ''))}"></div>
    <div class="campo" style="flex:1 1 180px"><label for="rt-nasc">Data de nascimento (titular ou sócio)</label><input id="rt-nasc" name="nascimento" type="date" required value="${p(v.nascimento)}" style="font:inherit;padding:11px 13px;border:1.5px solid #D6CCE0;border-radius:12px"></div>
  </div>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <div class="campo" style="flex:1 1 200px"><label for="rt-tel">WhatsApp</label><input id="rt-tel" type="tel" name="telefone" required inputmode="tel" maxlength="20" value="${p(v.telefone ?? usuario.telefone)}"></div>
    <div class="campo" style="flex:1 1 240px"><label for="rt-email">E-mail</label><input id="rt-email" name="email" type="email" required maxlength="120" value="${p(v.email ?? usuario.email)}"></div>
  </div>
  <div class="campo"><label for="rt-tipo">Documento com foto (do titular ou do sócio, se CNPJ)</label>
    <select id="rt-tipo" name="doc_tipo" required style="min-height:46px"><option value="RG">RG</option><option value="CNH" ${v.doc_tipo === 'CNH' ? 'selected' : ''}>CNH</option></select></div>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <div class="campo" style="flex:1 1 220px"><label for="rt-frente">Foto da frente</label><input id="rt-frente" name="doc_frente" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></div>
    <div class="campo" style="flex:1 1 220px"><label for="rt-verso">Foto do verso</label><input id="rt-verso" name="doc_verso" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></div>
  </div>
  <small class="muted" style="display:block;margin:-6px 0 14px">JPG, PNG ou PDF, até 5 MB cada.</small>
  <label style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px"><input type="checkbox" name="proprio" value="1" ${v.proprio === '0' ? '' : 'checked'} style="width:20px;height:20px;margin-top:3px"> <span>O pedido é para o <strong>meu próprio CPF/CNPJ</strong>. Se desmarcar, você declara ter autorização por escrito do titular.</span></label>
  <label style="display:flex;gap:10px;align-items:flex-start;margin-bottom:16px"><input type="checkbox" name="aceite" value="1" required style="width:20px;height:20px;margin-top:3px"> <span>Autorizo a análise do meu histórico de crédito e o uso destes dados e documentos exclusivamente para o serviço de Rating Bancário. Entendo que o serviço trabalha o meu perfil junto às instituições, mas <strong>não garante aprovação de crédito</strong>: a decisão final é de cada banco.</span></label>
  ${combo?.ativo ? blocoCombo(combo, v) : ''}
  <fieldset style="border:1.5px solid #D6CCE0;border-radius:14px;padding:12px 16px;margin:0 0 16px;min-width:0"><legend style="font-weight:700;padding:0 6px">Forma de pagamento</legend>
    <label style="display:flex;gap:10px;align-items:center;margin:6px 0"><input type="radio" name="forma" value="pix" ${v.forma === 'cartao' ? '' : 'checked'} style="width:20px;height:20px"> <span><strong>Pix</strong> · ${reais(cfg.preco)} à vista${combo?.ativo ? ` <span class="muted">(combo: ${reais(combo.preco)})</span>` : ''}</span></label>
    ${cfg.parcelas >= 1 ? `<label style="display:flex;gap:10px;align-items:center;margin:6px 0;flex-wrap:wrap"><input type="radio" name="forma" value="cartao" ${v.forma === 'cartao' ? 'checked' : ''} style="width:20px;height:20px"> <span><strong>Cartão de crédito</strong> em</span>
      <select name="parcelas" aria-label="Número de parcelas" style="min-height:40px;max-width:100%">${cfg.tabela.map((t) => `<option value="${t.n}" ${Number(v.parcelas || cfg.parcelas) === t.n ? 'selected' : ''}>${t.n}x de ${reais(t.parcela)}${t.n > 1 && cfg.juros > 0 ? ` (total ${reais(t.total)})` : ' sem juros'}</option>`).join('')}</select></label>
      ${combo?.ativo ? '<small class="muted" style="display:block;margin:2px 0 0 30px">Marcou o combo? As parcelas são recalculadas sobre o valor do combo na página de pagamento.</small>' : ''}` : ''}
  </fieldset>
  <button class="btn" type="submit">Continuar para o pagamento</button>
</form>` : `<div id="pedido" class="cartao" style="max-width:720px;text-align:center"><h2 style="font-size:1.2rem;margin-top:0">Pronto para melhorar o seu perfil nos bancos?</h2><p class="muted">Crie a sua conta grátis (ou entre) para contratar e acompanhar cada etapa.</p><p><a class="btn" href="/rating/contratar">Contratar o Rating Bancário</a></p></div>`;
  return `<div style="background:#0F0C14;color:#fff;border-radius:24px;padding:30px;margin-bottom:22px;background-image:radial-gradient(600px 400px at 90% 0%,#5B2D8E 0%,transparent 70%)">
  <span class="tag" style="background:#2A2233;color:#D9B8F0">SERVIÇO · RATING BANCÁRIO</span>
  <h1 style="font-size:2.1rem;line-height:1.12;margin:14px 0 10px;color:#fff;max-width:760px">Nome limpo e crédito negado? <span style="color:#C98BEB">O problema pode ser o seu rating no banco.</span></h1>
  <p style="color:#E2D3EE;font-size:1.08rem;margin:0 0 16px;max-width:720px">${p(cfg.resumo) || 'Cada banco dá uma nota interna para você, o rating, usando o seu histórico no Banco Central, o score, o Cadastro Positivo e os seus dados. Nós analisamos tudo isso e trabalhamos o seu perfil para os bancos enxergarem você melhor.'}</p>
  <p style="margin:0"><span style="font-family:Montserrat,sans-serif;font-size:2rem;font-weight:800">${reais(cfg.preco)}</span> <span style="color:#C9BFD4">no Pix${cfg.parcelas > 1 && ult ? ` ou até ${cfg.parcelas}x de ${reais(ult.parcela)} no cartão` : ''}${cfg.prazo ? ` · ${p(cfg.prazo)}` : ''}</span></p>
  <p style="margin:14px 0 0"><a class="btn" href="#pedido">Quero melhorar meu rating</a></p>
</div>
${pedidos.length ? `<div class="cartao" style="margin-bottom:18px"><h2 style="font-size:1.2rem;margin-top:0">Seus pedidos</h2><div class="rolar"><table class="tabela"><tr><th>#</th><th>Titular</th><th>Status</th><th></th></tr>
  ${pedidos.map((x) => `<tr><td>${x.id}</td><td>${esc(x.nome)}<br><span class="muted">${esc(formatarDoc(x.cpf))}</span></td><td>${etiqueta(x.status, 'rating')}</td><td><a href="/rating/${x.id}">Ver</a></td></tr>`).join('')}
</table></div></div>` : ''}
<div class="grade" style="margin-bottom:18px">
  <div class="cartao"><div style="font-size:1.7rem">🏦</div><h3 style="margin:6px 0">Análise no Banco Central</h3><p class="muted" style="margin:0">Levantamos o seu Registrato (SCR): empréstimos, limites, atrasos e prejuízos que os bancos enxergam.</p></div>
  <div class="cartao"><div style="font-size:1.7rem">📊</div><h3 style="margin:6px 0">Score e Cadastro Positivo</h3><p class="muted" style="margin:0">Conferimos score, consultas e o Cadastro Positivo nos birôs, e corrigimos o que está desligado ou desatualizado.</p></div>
  <div class="cartao"><div style="font-size:1.7rem">🗂️</div><h3 style="margin:6px 0">Cadastro em ordem</h3><p class="muted" style="margin:0">Renda, endereço e dados divergentes derrubam o rating. Orientamos e acompanhamos a atualização.</p></div>
  <div class="cartao"><div style="font-size:1.7rem">🤝</div><h3 style="margin:6px 0">Estratégia com os bancos</h3><p class="muted" style="margin:0">Plano de relacionamento: onde concentrar a movimentação, como usar o limite e quando pedir crédito.</p></div>
</div>
<div class="cartao" style="margin-bottom:18px">
  <h2 style="font-size:1.2rem;margin-top:0">Como funciona</h2>
  <p style="margin:8px 0"><strong>1. Você contrata.</strong> Preenche os dados, envia o documento e paga no Pix ou no cartão.</p>
  <p style="margin:8px 0"><strong>2. Análise do perfil.</strong> Levantamos o seu histórico de crédito e identificamos o que está pesando contra você.</p>
  <p style="margin:8px 0"><strong>3. Trabalho no rating.</strong> Atualizações cadastrais, Cadastro Positivo e ajustes de relacionamento, com orientações para você seguir.</p>
  <p style="margin:8px 0"><strong>4. Reavaliação.</strong> Medimos a evolução e indicamos o melhor momento e o melhor lugar para pedir crédito.</p>
  <p style="margin:8px 0"><strong>5. Acompanhe por aqui.</strong> Cada etapa aparece na sua área e chega no seu e-mail.</p>
  <p class="muted" style="margin:12px 0 0;font-size:.9rem">Importante: o rating é calculado por cada instituição. O serviço trabalha os fatores que pesam na nota, mas não garante aprovação de crédito.</p>
</div>
${combo?.ativo ? `<div class="cartao" style="margin-bottom:18px;border:2px solid #9F31D3"><h2 style="font-size:1.2rem;margin-top:0">Ainda tem restrições no nome?</h2><p style="margin:0">Leve o <strong>combo Limpa Nome + Rating Bancário por ${reais(combo.preco)}</strong>${combo.precoSeparado > combo.preco ? ` e economize ${reais(combo.precoSeparado - combo.preco)}` : ''}: primeiro tiramos as negativações, depois trabalhamos o seu perfil nos bancos. É só marcar o combo no formulário.</p></div>` : ''}
${form}`;
}

export function adminRating({ menu, cfg, combo, ln, pedidos, k, ok, erro }) {
  const rs = (c) => (c ? (c / 100).toFixed(2).replace('.', ',') : '');
  const ops = ['pago', 'em_analise', 'em_andamento', 'decisao', 'concluido', 'cancelado', 'reembolsado'];
  return `<h1 style="font-size:1.7rem">Rating Bancário</h1>${menu}${ok ? `<div class="aviso ok">${esc(ok)}</div>` : ''}${erro ? `<div class="aviso erro">${esc(erro)}</div>` : ''}
<div class="grade" style="margin-bottom:18px">
  ${kpiP('Aguardando início', k.aguardandoInicio, 'pagos (e combos esperando o Limpa Nome)')}${kpiP('Em andamento', k.andamento)}${kpiP('Concluídos', k.concluidos)}
  ${kpiP('Receita (Rating avulso)', reais(k.receita))}${kpiP('Combos vendidos', k.combos.n, reais(k.combos.s))}
</div>
<form class="cartao" method="post" action="/admin/rating/config" style="max-width:760px;margin-bottom:18px">
  <h2 style="font-size:1.15rem;margin-top:0">Configuração</h2>
  <label style="display:flex;gap:10px;align-items:center;margin-bottom:14px;font-weight:700"><input type="checkbox" name="ativo" value="1" ${cfg.ativoFlag ? 'checked' : ''} style="width:22px;height:22px"> À venda</label>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <div class="campo" style="flex:1 1 180px"><label for="rg-p">Preço do Rating (R$)</label><input id="rg-p" type="text" name="preco" inputmode="decimal" value="${rs(cfg.preco)}"></div>
    <div class="campo" style="flex:1 1 220px"><label for="rg-c">Preço do combo Limpa Nome + Rating (R$)</label><input id="rg-c" type="text" name="combo" inputmode="decimal" value="${rs(combo.preco)}"><small class="muted">separados: ${reais(ln.preco + cfg.preco)} · vazio = sem combo</small></div>
  </div>
  <div class="campo"><label for="rg-z">Prazo / chamada (aparece na página)</label><input id="rg-z" type="text" name="prazo" maxlength="150" value="${esc(cfg.prazo)}"></div>
  <div class="campo"><label for="rg-r">Resumo (opcional, substitui o texto do topo da página)</label><textarea id="rg-r" name="resumo" rows="2" maxlength="300" style="width:100%;font:inherit;padding:10px;border:1.5px solid #D6CCE0;border-radius:12px">${esc(cfg.resumo)}</textarea></div>
  <p class="muted" style="margin:0 0 12px">Parcelamento, juros e WhatsApp de atendimento seguem a configuração do Limpa Nome. O combo só aparece com os dois serviços à venda e preço do combo preenchido.</p>
  <button class="btn">Salvar</button> <a class="btn sec" href="/rating" target="_blank" rel="noopener">Ver página</a>
</form>
<div class="cartao"><h2 style="font-size:1.15rem;margin-top:0">Pedidos</h2><div class="rolar"><table class="tabela"><tr><th>#</th><th>Cliente</th><th>Origem</th><th>Valor</th><th>Status</th><th>Atualizar</th></tr>
${pedidos.map((x) => `<tr><td>${x.id}</td><td><strong>${esc(x.nome)}</strong><br>${esc(formatarDoc(x.cpf))}<br><span class="muted">${esc(x.telefone)} · ${esc(x.email)}</span></td>
  <td>${x.combo_de ? `combo #${x.combo_de}` : 'avulso'}${x.parceiro_id ? `<br><strong style="color:#5B2D8E">parceiro: ${esc(x.parceiro_nome || '')}</strong>` : ''}${x.doc_frente ? `<br><a href="/admin/limpa-nome/doc/${x.id}/frente" target="_blank" rel="noopener">doc frente</a>${x.doc_verso ? ` · <a href="/admin/limpa-nome/doc/${x.id}/verso" target="_blank" rel="noopener">verso</a>` : ''}` : x.combo_de ? `<br><a href="/admin/limpa-nome/doc/${x.combo_de}/frente" target="_blank" rel="noopener">doc (do combo)</a>` : ''}</td>
  <td>${reais(x.valor_centavos)}${x.pago_em ? `<br><span class="muted">pago ${dt(x.pago_em)}</span>` : ''}</td>
  <td>${etiqueta(x.status, 'rating')}${x.obs_admin ? `<br><span class="muted" style="font-size:.8rem">${esc(x.obs_admin)}</span>` : ''}<br>${x.tem_ficha ? `<a href="/admin/rating/ficha/${x.id}">📝 ver ficha cadastral</a>` : x.pago_em ? '<strong style="color:var(--erro);font-size:.85rem">ficha pendente</strong>' : ''}</td>
  <td>${x.pago_em ? `<form method="post" action="/admin/limpa-nome/status" style="display:flex;gap:6px;flex-wrap:wrap;margin:0"><input type="hidden" name="id" value="${x.id}"><input type="hidden" name="volta" value="/admin/rating">
    <select name="status" aria-label="Status" style="min-height:34px">${ops.map((o) => `<option value="${o}" ${o === x.status ? 'selected' : ''}>${esc(STATUS_RTG[o] || STATUS_LN[o].t)}</option>`).join('')}</select>
    <input type="text" name="obs" aria-label="Mensagem ao cliente" placeholder="mensagem ao cliente (opcional)" maxlength="300" style="min-width:180px;min-height:34px;padding:4px 8px" value="${esc(x.obs_admin || '')}">
    <button class="btn sec" style="${btnPeq}">Salvar</button></form>` : '<span class="muted">aguardando pagamento</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhum pedido ainda.</td></tr>'}
</table></div><p class="muted" style="margin:10px 0 0;font-size:.88rem">Ao mudar a etapa, o cliente recebe um e-mail (e o parceiro, se for cliente dele). Nos combos, o Rating começa sozinho quando o Limpa Nome é marcado como concluído.</p></div>`;
}

// ======================= FICHA CADASTRAL DO RATING (PF) =======================
// [chave, rótulo, tipo, opções/placeholder, largura]
export const ESTADOS_CIVIS = ['Solteiro(a)', 'Casado(a)', 'União estável', 'Divorciado(a)', 'Separado(a)', 'Viúvo(a)'];
export const ESCOLARIDADES = ['Fundamental incompleto', 'Fundamental completo', 'Médio incompleto', 'Médio completo', 'Superior incompleto', 'Superior completo', 'Pós-graduação'];
export const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
export const CAMPOS_FICHA = [
  ['Dados pessoais', [
    ['nome', 'Nome completo', 'text', '', '1 1 100%'],
    ['rg', 'RG', 'text', '', '1 1 160px'], ['rg_expedicao', 'Data de expedição do RG', 'date', '', '1 1 160px'], ['rg_uf', 'Estado do RG', 'uf', '', '1 1 110px'],
    ['titulo_eleitor', 'Título de eleitor', 'text', '', '1 1 180px'], ['estado_civil', 'Estado civil', ESTADOS_CIVIS, '', '1 1 180px'],
    ['nome_pai', 'Nome do pai', 'text', 'Se não constar no documento, escreva "não consta"', '1 1 100%'],
    ['escolaridade', 'Grau de instrução', ESCOLARIDADES, '', '1 1 220px'],
  ]],
  ['Contato e endereço', [
    ['email', 'E-mail', 'email', '', '1 1 240px'], ['celular', 'Celular', 'tel', '', '1 1 160px'], ['tel_residencial', 'Telefone residencial', 'text', 'Se não tiver, escreva "não tenho"', '1 1 200px'],
    ['cep', 'CEP', 'cep', '', '1 1 120px'], ['endereco', 'Endereço (rua/avenida)', 'text', '', '2 1 260px'], ['numero', 'Número', 'text', '', '0 1 100px'],
    ['bairro', 'Bairro', 'text', '', '1 1 180px'], ['cidade', 'Cidade', 'text', '', '1 1 180px'], ['uf', 'UF', 'uf', '', '0 1 90px'],
  ]],
  ['Trabalho e renda', [
    ['empresa', 'Empresa onde trabalha', 'text', 'Autônomo? Escreva "autônomo"', '1 1 240px'], ['ocupacao', 'Ocupação / cargo', 'text', '', '1 1 200px'],
    ['admissao', 'Data de admissão', 'date', '', '1 1 160px'], ['renda', 'Renda mensal (R$)', 'money', '', '1 1 150px'], ['renda_familiar', 'Renda familiar (R$)', 'money', '', '1 1 150px'],
    ['bancos', 'Bancos e instituições com que tem vínculo', 'textarea', 'Ex.: Caixa Econômica, Nubank, Renner, Itaú', '1 1 100%'],
  ]],
  ['3 referências pessoais', [1, 2, 3].flatMap((n) => [
    [`ref${n}_nome`, `Referência ${n}: nome`, 'text', '', '2 1 220px'], [`ref${n}_tel`, 'Telefone', 'tel', '', '1 1 150px'], [`ref${n}_parentesco`, 'Grau de parentesco', 'text', 'Ex.: irmã, amigo', '1 1 150px'],
  ])],
];
export const listaCamposFicha = () => CAMPOS_FICHA.flatMap(([, cs]) => cs);

export function paginaFichaRating({ p, d = {}, action, voltar, precisaDoc, temSenha = false, erro = '', ok = '' }) {
  const v = (k) => esc(d[k] ?? '');
  const campo = ([k, rot, tipo, ph, flex]) => {
    const id = `fc-${k}`;
    let input;
    if (Array.isArray(tipo)) input = `<select id="${id}" name="${k}" required style="min-height:46px"><option value="">Selecione</option>${tipo.map((o) => `<option ${d[k] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else if (tipo === 'uf') input = `<select id="${id}" name="${k}" required style="min-height:46px"><option value="">UF</option>${UFS.map((o) => `<option ${d[k] === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    else if (tipo === 'textarea') input = `<textarea id="${id}" name="${k}" required rows="2" maxlength="400" placeholder="${esc(ph)}" style="width:100%;font:inherit;padding:10px;border:1.5px solid #D6CCE0;border-radius:12px">${v(k)}</textarea>`;
    else if (tipo === 'date') input = `<input id="${id}" name="${k}" type="date" required value="${v(k)}" style="font:inherit;padding:11px 13px;border:1.5px solid #D6CCE0;border-radius:12px;width:100%">`;
    else input = `<input id="${id}" name="${k}" type="${tipo === 'email' ? 'email' : tipo === 'tel' ? 'tel' : 'text'}" ${tipo === 'money' ? 'inputmode="decimal"' : tipo === 'cep' || tipo === 'tel' ? 'inputmode="numeric"' : ''} required maxlength="${tipo === 'textarea' ? 400 : 150}" placeholder="${esc(ph)}" value="${v(k)}">`;
    return `<div class="campo" style="flex:${flex};min-width:0">${tipo !== 'textarea' && tipo !== 'date' && tipo !== 'uf' && !Array.isArray(tipo) ? '' : ''}<label for="${id}">${esc(rot)}</label>${input}</div>`;
  };
  return `${voltar ? `<p><a href="${esc(voltar[0])}">${esc(voltar[1])}</a></p>` : ''}
<h1 style="font-size:1.6rem;margin:6px 0">Ficha cadastral · Rating Bancário</h1>
<p class="muted" style="margin:0 0 16px">Pedido #${p.id} · ${esc(p.nome)} · CPF ${esc(formatarDoc(p.cpf))}. Todos os campos são obrigatórios: são os dados que usamos para trabalhar o seu perfil junto às instituições.</p>
${ok ? `<div class="aviso ok">${esc(ok)}</div>` : ''}${erro ? `<div class="aviso erro" role="alert">${esc(erro)}</div>` : ''}
<form class="cartao" method="post" action="${esc(action)}" enctype="multipart/form-data" style="max-width:820px">
  ${CAMPOS_FICHA.map(([titulo, cs]) => `<h2 style="font-size:1.12rem;margin:6px 0 10px">${esc(titulo)}</h2><div style="display:flex;gap:12px;flex-wrap:wrap">${cs.map(campo).join('')}</div>`).join('')}
  <h2 style="font-size:1.12rem;margin:6px 0 10px">Acesso ao Serasa</h2>
  <div class="campo" style="max-width:360px"><label for="fc-senha">Senha do Serasa</label><input id="fc-senha" name="senha_serasa" type="password" autocomplete="off" ${temSenha ? 'placeholder="já informada (deixe vazio para manter)"' : 'required'} maxlength="100">
    <small class="muted">Usada só para atualizar o seu cadastro e ativar o Cadastro Positivo. Fica guardada criptografada e é apagada quando o serviço termina. Não tem conta? Crie grátis em serasa.com.br antes de enviar.</small></div>
  <h2 style="font-size:1.12rem;margin:6px 0 10px">Documentos</h2>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    ${precisaDoc ? `<div class="campo" style="flex:1 1 240px"><label for="fc-doc">Foto da CNH ou do RG</label><input id="fc-doc" name="doc_ficha" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></div>` : '<p class="muted" style="flex:1 1 240px;margin:0">✓ Foto do documento já enviada no pedido.</p>'}
    <div class="campo" style="flex:1 1 240px"><label for="fc-selfie">Selfie segurando a CNH ou o RG</label><input id="fc-selfie" name="selfie" type="file" accept="image/jpeg,image/png,image/webp" ${d._selfie ? '' : 'required'}>${d._selfie ? '<small class="muted">já enviada (envie outra só se quiser trocar)</small>' : '<small class="muted">Rosto e documento bem visíveis, sem reflexo.</small>'}</div>
  </div>
  <label style="display:flex;gap:10px;align-items:flex-start;margin:6px 0 16px"><input type="checkbox" name="aceite" value="1" required style="width:20px;height:20px;margin-top:3px"> <span>Confirmo que os dados são verdadeiros e autorizo o uso deles, das imagens e do acesso ao Serasa exclusivamente para o serviço de Rating Bancário, conforme a LGPD.</span></label>
  <button class="btn" type="submit">Enviar ficha cadastral</button>
</form>`;
}

export function adminFichaRating({ menu, p, d, temSenha, senha = null, selfie, docExtra }) {
  const linha = ([k, rot]) => `<tr><th style="width:38%;text-align:left">${esc(rot)}</th><td>${esc(d[k] ?? '')}</td></tr>`;
  return `<h1 style="font-size:1.6rem">Ficha cadastral · pedido #${p.id}</h1>${menu}
<p><a href="/admin/rating">← Rating Bancário</a> · <a href="/admin/rating/ficha/${p.id}.txt">Baixar ficha (texto)</a></p>
<div class="cartao" style="max-width:820px">
  <p class="muted" style="margin-top:0">${esc(p.nome)} · CPF ${esc(formatarDoc(p.cpf))} · preenchida ${dt(d._em || '')}${d._por ? ` por ${esc(d._por)}` : ''}</p>
  ${CAMPOS_FICHA.map(([t, cs]) => `<h2 style="font-size:1.05rem;margin:14px 0 6px">${esc(t)}</h2><table class="tabela">${cs.map(linha).join('')}</table>`).join('')}
  <h2 style="font-size:1.05rem;margin:14px 0 6px">Serasa e documentos</h2>
  <table class="tabela"><tr><th style="width:38%;text-align:left">Senha do Serasa</th><td>${senha !== null ? `<code style="font-size:1rem">${esc(senha)}</code>` : temSenha ? `<form method="post" action="/admin/rating/ficha/${p.id}/senha" style="margin:0"><button class="btn sec" style="${btnPeq}">Mostrar senha (fica registrado)</button></form>` : '<span class="muted">apagada</span>'}</td></tr>
  <tr><th style="text-align:left">Selfie com documento</th><td>${selfie ? `<a href="/admin/limpa-nome/doc/${p.id}/selfie" target="_blank" rel="noopener">abrir</a>` : '<span class="muted">—</span>'}</td></tr>
  <tr><th style="text-align:left">Documento</th><td>${docExtra ? `<a href="/admin/limpa-nome/doc/${p.id}/ficha" target="_blank" rel="noopener">abrir</a>` : p.doc_frente ? `<a href="/admin/limpa-nome/doc/${p.id}/frente" target="_blank" rel="noopener">abrir (do pedido)</a>` : p.combo_de ? `<a href="/admin/limpa-nome/doc/${p.combo_de}/frente" target="_blank" rel="noopener">abrir (do combo)</a>` : '—'}</td></tr></table>
</div>`;
}
