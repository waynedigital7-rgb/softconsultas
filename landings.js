// Páginas de destino para campanhas (públicas, sem login)
import { esc, reais } from './paginas.js';

// Conteúdo de cada público. "consultas" = endpoints em destaque (só aparecem se estiverem ativos no catálogo).
export const PUBLICOS = {
  'limpa-nome': {
    titulo: 'Consultas para profissionais de limpa nome',
    descricaoMeta: 'Cadastro grátis. Descubra em qual base o seu cliente está negativado: Serasa, SPC, Boa Vista e Banco Central. Relatório em PDF na hora, sem mensalidade.',
    selo: 'Para profissionais de limpa nome',
    h1: 'Em qual base seu cliente está',
    destaque: 'negativado?',
    sub: 'Serasa, SPC, Boa Vista, Banco Central (SCR), protestos e CADIN num só lugar. Faça a triagem antes da reunião e o diagnóstico completo para fechar o serviço, com PDF pronto para mostrar ao cliente.',
    dores: [
      ['Cliente pergunta "onde estou negativado?"', 'Cada base mostra uma parte. Consulte todas e mostre o quadro completo com segurança.'],
      ['Diagnóstico caro corrói a margem', 'Triagem a partir de poucos reais. A consulta completa só quando o cliente fechar.'],
      ['Precisa provar o antes e o depois', 'Os PDFs ficam no histórico para você comparar e apresentar o resultado do serviço.'],
    ],
    consultas: ['e-boavista', 'cadin', 'protesto-nacional', 'ap-boavista', 'serasa-premium', 'spc-brasil', 'scr-premium', 'bacen'],
    extra: 'Indique outros profissionais e ganhe comissão em todas as consultas que eles fizerem.',
    faq: [
      ['O cadastro é pago? Tem mensalidade?', 'Não. O cadastro e o acesso são gratuitos. Você recarrega por Pix e paga apenas pelas consultas que fizer.'],
      ['O relatório serve para mostrar ao cliente?', 'Sim. Cada consulta gera um PDF com os dados da fonte, que você pode baixar e enviar.'],
      ['Posso consultar qualquer pessoa?', 'Apenas com a autorização do titular e para a finalidade do seu serviço, conforme a LGPD.'],
    ],
  },
  advogados: {
    titulo: 'Consultas para advogados e escritórios',
    descricaoMeta: 'Cadastro grátis. Localize veículos, imóveis e empresas do devedor, consulte processos, protestos e certidões. Relatórios em PDF, sem mensalidade.',
    selo: 'Para advogados e escritórios',
    h1: 'Ache os bens do',
    destaque: 'devedor.',
    sub: 'Veículos e imóveis em nome do devedor, participação em empresas, processos judiciais, protestos e certidões. Relatórios em PDF prontos para anexar, pagando só o que usar.',
    dores: [
      ['Execução parada por falta de bens', 'Encontre veículos, imóveis e participações societárias vinculados ao CPF ou CNPJ do devedor.'],
      ['Certidões espalhadas em vários sites', 'Emita e consulte certidões, protestos e processos numa única plataforma.'],
      ['Due diligence demorada', 'Levante o histórico de pessoas e empresas antes de contratos, acordos e audiências.'],
    ],
    consultas: ['pf-processos-judiciais', 'pj-processos-judiciais', 'pf-veiculos', 'pj-veiculos', 'consulta-imoveis', 'pj-quadro-societario', 'protesto-nacional', 'cert-pf-antecedentes-criminais', 'cert-pj-debitos-trabalhistas'],
    extra: 'Cadastre-se com o CNPJ do escritório para liberar automaticamente as consultas que envolvem dados pessoais.',
    faq: [
      ['O cadastro é pago? Tem contrato ou mensalidade?', 'Não. O cadastro e o acesso são gratuitos, sem contrato. Recarregue por Pix e pague apenas pelas consultas realizadas.'],
      ['Os relatórios podem ser anexados ao processo?', 'Você recebe o PDF da fonte consultada, com data e protocolo, para usar como subsídio.'],
      ['E as consultas com dados pessoais?', 'São liberadas para contas de escritório (CNPJ) ou após análise, e exigem finalidade legítima, conforme a LGPD.'],
    ],
  },
  veiculos: {
    titulo: 'Consulta veicular pela placa: leilão, roubo e débitos',
    descricaoMeta: 'Cadastro grátis. Consulte pela placa se o veículo tem leilão, roubo ou furto, débitos de IPVA e multas, Renajud e recall. Relatório em PDF na hora.',
    selo: 'Para lojas, revendas e compradores',
    h1: 'Consulte a placa antes de',
    destaque: 'fechar negócio.',
    sub: 'Leilão, roubo e furto, débitos de IPVA e multas, Renajud e recall a partir da placa. Evite prejuízo antes de comprar ou vender.',
    placa: true,
    dores: [],
    consultas: ['leilao', 'roubo-furto', 'debitos-veicular', 'renajud', 'ic-recall', 'ic-bin-estadual', 'csv-renainf-renajud-recall-bin-proprietario', 'ic-vipcar'],
    extra: '',
    faq: [
      ['O cadastro é pago? Tem mensalidade?', 'Não. O cadastro e o acesso são gratuitos. Você recarrega por Pix e paga apenas pelas consultas que fizer.'],
      ['Preciso de algum dado além da placa?', 'Não. As consultas veiculares funcionam só com a placa (formato antigo ou Mercosul).'],
      ['Serve para lojas e revendas?', 'Sim. Consulte cada carro que entra no estoque e guarde o PDF para mostrar ao comprador.'],
    ],
  },
  empresas: {
    titulo: 'Consulta de crédito para empresas',
    descricaoMeta: 'Cadastro grátis. Consulte CPF e CNPJ antes de vender a prazo: score, restrições, protestos e dados da empresa. Sem mensalidade, relatório na hora.',
    selo: 'Para empresas e lojistas',
    h1: 'Consulte antes de',
    destaque: 'vender a prazo.',
    sub: 'Score, restrições no Serasa e SPC, protestos e dados cadastrais de CPF e CNPJ em segundos. Ideal para crediário, locação, cadastro de clientes e fornecedores.',
    dores: [
      ['Calote na venda a prazo', 'Veja score e restrições do cliente antes de liberar a mercadoria ou o crediário.'],
      ['Cadastro de clientes e fornecedores', 'Confira a situação do CNPJ, sócios e protestos antes de fechar negócio.'],
      ['Contrato caro com birô de crédito', 'Sem mensalidade e sem fidelidade: recarregue e consulte só quando precisar.'],
    ],
    consultas: ['e-boavista', 'r-cadastrais-score-dividas', 'serasa-premium', 'spc-brasil', 'pj-quod-consulta', 'protesto-nacional', 'cnpj'],
    extra: 'Toda a equipe pode usar a mesma conta, e você acompanha cada consulta no histórico.',
    faq: [
      ['Quanto custa?', 'O cadastro é gratuito e não há mensalidade. Você paga por consulta, com o preço exibido antes de consultar, e ganha bônus em recargas maiores.'],
      ['Preciso de autorização do cliente?', 'Para análise de crédito há base legal na LGPD, mas sempre informe o cliente e use os dados só para essa finalidade.'],
      ['Funciona para CPF e CNPJ?', 'Sim. Há consultas para pessoa física, empresas ou ambos.'],
    ],
  },
};

// Conteúdo visual igual aos criativos (dados fictícios)
const VISUAL = {
  'limpa-nome': { doc: '529.982.247-25', titulo: 'Diagnóstico completo', valor: '3 restrições', linhas: [['Serasa', '2 registros', 0], ['SPC', '1 registro', 0], ['Boa Vista', 'Nada consta', 1], ['Banco Central', 'Nada consta', 1]],
    notif: [['Diagnóstico pronto ✅', '3 restrições em 2 bases. PDF pronto para a reunião.', 'agora'], ['Triagem concluída', 'Nada consta no Banco Central.', '2 min']], frase: 'Feche mais clientes com o <em>diagnóstico na mão.</em>' },
  empresas: { doc: '11.222.333/0001-81', titulo: 'Consulta de cliente', valor: 'Score 412 · risco alto', linhas: [['Pendências', '2 registros', 0], ['Protestos', 'Nada consta', 1], ['Cheques sem fundo', 'Nada consta', 1], ['Situação do CNPJ', 'Ativa', 1]],
    notif: [['Atenção: score 412 ⚠️', 'Cliente com 2 restrições. Melhor pedir entrada.', 'agora'], ['CNPJ ativo ✅', 'Nenhum protesto encontrado.', '1 min']], frase: 'O calote avisa. <em>Você só precisa consultar.</em>' },
  veiculos: { doc: 'BRA2E19', titulo: 'Consulta veicular', valor: '⚠️ Veículo de leilão', linhas: [['Leilão', 'Registro encontrado', 0], ['Roubo e furto', 'Nada consta', 1], ['Débitos (IPVA e multas)', 'R$ 1.284,50', 0], ['Renajud', 'Nada consta', 1]],
    notif: [['Atenção: veículo de leilão ⚠️', 'Registro em leilão encontrado. Negocie o preço.', 'agora'], ['Débitos encontrados', 'IPVA e multas somam R$ 1.284,50.', '1 min']], frase: 'Leilão, roubo e dívida <em>aparecem antes do negócio.</em>' },
  advogados: { doc: '390.533.447-05', titulo: 'Localização de bens', valor: '2 veículos · 1 empresa', linhas: [['Veículos', '2 encontrados', 0], ['Imóveis', '1 encontrado', 0], ['Empresas', '1 participação', 0], ['Processos', '4 processos', 0]],
    notif: [['Bens localizados ✅', '2 veículos e 1 imóvel em nome do devedor.', 'agora'], ['Certidões emitidas', 'Relatório com data e protocolo.', '3 min']], frase: 'A execução <em>volta a andar.</em>' },
};
const EXEMPLOS = {
  'limpa-nome': { titulo: 'Exemplo de diagnóstico', destaque: '3 restrições · R$ 5.517', linhas: [['Serasa', '2 registros', 0], ['SPC', '1 registro', 0], ['Boa Vista', 'Nada consta', 1], ['Banco Central (SCR)', 'Nada consta', 1], ['Protestos', '1 registro', 0]] },
  advogados: { titulo: 'Exemplo de localização de bens', destaque: '2 veículos · 1 empresa', linhas: [['Veículos no CPF', '2 encontrados', 0], ['Imóveis', '1 encontrado', 0], ['Participação societária', '1 empresa', 0], ['Processos judiciais', '4 processos', 0], ['Protestos', 'Nada consta', 1]] },
  empresas: { titulo: 'Exemplo de consulta de cliente', destaque: 'Score 412 · risco alto', linhas: [['Score de crédito', '412 / 1000', 0], ['Pendências financeiras', '2 registros', 0], ['Protestos', 'Nada consta', 1], ['Cheques sem fundo', 'Nada consta', 1], ['Situação do CNPJ', 'Ativa', 1]] },
};
const ICONE_RAIO = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg>';
const ICONE_PDF = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg>';
const ICONE_ESCUDO = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/><path d="M9 12l2 2 4-4"/></svg>';
const ICONE_CHECK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';

export function paginaLanding({ chave, cfg, produtos, bonus = {}, consultasFeitas = 0, menor = 0 }) {
  const vi = VISUAL[chave];
  const top = produtos.slice(0, 5);
  // "a partir de": menor preço entre as consultas em destaque do público
  if (top.length) menor = Math.min(...top.map((p) => p.preco_centavos).filter((v) => v > 0));
  const fim = bonus.ate ? bonus.ate.split('-').reverse().slice(0, 2).join('/') : '';
  const fecha = /[.?!]$/.test(cfg.destaque) ? '' : '.';
  // O celular de exemplo é clicável: quem toca no "Consultar" desenhado vai direto para o cadastro
  const celular = vi ? `<a class="lp-cel" href="/cadastro?origem=${encodeURIComponent(chave)}" data-evento="Lead" aria-label="Criar conta grátis e consultar" style="display:block;text-decoration:none;color:inherit"><div class="lp-tela">
      <div class="lp-top"><img src="/icone.png" alt=""> Soft Consultas</div>
      <div class="lp-busca"><span>${esc(vi.doc)}</span><b>Consultar</b></div>
      <div class="lp-res"><div class="t">${esc(vi.titulo)}</div><div class="v">${esc(vi.valor)}</div>
        ${vi.linhas.map(([a, b, ok]) => `<div class="l"><span>${esc(a)}</span><span class="${ok ? 'ok' : 'ruim'}">${esc(b)}</span></div>`).join('')}</div>
      <div class="lp-pdf">${ICONE_PDF} Baixar relatório em PDF</div></div></a>` : '';
  return `
<section class="lp-hero">
  <div class="lp-hero-in">
    <div>
      <span class="lp-selo-pub">${esc(cfg.selo)}</span>
      <h1>${esc(cfg.h1)} <em>${esc(cfg.destaque)}</em>${fecha}</h1>
      <p class="lp-sub">${esc(String(cfg.sub).split(/(?<=\.)\s/)[0])}</p>
      <form method="get" action="/cadastro" class="campo-consulta" data-consulta-topo>
        <input type="hidden" name="origem" value="${esc(chave)}">
        ${cfg.placa ? '<input name="placa" type="text" placeholder="Digite a placa (ex.: BRA2E19)" aria-label="Placa do veículo" autocomplete="off" maxlength="8" style="text-transform:uppercase">'
          : '<input name="doc" type="text" inputmode="numeric" placeholder="Digite o CPF ou CNPJ" aria-label="CPF ou CNPJ para consultar" autocomplete="off">'}
        <button class="btn" type="submit" data-evento="Lead">Consultar agora</button>
      </form>
      <a href="/cadastro?origem=${encodeURIComponent(chave)}" data-evento="Lead" style="display:inline-block;margin:10px 0 4px;color:#fff;font-weight:700;text-decoration:underline">Ou crie sua conta grátis em 30 segundos →</a>
      <div class="lp-linha">
        ${bonus.ativo ? `<span class="lp-oferta">+${bonus.pct}% na 1ª recarga${fim ? ` · até ${fim}` : ''}</span>` : ''}
        <span>Cadastro grátis · sem mensalidade${menor ? ` · a partir de <strong>${reais(menor)}</strong>` : ''}</span>
      </div>
    </div>
    ${celular}
  </div>
</section>
<div class="confianca" style="margin:18px 0 34px">
  <span>Bases: Serasa · SPC · Boa Vista · Banco Central · Cartórios</span><span>🔒 LGPD</span><span>Pix seguro via Asaas</span><span>CNPJ 20.801.827/0001-01</span>${consultasFeitas >= 100 ? `<span><strong>${consultasFeitas.toLocaleString('pt-BR')}</strong> consultas realizadas</span>` : ''}
</div>
${vi ? `<section class="lp-notifs">
  <h2>${vi.frase}</h2>
  <div class="lp-notif-col">${vi.notif.map(([m, d, h], i) => `<div class="lp-notif${i ? ' seg' : ''}"><img src="/icone-branco.png" alt=""><div style="flex:1"><div class="app"><b>Soft Consultas</b><span>${esc(h)}</span></div><div class="m">${esc(m)}</div><div class="d">${esc(d)}</div></div></div>`).join('')}</div>
</section>` : ''}
<section class="grade" style="margin:0 0 34px">
  <div class="cartao"><span style="color:var(--roxo)">${ICONE_RAIO}</span><h3 style="margin:8px 0 4px">Resultado em segundos</h3><p class="muted" style="margin:0">Digite o documento e pronto. Sem formulários longos.</p></div>
  <div class="cartao"><span style="color:var(--roxo)">${ICONE_PDF}</span><h3 style="margin:8px 0 4px">PDF pronto para usar</h3><p class="muted" style="margin:0">Baixe, envie ou anexe. Fica no histórico por 10 dias.</p></div>
  <div class="cartao"><span style="color:var(--roxo)">${ICONE_ESCUDO}</span><h3 style="margin:8px 0 4px">Não funcionou? Dinheiro de volta</h3><p class="muted" style="margin:0">Se a consulta falhar, o valor volta na hora.</p></div>
</section>
${top.length ? `<section style="max-width:720px;margin:0 auto 34px">
  <h2 style="font-size:1.35rem;text-align:center">Preço por consulta, sem mensalidade</h2>
  <div class="lista">${top.map((p) => `<div class="item"><span class="ic">${ICONE_CHECK}</span><span class="tx"><strong>${esc(p.nome)}</strong></span><span class="pr"><strong>${reais(p.preco_centavos)}</strong><small>por consulta</small></span></div>`).join('')}</div>
</section>` : ''}
<section style="max-width:720px;margin:0 auto 30px">
  ${cfg.faq.map(([q, r]) => `<details style="border-top:1px solid var(--borda);padding:14px 0"><summary style="cursor:pointer;font-weight:700">${esc(q)}</summary><p class="muted" style="margin:8px 0 0">${esc(r)}</p></details>`).join('')}
</section>
<section class="lp-final">
  <h2>Faça sua primeira consulta hoje</h2>
  <p>Crie a conta grátis em 30 segundos e pague só quando consultar.</p>
  <a class="btn lp-btn-claro" href="/cadastro?origem=${encodeURIComponent(chave)}" data-evento="Lead">Criar conta grátis</a>
</section>
<div class="cta-fixo"><span>Cadastro grátis · sem mensalidade</span><a class="btn" href="/cadastro?origem=${encodeURIComponent(chave)}" data-evento="Lead">Criar conta</a></div>`;
}
