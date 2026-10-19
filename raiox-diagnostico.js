// Raio-X: transforma o resultado da consulta em diagnóstico + plano de ação personalizado (regras, sem atendimento humano)
const real = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const WHATS = () => process.env.WHATSAPP_ATENDIMENTO || '(47) 99740-0955';
// Ofertas configuráveis: o Limpa Nome da Soft Consultas (se estiver ligado) ou o atendimento por WhatsApp

// "12/08/2019" -> anos desde a data (ou null)
function anosDesde(d) {
  const m = String(d || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const t = Date.UTC(+m[3], +m[2] - 1, +m[1]);
  return (Date.now() - t) / (365.25 * 86400000);
}

export function montarDiagnostico(resumo, documento, { limpaNome = null } = {}) {
  const pj = String(documento).replace(/\D/g, '').length === 14;
  const doc = pj ? 'CNPJ' : 'CPF';
  const score = resumo.score?.valor ?? null;
  const qtd = Number(resumo.quantidade || 0);
  const total = Number(resumo.total || 0);
  const itens = resumo.itens || [];
  const protestos = Number(resumo.protestos?.quantidade || 0);
  const acoes = itens.filter((i) => i.origem === 'Ação cível').length;
  const consultasMes = Number(resumo.consultasMes || 0);
  const consultasTot = Number(resumo.totalConsultas || 0);
  const cadPos = String(resumo.cadastroPositivo || '');
  const cadPosInativo = /n[aã]o|inativ|cancel|exclu/i.test(cadPos);
  const antigas = itens.filter((i) => (anosDesde(i.data) ?? 0) >= 5);
  const recentes = itens.filter((i) => { const a = anosDesde(i.data); return a !== null && a < 0.25; });
  const fracos = (resumo.comportamento || []).filter((c) => /^[DE]$/.test(c.nota));

  // ---------- Nível ----------
  let nivel, titulo, explicacao;
  if (qtd > 0) {
    nivel = 'critico';
    titulo = `Seu ${doc} está com restrições`;
    explicacao = `Encontramos ${qtd} ${qtd === 1 ? 'restrição' : 'restrições'}${total ? ` somando ${real(total)}` : ''}. Enquanto ${qtd === 1 ? 'ela aparecer' : 'elas aparecerem'} nas consultas, a maioria dos bancos e lojas recusa crédito automaticamente, mesmo que a sua renda seja boa. Este é o principal motivo de recusas.`;
  } else if (score !== null && score < 500) {
    nivel = 'atencao';
    titulo = 'Nome limpo, mas com score baixo';
    explicacao = `Não há restrições no seu ${doc}, mas o score (${score}) ainda está abaixo do que os bancos costumam aprovar com facilidade. Isso indica pouco histórico de pagamentos em dia, atrasos recentes ou muitas solicitações de crédito.`;
  } else if (consultasMes >= 3 || consultasTot >= 8) {
    nivel = 'atencao';
    titulo = 'Nome limpo, mas com muitas consultas';
    explicacao = `Seu ${doc} não tem restrições, porém foi consultado muitas vezes recentemente. Para o mercado, isso sinaliza "busca intensa por crédito", o que derruba o score e aumenta as recusas.`;
  } else {
    nivel = 'bom';
    titulo = `Seu ${doc} está em boa situação`;
    explicacao = `Não encontramos restrições${score !== null ? ` e o seu score é ${score}` : ''}. Você tem boas chances de aprovação. O foco agora é manter o histórico e construir relacionamento com os bancos.`;
  }

  // ---------- Achados ----------
  const achados = [];
  if (qtd > 0) {
    const maiores = [...itens].sort((a, b) => b.valor - a.valor).slice(0, 3);
    achados.push({ t: `${qtd} ${qtd === 1 ? 'restrição ativa' : 'restrições ativas'}${total ? ` (${real(total)})` : ''}`,
      d: maiores.length ? `Maiores credores: ${maiores.map((i) => `${i.credor}${i.valor ? ` (${real(i.valor)})` : ''}`).join('; ')}.` : 'Veja a lista completa na seção de restrições deste relatório.' });
  }
  if (antigas.length) achados.push({ t: `${antigas.length} ${antigas.length === 1 ? 'registro tem' : 'registros têm'} mais de 5 anos`, d: 'Pelo Código de Defesa do Consumidor (art. 43, §1º), nenhuma negativação pode ficar no cadastro por mais de 5 anos. Você pode pedir a retirada imediata desses registros.' });
  if (recentes.length) achados.push({ t: `${recentes.length} ${recentes.length === 1 ? 'restrição recente' : 'restrições recentes'} (menos de 3 meses)`, d: 'Dívidas recentes costumam ter menos desconto na negociação, mas também são as que mais pesam no score. Vale tentar resolver primeiro.' });
  if (protestos) achados.push({ t: `${protestos} ${protestos === 1 ? 'protesto' : 'protestos'} em cartório`, d: 'Para cancelar um protesto depois de pagar, é preciso pedir a carta de anuência ao credor e levar ao cartório (há taxas).' });
  if (acoes) achados.push({ t: `${acoes} ${acoes === 1 ? 'ação cível' : 'ações cíveis'}`, d: 'Processos judiciais exigem acompanhamento. Verifique se há acordo possível e mantenha os comprovantes.' });
  if (score !== null) {
    const faixa = score < 300 ? 'muito baixo: crédito muito difícil' : score < 500 ? 'baixo: crédito caro e limitado' : score < 700 ? 'bom: aprovação em muitas empresas' : 'excelente: melhores taxas e limites';
    achados.push({ t: `Score ${score} (${faixa.split(': ')[0]}): ${faixa.split(': ')[1]}`, d: resumo.score?.pagamento != null ? `Probabilidade de pagamento em dia estimada em ${resumo.score.pagamento}%. É esse número que os bancos usam para decidir.` : 'O score estima a chance de você pagar as contas em dia nos próximos meses.' });
  }
  if (consultasMes >= 3 || consultasTot >= 8) achados.push({ t: `${consultasTot || consultasMes} consultas ao seu ${doc}`, d: 'Cada pedido de crédito gera uma consulta. Muitas em pouco tempo derrubam o score. Evite novos pedidos pelos próximos 90 dias.' });
  if (cadPosInativo) achados.push({ t: 'Cadastro Positivo possivelmente inativo', d: 'Sem o Cadastro Positivo, o mercado só enxerga o que você deve, não o que você paga em dia. Ativar é grátis e ajuda muito o score.' });
  if (fracos.length) achados.push({ t: 'Pontos fracos no comportamento de pagamento', d: `Notas baixas em: ${fracos.map((f) => f.label).join(', ')}.` });

  // ---------- Plano de ação ----------
  const agora = ['Acesse o Registrato do Banco Central (gratuito, com a conta gov.br) para ver todos os empréstimos, financiamentos e cartões no seu nome.'];
  if (qtd > 0) agora.push('Separe as restrições que você reconhece das que não reconhece. Para dívida que você nunca fez, registre boletim de ocorrência e peça a retirada ao credor: pode ser fraude.');
  if (antigas.length) agora.push('Peça aos órgãos de proteção ao crédito a retirada dos registros com mais de 5 anos.');
  agora.push(cadPosInativo ? 'Ative o Cadastro Positivo nos sites da Serasa, SPC e Boa Vista.' : 'Confira se o Cadastro Positivo está ativo e se as suas contas aparecem nele.');
  agora.push('Atualize endereço, telefone e renda nos sites dos órgãos de proteção ao crédito.');

  const dias30 = [];
  if (qtd > 0) {
    dias30.push('Negocie primeiro as dívidas com maior desconto e menor valor: são as que limpam o nome mais barato. Nunca feche parcela que não cabe no bolso (no máximo 30% da renda somando tudo).');
    dias30.push('Depois de pagar, a lei dá 5 dias úteis para o credor pedir a retirada do seu nome (Súmula 548 do STJ). Consulte de novo para confirmar.');
    if (protestos) dias30.push('Para os protestos, peça a carta de anuência e cancele no cartório.');
  }
  dias30.push('Coloque contas de consumo (luz, água, celular) no seu nome e em débito automático.');
  if (consultasMes >= 3 || consultasTot >= 8) dias30.push('Não peça crédito em nenhum lugar por 90 dias.');

  const dias90 = [
    'Use no máximo 30% do limite do cartão e pague sempre a fatura inteira.',
    'Peça crédito pequeno primeiro, no banco onde você já tem conta. Um pedido por mês, no máximo.',
    'Consulte seu ' + doc + ' de novo em 60 a 90 dias para medir a evolução do score.',
  ];

  // ---------- Próximo passo recomendado ----------
  let proximo;
  const ln = limpaNome ? `o Limpa Nome da Soft Consultas, por ação judicial coletiva amparada pelo Código de Defesa do Consumidor (${limpaNome.prazo || 'nome limpo em até 30 dias'}). Veja em softconsultas.com/limpa-nome/servico` : `o Limpa Nome por ação coletiva da Soft Crédito. Fale pelo WhatsApp ${WHATS()}`;
  if (qtd >= 3 || total >= 1500) {
    proximo = { titulo: 'Recomendação: Limpa Nome', texto: `Com ${qtd} restrições${total ? ` somando ${real(total)}` : ''}, negociar uma a uma pode sair caro e demorado. O caminho mais rápido é ${ln}.` };
  } else if (qtd > 0) {
    proximo = { titulo: 'Recomendação: negociar e limpar o nome', texto: `Com ${qtd === 1 ? 'uma restrição' : 'poucas restrições'}, o caminho mais econômico costuma ser negociar direto com o credor seguindo o plano acima. Se preferir resolver tudo de uma vez, existe ${ln}.` };
  } else if (score !== null && score < 600) {
    proximo = { titulo: 'Recomendação: trabalhar o perfil de crédito', texto: `Seu nome está limpo, mas o score ainda não abre portas. Siga o plano de 90 dias acima e acompanhe a evolução com o Monitoramento da Soft Consultas (softconsultas.com/monitoramento). Para acompanhamento personalizado do Rating bancário, fale com a Soft Crédito: WhatsApp ${WHATS()}.` };
  } else {
    proximo = { titulo: 'Recomendação: proteger o que você conquistou', texto: `Seu perfil está bom. Para não ser pego de surpresa por uma negativação nova ou por fraude no seu ${doc}, ative o Monitoramento da Soft Consultas: avisamos por e-mail qualquer mudança (softconsultas.com/monitoramento).` };
  }

  return { nivel, titulo, explicacao, achados, plano: [['Agora (próximos 7 dias)', agora], ['Em até 30 dias', dias30], ['Em até 90 dias', dias90]], proximo };
}
