// Comportamentos da página (sem scripts inline, por segurança)
document.addEventListener('DOMContentLoaded', () => {
  const calmo = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Saldo "contando" até o valor (ex.: R$ 85,42)
  if (!calmo) document.querySelectorAll('.valor').forEach((el) => {
    const m = el.textContent.match(/R\$\s*([\d.]+,\d{2})/);
    if (!m) return;
    const alvo = Number(m[1].replace(/\./g, '').replace(',', '.'));
    if (!alvo) return;
    const fmt = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const inicio = performance.now(), dur = 900;
    const passo = (t) => {
      const p = Math.min(1, (t - inicio) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(alvo * e);
      if (p < 1) requestAnimationFrame(passo); else el.textContent = fmt(alvo);
    };
    requestAnimationFrame(passo);
  });

  // Banner de anúncios: troca a cada 6 segundos
  document.querySelectorAll('[data-banner]').forEach((b) => {
    const slides = [...b.querySelectorAll('.slide')], pontos = [...b.querySelectorAll('.pontos button')];
    if (slides.length < 2) return;
    let i = 0, t;
    const ir = (n) => { slides[i].classList.remove('ativo'); pontos[i]?.classList.remove('ativo'); i = (n + slides.length) % slides.length; slides[i].classList.add('ativo'); pontos[i]?.classList.add('ativo'); };
    const auto = () => { clearInterval(t); if (!calmo) t = setInterval(() => ir(i + 1), 6000); };
    pontos.forEach((p, n) => p.addEventListener('click', () => { ir(n); auto(); }));
    b.addEventListener('mouseenter', () => clearInterval(t)); b.addEventListener('mouseleave', auto);
    auto();
  });

  // Botões com confirmação (ex.: pagar saque pelo Asaas)
  document.querySelectorAll('[data-confirmar]').forEach((b) => b.addEventListener('click', (e) => {
    if (!confirm(b.getAttribute('data-confirmar'))) e.preventDefault();
  }));

  // Indicador de carregamento ao enviar formulários (exceto o de consulta, que abre nova aba)
  document.querySelectorAll('form[method="post"]:not([data-consulta])').forEach((f) => f.addEventListener('submit', (e) => {
    const b = e.submitter || f.querySelector('button[type=submit], button:not([type])');
    if (b && !e.defaultPrevented) setTimeout(() => b.classList.add('carregando'), 0);
  }));
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
      setTimeout(() => { b.disabled = true; b.classList.add('carregando'); b.textContent = 'Consultando… o PDF abre na nova aba'; }, 0);
      // Libera para uma nova consulta depois de alguns segundos
      setTimeout(() => { b.disabled = false; b.classList.remove('carregando'); b.textContent = 'Fazer outra consulta'; f.reset(); }, 15000);
    }
  });
});
