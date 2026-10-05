// PDF: o cliente recebe o relatório original da fonte (APIFull).
// Só quando a fonte não fornece PDF geramos um simples com os dados retornados.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const A4 = [595.28, 841.89];
const M = 44;
const CINZA = rgb(0.36, 0.33, 0.4), PRETO = rgb(0.06, 0.05, 0.08), FUNDO = rgb(0.97, 0.96, 0.98);
const limpar = (t) => String(t ?? '').normalize('NFC').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '');
function quebrar(t, f, s, w) {
  const out = []; let cur = '';
  for (const p of limpar(t).split(' ')) { const tt = cur ? `${cur} ${p}` : p; if (f.widthOfTextAtSize(tt, s) > w && cur) { out.push(cur); cur = p; } else cur = tt; }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}
export function formatarDoc(d) {
  d = String(d || '');
  if (/^\d{11}$/.test(d)) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (/^\d{14}$/.test(d)) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d.toUpperCase();
}

export async function pdfGenerico(info, linhas) {
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let pg, y;
  const nova = () => { pg = pdf.addPage(A4); y = A4[1] - M; };
  nova();
  pg.drawText(limpar(info.produto), { x: M, y, size: 16, font: bold, color: PRETO }); y -= 20;
  pg.drawText(limpar(`${formatarDoc(info.parametro)}  ·  ${info.dataHora}  ·  Protocolo #${info.id}`), { x: M, y, size: 9, font: reg, color: CINZA }); y -= 26;
  const w1 = 210, w2 = A4[0] - 2 * M - w1 - 10;
  linhas.forEach(([k, v], i) => {
    const l1 = quebrar(k, reg, 8, w1), l2 = quebrar(v, bold, 8.5, w2);
    const h = Math.max(l1.length, l2.length) * 11 + 8;
    if (y - h < M) nova();
    if (i % 2 === 0) pg.drawRectangle({ x: M, y: y - h + 9, width: A4[0] - 2 * M, height: h, color: FUNDO });
    l1.forEach((t, j) => pg.drawText(t, { x: M + 6, y: y - j * 11, size: 8, font: reg, color: CINZA }));
    l2.forEach((t, j) => pg.drawText(t, { x: M + w1 + 10, y: y - j * 11, size: 8.5, font: bold, color: PRETO }));
    y -= h;
  });
  pdf.setTitle(limpar(info.produto));
  return Buffer.from(await pdf.save());
}
