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

// Exemplo de resultado (fictício) mostrado no topo de cada página
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
  const ex = EXEMPLOS[chave];
  const top = produtos.slice(0, 5);
  const fim = bonus.ate ? bonus.ate.split('-').reverse().slice(0, 2).join('/') : '';
  const faixaBonus = bonus.ativo ? `<div class="aviso ok" style="text-align:center;margin:0 auto 26px;max-width:760px"><strong>Oferta de lançamento:</strong> +${bonus.pct}% de crédito na primeira recarga${bonus.min ? ` a partir de ${reais(bonus.min)}` : ''}${fim ? `, até ${fim}` : ''}.</div>` : '';
  return `
<section class="hero" style="padding-top:6px;align-items:center">
  <div>
    <span class="tag">${esc(cfg.selo)}</span>
    <h1 style="margin-top:14px">${esc(cfg.h1)} <em>${esc(cfg.destaque)}</em>.</h1>
    <p class="muted" style="font-size:1.12rem;max-width:540px;margin-bottom:20px">${esc(String(cfg.sub).split(/(?<=\.)\s/)[0])}</p>
    <form method="get" action="/cadastro" class="campo-consulta" data-consulta-topo>
      <input type="hidden" name="origem" value="${esc(chave)}">
      <input name="doc" type="text" inputmode="numeric" placeholder="Digite o CPF ou CNPJ" aria-label="CPF ou CNPJ para consultar" autocomplete="off">
      <button class="btn" type="submit" data-evento="Lead">Consultar agora</button>
    </form>
    <p class="muted" style="font-size:.9rem;margin:10px 0 0">Cadastro grátis em 30 segundos · sem mensalidade${menor ? ` · consultas a partir de <strong style="color:var(--preto)">${reais(menor)}</strong>` : ''}</p>
  </div>
  ${ex ? `<div class="cartao" style="max-width:420px;justify-self:center;width:100%;box-shadow:0 30px 60px -30px rgba(159,49,211,.45)">
    <div class="muted" style="font-size:.85rem">${esc(ex.titulo)}</div>
    <div style="font-family:Montserrat,sans-serif;font-size:1.3rem;font-weight:800;margin:4px 0 10px">${esc(ex.destaque)}</div>
    <table class="tabela">${ex.linhas.map(([a, b, ok]) => `<tr><td>${esc(a)}</td><td style="text-align:right;font-weight:700;color:${ok ? 'var(--ok)' : 'var(--erro)'}">${esc(b)}</td></tr>`).join('')}</table>
    <div style="display:flex;gap:8px;align-items:center;margin-top:12px;color:var(--roxo);font-weight:600;font-size:.9rem">${ICONE_PDF} Relatório em PDF na hora</div>
  </div>` : ''}
</section>
<div class="confianca" style="margin:-6px 0 30px">
  <span>Bases: Serasa · SPC · Boa Vista · Banco Central · Cartórios</span><span>🔒 LGPD</span><span>Pix seguro via Asaas</span><span>CNPJ 20.801.827/0001-01</span>${consultasFeitas >= 100 ? `<span><strong>${consultasFeitas.toLocaleString('pt-BR')}</strong> consultas realizadas</span>` : ''}
</div>
${faixaBonus}
<section class="grade" style="margin-bottom:34px">
  <div class="cartao"><span style="color:var(--roxo)">${ICONE_RAIO}</span><h3 style="margin:8px 0 4px">Resultado em segundos</h3><p class="muted" style="margin:0">Sem formulários longos nem espera. Digite o documento e pronto.</p></div>
  <div class="cartao"><span style="color:var(--roxo)">${ICONE_PDF}</span><h3 style="margin:8px 0 4px">PDF pronto para usar</h3><p class="muted" style="margin:0">Baixe, envie ao cliente ou anexe. Fica no histórico por 10 dias.</p></div>
  <div class="cartao"><span style="color:var(--roxo)">${ICONE_ESCUDO}</span><h3 style="margin:8px 0 4px">Não funcionou? Dinheiro de volta</h3><p class="muted" style="margin:0">Se a consulta falhar, o valor volta na hora para o seu saldo.</p></div>
</section>
${top.length ? `<section style="max-width:720px;margin:0 auto 34px">
  <h2 style="font-size:1.35rem;text-align:center">Preço por consulta, sem mensalidade</h2>
  <div class="lista">${top.map((p) => `<div class="item"><span class="ic">${ICONE_CHECK}</span><span class="tx"><strong>${esc(p.nome)}</strong></span><span class="pr"><strong>${reais(p.preco_centavos)}</strong><small>por consulta</small></span></div>`).join('')}</div>
</section>` : ''}
<section style="max-width:720px;margin:0 auto 30px">
  ${cfg.faq.map(([q, r]) => `<details style="border-top:1px solid var(--borda);padding:14px 0"><summary style="cursor:pointer;font-weight:700">${esc(q)}</summary><p class="muted" style="margin:8px 0 0">${esc(r)}</p></details>`).join('')}
</section>
<section class="cartao" style="text-align:center;max-width:720px;margin:0 auto 10px;background:var(--preto);color:#fff;border:0">
  <h2 style="font-size:1.5rem;color:#fff">Faça sua primeira consulta hoje</h2>
  <p style="color:#E2D3EE;margin:0 0 18px">Crie a conta grátis em 30 segundos e pague só quando consultar.</p>
  <a class="btn" style="font-size:1.05rem;padding:15px 32px" href="/cadastro?origem=${encodeURIComponent(chave)}" data-evento="Lead">Criar conta grátis</a>
</section>
<div class="cta-fixo"><span>Cadastro grátis · sem mensalidade</span><a class="btn" href="/cadastro?origem=${encodeURIComponent(chave)}" data-evento="Lead">Criar conta</a></div>`;
}
