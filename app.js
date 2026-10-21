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

  // Barra fixa de cadastro no celular (páginas de campanha)
  if (document.querySelector('.cta-fixo')) document.body.classList.add('com-cta');

  // Documento digitado no topo da página de campanha: preenche a consulta depois do cadastro
  const docUrl = new URLSearchParams(location.search).get('doc');
  if (docUrl) { try { sessionStorage.setItem('sc_doc', docUrl.replace(/\D/g, '').slice(0, 14)); } catch {} }
  const placaUrl = new URLSearchParams(location.search).get('placa');
  if (placaUrl) { try { sessionStorage.setItem('sc_placa', placaUrl.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7)); } catch {} }
  const campoValor = document.querySelector('form[data-consulta] #valor');
  if (campoValor && !campoValor.value) {
    try {
      const d = sessionStorage.getItem('sc_doc') || '', t = campoValor.getAttribute('data-tipo');
      const serve = (t === 'cpf' && d.length === 11) || (t === 'cnpj' && d.length === 14) || (t === 'cpf_cnpj' && (d.length === 11 || d.length === 14));
      if (serve) campoValor.value = d;
      const pl = sessionStorage.getItem('sc_placa') || '';
      if (t === 'placa' && pl) campoValor.value = pl;
    } catch {}
  }
  const topo = document.querySelector('form[data-consulta-topo]');
  if (topo) topo.addEventListener('submit', () => {
    const i = topo.querySelector('[name=doc]'), pl = topo.querySelector('[name=placa]');
    if (i) { i.value = i.value.replace(/\D/g, '').slice(0, 14); if (!i.value) i.disabled = true; }
    if (pl) { pl.value = pl.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7); if (!pl.value) pl.disabled = true; }
  });

  // Eventos de campanha em botões (ex.: "Criar conta" nas páginas de campanha)
  document.querySelectorAll('[data-evento]').forEach((a) => a.addEventListener('click', () => { if (window.scEvento) window.scEvento(a.getAttribute('data-evento')); }));

  // Botões com confirmação (ex.: pagar saque pelo Asaas)
  document.querySelectorAll('[data-confirmar]').forEach((b) => b.addEventListener('click', (e) => {
    if (!confirm(b.getAttribute('data-confirmar'))) e.preventDefault();
  }));

  // Indicador de carregamento ao enviar formulários (exceto o de consulta, que abre nova aba)
  document.querySelectorAll('form[method="post"]:not([data-consulta])').forEach((f) => f.addEventListener('submit', (e) => {
    if (e.defaultPrevented) return;
    // Evita envio duplicado (clique duplo em pagar, estornar, repassar etc.)
    if (f.dataset.enviando) { e.preventDefault(); return; }
    f.dataset.enviando = '1';
    setTimeout(() => { delete f.dataset.enviando; }, 15000);
    const b = e.submitter || f.querySelector('button[type=submit], button:not([type])');
    if (b) setTimeout(() => b.classList.add('carregando'), 0);
  }));
  // Copiar um texto pronto (ex.: link do cliente na área do parceiro)
  document.querySelectorAll('[data-copiar-texto]').forEach((b) => b.addEventListener('click', async () => {
    const t = b.getAttribute('data-copiar-texto'), antes = b.textContent;
    try { await navigator.clipboard.writeText(t); b.textContent = 'Copiado!'; } catch { window.prompt('Copie o link:', t); return; }
    setTimeout(() => { b.textContent = antes; }, 2000);
  }));
  // Área do parceiro: calcula a comissão conforme o valor de venda digitado
  const venda = document.querySelector('[data-venda-nossa]');
  if (venda) {
    const saida = document.getElementById('pc-comissao');
    const fmt = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const calc = () => {
      const t = venda.value.replace(/[^\d,.]/g, '');
      const n = /,\d{1,2}$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t.replace(/\./g, ''));
      const c = Math.round(n * 100), nossa = Number(venda.dataset.vendaNossa), min = Number(venda.dataset.vendaMin), max = Number(venda.dataset.vendaMax);
      if (!Number.isFinite(c) || !c) { saida.textContent = ''; return; }
      if (c < min) { saida.textContent = `O mínimo é ${fmt(min)}.`; return; }
      if (c > max) { saida.textContent = `O máximo é ${fmt(max)}.`; return; }
      saida.innerHTML = `Cliente paga ${fmt(c)} · sua comissão: <strong>${fmt(c - nossa)}</strong>`;
    };
    venda.addEventListener('input', calc);
    // Troca de serviço: atualiza preço sugerido, nossa parte e atacado
    const sel = document.getElementById('pc-servico');
    if (sel) sel.addEventListener('change', () => {
      const o = sel.selectedOptions[0];
      venda.dataset.vendaNossa = o.dataset.nossa; venda.dataset.vendaMin = o.dataset.min || o.dataset.preco; venda.dataset.vendaMax = o.dataset.max;
      venda.value = (Number(o.dataset.preco) / 100).toFixed(2).replace('.', ',');
      const regra = document.getElementById('pc-regra');
      if (regra) regra.textContent = `Sugerido ${fmt(Number(o.dataset.preco))}; você pode dar desconto até ${fmt(Number(o.dataset.min || o.dataset.preco))}. A nossa parte é ${fmt(Number(o.dataset.nossa))}: tudo acima disso é comissão sua.`;
      const op = document.getElementById('pc-atac-op');
      if (op) {
        op.style.display = o.dataset.atacado ? 'flex' : 'none';
        const val = document.getElementById('pc-atac-valor'); if (val && o.dataset.atacado) val.textContent = fmt(Number(o.dataset.atacado));
        if (!o.dataset.atacado) { const c = document.querySelector('input[name=modelo][value=comissao]'); if (c) c.checked = true; }
      }
      calc();
    });
  }

  // ===== Aplicativo (Android/iOS) =====
  // Aba ativa na barra inferior
  document.querySelectorAll('.abas-app a').forEach((l) => {
    const h = l.getAttribute('data-aba');
    if (location.pathname === h || (h !== '/app' && location.pathname.startsWith(h))) l.classList.add('on');
  });
  const cap = window.Capacitor;
  if (cap && cap.isNativePlatform && cap.isNativePlatform()) {
    const plat = cap.getPlatform ? cap.getPlatform() : '';
    const logado = !!document.querySelector('.abas-app');
    const salvarToken = (token) => {
      if (!token || !logado) return;
      try { if (localStorage.getItem('sc_push_token') === token) return; } catch {}
      fetch('/api/app/dispositivo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, plataforma: plat }) })
        .then((r) => { if (r.ok) { try { localStorage.setItem('sc_push_token', token); } catch {} } }).catch(() => {});
    };
    const abrirLink = (dados) => { const l = dados && dados.link; if (l && /^\/[\w\/?=&%.-]*$/.test(l)) location.href = l; };
    // Firebase Messaging (token FCM no Android e no iPhone)
    const plugin = (n) => (cap.Plugins && cap.Plugins[n]) || (cap.registerPlugin ? cap.registerPlugin(n) : null);
    const fm = plugin('FirebaseMessaging');
    if (fm && logado) {
      fm.requestPermissions().then((p) => { if (p.receive === 'granted') return fm.getToken().then((t) => salvarToken(t.token)); }).catch(() => {});
      fm.addListener('tokenReceived', (e) => salvarToken(e.token));
      fm.addListener('notificationActionPerformed', (e) => abrirLink(e.notification && e.notification.data));
    }
    // Botão "voltar" do Android
    const appPl = plugin('App');
    if (appPl) appPl.addListener('backButton', ({ canGoBack }) => { if (canGoBack && location.pathname !== '/app') history.back(); else appPl.exitApp(); });
  }

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
          if (window.scEvento && j.valor) window.scEvento('Purchase', j.valor, j.eid);
          return;
        }
      } catch {}
      setTimeout(verificar, 5000);
    };
    setTimeout(verificar, 4000);
  }

  // Acompanhar pagamento do Raio-X (venda avulsa): recarrega quando pagar e quando o PDF ficar pronto
  const rx = document.querySelector('[data-raiox]');
  if (rx) {
    const aguardandoPix = !!document.querySelector('.pulsando');
    const ver = async () => {
      try { const j = await (await fetch(`/api/raio-x/${rx.getAttribute('data-raiox')}/status`, { headers: { Accept: 'application/json' } })).json();
        if (j.pago && aguardandoPix) { if (window.scEvento && j.valor) window.scEvento('Purchase', j.valor, j.eid); return location.reload(); }
        if (j.entregue) return location.reload(); } catch {}
      setTimeout(ver, 5000);
    };
    setTimeout(ver, 4000);
  }

  // Acompanhar pagamento do ebook
  const ebk = document.querySelector('[data-ebook]');
  if (ebk) {
    const ver = async () => {
      try { const j = await (await fetch(`/api/ebook/${ebk.getAttribute('data-ebook')}/status`, { headers: { Accept: 'application/json' } })).json();
        if (j.pago) { if (window.scEvento && j.valor) window.scEvento('Purchase', j.valor, j.eid); return location.assign(ebk.getAttribute('data-destino') || '/ebook/baixar'); } } catch {}
      setTimeout(ver, 5000);
    };
    setTimeout(ver, 4000);
  }

  // Acompanhar pagamento do monitoramento
  const mon = document.querySelector('[data-mon]');
  if (mon) {
    const ver = async () => {
      try { const j = await (await fetch(`/api/monitoramento/${mon.getAttribute('data-mon')}/status`, { headers: { Accept: 'application/json' } })).json();
        if (j.pago) { if (window.scEvento && j.valor) window.scEvento('Purchase', j.valor, j.eid); return location.assign('/monitoramento?ok=' + encodeURIComponent('Pagamento confirmado! Seu monitoramento está ativo e a primeira checagem chega no seu e-mail.')); } } catch {}
      setTimeout(ver, 5000);
    };
    setTimeout(ver, 4000);
  }

  // Acompanhar pagamento do serviço Limpa Nome
  const ln = document.querySelector('[data-pedido-ln]');
  if (ln) {
    const id = ln.getAttribute('data-pedido-ln');
    const ver = async () => {
      try {
        const j = await (await fetch(ln.getAttribute('data-status-url') || `/api/limpa-nome/${id}/status`, { headers: { Accept: 'application/json' } })).json();
        if (j.pago) { if (window.scEvento && j.valor) window.scEvento('Purchase', j.valor, j.eid); return location.reload(); }
      } catch {}
      setTimeout(ver, 5000);
    };
    setTimeout(ver, 4000);
  }

  // Campo "outro valor" da recarga: máscara de dinheiro estilo app de banco (digitar 5000 mostra R$ 50,00).
  // O cliente sempre vê o valor exato que vai pagar.
  const outro = document.getElementById('outro');
  if (outro && outro.closest('form[action="/recarregar"]')) {
    outro.placeholder = 'R$ 0,00';
    const fmt = () => {
      const d = outro.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 9);
      if (!d) { outro.value = ''; return; }
      const c = d.padStart(3, '0');
      const inteiro = c.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      outro.value = `R$ ${inteiro},${c.slice(-2)}`;
    };
    outro.addEventListener('input', () => { fmt(); outro.setSelectionRange(outro.value.length, outro.value.length); });
    if (outro.value) fmt();
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
