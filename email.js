// Envio de e-mails pelo Resend
export async function enviarEmail({ para, assunto, html }) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[e-mail não enviado: RESEND_API_KEY ausente] Para: ${para} | ${assunto}\n${html}`);
    return;
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: process.env.EMAIL_REMETENTE, to: [para], subject: assunto, html }),
  });
  if (!r.ok) throw new Error(`Erro no e-mail: ${r.status} ${await r.text()}`);
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const emailRedefinicao = (nome, link) => `
<div style="font-family:Arial,sans-serif;color:#0F0C14;max-width:560px">
  <h2 style="color:#9F31D3">Redefinir sua senha</h2>
  <p>Olá, ${esc(nome.split(' ')[0])}. Recebemos um pedido para redefinir a senha da sua conta na Soft Consultas.</p>
  <p><a href="${esc(link)}" style="display:inline-block;background:#9F31D3;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:bold">Criar nova senha</a></p>
  <p style="color:#666;font-size:13px">O link vale por 1 hora. Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>
  <p style="color:#666;font-size:12px">Soft Consultas</p>
</div>`;

export const emailBoasVindas = (nome, link) => `
<div style="font-family:Arial,sans-serif;color:#0F0C14;max-width:560px">
  <h2 style="color:#9F31D3">Bem-vindo à Soft Consultas</h2>
  <p>Olá, ${esc(nome.split(' ')[0])}. Sua conta foi criada com sucesso.</p>
  <p><a href="${esc(link)}" style="display:inline-block;background:#9F31D3;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:bold">Acessar minha conta</a></p>
  <p style="color:#666;font-size:12px">Soft Consultas</p>
</div>`;
