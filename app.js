// Comportamentos da página (sem scripts inline, por segurança)
document.addEventListener('DOMContentLoaded', () => {
  // Copiar código Pix
  const copiar = document.getElementById('copiar');
  if (copiar) copiar.addEventListener('click', async () => {
    const t = document.getElementById('pix-codigo');
    try { await navigator.clipboard.writeText(t.value); copiar.textContent = 'Código copiado'; } catch { t.select(); }
  });

  // Copiar link de indicação (ou qualquer campo com data-copiar)
  document.querySelectorAll('[data-copiar]').forEach((b) => b.addEventListener('click', async () => {
    const campo = document.getElementById(b.getAttribute('data-copiar'));
    try { await navigator.clipboard.writeText(campo.value); b.textContent = 'Copiado!'; } catch { campo.select(); }
  }));

  // Acompanhar pagamento da recarga
  const box = document.querySelector('[data-recarga]');
  if (box) {
    const id = box.getAttribute('data-recarga');
    const verificar = async () => {
      try {
        const r = await fetch(`/api/recarga/${id}/status`, { headers: { Accept: 'application/json' } });
        const j = await r.json();
        if (j.pago) {
          document.getElementById('aguardando').hidden = true;
          document.getElementById('pago').hidden = false;
          return;
        }
      } catch {}
      setTimeout(verificar, 5000);
    };
    setTimeout(verificar, 4000);
  }

  // Evitar clique duplo ao consultar
  const f = document.querySelector('form[data-consulta]');
  if (f) f.addEventListener('submit', () => {
    const b = f.querySelector('button[type=submit]');
    const aviso = document.getElementById('aviso-nova-aba');
    if (aviso) aviso.hidden = false;
    if (b) {
      // O envio acontece antes de desabilitar (o formulário abre numa nova aba)
      setTimeout(() => { b.disabled = true; b.textContent = 'Consulta enviada. O PDF abre na nova aba.'; }, 0);
      // Libera para uma nova consulta depois de alguns segundos
      setTimeout(() => { b.disabled = false; b.textContent = 'Fazer outra consulta'; f.reset(); }, 15000);
    }
  });
});
