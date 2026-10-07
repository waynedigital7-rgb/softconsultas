// Páginas de destino para campanhas (públicas, sem login)
import { esc, reais, faixaGratis } from './paginas.js';

// Conteúdo de cada público. "consultas" = endpoints em destaque (só aparecem se estiverem ativos no catálogo).
export const PUBLICOS = {
  'limpa-nome': {
    titulo: 'Consultas para profissionais de limpa nome',
    descricaoMeta: 'Cadastro grátis. Descubra em qual base o seu cliente está negativado: Serasa, SPC, Boa Vista e Banco Central. Relatório em PDF na hora, sem mensalidade.',
    selo: 'Para profissionais de limpa nome',
    h1: 'Descubra em qual base o seu cliente está negativado',
    destaque: 'em minutos',
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
    h1: 'Localize bens e informações para o seu processo',
    destaque: 'em um só lugar',
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
  empresas: {
    titulo: 'Consulta de crédito para empresas',
    descricaoMeta: 'Cadastro grátis. Consulte CPF e CNPJ antes de vender a prazo: score, restrições, protestos e dados da empresa. Sem mensalidade, relatório na hora.',
    selo: 'Para empresas e lojistas',
    h1: 'Consulte o cliente antes de vender a prazo',
    destaque: 'e evite calote',
    sub: 'Score, restrições no Serasa e SPC, protestos e dados cadastrais de CPF e CNPJ em segundos. Ideal para crediário, locação, cadastro de clientes e fornecedores.',
    dores: [
      ['Calote na venda a prazo', 'Veja score e restrições do cliente antes de liberar a mercadoria ou o crediário.'],
      ['Cadastro de clientes e fornecedores', 'Confira a situação do CNPJ, sócios e protestos antes de fechar negócio.'],
      ['Contrato caro com birô de crédito', 'Sem mensalidade e sem fidelidade: recarregue e consulte só quando precisar.'],
    ],
    consultas: ['e-boavista', 'serasa-premium', 'spc-brasil', 'pj-quod-consulta', 'cnpj', 'pj-dados-cadastrais', 'protesto-nacional', 'r-cadastrais-score-dividas'],
    extra: 'Toda a equipe pode usar a mesma conta, e você acompanha cada consulta no histórico.',
    faq: [
      ['Quanto custa?', 'O cadastro é gratuito e não há mensalidade. Você paga por consulta, com o preço exibido antes de consultar, e ganha bônus em recargas maiores.'],
      ['Preciso de autorização do cliente?', 'Para análise de crédito há base legal na LGPD, mas sempre informe o cliente e use os dados só para essa finalidade.'],
      ['Funciona para CPF e CNPJ?', 'Sim. Há consultas para pessoa física, empresas ou ambos.'],
    ],
  },
};

const ICONE_CHECK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';

export function paginaLanding({ chave, cfg, produtos }) {
  const qs = `?origem=${encodeURIComponent(chave)}`;
  const lista = produtos.length ? `<div class="lista">${produtos.map((p) => `
    <div class="item">
      <span class="ic">${ICONE_CHECK}</span>
      <span class="tx"><strong>${esc(p.nome)}</strong><span>${esc(String(p.descricao || '').split(/(?<=[.!?])\s/)[0])}</span></span>
      <span class="pr"><strong>${reais(p.preco_centavos)}</strong><small>por consulta</small></span>
    </div>`).join('')}</div>` : '';
  return `
<section class="hero" style="padding-top:8px">
  <div>
    <span class="tag">${esc(cfg.selo)}</span>
    <h1 style="margin-top:14px">${esc(cfg.h1)} <em>${esc(cfg.destaque)}</em>.</h1>
    <p class="muted" style="font-size:1.12rem;max-width:560px">${esc(cfg.sub)}</p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:22px">
      <a class="btn" href="/cadastro${qs}" data-evento="Lead">Criar conta grátis</a>
      <a class="btn sec" href="#consultas">Ver consultas e preços</a>
    </div>
    <div class="selos">${['Cadastro grátis', 'Sem mensalidade', 'Pague só pela consulta', 'PDF na hora'].map((t) => `<span>${ICONE_CHECK} ${t}</span>`).join('')}</div>
  </div>
  <div class="grade" style="grid-template-columns:1fr">
    ${cfg.dores.map(([t, d]) => `<div class="cartao"><h3 style="margin-bottom:6px">${esc(t)}</h3><p class="muted" style="margin:0">${esc(d)}</p></div>`).join('')}
  </div>
</section>
<section style="margin:4px 0 8px">${faixaGratis()}</section>
${lista ? `<section id="consultas" style="margin:10px 0 28px">
  <h2 style="font-size:1.6rem">Consultas mais usadas</h2>
  <p class="muted" style="margin-top:-4px">O acesso é grátis. Estes são os preços <strong>por consulta</strong>: você vê o valor antes de confirmar e só paga o que usar.</p>
  ${lista}
  <p style="margin-top:14px"><a class="btn" href="/cadastro${qs}" data-evento="Lead">Começar agora</a></p>
</section>` : ''}
<section class="grade" style="margin-bottom:28px">
  <div class="cartao"><h3>1. Crie sua conta grátis</h3><p class="muted" style="margin:0">Leva menos de um minuto e não tem custo.</p></div>
  <div class="cartao"><h3>2. Recarregue por Pix</h3><p class="muted" style="margin:0">O saldo cai na hora, com bônus em recargas maiores.</p></div>
  <div class="cartao"><h3>3. Consulte e baixe o PDF</h3><p class="muted" style="margin:0">Resultado na hora e histórico para baixar de novo.</p></div>
</section>
<section class="cartao" style="margin-bottom:28px;border:2px solid var(--roxo)"><p style="margin:0;font-weight:600">${esc(cfg.extra)}</p></section>
<section class="cartao" style="margin-bottom:28px">
  <h2 style="font-size:1.4rem">Perguntas frequentes</h2>
  ${cfg.faq.map(([q, r]) => `<details style="border-top:1px solid var(--borda);padding:12px 0"><summary style="cursor:pointer;font-weight:700">${esc(q)}</summary><p class="muted" style="margin:8px 0 0">${esc(r)}</p></details>`).join('')}
</section>
<section style="text-align:center;margin-bottom:10px">
  <h2 style="font-size:1.6rem">Pronto para começar?</h2>
  <p class="muted" style="margin-top:-4px">Criar a conta é grátis. Você só paga quando consultar.</p>
  <a class="btn" href="/cadastro${qs}" data-evento="Lead">Criar conta grátis</a>
</section>`;
}
