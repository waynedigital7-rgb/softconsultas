// Raio-X: organiza o retorno da consulta Boa Vista (APIFull) em um resumo para o relatório
// "5.999,63" -> 5999.63 | 0 -> 0 | null -> 0
function dinheiro(v) {
  if (typeof v === 'number') return v;
  if (!v) return 0;
  const t = String(v).trim();
  const n = /,\d{1,2}$/.test(t)
    ? Number(t.replace(/[^\d,-]/g, '').replace(',', '.'))
    : Number(t.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// "2026-08-12T03:00:00.000+00:00" -> "12/08/2026"
function data(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
}

const primeiro = (obj, chaves) => {
  for (const c of chaves) if (obj?.[c] !== undefined && obj[c] !== null && obj[c] !== '') return obj[c];
  return '';
};

// Procura uma chave em qualquer nível do JSON
function acharChave(obj, nome) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (nome in obj) return obj[nome];
  for (const v of Object.values(obj)) {
    const achou = acharChave(v, nome);
    if (achou !== undefined) return achou;
  }
  return undefined;
}

const CREDOR = ['nomeInformante', 'informante', 'credor', 'nomeCredor', 'razaoSocial', 'nomeAssociado', 'empresa', 'nomeCartorio', 'cartorio', 'origem'];
const VALOR = ['valor', 'valorDebito', 'valorProtesto', 'valorProtestado', 'valorTotal', 'valorDivida'];
const DATA = ['dataOcorrencia', 'dataDebito', 'dataInclusao', 'dataProtesto', 'dataVencimento', 'data'];

function mapear(lista, tipo) {
  return (Array.isArray(lista) ? lista : []).filter((x) => x && typeof x === 'object').map((x) => {
    let credor = primeiro(x, CREDOR) || 'Não informado';
    const cidade = primeiro(x, ['cidade']);
    const uf = primeiro(x, ['unidadeFederativa', 'uf']);
    if (tipo === 'Protesto' && cidade) credor += ` - ${cidade}${uf ? '/' + uf : ''}`;
    return { credor, valor: dinheiro(primeiro(x, VALOR)), data: data(primeiro(x, DATA)), origem: tipo };
  });
}

// Tipos do painel que são restrições (ficam de fora: consultas e participação em empresas)
const NOMES = [
  [/d[eé]bito/i, 'Pendências financeiras (dívidas)'],
  [/fal[eê]ncia|recupera/i, 'Recuperações e falências'],
  [/^a[cç][oõ]es/i, 'Ações cíveis'],
  [/sem fundo/i, 'Cheques sem fundo'],
  [/sustado/i, 'Cheques sustados'],
  [/devolu/i, 'Cheques devolvidos'],
  [/protesto/i, 'Protestos em cartório'],
];
const RESTRICOES = /d[eé]bito|a[cç][oõ]es|cheque|fal[eê]ncia|recupera|devolu|protesto/i;

export function montarResumo(dados) {
  const saida = acharChave(dados, 'saida') || dados.dados || dados;

  // Formato real da APIFull / Boa Vista
  const deb = saida.RegistroDeDebitos || acharChave(dados, 'RegistroDeDebitos') || {};
  const prot = saida.Protestos || acharChave(dados, 'Protestos') || {};
  const acoes = saida.AcoesCiveis || acharChave(dados, 'AcoesCiveis') || {};

  // Formato do exemplo antigo da documentação (mantido por compatibilidade)
  const resumoAntigo = acharChave(dados, 'resumoConsulta') || {};
  const pendAnt = resumoAntigo.pendenciasFinanceiras || {};
  const protAnt = resumoAntigo.protestos || {};

  const itensDeb = mapear(deb.listaDebitos ?? (Array.isArray(saida.pendenciasFinanceiras) ? saida.pendenciasFinanceiras : acharChave(dados, 'pendenciasFinanceiras')), 'Pendência financeira');
  const itensProt = mapear(prot.listaProtestos ?? (Array.isArray(saida.protestos) ? saida.protestos : null), 'Protesto');
  const itensAcoes = mapear(acoes.listaAcoes, 'Ação cível');
  const itens = [...itensDeb, ...itensProt, ...itensAcoes];
  const soma = (l) => l.reduce((s, x) => s + x.valor, 0);

  const pendencias = {
    quantidade: Math.max(Number(deb.totalDebitosDevedor || pendAnt.quantidadeTotal || 0), itensDeb.length),
    valor: dinheiro(deb.valorAcumulado) || dinheiro(pendAnt.valorTotal) || soma(itensDeb),
  };
  const protestos = {
    quantidade: Math.max(Number(prot.quantidade || protAnt.quantidadeTotal || 0), itensProt.length),
    valor: dinheiro(prot.valorTotal) || dinheiro(protAnt.valorTotal) || soma(itensProt),
  };

  // Checklist por tipo de registro
  let painel = (saida.ListaPainelControle || acharChave(dados, 'ListaPainelControle') || [])
    .filter((p) => RESTRICOES.test(p.ocorrencia || ''))
    .map((p) => {
      const tipo = NOMES.find(([re]) => re.test(p.ocorrencia))?.[1] || p.ocorrencia;
      let valor = dinheiro(p.valorTotal);
      if (!valor && /protesto/i.test(p.ocorrencia)) valor = protestos.valor;
      if (!valor && /d[eé]bito/i.test(p.ocorrencia)) valor = pendencias.valor;
      return { tipo, total: Number(p.total || 0), valor };
    });
  if (!painel.length) {
    painel = [
      { tipo: 'Registro de débito', total: pendencias.quantidade, valor: pendencias.valor },
      { tipo: 'Protestos', total: protestos.quantidade, valor: protestos.valor },
    ];
  }

  // Score
  const sc0 = (saida.Scores || acharChave(dados, 'Scores') || [])[0];
  const score = sc0 && sc0.score !== null && sc0.score !== '' ? {
    valor: Number(sc0.score),
    pagamento: sc0.probabilidade ? Math.round(100 - Number(sc0.probabilidade)) : null,
    faixa: sc0.classificacaoAlfabetica || '',
  } : null;

  const quantidade = painel.reduce((s, p) => s + p.total, 0) || itens.length;
  const total = pendencias.valor + protestos.valor || soma(itens);

  // ===== Dados extras para o relatório completo =====
  const sec = (k) => (saida && saida[k] !== undefined ? saida[k] : acharChave(dados, k));
  const ident = sec('Identificacao') || {};
  const loc = sec('Localizacao') || {};
  const pcpf = sec('PainelControlePF') || {};
  const nc = pcpf.notaComportamento || {};
  const comportamento = Object.values(nc)
    .filter((n) => n && n.label && n.nota)
    .map((n) => ({ label: n.label, nota: String(n.nota).toUpperCase() }));

  const rp = (sec('RendaPresumida') || [])[0];
  const cons = sec('Consultas') || {};
  const consultas = (cons.historicoconsultas || [])
    .map((c) => ({
      iso: c.dataConsulta || '', data: data(c.dataConsulta), empresa: c.informante || '-',
      segmento: c.segmento || '-', tipo: c.tipoDeOcorrencia || '-', quantidade: c.quantidade ?? '-',
    }))
    .sort((x, y) => String(y.iso).localeCompare(String(x.iso)));

  const participacoes = (sec('ParticipacoesEmpresas') || []).map((e) => ({
    empresa: e.razaoSocial || '-',
    cnpj: String(e.numeroDocumento || '').replace(/\D/g, ''),
    funcao: e.funcao || '-',
    percentual: e.percentualParticipacao != null ? Number(e.percentualParticipacao) : null,
    valor: e.valorParticipacao != null ? Number(e.valorParticipacao) : null,
    desde: data(e.dataEntrada),
  }));

  const ni = (v) => (v === null || v === undefined || String(v).trim() === '' ? 'Não informado' : String(v));
  const tit = String(ident.tituloEleitor || '');
  const endereco = [loc.tipoLogradouro && loc.tipoLogradouro.length <= 3 ? '' : loc.tipoLogradouro, loc.nomeLogradouro, loc.numeroLogradouro, loc.complementoLogradouro]
    .filter(Boolean).join(' ');
  const cep = String(loc.cep || '').replace(/^(\d{5})(\d{3})$/, '$1-$2');
  const cadastro = {
    nome: ident.nome || '',
    situacaoReceita: ni(ident.situacaoReceita),
    nascimento: ni(data(ident.dataNascimento)),
    sexo: ni(ident.sexoConsultado),
    estadoCivil: ni(ident.estadoCivil),
    escolaridade: ni(ident.grauInstrucao),
    nomeMae: ni(ident.nomeMae),
    rg: `${ni(ident.numeroRG)} / ${ident.orgaoEmissor || '-'}`,
    tituloEleitor: /^0*$/.test(tit) ? 'Não informado' : tit,
    obito: ident.obito === true ? 'Sim' : ident.obito === false ? 'Não' : 'Não informado',
    dependentes: ni(ident.numeroDependentes),
    naturalidade: ni(ident.cidadeNascimento),
    endereco: ni(endereco),
    bairro: ni(loc.bairro),
    cidadeUf: ni([loc.cidade, loc.unidadeFederativa].filter(Boolean).join(' - ')),
    cep: ni(cep),
    regiaoCpf: ni(ident.regiaoCpf),
    atualizacao: ni(data(ident.dataAtualizacao)),
  };

  // Painel completo (inclui consultas anteriores e participações, como no relatório original)
  const painelCompleto = (sec('ListaPainelControle') || []).map((p) => ({
    tipo: p.ocorrencia, total: Number(p.total || 0), restricao: RESTRICOES.test(p.ocorrencia || ''),
  }));

  const sc = (sec('Scores') || [])[0];
  if (score && sc) {
    score.letra = String(sc.classificacaoAlfabetica || '').toUpperCase();
    score.texto = sc.texto ? String(sc.texto).replace(/\s+/g, ' ').trim() : '';
  }

  return {
    quantidade, total, pendencias, protestos, painel, score, itens,
    cadastro, painelCompleto, comportamento,
    cadastroPositivo: pcpf.message ? String(pcpf.message) : '',
    renda: rp && rp.texto ? String(rp.texto).replace(/\s+/g, ' ').trim() : '',
    rendaTexto: rp && rp.textoExplicativo ? String(rp.textoExplicativo) : '',
    consultas, totalConsultas: Number(cons.totalConsultas ?? consultas.length ?? 0),
    consultasMes: Number(cons.mesCorrente?.quantidade ?? 0),
    participacoes,
    bruto: dados,
  };
}
