// Páginas HTML (renderizadas no servidor)
// Pixel da Meta / tag do Google
let rastreioAtivo = false;
export const configurarRastreio = (v) => { rastreioAtivo = !!v; };

// Widget "Não sou um robô" (Cloudflare Turnstile)
let chaveRobo = '';
export const configurarRobo = (k) => { chaveRobo = k; };
const robo = () => (chaveRobo ? `<div class="cf-turnstile" data-sitekey="${chaveRobo}" data-language="pt-br" style="margin:4px 0 16px"></div>` : '');
const scriptRobo = () => (chaveRobo ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : '');

const ICONE_OK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
export const faixaGratis = () => `<div class="faixa-gratis" role="note">${ICONE_OK} <strong>Cadastro e acesso 100% gratuitos.</strong> Sem mensalidade e sem taxa de adesão: você só paga pelas consultas que fizer.</div>`;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const dt = (v) => {
  if (!v) return '-';
  const d = new Date(String(v).replace(' ', 'T') + 'Z');
  return isNaN(d) ? String(v) : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const fmtDoc = (d) => { d = String(d || ''); if (/^\d{11}$/.test(d)) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'); if (/^\d{14}$/.test(d)) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5'); return d; };
export const reais = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const CSS = `
:root{--roxo:#9F31D3;--roxo2:#7A1FA8;--preto:#0F0C14;--cinza:#5B5466;--borda:#E6DDEE;--fundo:#F7F3FB;--branco:#fff;--erro:#B3261E;--ok:#1E7B4D}
*{box-sizing:border-box}html,body{margin:0}
body{font-family:Figtree,'Segoe UI',Helvetica,Arial,sans-serif;color:var(--preto);background:var(--fundo);line-height:1.55;min-height:100vh;display:flex;flex-direction:column}
a{color:var(--roxo)}a:hover{color:var(--roxo2)}
h1,h2,h3{font-family:Montserrat,'Arial Black',sans-serif;line-height:1.2;margin:0 0 .5em}
.topo{background:var(--preto);color:#fff}
.topo .in{max-width:1100px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.marca{display:flex;align-items:center;gap:10px;color:#fff;text-decoration:none}
.marca img{width:34px;height:34px}
.marca b{font-family:Montserrat,sans-serif;font-size:1.25rem;font-weight:800;letter-spacing:-.01em}
.marca span{font-family:Montserrat,sans-serif;font-weight:500;color:#D9B8F0}
.nav{display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.nav a{color:#E9E3F0;text-decoration:none;font-weight:500}.nav a:hover{color:#fff}
main{flex:1;width:100%;max-width:1100px;margin:0 auto;padding:32px 20px 56px}
.cartao{background:var(--branco);border:1px solid var(--borda);border-radius:20px;padding:28px}
.estreito{max-width:440px;margin:0 auto}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:12px 26px;border-radius:999px;border:0;background:var(--roxo);color:#fff;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}
.btn:hover{background:var(--roxo2);color:#fff}
.btn.sec{background:transparent;color:var(--preto);border:1.5px solid var(--borda)}
.btn.sec:hover{border-color:var(--roxo);color:var(--roxo)}
.btn[disabled]{opacity:.5;cursor:not-allowed}
.btn.largo{width:100%}
form .campo{display:flex;flex-direction:column;gap:6px;margin-bottom:16px}
label{font-weight:600}
select{font:inherit}input[type=text],input[type=email],input[type=password],input[type=tel]{font:inherit;padding:13px 15px;border:1.5px solid #D6CCE0;border-radius:12px;min-height:48px;width:100%;background:#fff}
input:focus{outline:3px solid #E4CCF4;border-color:var(--roxo)}
.check{display:flex;gap:10px;align-items:flex-start;font-weight:400;color:var(--cinza);font-size:.95rem;margin-bottom:18px}
.check input{width:20px;height:20px;accent-color:var(--roxo);flex:none;margin-top:2px}
.aviso{padding:12px 16px;border-radius:12px;margin-bottom:18px;font-weight:500}
.aviso.erro{background:#FCEEEE;color:var(--erro)}
.aviso.ok{background:#E9F6EF;color:var(--ok)}
.muted{color:var(--cinza)}
.grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}
.saldo{background:var(--preto);color:#fff;border-radius:20px;padding:28px}
.saldo .valor{font-family:Montserrat,sans-serif;font-size:2.4rem;font-weight:800}
.tag{display:inline-block;align-self:flex-start;font-size:.75rem;font-weight:700;padding:3px 10px;border-radius:999px;background:var(--fundo);color:var(--roxo)}
.tabela{width:100%;border-collapse:collapse}
.tabela th,.tabela td{text-align:left;padding:12px 10px;border-bottom:1px solid var(--borda);font-size:.95rem}
.tabela th{color:var(--cinza);font-weight:600;font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}
.rolar{overflow-x:auto}
.vazio{text-align:center;padding:36px 12px;color:var(--cinza)}
footer{color:var(--cinza);font-size:.85rem;text-align:center;padding:24px 20px;border-top:1px solid var(--borda);background:#fff}
.lista{display:flex;flex-direction:column;background:#fff;border:1px solid var(--borda);border-radius:20px;overflow:hidden}
.item{display:flex;align-items:center;gap:14px;padding:14px 18px;border-bottom:1px solid var(--borda);text-decoration:none;color:inherit}
.item:last-child{border-bottom:0}.item:hover{background:var(--fundo)}
.item .ic{flex:none;width:44px;height:44px;border-radius:12px;background:var(--fundo);color:var(--roxo);display:flex;align-items:center;justify-content:center}
.item .tx{flex:1;min-width:0}.item .tx strong{display:block;font-size:1rem}
.item .tx span{display:block;color:var(--cinza);font-size:.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.item .pr{flex:none;text-align:right}.item .pr strong{display:block;font-family:Montserrat,sans-serif;font-size:1.05rem}
.item .pr small{color:var(--cinza);font-size:.78rem}
.item .bt{flex:none;min-height:40px;padding:8px 18px}
@media (max-width:560px){.item{flex-wrap:wrap}.item .tx{flex-basis:calc(100% - 60px)}.item .pr{text-align:left;margin-left:58px}.item .bt{margin-left:auto}}
.banner{position:relative;border-radius:20px;overflow:hidden;aspect-ratio:4/1;background:var(--preto);min-height:120px}
.banner .slide{position:absolute;inset:0;opacity:0;transition:opacity .6s ease;pointer-events:none}
.banner .slide.ativo{opacity:1;pointer-events:auto}
.banner img{width:100%;height:100%;object-fit:cover;display:block}
.banner .selo{position:absolute;top:10px;left:12px;background:rgba(15,12,20,.7);color:#fff;font-size:.72rem;font-weight:700;padding:3px 9px;border-radius:999px}
.banner .pontos{position:absolute;bottom:10px;left:0;right:0;display:flex;gap:6px;justify-content:center}
.banner .pontos button{width:9px;height:9px;border-radius:50%;border:0;background:rgba(255,255,255,.5);cursor:pointer;padding:0}
.banner .pontos button.ativo{background:#fff;width:22px;border-radius:999px}
.banner-vazio{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:28px;border-radius:20px;background:linear-gradient(120deg,#0F0C14 0%,#2A1440 60%,#9F31D3 140%);color:#fff;text-decoration:none}
.banner-vazio strong{font-family:Montserrat,sans-serif;font-size:1.5rem}.banner-vazio span{color:#E2D3EE}
.banner-vazio:hover{color:#fff}
@media (max-width:560px){.banner{aspect-ratio:2/1}}
.faixa-gratis{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#E9F6EF;color:#14532D;border:1px solid #BFE5CF;border-radius:14px;padding:12px 16px;margin:0 0 20px;font-size:.98rem}
.faixa-gratis svg{color:var(--ok);flex:none}
.selos{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
.selos span{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid var(--borda);border-radius:999px;padding:6px 12px;font-size:.88rem;font-weight:600}
.selos svg{color:var(--ok)}
/* ---------- Animações ---------- */
@keyframes subir{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes girar{to{transform:rotate(360deg)}}
@keyframes pulsar{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}
@keyframes pop{0%{transform:scale(.6);opacity:0}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
@keyframes brilho{from{background-position:200% 0}to{background-position:-200% 0}}
main>*{animation:subir .5s cubic-bezier(.2,.7,.2,1) both}
main>*:nth-child(2){animation-delay:.05s}main>*:nth-child(3){animation-delay:.1s}main>*:nth-child(4){animation-delay:.15s}main>*:nth-child(5){animation-delay:.2s}
.grade>*,.lista>.item{animation:subir .45s cubic-bezier(.2,.7,.2,1) both}
.grade>*:nth-child(2),.lista>.item:nth-child(2){animation-delay:.04s}.grade>*:nth-child(3),.lista>.item:nth-child(3){animation-delay:.08s}
.grade>*:nth-child(4),.lista>.item:nth-child(4){animation-delay:.12s}.grade>*:nth-child(5),.lista>.item:nth-child(5){animation-delay:.16s}
.grade>*:nth-child(6),.lista>.item:nth-child(6){animation-delay:.2s}.grade>*:nth-child(7),.lista>.item:nth-child(7){animation-delay:.24s}
.grade>*:nth-child(8),.lista>.item:nth-child(8){animation-delay:.28s}.grade>*:nth-child(n+9),.lista>.item:nth-child(n+9){animation-delay:.32s}
.cartao,.saldo,.item,.btn{transition:transform .18s ease,box-shadow .18s ease,background-color .18s ease,border-color .18s ease}
a.cartao:hover{transform:translateY(-4px);box-shadow:0 14px 30px -18px rgba(159,49,211,.55);border-color:#D9B8F0}
.item:hover .ic{transform:scale(1.08)}.item .ic{transition:transform .18s ease}
.btn:active{transform:scale(.97)}
.btn:hover{box-shadow:0 8px 20px -10px rgba(159,49,211,.7)}
.btn.sec:hover{box-shadow:none}
.saldo{position:relative;overflow:hidden}
.saldo::after{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 40%,rgba(217,184,240,.12) 50%,transparent 60%);background-size:250% 100%;animation:brilho 6s linear infinite;pointer-events:none}
.btn.carregando{pointer-events:none;opacity:.85}
.btn.carregando::before{content:"";width:16px;height:16px;border:2px solid rgba(255,255,255,.45);border-top-color:#fff;border-radius:50%;animation:girar .7s linear infinite}
.btn.sec.carregando::before{border-color:rgba(159,49,211,.3);border-top-color:var(--roxo)}
.pulsando::before{content:"";display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--roxo);margin-right:8px;vertical-align:middle;animation:pulsar 1.2s ease-in-out infinite}
.pop{animation:pop .5s cubic-bezier(.2,.7,.2,1) both}
.aviso{animation:subir .35s ease both}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
.hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:40px;align-items:center;padding:24px 0 40px}
.hero h1{font-size:clamp(2rem,4.5vw,3.2rem);font-weight:800;letter-spacing:-.02em}
.hero h1 em{font-style:normal;color:var(--roxo)}
`;

export function layout({ titulo, corpo, usuario, descricao = '' }) {
  const nav = usuario
    ? `<a href="/painel">Painel</a><a href="/consultas">Consultas</a><a href="/limpa-nome">Limpa Nome</a><a href="/historico">Histórico</a><a href="/recarregar">Recarregar</a><a href="/indicacoes">Indicações</a><a href="/conta">Minha conta</a>${usuario.admin ? '<a href="/admin">Admin</a>' : ''}
       <form method="post" action="/sair" style="margin:0"><button class="btn sec" style="min-height:40px;padding:8px 18px;color:#fff;border-color:#3A3046">Sair</button></form>`
    : `<a href="/entrar">Entrar</a><a class="btn" href="/cadastro" style="min-height:40px;padding:8px 20px">Criar conta</a>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)} · Soft Consultas</title>
<meta name="description" content="${esc(descricao || 'Cadastro grátis e sem mensalidade: pague só pelas consultas de crédito, veículos, empresas, processos e certidões, com relatório em PDF na hora.')}">
<meta property="og:title" content="${esc(titulo)} · Soft Consultas"><meta property="og:description" content="${esc(descricao || 'Consultas de crédito, veículos, empresas e certidões num só lugar.')}">
<meta property="og:image" content="/icone.png">
<link rel="icon" href="/icone.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;700;800&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style><script src="/app.js" defer></script>${scriptRobo()}${rastreioAtivo ? '<script src="/rastreio.js" defer></script>' : ''}</head><body>
<header class="topo"><div class="in">
<a class="marca" href="${usuario ? '/painel' : '/'}"><img src="/icone-branco.png" alt=""><b>Soft</b><span>Consultas</span></a>
<nav class="nav">${nav}</nav></div></header>
<main>${corpo}</main>
<footer><strong>Cadastro grátis · Sem mensalidade · Você só paga pelas consultas</strong><br>Soft Consultas · Soft Solutions Technology Ltda · CNPJ 20.801.827/0001-01 · <a href="/termos">Termos de uso</a> · <a href="/privacidade">Privacidade</a></footer>
</body></html>`;
}

const aviso = (erro, ok) => (erro ? `<div class="aviso erro" role="alert">${esc(erro)}</div>` : '') + (ok ? `<div class="aviso ok">${esc(ok)}</div>` : '');

// Banner rotativo de anúncios (com espaço "Anuncie aqui" quando não há anunciantes)
export function bannerAnuncios(anuncios = [], contato = '#') {
  if (!anuncios.length) {
    return `<a class="banner-vazio" href="${esc(contato)}" target="_blank" rel="noopener">
      <span class="tag" style="background:#2A2233;color:#D9B8F0">Espaço publicitário</span>
      <strong>Anuncie aqui o seu negócio</strong>
      <span>Fale com milhares de empresas e profissionais que usam a Soft Consultas todos os dias.</span>
      <span class="btn" style="margin-top:6px">Quero anunciar</span></a>`;
  }
  return `<div class="banner" data-banner aria-roledescription="carrossel" aria-label="Anúncios">
    ${anuncios.map((a, i) => `<a class="slide${i ? '' : ' ativo'}" href="${a.link ? `/anuncio/${a.id}` : '#'}" ${a.link ? 'target="_blank" rel="noopener sponsored"' : ''} aria-label="${esc(a.titulo || a.anunciante)}">
      <img src="/anuncio-img/${a.id}" alt="${esc(a.titulo || a.anunciante)}" loading="lazy"></a>`).join('')}
    <span class="selo">Anúncio</span>
    ${anuncios.length > 1 ? `<div class="pontos">${anuncios.map((_, i) => `<button type="button" aria-label="Anúncio ${i + 1}" class="${i ? '' : 'ativo'}"></button>`).join('')}</div>` : ''}
  </div>
  <p class="muted" style="text-align:right;font-size:.8rem;margin:6px 0 0"><a href="${esc(contato)}" target="_blank" rel="noopener">Anuncie aqui</a></p>`;
}

export const paginaInicial = ({ anuncios = [], contato = '#' } = {}) => `
<section class="hero">
  <div>
    <span class="tag">Consultas para o seu negócio</span>
    <h1 style="margin-top:14px">Informação de qualidade para <em>decidir com segurança</em>.</h1>
    <p class="muted" style="font-size:1.15rem;max-width:520px">Consultas de crédito, empresas, veículos e muito mais, num só lugar. <strong style="color:var(--preto)">O cadastro é gratuito e você só paga pelas consultas que fizer</strong>, com relatório em PDF na hora.</p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px">
      <a class="btn" href="/cadastro">Criar conta grátis</a><a class="btn sec" href="/entrar">Já tenho conta</a>
    </div>
    <div class="selos">${['Cadastro grátis', 'Sem mensalidade', 'Pague só pela consulta', 'PDF na hora'].map((t) => `<span>${ICONE_OK} ${t}</span>`).join('')}</div>
  </div>
  <div class="grade">
    <div class="cartao"><h3>Crédito</h3><p class="muted" style="margin:0">Score, restrições, protestos e histórico de CPF e CNPJ.</p></div>
    <div class="cartao"><h3>Veículos</h3><p class="muted" style="margin:0">Débitos, restrições e informações por placa.</p></div>
    <div class="cartao"><h3>Cadastro gratuito</h3><p class="muted" style="margin:0">Sem mensalidade e sem adesão. Recarregue por Pix e pague só pelo que consultar.</p></div>
    <div class="cartao"><h3>Relatório em PDF</h3><p class="muted" style="margin:0">Resultado na tela e PDF para baixar e arquivar.</p></div>
  </div>
</section>
<section style="margin-bottom:28px">${bannerAnuncios(anuncios, contato)}</section>
<section class="cartao" style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;justify-content:space-between">
  <div><span class="tag">Para profissionais de limpa nome</span><h2 style="margin:10px 0 6px">Área exclusiva com as consultas certas para cada caso</h2>
  <p class="muted" style="margin:0;max-width:620px">As consultas mais em conta para triagem e as mais completas para o diagnóstico: Serasa, SPC, Boa Vista, Banco Central, protestos e CADIN.</p></div>
  <a class="btn" href="/cadastro">Criar conta grátis</a>
</section>`;

export const paginaCadastro = ({ erro, v = {} }) => `
<div class="cartao estreito">
  <h1 style="font-size:1.7rem">Criar conta grátis</h1>
  <p class="muted">Leva menos de um minuto. <strong style="color:var(--ok)">O cadastro e o acesso são gratuitos</strong>: sem mensalidade, você só paga pelas consultas que fizer.</p>
  ${aviso(erro)}
  <form method="post" action="/cadastro" novalidate>
    <div class="campo"><label for="nome">Nome completo ou razão social</label><input id="nome" name="nome" type="text" autocomplete="name" required value="${esc(v.nome)}"></div>
    <div class="campo"><label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required value="${esc(v.email)}"></div>
    <div class="campo"><label for="documento">CPF ou CNPJ</label><input id="documento" name="documento" type="text" inputmode="numeric" required value="${esc(v.documento)}"></div>
    <div class="campo"><label for="telefone">WhatsApp</label><input id="telefone" name="telefone" type="tel" autocomplete="tel" placeholder="(00) 00000-0000" required value="${esc(v.telefone)}"></div>
    <div class="campo"><label for="senha">Senha</label><input id="senha" name="senha" type="password" autocomplete="new-password" minlength="8" required><small class="muted">Mínimo de 8 caracteres.</small></div>
    <label class="check"><input type="checkbox" name="aceite" value="1" required><span>Li e aceito os <a href="/termos" target="_blank">Termos de uso</a> e a <a href="/privacidade" target="_blank">Política de privacidade</a>.</span></label>
    ${robo()}
    <button class="btn largo" type="submit">Criar minha conta grátis</button>
  </form>
  <p class="muted" style="text-align:center;margin:18px 0 0">Já tem conta? <a href="/entrar">Entrar</a></p>
</div>`;

export const paginaEntrar = ({ erro, ok, email = '' }) => `
<div class="cartao estreito">
  <h1 style="font-size:1.7rem">Entrar</h1>
  ${aviso(erro, ok)}
  <form method="post" action="/entrar">
    <div class="campo"><label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required value="${esc(email)}"></div>
    <div class="campo"><label for="senha">Senha</label><input id="senha" name="senha" type="password" autocomplete="current-password" required></div>
    ${robo()}
    <button class="btn largo" type="submit">Entrar</button>
  </form>
  <p style="text-align:center;margin:18px 0 0"><a href="/esqueci-senha">Esqueci minha senha</a></p>
  <p class="muted" style="text-align:center;margin:8px 0 0">Ainda não tem conta? <a href="/cadastro">Criar conta</a></p>
</div>`;

export const paginaEsqueci = ({ erro, ok }) => `
<div class="cartao estreito">
  <h1 style="font-size:1.7rem">Esqueci minha senha</h1>
  <p class="muted">Informe o e-mail da sua conta. Vamos enviar um link para você criar uma nova senha.</p>
  ${aviso(erro, ok)}
  <form method="post" action="/esqueci-senha">
    <div class="campo"><label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required></div>
    ${robo()}
    <button class="btn largo" type="submit">Enviar link</button>
  </form>
  <p style="text-align:center;margin:18px 0 0"><a href="/entrar">Voltar para o login</a></p>
</div>`;

export const paginaRedefinir = ({ erro, token, valido }) => `
<div class="cartao estreito">
  <h1 style="font-size:1.7rem">Criar nova senha</h1>
  ${aviso(erro)}
  ${valido ? `<form method="post" action="/redefinir-senha">
    <input type="hidden" name="token" value="${esc(token)}">
    <div class="campo"><label for="senha">Nova senha</label><input id="senha" name="senha" type="password" autocomplete="new-password" minlength="8" required><small class="muted">Mínimo de 8 caracteres.</small></div>
    <div class="campo"><label for="senha2">Repita a nova senha</label><input id="senha2" name="senha2" type="password" autocomplete="new-password" required></div>
    <button class="btn largo" type="submit">Salvar nova senha</button>
  </form>` : `<p class="muted">Este link é inválido ou já expirou.</p><a class="btn largo" href="/esqueci-senha">Pedir um novo link</a>`}
</div>`;

// Botões de PDF bem visíveis: baixar (arquivo) e abrir (nova aba)
const ICONE_BAIXAR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>';
export const botoesPdf = (id) => `<span style="display:inline-flex;gap:6px;flex-wrap:wrap">
  <a class="btn" style="min-height:38px;padding:6px 14px" href="/consulta/${id}/pdf?baixar=1">${ICONE_BAIXAR} Baixar PDF</a>
  <a class="btn sec" style="min-height:38px;padding:6px 14px" href="/consulta/${id}/pdf" target="_blank" rel="noopener">Abrir</a></span>`;

export const paginaPainel = ({ usuario, saldo, transacoes, consultas, anuncios = [], contato = '#' }) => `
<h1 style="font-size:1.8rem">Olá, ${esc(usuario.nome.split(' ')[0])}</h1>
${!usuario.admin && !transacoes.length ? faixaGratis() : ''}
<p class="muted" style="margin-top:-4px">Bem-vindo ao seu painel.</p>
<div class="grade" style="margin:22px 0">
  ${usuario.admin ? `<div class="saldo">
    <div style="color:#D9B8F0;font-weight:600">Saldo na APIFull (conta admin)</div>
    <div class="valor">${saldo === null ? 'Indisponível' : reais(saldo)}</div>
    <p style="color:#CFC6DA;font-size:.9rem;margin:6px 0 0">Suas consultas saem direto deste saldo, a preço de custo.</p>
    <a class="btn" href="https://app.apifull.com.br" target="_blank" rel="noopener" style="margin-top:14px">Recarregar na APIFull</a>
  </div>` : `<div class="saldo">
    <div style="color:#D9B8F0;font-weight:600">Saldo disponível</div>
    <div class="valor">${reais(saldo)}</div>
    <a class="btn" href="/recarregar" style="margin-top:14px">Recarregar</a>
  </div>`}
  <div class="cartao">
    <h3>Nova consulta</h3>
    <p class="muted">Escolha o tipo de consulta e veja o resultado na hora.</p>
    <a class="btn" href="/consultas">Ver consultas</a>
  </div>
  <div class="cartao">
    <h3>Indique e ganhe</h3>
    <p class="muted">Compartilhe seu link e ganhe comissão em todas as consultas de quem você indicar. Saque por Pix ou use como crédito.</p>
    <a class="btn" href="/indicacoes">Pegar meu link</a>
  </div>
</div>
${usuario.admin ? '' : `<div style="margin-bottom:18px">${bannerAnuncios(anuncios, contato)}</div>`}
<div class="cartao" style="margin-bottom:18px">
  <h3>Últimas consultas</h3>
  ${consultas.length ? `<div class="rolar"><table class="tabela"><tr><th>Data</th><th>Consulta</th><th>Documento</th><th>Valor</th><th>Status</th></tr>
    ${consultas.map((c) => `<tr><td>${dt(c.criado_em)}</td><td>${esc(c.produto)}</td><td>${esc(fmtDoc(c.parametro))}</td><td>${reais(c.preco_centavos)}</td><td>${c.status === 'concluida' ? (c.resultado ? botoesPdf(c.id) : 'Expirada') : c.status === 'falhou' ? 'Falhou (estornada)' : 'Processando'}</td></tr>`).join('')}
  </table></div>` : '<div class="vazio">Você ainda não fez nenhuma consulta.</div>'}
</div>
<div class="cartao">
  <h3>Extrato</h3>
  ${transacoes.length ? `<div class="rolar"><table class="tabela"><tr><th>Data</th><th>Descrição</th><th style="text-align:right">Valor</th></tr>
    ${transacoes.map((t) => `<tr><td>${dt(t.criado_em)}</td><td>${esc(t.descricao)}</td><td style="text-align:right;font-weight:700;color:${t.valor_centavos < 0 ? 'var(--erro)' : 'var(--ok)'}">${t.valor_centavos < 0 ? '-' : '+'} ${reais(Math.abs(t.valor_centavos))}</td></tr>`).join('')}
  </table></div>` : '<div class="vazio">Nenhuma movimentação ainda. Faça sua primeira recarga para começar.</div>'}
</div>`;

export const paginaEmBreve = (titulo, texto) => `
<div class="cartao estreito" style="text-align:center">
  <h1 style="font-size:1.6rem">${esc(titulo)}</h1>
  <p class="muted">${esc(texto)}</p>
  <a class="btn" href="/painel">Voltar ao painel</a>
</div>`;

export const paginaConta = ({ usuario, erro, ok }) => `
<div class="cartao estreito" style="max-width:560px">
  <h1 style="font-size:1.7rem">Minha conta</h1>
  ${aviso(erro, ok)}
  <table class="tabela" style="margin-bottom:24px">
    <tr><th>Nome</th><td>${esc(usuario.nome)}</td></tr>
    <tr><th>E-mail</th><td>${esc(usuario.email)}</td></tr>
    <tr><th>CPF/CNPJ</th><td>${esc(usuario.documento)}</td></tr>
    <tr><th>WhatsApp</th><td>${esc(usuario.telefone)}</td></tr>
  </table>
  <h3>Alterar senha</h3>
  <form method="post" action="/conta/senha">
    <div class="campo"><label for="atual">Senha atual</label><input id="atual" name="atual" type="password" autocomplete="current-password" required></div>
    <div class="campo"><label for="nova">Nova senha</label><input id="nova" name="nova" type="password" autocomplete="new-password" minlength="8" required></div>
    <button class="btn" type="submit">Alterar senha</button>
  </form>
</div>`;

export const paginaTexto = (titulo, html) => `<div class="cartao" style="max-width:800px;margin:0 auto"><h1 style="font-size:1.7rem">${esc(titulo)}</h1>${html}</div>`;
