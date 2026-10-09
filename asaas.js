// Asaas: cobranças Pix para recarga de créditos
const URL = () => process.env.ASAAS_URL || 'https://api-sandbox.asaas.com/v3';

async function asaas(caminho, opcoes = {}) {
  const r = await fetch(URL() + caminho, {
    ...opcoes,
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'softconsultas', access_token: process.env.ASAAS_API_KEY },
    signal: AbortSignal.timeout(30000),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados?.errors?.[0]?.description || `Erro Asaas ${r.status}`);
  return dados;
}

export const PREFIXO = 'screc_'; // identifica recargas da Soft Consultas (o site da Soft Crédito ignora)

export const criarCliente = ({ nome, documento, email, telefone }) =>
  asaas('/customers', { method: 'POST', body: JSON.stringify({ name: nome, cpfCnpj: documento, email, mobilePhone: telefone, notificationDisabled: true }) });

export function criarCobranca({ clienteId, valorCentavos, recargaId }) {
  const venc = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  return asaas('/payments', {
    method: 'POST',
    body: JSON.stringify({
      customer: clienteId,
      billingType: 'PIX',
      value: valorCentavos / 100,
      dueDate: venc,
      description: `Recarga de créditos - Soft Consultas #${recargaId}`,
      externalReference: `${PREFIXO}${recargaId}`,
    }),
  });
}

export const pixQrCode = (id) => asaas(`/payments/${id}/pixQrCode`);
export const buscarCobranca = (id) => asaas(`/payments/${id}`);
export const STATUS_PAGO = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];

// ---------- Transferência Pix (pagamento de saques de comissão) ----------
export function tipoChavePix(chave) {
  const c = String(chave || '').trim();
  const n = c.replace(/\D/g, '');
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) return { tipo: 'EVP', chave: c.toLowerCase() };
  if (c.includes('@')) return { tipo: 'EMAIL', chave: c.toLowerCase() };
  if (n.length === 14 && /^[\d./-]+$/.test(c)) return { tipo: 'CNPJ', chave: n };
  if (n.length === 11 && /^[\d.-]+$/.test(c) && !c.startsWith('+') && cpfOk(n)) return { tipo: 'CPF', chave: n };
  if (n.length >= 10 && n.length <= 13) return { tipo: 'PHONE', chave: n.length <= 11 ? `+55${n}` : `+${n}` };
  return null;
}
function cpfOk(cpf) {
  if (/^(\d)\1+$/.test(cpf)) return false;
  for (let t = 9; t < 11; t++) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(cpf[i]) * (t + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(cpf[t])) return false;
  }
  return true;
}
export function transferirPix({ valorCentavos, chave, descricao }) {
  const k = tipoChavePix(chave);
  if (!k) throw new Error('Chave Pix em formato não reconhecido.');
  return asaas('/transfers', {
    method: 'POST',
    body: JSON.stringify({ value: valorCentavos / 100, operationType: 'PIX', pixAddressKey: k.chave, pixAddressKeyType: k.tipo, description: descricao }),
  });
}

// Paga um Pix "copia e cola" com o saldo da conta Asaas (usado no repasse para a APIFull)
export const pagarPixCopiaECola = ({ payload, valorCentavos, descricao }) =>
  asaas('/pix/qrCodes/pay', { method: 'POST', body: JSON.stringify({ qrCode: { payload }, value: valorCentavos / 100, description: descricao }) });
export const saldoConta = () => asaas('/finance/balance');
