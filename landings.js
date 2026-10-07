// Páginas de destino para campanhas (públicas, sem login)
import { esc, reais } from './paginas.js';

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
  const top = produtos.slice(0, 5);
  const selos = `<div class="selos" style="justify-content:center">${['Cadastro grátis', 'Sem mensalidade', 'Pague só pela consulta'].map((t) => `<span>${ICONE_CHECK} ${t}</span>`).join('')}</div>`;
  return `
<section style="text-align:center;max-width:760px;margin:12px auto 36px">
  <span class="tag">${esc(cfg.selo)}</span>
  <h1 style="font-size:clamp(2rem,5vw,3.2rem);font-weight:800;letter-spacing:-.02em;margin:16px 0 12px">${esc(cfg.h1)} <em style="font-style:normal;color:var(--roxo)">${esc(cfg.destaque)}</em>.</h1>
  <p class="muted" style="font-size:1.15rem;margin:0 auto 24px;max-width:600px">${esc(String(cfg.sub).split(/(?<=\.)\s/)[0])}</p>
  <a class="btn" style="font-size:1.08rem;padding:16px 34px" href="/cadastro${qs}" data-evento="Lead">Criar conta grátis</a>
  ${selos}
</section>
${top.length ? `<section style="max-width:720px;margin:0 auto 36px">
  <h2 style="font-size:1.3rem;text-align:center">Consultas mais usadas</h2>
  <div class="lista">${top.map((p) => `<div class="item"><span class="ic">${ICONE_CHECK}</span><span class="tx"><strong>${esc(p.nome)}</strong></span><span class="pr"><strong>${reais(p.preco_centavos)}</strong><small>por consulta</small></span></div>`).join('')}</div>
</section>` : ''}
<section style="max-width:720px;margin:0 auto 36px;text-align:center">
  <p style="font-weight:600;margin:0">1. Crie a conta grátis &nbsp;→&nbsp; 2. Recarregue por Pix &nbsp;→&nbsp; 3. Consulte e baixe o PDF</p>
</section>
<section style="max-width:720px;margin:0 auto 36px">
  ${cfg.faq.map(([q, r]) => `<details style="border-top:1px solid var(--borda);padding:14px 0"><summary style="cursor:pointer;font-weight:700">${esc(q)}</summary><p class="muted" style="margin:8px 0 0">${esc(r)}</p></details>`).join('')}
</section>
<section style="text-align:center;margin-bottom:10px">
  <a class="btn" style="font-size:1.08rem;padding:16px 34px" href="/cadastro${qs}" data-evento="Lead">Começar agora, é grátis</a>
</section>`;
}
