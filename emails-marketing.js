// E-mails automáticos para quem se cadastrou e ainda não fez a primeira recarga
// Cada e-mail é adaptado ao perfil do cliente (de onde ele veio: limpa nome, veículos, empresas, advogados)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reais = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const PERFIS = ['limpa-nome', 'veiculos', 'empresas', 'advogados', 'geral'];
export function perfilDo(u) {
  const t = `${u.origem || ''} ${u.utm_campaign || ''} ${u.pagina_entrada || ''}`.toLowerCase();
  if (/limpa|negativ|serasa|nome/.test(t)) return 'limpa-nome';
  if (/veicul|placa|carro|leil/.test(t)) return 'veiculos';
  if (/advog|devedor|jur/.test(t)) return 'advogados';
  if (/empresa|cnpj|credito|crédito/.test(t)) return 'empresas';
  return 'geral';
}

// Conteúdo por perfil
const P = {
  'limpa-nome': {
    gancho: 'descobrir em qual base seu nome está negativado',
    bases: ['Serasa, SPC e Boa Vista', 'Banco Central (dívidas bancárias)', 'Protestos em cartório e CADIN'],
    exemplo: 'Você digita o CPF e, em minutos, recebe um PDF com as dívidas registradas no seu nome. Com isso você sabe exatamente o que negociar para limpar o nome.',
    link: '/consultas', cta: 'Consultar meu CPF',
  },
  veiculos: {
    gancho: 'conferir a placa antes de fechar negócio',
    bases: ['Leilão e sinistro (perda total)', 'Roubo e furto, Renajud e restrições', 'Débitos de IPVA, multas e recall'],
    exemplo: 'Carro de leilão ou com sinistro costuma valer bem menos na revenda e pode ter seguro recusado. Com a placa você descobre isso em minutos, antes de pagar.',
    link: '/consultas/categoria/veiculos', cta: 'Consultar uma placa',
  },
  empresas: {
    gancho: 'analisar um cliente antes de vender a prazo',
    bases: ['Score e restrições do CPF ou CNPJ', 'Protestos e pendências financeiras', 'Dados cadastrais e sócios'],
    exemplo: 'Antes de liberar um boleto ou um parcelamento, uma consulta de crédito mostra se o cliente tem dívidas em aberto. Um único calote evitado paga meses de consultas.',
    link: '/consultas', cta: 'Analisar um cliente',
  },
  advogados: {
    gancho: 'localizar devedores e bens para seus processos',
    bases: ['Endereços e telefones atualizados', 'Veículos e vínculos empresariais', 'Score, protestos e restrições'],
    exemplo: 'Na fase de execução, localizar o devedor e o patrimônio é o que faz o processo andar. Os relatórios saem em PDF, prontos para anexar.',
    link: '/consultas', cta: 'Fazer uma consulta',
  },
  geral: {
    gancho: 'consultar CPF, CNPJ e veículos em minutos',
    bases: ['Crédito, score e negativações', 'Dados cadastrais de pessoas e empresas', 'Histórico de veículos pela placa'],
    exemplo: 'Você escolhe a consulta, digita o documento ou a placa e recebe o relatório oficial em PDF na hora. Sem mensalidade: paga só o que usar.',
    link: '/consultas', cta: 'Ver as consultas',
  },
};

// Etapas da sequência (horas depois do cadastro)
export const ETAPAS = [
  { chave: 'd1', horas: 24, nome: '1 dia depois' },
  { chave: 'd3', horas: 72, nome: '3 dias depois' },
  { chave: 'd7', horas: 144, nome: '6 dias depois (último dia da oferta)' },
];

function moldura({ base, preheader, corpo, sair }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#F4F1F7">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F1F7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#0F0C14">
  <tr><td style="background:#0F0C14;padding:20px 28px">
    <img src="${base}/icone-branco.png" width="28" height="28" alt="" style="vertical-align:middle">
    <span style="color:#ffffff;font-weight:bold;font-size:18px;vertical-align:middle;margin-left:8px">Soft <span style="color:#C98BEB;font-weight:normal">Consultas</span></span>
  </td></tr>
  <tr><td style="padding:28px 28px 8px;font-size:16px;line-height:1.55">${corpo}</td></tr>
  <tr><td style="padding:8px 28px 28px;font-size:12px;color:#7A7285;line-height:1.5">
    Você recebeu este e-mail porque criou uma conta na Soft Consultas.${sair ? `<br>
    <a href="${esc(sair)}" style="color:#7A7285">Não quero mais receber estes e-mails</a>` : ''}
  </td></tr>
</table></td></tr></table></body></html>`;
}
const botao = (href, texto) => `<p style="margin:24px 0"><a href="${esc(href)}" style="display:inline-block;background:#9F31D3;color:#ffffff;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:bold;font-size:16px">${esc(texto)}</a></p>`;
const lista = (itens) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px">${itens.map((i) => `<tr><td style="padding:4px 10px 4px 0;color:#9F31D3;font-weight:bold;vertical-align:top">✓</td><td style="padding:4px 0">${esc(i)}</td></tr>`).join('')}</table>`;
const nomeOferta = (b) => (b.pct >= 100 ? 'primeira recarga em dobro' : `+${b.pct}% na primeira recarga`);
const caixaBonus = (b) => {
  const ex = b.exemplo || Math.max(b.min || 0, 500);
  const bon = b.bonusExemplo ?? Math.round((ex * b.pct) / 100);
  return `<div style="background:#EFFAF3;border:2px solid #1E7B4D;border-radius:14px;padding:14px 16px;margin:18px 0">
  <strong style="color:#14532D;font-size:17px">🎁 ${b.pct >= 100 ? 'Sua primeira recarga em dobro' : `+${b.pct}% na sua primeira recarga`}</strong><br>
  <span style="font-size:15px">Recarregue <strong>${reais(ex)}</strong> por Pix e receba <strong>${reais(ex + bon)}</strong> em créditos para consultas${b.prazoTexto ? ` (válido ${b.prazoTexto})` : ''}.</span></div>`;
};

// Monta { assunto, html } para uma etapa
export function montarEmail({ etapa, nome, perfil, bonus, base, sair, podeResponder = false }) {
  const p = P[perfil] || P.geral;
  const primeiro = esc(String(nome || '').trim().split(/\s+/)[0] || 'tudo bem');
  const utm = (c) => `?utm_source=email&utm_medium=automacao&utm_campaign=${c}`;
  const b = bonus?.ativo ? bonus : null;
  if (etapa === 'boasvindas') {
    return {
      assunto: `Bem-vindo à Soft Consultas, ${primeiro}!`,
      html: moldura({ base, sair: null, preheader: 'Sua conta está pronta. Veja como fazer sua primeira consulta.', corpo: `
        <h1 style="font-size:22px;margin:0 0 12px">Sua conta está pronta, ${primeiro}!</h1>
        <p>Agora você pode ${esc(p.gancho)} em poucos minutos, com relatório oficial em PDF.</p>
        <p style="margin:6px 0"><strong>1.</strong> Recarregue via Pix (cai na hora).<br><strong>2.</strong> Escolha a consulta e digite o documento ou a placa.<br><strong>3.</strong> Receba o relatório em PDF.</p>
        ${b ? caixaBonus(b) : ''}
        ${botao(`${base}/painel${utm('boasvindas')}`, 'Acessar minha conta')}
        <h2 style="font-size:18px;margin:26px 0 8px">Tudo o que você encontra na Soft Consultas</h2>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:15px">
          ${[
            ['💳', 'Crédito e negativações', 'Score, Serasa, SPC, Boa Vista, protestos, CADIN e dívidas no Banco Central.'],
            ['🧾', 'Área Limpa Nome', 'Descubra em qual base seu nome (ou o do seu cliente) está negativado e o que negociar.'],
            ['🚗', 'Veículos', 'Pela placa: leilão, sinistro, roubo e furto, débitos, multas, Renajud e recall.'],
            ['🏢', 'Empresas (CNPJ)', 'Dados cadastrais, sócios, restrições e análise de crédito antes de vender a prazo.'],
            ['👤', 'Pessoas (CPF)', 'Dados cadastrais e de contato atualizados, para localizar clientes e devedores.'],
            ['📄', 'Relatório em PDF', 'Cada consulta gera o relatório oficial da fonte, pronto para baixar ou enviar.'],
            ['🤝', 'Indique e ganhe', 'Compartilhe seu link e ganhe comissão em todas as consultas de quem você indicar.'],
          ].map(([i, t, d]) => `<tr><td style="padding:8px 10px 8px 0;vertical-align:top;font-size:20px">${i}</td><td style="padding:8px 0;border-bottom:1px solid #EFEAF3"><strong>${t}</strong><br><span style="color:#5B5366;font-size:14px">${d}</span></td></tr>`).join('')}
        </table>
        <p style="font-size:14px;color:#5B5366;margin-top:18px">Sem mensalidade e sem fidelidade: você paga só pelas consultas que fizer. Guarde este e-mail: o acesso é sempre pelo site softconsultas.com com o seu e-mail e senha.</p>` }),
    };
  }
  if (etapa === 'd1') {
    return {
      assunto: b ? `${primeiro}, sua ${nomeOferta(b)} está esperando` : `${primeiro}, sua primeira consulta leva 2 minutos`,
      html: moldura({ base, sair, preheader: `Veja como ${p.gancho} em poucos minutos.`, corpo: `
        <h1 style="font-size:22px;margin:0 0 12px">Oi, ${primeiro}! Falta só um passo.</h1>
        <p>Sua conta na Soft Consultas está pronta para ${esc(p.gancho)}. Funciona assim:</p>
        <p style="margin:6px 0"><strong>1.</strong> Recarregue via Pix (cai na hora).<br><strong>2.</strong> Escolha a consulta e digite o documento ou a placa.<br><strong>3.</strong> Receba o relatório oficial em PDF.</p>
        ${b ? caixaBonus(b) : ''}
        ${botao(`${base}/recarregar${utm('seq_d1')}`, b ? 'Recarregar com bônus' : 'Fazer minha primeira recarga')}
        <p style="font-size:14px;color:#5B5366">Sem mensalidade e sem fidelidade: você paga só pelas consultas que fizer.</p>` }),
    };
  }
  if (etapa === 'd3') {
    return {
      assunto: `O que você descobre com uma consulta na Soft`,
      html: moldura({ base, sair, preheader: p.exemplo.slice(0, 90), corpo: `
        <h1 style="font-size:22px;margin:0 0 12px">${primeiro}, veja o que aparece no relatório</h1>
        <p>${esc(p.exemplo)}</p>
        <p style="margin-bottom:0"><strong>O que você consulta:</strong></p>
        ${lista(p.bases)}
        ${botao(`${base}${p.link}${utm('seq_d3')}`, p.cta)}
        <p style="font-size:14px;color:#5B5366">Seus dados e os das suas consultas ficam protegidos e o histórico é apagado automaticamente depois de alguns dias (LGPD).</p>` }),
    };
  }
  // d7: última chamada
  return {
    assunto: b ? `Último dia: ${nomeOferta(b)}` : `${primeiro}, ainda podemos ajudar?`,
    html: moldura({ base, sair, preheader: b ? `Recarregue ${reais(b.exemplo || b.min)} e receba ${reais((b.exemplo || b.min) + (b.bonusExemplo || 0))}. Acaba hoje.` : 'Se tiver qualquer dúvida, estamos aqui para ajudar.', corpo: `
      <h1 style="font-size:22px;margin:0 0 12px">${primeiro}, sua conta continua pronta</h1>
      <p>Faz alguns dias que você criou sua conta e ainda não fez a primeira consulta. Se ficou alguma dúvida sobre preço, segurança ou qual consulta escolher, ${podeResponder ? 'é só responder este e-mail' : 'fale com a gente pelo site'}.</p>
      ${b ? caixaBonus(b) : ''}
      ${botao(`${base}/recarregar${utm('seq_d7')}`, b ? 'Usar meu bônus agora' : 'Fazer minha primeira consulta')}` }),
  };
}

// ======================= CAMPANHAS AVULSAS (disparo pelo Admin) =======================
// Campanha: "Consulte o seu próprio CPF" com a Cred Completa Plus
export const CAMPANHAS = {
  'cpf-credplus': { nome: 'Consulte seu CPF · Cred Completa Plus', produto: 'cred-completa-plus' },
  // Semanal: pode ser reenviada a cada lote; quem já tem pedido em andamento não recebe
  'limpa-nome-servico': { nome: 'Limpa Nome · lote da semana', produto: null, semanal: true },
  // Preços novos (margem menor): uma por segmento; cada cliente recebe só a do seu perfil
  'precos-limpa-nome': { nome: 'Preços novos · perfil Limpa Nome / CPF', produto: null, promo: true, perfil: 'limpa-nome' },
  'precos-veiculos': { nome: 'Preços novos · perfil Veículos', produto: null, promo: true, perfil: 'veiculos' },
  'precos-empresas': { nome: 'Preços novos · perfil Empresas', produto: null, promo: true, perfil: 'empresas' },
  'precos-advogados': { nome: 'Preços novos · perfil Advogados', produto: null, promo: true, perfil: 'advogados' },
  'precos-geral': { nome: 'Preços novos · demais clientes', produto: null, promo: true, perfil: 'geral' },
};
// Textos da campanha de preços por segmento
const PROMO = {
  'limpa-nome': { assunto: (n, d) => `${n}, consultar o seu CPF ficou ${d ? `até ${d}% ` : ''}mais barato`, titulo: 'Consultar o seu CPF ficou mais barato',
    intro: 'Baixamos os preços das consultas. Agora ficou mais fácil descobrir onde o seu nome está negativado, quanto deve e o que negociar primeiro, antes de pedir crédito.' },
  veiculos: { assunto: (n, d) => `${n}, consultar placa ficou ${d ? `até ${d}% ` : ''}mais barato`, titulo: 'Consultar placa ficou mais barato',
    intro: 'Baixamos os preços das consultas. Antes de comprar ou vender um carro, confira leilão, sinistro, restrições e débitos pagando menos.' },
  empresas: { assunto: (n, d) => `${n}, analisar clientes ficou ${d ? `até ${d}% ` : ''}mais barato`, titulo: 'Analise seus clientes pagando menos',
    intro: 'Baixamos os preços das consultas. Agora sai ainda mais em conta checar CPF e CNPJ antes de vender a prazo: um único calote evitado paga muitas consultas.' },
  advogados: { assunto: (n, d) => `${n}, localizar devedores ficou ${d ? `até ${d}% ` : ''}mais barato`, titulo: 'Localizar devedores ficou mais barato',
    intro: 'Baixamos os preços das consultas. Endereços, telefones, bens e restrições para os seus processos, em PDF pronto para anexar, pagando menos.' },
  geral: { assunto: (n, d) => `${n}, as consultas da Soft Consultas ficaram ${d ? `até ${d}% ` : ''}mais baratas`, titulo: 'Preços novos, mais baixos',
    intro: 'Baixamos os preços das consultas de CPF, CNPJ e veículos. Mesmos relatórios oficiais em PDF, na hora, sem mensalidade: você paga só o que usar.' },
};
export function montarCampanha({ chave, nome, produto, bonus, base, sair, podeResponder = false, servico = null, promo = null }) {
  const primeiro = esc(String(nome || '').trim().split(/\s+/)[0] || 'tudo bem');
  const utm = `?utm_source=email&utm_medium=campanha&utm_campaign=${chave}`;
  const b = bonus?.ativo ? bonus : null;
  const preco = produto?.preco_centavos ? reais(produto.preco_centavos) : '';
  if (CAMPANHAS[chave]?.promo) {
    const perfil = CAMPANHAS[chave].perfil, t = PROMO[perfil] || PROMO.geral, cfgP = P[perfil] || P.geral;
    const itens = promo?.itens || [];
    const desc = promo?.desconto || 0;
    const link = `${base}${cfgP.link}${utm}`;
    const cards = itens.map((i) => `<tr><td style="padding:14px 16px;border-bottom:1px solid #EEE7F4">
        <div style="font-weight:bold;font-size:16px;color:#0F0C14">${esc(i.nome)}</div>
        ${i.descricao ? `<div style="font-size:13px;color:#5B5366;margin-top:3px">${esc(i.descricao)}</div>` : ''}</td>
      <td style="padding:14px 16px;border-bottom:1px solid #EEE7F4;text-align:right;white-space:nowrap;vertical-align:middle">
        ${i.antes ? `<div style="font-size:13px;color:#9A8FA8;text-decoration:line-through">${reais(i.antes)}</div>` : ''}
        <div style="font-size:19px;font-weight:bold;color:#5B2D8E">${reais(i.preco)}</div></td></tr>`).join('');
    return {
      assunto: t.assunto(primeiro, desc),
      html: moldura({ base, sair, preheader: `${desc ? `Até ${desc}% mais barato. ` : ''}Relatórios oficiais em PDF, na hora, sem mensalidade.`, corpo: `
        <div style="display:inline-block;background:#F6ECFC;color:#5B2D8E;font-weight:bold;font-size:12px;letter-spacing:1px;border-radius:999px;padding:6px 14px">PREÇOS NOVOS${desc ? ` · ATÉ ${desc}% MENOS` : ''}</div>
        <h1 style="font-size:22px;margin:12px 0 10px">${primeiro}, ${esc(t.titulo.charAt(0).toLowerCase() + t.titulo.slice(1))}</h1>
        <p>${esc(t.intro)}</p>
        ${itens.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #EEE7F4;border-radius:14px;border-collapse:separate;margin:18px 0;overflow:hidden">${cards}</table>` : ''}
        ${b ? caixaBonus(b) : ''}
        ${botao(link, cfgP.cta)}
        <p style="font-size:14px;color:#5B5366">Sem mensalidade: você recarrega o valor que quiser e paga só as consultas que fizer.${podeResponder ? ' Dúvidas? É só responder este e-mail.' : ''}</p>` }),
    };
  }
  if (chave === 'cpf-credplus') {
    const link = `${base}/consultas/${produto?.slug || 'cred-completa-plus'}${utm}`;
    return {
      assunto: `${primeiro}, você sabe o que as empresas veem quando consultam o seu CPF?`,
      html: moldura({ base, sair, preheader: 'Score, negativações, protestos e quem consultou seu CPF, num relatório só.', corpo: `
        <h1 style="font-size:22px;margin:0 0 12px">${primeiro}, veja o seu CPF com os olhos de quem vai te dar crédito</h1>
        <p>Antes de aprovar um cartão, um financiamento ou até um aluguel, as empresas consultam o seu CPF. Com a <strong>Cred Completa Plus</strong> você vê exatamente o mesmo tipo de informação, antes delas:</p>
        ${lista(['Score e rating de crédito', 'Negativações, protestos e cheques sem fundo', 'Ações judiciais registradas', 'Cadastro positivo', 'Quais empresas consultaram o seu CPF recentemente'])}
        <div style="background:#0F0C14;color:#ffffff;border-radius:14px;padding:18px 20px;margin:20px 0">
          <div style="font-size:13px;color:#C98BEB;font-weight:bold;letter-spacing:.5px">CRED COMPLETA PLUS</div>
          <div style="font-size:15px;margin-top:6px">Relatório completo em PDF, na hora${preco ? `<br><span style="font-size:26px;font-weight:bold">${preco}</span> <span style="color:#C9BFD4">por consulta, sem mensalidade</span>` : ''}</div>
        </div>
        ${b ? caixaBonus(b) : ''}
        ${botao(link, 'Consultar meu CPF agora')}
        <p style="font-size:14px;color:#5B5366">Consultar o próprio CPF é um direito seu. O resultado fica só na sua conta e é apagado automaticamente depois de alguns dias (LGPD).${podeResponder ? ' Dúvidas? É só responder este e-mail.' : ''}</p>` }),
    };
  }
  if (chave === 'limpa-nome-servico') {
    const sv = servico || {};
    const link = `${base}/limpa-nome/servico${utm}`;
    const lote = sv.lote ? sv.lote.split('-').reverse().join('/') : '';
    const ult = sv.tabela?.at(-1);
    const parc = sv.parcelas > 1 && ult ? ` ou em até ${sv.parcelas}x de ${reais(ult.parcela)} no cartão` : '';
    const prazo = sv.prazo || 'Nome limpo em até 30 dias';
    return {
      assunto: `${primeiro}, ${prazo.charAt(0).toLowerCase() + prazo.slice(1)}, com "nada consta" no seu CPF`,
      html: moldura({ base, sair, preheader: `Ação judicial coletiva amparada pelo CDC. ${reais(sv.preco || 0)} no Pix${parc}.`, corpo: `
        <h1 style="font-size:22px;margin:0 0 12px">${primeiro}, ${esc(prazo.charAt(0).toLowerCase() + prazo.slice(1))}</h1>
        <p>Nome negativado fecha portas: cartão negado, financiamento recusado, aluguel que não sai. Agora a Soft Consultas tem o <strong>Limpa Nome por ação judicial coletiva</strong>, amparada pelo Código de Defesa do Consumidor.</p>
        ${lista(['Retirada das negativações do seu CPF ou CNPJ: Serasa, SPC, Boa Vista e protestos', '"Nada consta" no relatório: as empresas deixam de ver os débitos antigos', ...(sv.blindagem ? [`Blindagem de ${sv.blindagem} meses: se alguma negativação abrangida voltar, reprotocolamos sem custo`] : []), 'Sem advogado e sem ir ao fórum: pedido 100% online, com acompanhamento órgão por órgão', `${prazo}`])}
        <div style="background:#0F0C14;color:#ffffff;border-radius:14px;padding:18px 20px;margin:20px 0">
          <div style="font-size:13px;color:#C98BEB;font-weight:bold;letter-spacing:.5px">LIMPA NOME · AÇÃO COLETIVA</div>
          <div style="font-size:15px;margin-top:6px"><span style="font-size:26px;font-weight:bold">${reais(sv.preco || 0)}</span> <span style="color:#C9BFD4">no Pix${esc(parc)}</span></div>
          ${lote ? `<div style="font-size:14px;color:#E3C6F4;margin-top:8px">Próxima inclusão na ação: <strong>${lote}</strong></div>` : ''}
        </div>
        ${sv.video ? `<p><a href="${link}" style="color:#9F31D3;font-weight:bold">▶ Assista ao vídeo explicativo</a></p>` : ''}
        ${botao(link, 'Quero limpar meu nome')}
        <p style="font-size:13px;color:#5B5366">Garantimos a retirada das negativações; não garantimos aprovação de crédito, que depende de cada empresa. A dívida em si continua com o credor.${podeResponder ? ' Dúvidas? É só responder este e-mail.' : ''}</p>` }),
    };
  }
  throw new Error('Campanha desconhecida');
}
