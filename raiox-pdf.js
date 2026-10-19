// Raio-X do CPF: relatório em PDF (diagnóstico + dados da consulta + plano de ação), marca Soft Consultas
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const ROXO = hex('#9F31D3');
const NAVY = hex('#1F2937');
const TEXTO = hex('#111827');
const LABEL = hex('#6B7280');
const BORDA = hex('#E5E7EB');
const FUNDO = hex('#F8FAFC');
const FUNDO2 = hex('#F3F4F6');
const VERDE = hex('#059669');
const VERMELHO = hex('#DC2626');
const AMARELO_F = hex('#FFFBEB');
const AMARELO_B = hex('#F59E0B');
const AMARELO_T = hex('#92400E');
const BRANCO = rgb(1, 1, 1);

const A4 = [595.28, 841.89];
const M = 30;

const real = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export function formatarDocumento(d) {
  d = String(d).replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d;
}
const limpar = (t) => String(t ?? '').normalize('NFC').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '');
function cortar(t, f, s, w) {
  t = limpar(t);
  if (f.widthOfTextAtSize(t, s) <= w) return t;
  while (t.length && f.widthOfTextAtSize(t + '...', s) > w) t = t.slice(0, -1);
  return t + '...';
}
function quebrar(t, f, s, w) {
  const out = []; let cur = '';
  for (const p of limpar(t).split(' ')) {
    const tt = cur ? cur + ' ' + p : p;
    if (f.widthOfTextAtSize(tt, s) > w && cur) { out.push(cur); cur = p; } else cur = tt;
  }
  if (cur) out.push(cur);
  return out;
}
const frase = (t) => { t = String(t || '').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };

// Escala de rating (pior -> melhor), como no relatório original
const ESCALA = ['E', 'D', 'C', 'CC', 'CCC', 'B', 'BB', 'BBB', 'A', 'AA', 'AAA'];
const GRUPOS = [['Extremamente baixa', 0, 3], ['Baixa', 3, 5], ['Média', 5, 7], ['Alta', 7, 9], ['Extremamente alta', 9, 11]];
const STOPS = [[0, '#DB2655'], [0.25, '#E8763A'], [0.45, '#B9A23C'], [0.6, '#5DB565'], [0.75, '#2DB79A'], [1, '#5A4BA6']];
function corEm(p) {
  for (let i = 1; i < STOPS.length; i++) {
    if (p <= STOPS[i][0]) {
      const [p0, c0] = STOPS[i - 1], [p1, c1] = STOPS[i];
      const k = (p - p0) / (p1 - p0 || 1);
      const a = [1, 3, 5].map((j) => parseInt(c0.slice(j, j + 2), 16));
      const b = [1, 3, 5].map((j) => parseInt(c1.slice(j, j + 2), 16));
      return rgb(...a.map((v, j) => (v + (b[j] - v) * k) / 255));
    }
  }
  return hex(STOPS.at(-1)[1]);
}
const corLetra = (l) => corEm(Math.max(0, ESCALA.indexOf(l)) / (ESCALA.length - 1));

export async function gerarRelatorioPDF({ nome, documento, resumo, fonte = 'SCPC Boa Vista', data = new Date(), diagnostico = null }) {
  const ocultar = String(process.env.PDF_OCULTAR_SENSIVEIS || '').toLowerCase() === 'sim';
  const pdf = await PDFDocument.create();
  pdf.setTitle(diagnostico ? 'Raio-X do CPF - Soft Consultas' : 'Relatório de Crédito - Soft Consultas');
  pdf.setAuthor('Soft Consultas');
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(await readFile(new URL('./icone.png', import.meta.url)));

  const L = A4[0] - M * 2;
  const pj = String(documento).replace(/\D/g, '').length === 14;
  const cad = resumo.cadastro || {};
  const dataTxt = data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' às ' +
    data.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

  let pg, y;
  const paginas = [];
  const T = (t, x, yy, { f = reg, s = 9, c = TEXTO } = {}) => pg.drawText(limpar(t), { x, y: yy, size: s, font: f, color: c });
  const TD = (t, xd, yy, o = {}) => T(t, xd - (o.f || reg).widthOfTextAtSize(limpar(t), o.s || 9), yy, o);
  const R = (x, yy, w, h, c, borda) => pg.drawRectangle({ x, y: yy, width: w, height: h, color: c, borderColor: borda, borderWidth: borda ? 0.8 : 0 });

  function nova() {
    pg = pdf.addPage(A4);
    paginas.push(pg);
    R(0, A4[1] - 5, A4[0], 5, ROXO);
    y = A4[1] - 34;
  }
  const espaco = (h) => { if (y - h < M + 40) { nova(); } };
  function titulo(t) {
    espaco(70);
    T(t.toUpperCase(), M, y, { f: bold, s: 10.5, c: TEXTO });
    y -= 16;
  }

  // ---------- Cabeçalho ----------
  nova();
  const lh = 34;
  pg.drawImage(logo, { x: M, y: y - lh + 8, width: lh - 4, height: lh - 4 });
  T('Soft', M + lh + 4, y - 16, { f: bold, s: 16, c: TEXTO });
  T('Consultas', M + lh + 4 + bold.widthOfTextAtSize('Soft ', 16), y - 16, { s: 16, c: ROXO });
  TD(diagnostico ? (pj ? 'RAIO-X DO CNPJ' : 'RAIO-X DO CPF') : 'RELATÓRIO DE CRÉDITO', A4[0] - M, y - 2, { f: bold, s: 15, c: TEXTO });
  TD(diagnostico ? 'Diagnóstico de crédito e plano de ação' : 'Consulta cadastral e análise de risco', A4[0] - M, y - 17, { s: 9, c: LABEL });
  y -= 44;
  R(M, y - 62, L, 70, FUNDO, BORDA);
  T(cortar((cad.nome || nome).toUpperCase(), bold, 14, L - 30), M + 14, y - 14, { f: bold, s: 14 });
  T(`${pj ? 'CNPJ' : 'CPF'} ${formatarDocumento(documento)}`, M + 14, y - 32, { f: bold, s: 10, c: ROXO });
  const ref = cad.atualizacao && cad.atualizacao !== 'Não informado' ? ` Referência dos dados: ${cad.atualizacao}.` : '';
  T(cortar(`Relatório emitido em ${dataTxt} com base nos dados retornados pela consulta.${ref}`, reg, 7.8, L - 28), M + 14, y - 50, { s: 7.8, c: LABEL });
  y -= 84;

  // ---------- Raio-X: diagnóstico em linguagem simples ----------
  if (diagnostico) {
    const corN = { critico: VERMELHO, atencao: AMARELO_B, bom: VERDE }[diagnostico.nivel] || ROXO;
    titulo('Diagnóstico');
    const ex = quebrar(diagnostico.explicacao, reg, 9.5, L - 36);
    const hD = 44 + ex.length * 13;
    espaco(hD + 8);
    R(M, y - hD, L, hD, FUNDO, BORDA);
    R(M, y - hD, 5, hD, corN);
    T(diagnostico.titulo, M + 18, y - 20, { f: bold, s: 13, c: corN });
    ex.forEach((t, i) => T(t, M + 18, y - 38 - i * 13, { s: 9.5 }));
    y -= hD + 12;
    if (diagnostico.achados.length) {
      titulo('O que encontramos');
      for (const a of diagnostico.achados) {
        const dl = quebrar(a.d, reg, 8.8, L - 40);
        const h = 22 + dl.length * 12;
        espaco(h + 6);
        pg.drawCircle({ x: M + 8, y: y - 8, size: 3.2, color: ROXO });
        T(cortar(a.t, bold, 10, L - 24), M + 20, y - 11, { f: bold, s: 10 });
        dl.forEach((t, i) => T(t, M + 20, y - 25 - i * 12, { s: 8.8, c: LABEL }));
        y -= h + 4;
      }
      y -= 6;
    }
  }

  // ---------- Avaliação ----------
  titulo('Avaliação de crédito');
  const tem = resumo.quantidade > 0;
  const hA = 120, wA = (L - 12) / 2;
  espaco(hA + 10);
  // Situação
  R(M, y - hA, wA, hA, BRANCO, BORDA);
  T('Situação do nome', M + 14, y - 18, { s: 8.5, c: LABEL });
  T(tem ? 'Com restrições' : 'Sem restrições', M + 14, y - 44, { f: bold, s: 18, c: tem ? VERMELHO : VERDE });
  T(tem ? `${resumo.quantidade} ${resumo.quantidade === 1 ? 'registro' : 'registros'} de restrição` : 'Nenhuma pendência ou protesto', M + 14, y - 62, { s: 9, c: LABEL });
  if (tem) {
    T('Valor total', M + 14, y - 86, { s: 8.5, c: LABEL });
    T(real(resumo.total), M + 14, y - 104, { f: bold, s: 15 });
  }
  // Score gauge
  const gx = M + wA + 12;
  R(gx, y - hA, wA, hA, BRANCO, BORDA);
  T('Score de crédito', gx + 14, y - 18, { s: 8.5, c: LABEL });
  const sc = resumo.score;
  if (sc && Number.isFinite(sc.valor)) {
    const cx = gx + wA / 2, cy = y - 92, r = 46, esp = 10;
    const passos = 60;
    for (let i = 0; i < passos; i++) {
      const a0 = Math.PI - (Math.PI * i) / passos, a1 = Math.PI - (Math.PI * (i + 1)) / passos;
      const p = (i + 0.5) / passos;
      const pts = [[a0, r], [a1, r], [a1, r - esp], [a0, r - esp]].map(([a, rr]) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
      const path = `M ${pts[0][0] - cx} ${-(pts[0][1] - cy)} ` + pts.slice(1).map(([px, py]) => `L ${px - cx} ${-(py - cy)}`).join(' ') + ' Z';
      const ativo = p <= sc.valor / 1000;
      pg.drawSvgPath(path, { x: cx, y: cy, color: ativo ? corEm(p) : BORDA });
    }
    const v = String(sc.valor);
    T(v, cx - bold.widthOfTextAtSize(v, 22) / 2, cy + 4, { f: bold, s: 22 });
    T('0', cx - r, cy - 13, { s: 7.5, c: LABEL });
    TD('1000', cx + r, cy - 13, { s: 7.5, c: LABEL });
    if (sc.pagamento !== null) {
      const t = `${sc.pagamento}% de chance de pagar em dia`;
      T(t, cx - reg.widthOfTextAtSize(t, 8) / 2, cy - 22, { s: 8, c: LABEL });
    }
  } else {
    T('Score não informado na consulta.', gx + 14, y - 50, { s: 9, c: LABEL });
  }
  y -= hA + 22;

  // ---------- Alerta de restrições ----------
  const painel = (resumo.painelCompleto && resumo.painelCompleto.length) ? resumo.painelCompleto
    : (resumo.painel || []).map((p) => ({ ...p, restricao: true }));
  if (painel.length) {
    titulo('Alerta de restrições');
    const cols = 3, gap = 8, w = (L - gap * (cols - 1)) / cols, h = 40;
    painel.forEach((p, i) => {
      if (i % cols === 0) { espaco(h + gap); if (i > 0) y -= h + gap; }
      const x = M + (i % cols) * (w + gap);
      R(x, y - h, w, h, BRANCO, BORDA);
      const alerta = p.restricao && p.total > 0;
      const cor = alerta ? VERMELHO : p.restricao ? VERDE : LABEL;
      pg.drawCircle({ x: x + 16, y: y - h / 2, size: 8, color: cor });
      if (alerta) T('!', x + 14.3, y - h / 2 - 3.3, { f: bold, s: 9.5, c: BRANCO });
      else {
        pg.drawLine({ start: { x: x + 12, y: y - h / 2 }, end: { x: x + 15, y: y - h / 2 - 3 }, thickness: 1.5, color: BRANCO });
        pg.drawLine({ start: { x: x + 15, y: y - h / 2 - 3 }, end: { x: x + 20.5, y: y - h / 2 + 3.5 }, thickness: 1.5, color: BRANCO });
      }
      const nomeTipo = String(p.tipo || '').replace(/Devolu[cç][oõ]es Informadas pelo Usu[aá]rio/i, 'Devoluções informadas');
      T(cortar(nomeTipo, bold, 8.3, w - 40), x + 32, y - 16, { f: bold, s: 8.3 });
      const det = p.total === 0 ? 'Nada consta' : `${p.total} registro(s)`;
      T(det, x + 32, y - 29, { s: 8.3, c: alerta ? VERMELHO : LABEL });
    });
    y -= h + 20;
  }

  // ---------- Dados cadastrais ----------
  if (resumo.cadastro) {
    titulo('Dados cadastrais');
    const campos = pj
      ? [['Razão social', cad.nome || nome], ['CNPJ', formatarDocumento(documento)], ['Situação Receita', cad.situacaoReceita],
        ['Endereço', cad.endereco], ['Bairro', cad.bairro], ['Cidade / UF', cad.cidadeUf], ['CEP', cad.cep], ['Atualização cadastral', cad.atualizacao]]
      : [['Nome', cad.nome || nome], ['CPF', formatarDocumento(documento)], ['Situação Receita', cad.situacaoReceita],
        ['Nascimento', cad.nascimento], ['Sexo', cad.sexo], ['Estado civil', cad.estadoCivil],
        ['Escolaridade', cad.escolaridade], ['Nome da mãe', cad.nomeMae], ['RG / Órgão', cad.rg],
        ['Título de eleitor', cad.tituloEleitor], ['Indicativo de óbito', cad.obito], ['Dependentes', cad.dependentes],
        ['Naturalidade', cad.naturalidade], ['Endereço', cad.endereco], ['Bairro', cad.bairro],
        ['Cidade / UF', cad.cidadeUf], ['CEP', cad.cep], ['Região do CPF', cad.regiaoCpf], ['Atualização cadastral', cad.atualizacao]];
    const lista = campos.filter(([r]) => !(ocultar && ['Nome da mãe', 'Endereço', 'CEP', 'RG / Órgão', 'Título de eleitor'].includes(r)));
    const cols = 3, w = L / cols, h = 32;
    const linhas = Math.ceil(lista.length / cols);
    for (let li = 0; li < linhas; li++) {
      espaco(h);
      if (li % 2 === 0) R(M, y - h + 6, L, h, FUNDO);
      for (let c = 0; c < cols; c++) {
        const item = lista[li * cols + c];
        if (!item) continue;
        const x = M + c * w + 10;
        T(item[0].toUpperCase(), x, y - 4, { f: bold, s: 6.8, c: LABEL });
        T(cortar(item[1] || 'Não informado', reg, 8.6, w - 18), x, y - 17, { s: 8.6 });
      }
      y -= h;
    }
    if (resumo.renda) {
      espaco(52);
      y -= 6;
      R(M, y - 40, L, 46, BRANCO, BORDA);
      T('RENDA PRESUMIDA', M + 12, y - 8, { f: bold, s: 6.8, c: LABEL });
      T(resumo.renda, M + 12, y - 22, { f: bold, s: 10.5, c: ROXO });
      if (resumo.rendaTexto) T(cortar(frase(resumo.rendaTexto), reg, 7.5, L - 24), M + 12, y - 34, { s: 7.5, c: LABEL });
      y -= 52;
    }
    y -= 12;
  }

  // ---------- Tabela genérica ----------
  function tabela(cols, linhas) {
    const cab = () => {
      espaco(46);
      R(M, y - 18, L, 22, NAVY);
      cols.forEach((c) => (c.dir ? TD(c.t.toUpperCase(), c.x + c.w, y - 10, { f: bold, s: 6.8, c: BRANCO })
        : T(c.t.toUpperCase(), c.x, y - 10, { f: bold, s: 6.8, c: BRANCO })));
      y -= 22;
    };
    cab();
    linhas.forEach((ln, i) => {
      if (y < M + 60) { nova(); cab(); }
      if (i % 2 === 1) R(M, y - 20, L, 22, FUNDO);
      cols.forEach((c, k) => {
        const f = c.b ? bold : reg;
        const v = cortar(ln[k] ?? '-', f, 7.8, c.w);
        const cor = c.cor || TEXTO;
        c.dir ? TD(v, c.x + c.w, y - 12, { f, s: 7.8, c: cor }) : T(v, c.x, y - 12, { f, s: 7.8, c: cor });
      });
      pg.drawLine({ start: { x: M, y: y - 20 }, end: { x: M + L, y: y - 20 }, thickness: 0.5, color: BORDA });
      y -= 22;
    });
    y -= 18;
  }

  // ---------- Restrições detalhadas ----------
  if (resumo.itens && resumo.itens.length) {
    titulo('Detalhamento das restrições');
    tabela(
      [{ t: 'Credor / Cartório', x: M + 8, w: 220, b: true }, { t: 'Tipo', x: M + 236, w: 120 },
        { t: 'Data', x: M + 362, w: 70 }, { t: 'Valor', x: M + 440, w: L - 448, dir: true, b: true, cor: VERMELHO }],
      resumo.itens.map((it) => [it.credor, it.origem, it.data || '-', real(it.valor)]),
    );
  }

  // ---------- Participação em empresas ----------
  if (resumo.participacoes && resumo.participacoes.length) {
    titulo('Participação em empresas');
    tabela(
      [{ t: 'Razão social', x: M + 8, w: 128 }, { t: 'CNPJ', x: M + 142, w: 88 }, { t: 'Função', x: M + 234, w: 104 },
        { t: 'Participação', x: M + 342, w: 52 }, { t: 'Valor', x: M + 398, w: 64, b: true, cor: VERDE }, { t: 'Entrada', x: M + 466, w: L - 474 }],
      resumo.participacoes.map((e) => [e.empresa, formatarDocumento(e.cnpj), e.funcao,
        e.percentual != null ? `${e.percentual}%` : '-', e.valor != null ? real(e.valor) : '-', e.desde || '-']),
    );
  }

  // ---------- Score de crédito (rating) ----------
  if (sc && Number.isFinite(sc.valor)) {
    titulo('Score de crédito');
    const h = 190;
    espaco(h + 10);
    R(M, y - h, L, h, BRANCO, BORDA);
    const letra = sc.letra || '';
    const cx = M + 52, cy = y - 50;
    pg.drawCircle({ x: cx, y: cy, size: 30, borderColor: letra ? corLetra(letra) : LABEL, borderWidth: 5, color: BRANCO });
    T('Rating', cx - reg.widthOfTextAtSize('Rating', 7) / 2, cy + 14, { s: 7, c: LABEL });
    const lt = letra || '-';
    T(lt, cx - bold.widthOfTextAtSize(lt, 20) / 2, cy - 8, { f: bold, s: 20, c: NAVY });
    T('Descritivo:', M + 104, y - 22, { f: bold, s: 11 });
    const desc = sc.texto ? frase(sc.texto) : (sc.pagamento !== null ? `${sc.pagamento}% das pessoas com esse perfil pagam as contas em dia nos próximos 6 meses.` : '');
    const dl = quebrar(desc, reg, 9, L - 140);
    R(M + 104, y - 36 - dl.length * 12 - 8, L - 118, dl.length * 12 + 14, FUNDO2);
    dl.forEach((t, i) => T(t, M + 114, y - 46 - i * 12, { s: 9 }));
    // escala
    const bx = M + 30, bw = L - 60, by = y - 140;
    const passo = bw / ESCALA.length;
    GRUPOS.forEach(([nome, a, b]) => {
      const mx = bx + passo * (a + b) / 2;
      quebrar(nome, reg, 7, passo * (b - a) - 4).forEach((t, i) => T(t, mx - reg.widthOfTextAtSize(t, 7) / 2, by + 50 - i * 9, { s: 7, c: LABEL }));
      if (a > 0) for (let k = 0; k < 9; k++) pg.drawLine({ start: { x: bx + passo * a, y: by - 12 + k * 7 }, end: { x: bx + passo * a, y: by - 9 + k * 7 }, thickness: 0.8, color: LABEL });
    });
    ESCALA.forEach((l, i) => {
      const mx = bx + passo * (i + 0.5);
      T(l, mx - bold.widthOfTextAtSize(l, 9) / 2, by + 18, { f: bold, s: 9, c: l === letra ? corLetra(l) : NAVY });
    });
    const fatias = 140;
    for (let i = 0; i < fatias; i++) R(bx + (bw * i) / fatias, by, bw / fatias + 0.6, 10, corEm(i / fatias));
    const px = bx + bw * Math.min(Math.max(sc.valor, 0), 1000) / 1000;
    const pill = String(sc.valor), pw = bold.widthOfTextAtSize(pill, 9) + 16;
    const pxx = Math.min(Math.max(px - pw / 2, bx - 6), bx + bw - pw + 6);
    pg.drawRectangle({ x: pxx, y: by - 3, width: pw, height: 16, color: hex('#F97316') });
    T(pill, pxx + 8, by + 1.5, { f: bold, s: 9, c: BRANCO });
    R(M + 12, y - h + 10, L - 24, 22, FUNDO2);
    const nota = 'Esta análise de rating considera múltiplos fatores, como restrições, informações cadastrais, ocorrências financeiras e outros indicadores relevantes.';
    T(cortar(nota, reg, 7.5, L - 40), M + 20, y - h + 18, { s: 7.5, c: LABEL });
    y -= h + 20;
  }

  // ---------- Cadastro positivo ----------
  if (resumo.cadastroPositivo || (resumo.comportamento && resumo.comportamento.length)) {
    titulo('Cadastro positivo');
    if (resumo.cadastroPositivo) {
      espaco(30);
      R(M, y - 22, L, 26, AMARELO_F, hex('#FDE68A'));
      R(M, y - 22, 3, 26, AMARELO_B);
      T(cortar(resumo.cadastroPositivo, reg, 8, L - 24), M + 14, y - 12, { s: 8, c: AMARELO_T });
      y -= 34;
    }
    const comp = resumo.comportamento || [];
    if (comp.length) {
      espaco(44);
      const w = L / comp.length;
      R(M, y - 36, L, 40, BRANCO, BORDA);
      comp.forEach((c, i) => {
        const x = M + i * w;
        if (i > 0) pg.drawLine({ start: { x, y: y + 4 }, end: { x, y: y - 36 }, thickness: 0.8, color: BORDA });
        T(c.label.toUpperCase(), x + 12, y - 10, { f: bold, s: 6.8, c: LABEL });
        T(c.nota, x + 12, y - 26, { f: bold, s: 11, c: NAVY });
      });
      y -= 46;
      espaco(28);
      R(M, y - 20, L, 24, FUNDO, BORDA);
      T('Pontualidade e comprometimento: valores não informados na consulta.', M + 12, y - 11, { s: 8, c: LABEL });
      y -= 34;
    }
  }

  // ---------- Histórico de consultas ----------
  if (resumo.consultas && resumo.consultas.length) {
    titulo('Histórico de consultas');
    espaco(30);
    R(M, y - 20, L, 24, FUNDO, BORDA);
    T(`Total informado: ${resumo.totalConsultas}  |  Mês corrente: ${resumo.consultasMes}`, M + 12, y - 11, { s: 8, c: LABEL });
    y -= 26;
    tabela(
      [{ t: 'Data', x: M + 8, w: 90 }, { t: 'Informante', x: M + 104, w: 170 }, { t: 'Documento / Segmento', x: M + 280, w: 110 },
        { t: 'Tipo', x: M + 396, w: 70 }, { t: 'Quantidade', x: M + 472, w: L - 480 }],
      resumo.consultas.map((c) => [c.data || '-', c.empresa, c.segmento, c.tipo, String(c.quantidade)]),
    );
  }

  // ---------- Raio-X: plano de ação ----------
  if (diagnostico) {
    nova();
    titulo('Seu plano de ação');
    T('Siga na ordem. Cada etapa prepara a próxima.', M, y, { s: 9, c: LABEL });
    y -= 18;
    diagnostico.plano.forEach(([fase, passos], fi) => {
      espaco(40);
      R(M, y - 22, L, 24, ROXO);
      T(`${fi + 1}. ${fase.toUpperCase()}`, M + 12, y - 15, { f: bold, s: 10, c: BRANCO });
      y -= 32;
      for (const p of passos) {
        const pl = quebrar(p, reg, 9.3, L - 40);
        const h = pl.length * 12.5 + 6;
        espaco(h + 4);
        R(M + 6, y - 9, 8, 8, BRANCO, ROXO);
        pl.forEach((t, i) => T(t, M + 24, y - 8 - i * 12.5, { s: 9.3 }));
        y -= h + 4;
      }
      y -= 8;
    });
    const pr = quebrar(diagnostico.proximo.texto, reg, 9.5, L - 36);
    const ph = 42 + pr.length * 13;
    espaco(ph + 6);
    R(M, y - ph, L, ph, ROXO);
    T(diagnostico.proximo.titulo, M + 18, y - 20, { f: bold, s: 12, c: BRANCO });
    pr.forEach((t, i) => T(t, M + 18, y - 38 - i * 13, { s: 9.5, c: BRANCO }));
    y -= ph + 8;
  }

  // ---------- Próximo passo ----------
  const msg = tem
    ? 'Para resolver as restrições, conheça o Limpa Nome da Soft Consultas, por ação judicial coletiva amparada pelo Código de Defesa do Consumidor: softconsultas.com/limpa-nome.'
    : 'Seu documento não apresenta restrições nesta consulta. Para manter o score saudável, pague as contas em dia e evite muitas solicitações de crédito em pouco tempo.';
  if (!diagnostico) {
    const ml = quebrar(msg, reg, 9.5, L - 36);
    const mh = 42 + ml.length * 13;
    espaco(mh + 6);
    R(M, y - mh, L, mh, ROXO);
    T(tem ? 'Próximo passo' : 'Recomendação', M + 18, y - 20, { f: bold, s: 12, c: BRANCO });
    ml.forEach((t, i) => T(t, M + 18, y - 38 - i * 13, { s: 9.5, c: BRANCO }));
    y -= mh + 8;
  }

  // ---------- Rodapé ----------
  const aviso = `Fonte: ${fonte}. Documento informativo, não é recomendação jurídica. Os dados reproduzem o retorno da fonte consultada e podem sofrer atualizações posteriores. Uso exclusivo do titular.`;
  paginas.forEach((p, i) => {
    pg = p;
    p.drawLine({ start: { x: M, y: M + 18 }, end: { x: A4[0] - M, y: M + 18 }, thickness: 0.6, color: BORDA });
    T('Soft Consultas · Soft Solutions Technology Ltda · CNPJ 20.801.827/0001-01 · softconsultas.com', M, M + 6, { s: 7, c: LABEL });
    TD(`Página ${i + 1} de ${paginas.length}`, A4[0] - M, M + 6, { s: 7, c: LABEL });
    T(cortar(aviso, reg, 6.5, L), M, M - 5, { s: 6.5, c: LABEL });
  });

  return Buffer.from(await pdf.save());
}
