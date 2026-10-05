// Comportamentos da página (sem scripts inline, por segurança)
document.addEventListener('DOMContentLoaded', () => {
  // Copiar código Pix
  const copiar = document.getElementById('copiar');
  if (copiar) copiar.addEventListener('click', async () => {
    const t = document.getElementById('pix-codigo');
    try { await navigator.clipboard.writeText(t.value); copiar.textContent = 'Código copiado'; } catch { t.select(); }
  });

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
    if (b) { b.disabled = true; b.textContent = 'Consultando… isso pode levar alguns segundos'; }
  });
});
