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
      billingType: 'UNDEFINED',
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
