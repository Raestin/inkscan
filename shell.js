/* InkScan shell: Home, search everything, keyboard shortcuts, stepping through cards, and card peek.
   Runs after app.js and talks to it only through window.InkApp and the inkscan:* events it sends. */
(function(){
'use strict';
const A = window.InkApp; if (!A) return;
const $ = id => document.getElementById(id);
const {esc, norm, money, money0} = A;
const wide = () => window.matchMedia('(min-width:1024px)').matches;
const typing = el => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
const ic = name => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
$('searchKey').textContent = mac ? '⌘K' : 'Ctrl K';

/* ---------- Home ---------- */
function deckInfo(d){
  const st = A.deckStats(d), have = A.lorcana ? st.total : st.main, size = A.lorcana ? 60 : st.size || A.deckSize(d);
  const owned = Math.max(0, st.total - st.missing), pct = st.total ? Math.round(100 * owned / st.total) : 0;
  return {d, st, have, size, pct};
}
function deckRow({d, st, have, size, pct}, trail){
  const c = A.deckLead(d, st);
  const status = !st.total ? 'No cards yet' : d.built ? 'Built' : st.missing ? `${st.missing} to get` : 'You own every card';
  return `<div class="item"><button class="item-main" data-home-deck="${esc(d.id)}">${c ? A.thumbHTML(c) : '<span class="thumb"></span>'}<div class="who"><div class="n">${esc(d.name)}</div><div class="m">${A.inkSetHTML(st.inks)} ${have}/${size} · ${status}</div><div class="meter${st.missing ? '' : ' full'}"><i style="width:${pct}%"></i></div></div>${trail || ''}</button></div>`;
}
function topCards(n){
  const rows = [];
  for (const id of Object.keys(A.inv)){
    if (!A.ownedOf(id)) continue;
    const c = A.card(id), p = c && A.priceOf(c);
    if (p) rows.push({c, p});
  }
  return rows.sort((a, b) => b.p - a.p).slice(0, n);
}
function renderHome(){
  const box = $('homeBody'); if (!box || !A.ready) return;
  const t = A.totals(), decks = A.decks, info = decks.map(deckInfo);
  const wishN = Object.values(A.wish || {}).reduce((s, q) => s + (+q || 0), 0);
  if (!t.copies && !decks.length){
    box.innerHTML = `<div class="home-start"><p>Scan your first ${esc(A.gameName)} card and your collection starts here.</p><button class="btn primary" data-tab="scan">${ic('scan')}Scan cards</button></div>`;
    return;
  }
  const built = decks.filter(d => d.built).length;
  const ready = info.filter(x => x.st.total && !x.st.missing && !x.d.built).length;
  const recent = [...info].sort((a, b) => (b.d.updated || 0) - (a.d.updated || 0)).slice(0, 5);
  const close = info.filter(x => x.st.missing && !x.d.built && !x.st.unknown).sort((a, b) => a.st.missCost - b.st.missCost || a.st.missing - b.st.missing).slice(0, 5);
  const top = topCards(8);
  box.innerHTML = `
    <div class="home-top">
      <div class="hero"><div class="hero-main"><span class="hero-label">${esc(A.gameName)} collection</span><strong>${money0(t.val)}${t.unpriced ? ' <span class="hero-sub">partial</span>' : ''}</strong><span class="hero-sub"><b>${t.u.toLocaleString()}</b> cards · <b>${t.copies.toLocaleString()}</b> copies</span></div>${top.length >= 3 ? `<div class="hero-fan">${[1, 0, 2].map(k => { const u = A.imgUrl(top[k].c, 'normal'); return u ? `<button type="button" class="fan f${k}" data-card="${esc(top[k].c.id)}" aria-label="${esc(top[k].c.n)}"><img src="${esc(u)}" alt="" loading="lazy"></button>` : ''; }).join('')}</div>` : ''}</div>
      <div class="statrow">
        <button class="statcard" data-tab="decks"><b>${decks.length}</b><span>${decks.length === 1 ? 'Deck' : 'Decks'}, ${built} built</span></button>
        <button class="statcard" data-tab="decks"><b>${ready}</b><span>Ready to build</span></button>
        <button class="statcard" data-home="wish"><b>${wishN}</b><span>On wishlist</span></button>
      </div>
    </div>
    <div class="home-acts">
      <button class="btn primary" data-tab="scan">${ic('scan')}Scan cards</button>
      <button class="btn" data-home="new">${ic('plus')}New deck</button>
      <button class="btn" data-home="import">${ic('import')}Import</button>
      <button class="btn" data-tab="browse">${ic('search')}Browse</button>
    </div>
    ${decks.length ? `<div class="home-cols">
      <section class="home-sec hdeck"><header><h3>Jump back in</h3><button class="seeall" data-tab="decks">All decks</button></header><div class="list">${recent.map(x => deckRow(x)).join('')}</div></section>
      ${close.length ? `<section class="home-sec hdeck"><header><h3>Closest to finished</h3></header><div class="list">${close.map(x => deckRow(x, `<span class="trail"><b>${money(x.st.missCost)}</b>${x.st.missing} to get</span>`)).join('')}</div></section>` : ''}
    </div>` : ''}
    ${top.length ? `<section class="home-sec"><header><h3>Most valuable cards</h3><button class="seeall" data-tab="coll">Collection</button></header><div class="grid">${top.map(({c, p}) => A.tileHTML(c, {cap: money(p)})).join('')}</div></section>` : ''}
    <section class="home-sec"><header><h3>More</h3></header><div class="menu">
      <button class="menurow" data-tab="help">${ic('help')}<span><b>How to play</b><small>Rules and a quick start for ${esc(A.gameName)}</small></span></button>
      <button class="menurow" data-home="cloud">${ic('cloud')}<span><b>Cloud &amp; family</b><small>Sync across devices and share a collection</small></span></button>
      <button class="menurow" data-home="tools">${ic('save')}<span><b>Tools and backup</b><small>Export, import and restore</small></span></button>
      <a class="menurow" href="portal/">${ic('chart')}<span><b>Portal</b><small>Deck workshop, simulator, buy planner and advisor</small></span></a>
    </div></section>`;
}
const HOME_ACTS = {
  new: () => { A.showTab('decks'); $('newDeckBtn').click(); },
  import: () => { A.showTab('decks'); $('importDeckBtn').click(); },
  wish: () => { A.showTab('coll'); document.querySelector('[data-csub="wish"]')?.click(); },
  sets: () => { A.showTab('coll'); document.querySelector('[data-csub="sets"]')?.click(); },
  cloud: () => $('manualUpdate').click(),
  tools: () => $('toolsBtn').click(),
  keys: () => showKeys(),
};
$('homeBody').addEventListener('click', e => {
  const d = e.target.closest('[data-home-deck]'); if (d) return A.openDeck(d.dataset.homeDeck);
  const a = e.target.closest('[data-home]'); if (a) HOME_ACTS[a.dataset.home]?.();
});
document.addEventListener('inkscan:tab', e => { if (e.detail === 'home') renderHome(); });
document.addEventListener('inkscan:ready', renderHome);
document.addEventListener('inkscan:data', () => { if (A.tab === 'home') renderHome(); });

/* ---------- search everything ---------- */
let palItems = [], palAt = 0, palBack = null;
function gameActions(){
  const sel = $('gameSel'); if (!sel) return [];
  return [...sel.options].filter(o => !o.selected).map(o => ({icon: 'grid', n: `Switch to ${o.textContent}`, m: 'Game', run: () => { sel.value = o.value; sel.dispatchEvent(new Event('change', {bubbles: true})); }}));
}
function actions(){
  return [
    {icon: 'home', n: 'Home', k: 'G H', run: () => A.showTab('home')},
    {icon: 'box', n: 'Collection', k: 'G C', run: () => A.showTab('coll')},
    {icon: 'deck', n: 'Decks', k: 'G D', run: () => A.openDeck(null)},
    {icon: 'search', n: 'Browse all cards', k: 'G B', run: () => A.showTab('browse')},
    {icon: 'scan', n: 'Scan cards', k: 'G S', run: () => A.showTab('scan')},
    {icon: 'plus', n: 'New deck', k: 'N', run: HOME_ACTS.new},
    {icon: 'import', n: 'Import a deck', run: HOME_ACTS.import},
    {icon: 'heart', n: 'Wishlist', run: HOME_ACTS.wish},
    {icon: 'grid', n: 'Sets', m: 'How much of each set you own', run: HOME_ACTS.sets},
    {icon: 'help', n: 'How to play', run: () => A.showTab('help')},
    {icon: 'save', n: 'Tools and backup', run: HOME_ACTS.tools},
    {icon: 'cloud', n: 'Cloud & family', run: HOME_ACTS.cloud},
    {icon: 'chart', n: 'Deck workshop', m: 'Portal', run: () => { location.href = 'portal/#decks'; }},
    {icon: 'dice', n: 'Simulator', m: 'Portal', run: () => { location.href = 'portal/#simulate'; }},
    {icon: 'cart', n: 'Buy planner', m: 'Portal', run: () => { location.href = 'portal/#buy'; }},
    {icon: 'spark', n: 'Advisor', m: 'Portal', run: () => { location.href = 'portal/#advisor'; }},
    ...gameActions(),
    {icon: 'keys', n: 'Keyboard shortcuts', k: '?', run: showKeys},
  ];
}
function palRender(){
  const raw = $('palQ').value.trim(), q = norm(raw);
  const groups = [];
  const acts = actions().filter(a => !q || norm(a.n + ' ' + (a.m || '')).includes(q));
  if (!q) groups.push(['Go to', acts.slice(0, 8)]);
  else if (acts.length) groups.push(['Actions', acts.slice(0, 6)]);
  if (A.ready){
    const decks = (q ? A.decks.filter(d => norm(d.name).includes(q)) : [...A.decks].sort((a, b) => (b.updated || 0) - (a.updated || 0))).slice(0, q ? 6 : 4);
    if (decks.length) groups.push([q ? 'Decks' : 'Recent decks', decks.map(d => ({deck: d, n: d.name, m: `${Object.values(d.cards).reduce((s, n) => s + n, 0)} cards${d.built ? ' · Built' : ''}`, run: () => A.openDeck(d.id)}))]);
    if (q.length >= 2){
      const cards = A.search(raw, 8);
      if (cards.length) groups.push(['Cards', cards.map(c => { const own = A.ownedOf(c.id), p = A.priceOf(c); return {card: c, n: c.n + (c.v ? ' – ' + c.v : ''), m: `${A.setLabel(c)} · #${c.c}${own ? ` · You own ${own}` : ''}`, k: p ? money(p) : '', run: () => A.openCard(c.id)}; })]);
      groups.push(['', [{icon: 'search', n: `Search all cards for “${raw}”`, run: () => { A.showTab('browse'); const b = $('bq'); b.value = raw; b.dispatchEvent(new Event('input', {bubbles: true})); }}]]);
    }
  }
  palItems = groups.flatMap(g => g[1]); palAt = 0;
  let i = 0;
  $('palList').innerHTML = palItems.length ? groups.map(([label, items]) => (label ? `<div class="pal-grp">${label}</div>` : '') + items.map(it => {
    const lead = it.card ? A.thumbHTML(it.card) : it.deck ? ic('deck') : ic(it.icon);
    return `<button class="pal-i" role="option" id="pal-${i}" data-i="${i}" aria-selected="${i++ === 0}">${lead}<span class="w"><span class="n">${esc(it.n)}</span>${it.m ? `<span class="m">${esc(it.m)}</span>` : ''}</span>${it.k ? (it.card ? `<span class="k">${esc(it.k)}</span>` : `<kbd>${esc(it.k)}</kbd>`) : ''}</button>`;
  }).join('')).join('') : `<p class="pal-none">Nothing matches “${esc(raw)}”.</p>`;
  $('palQ').setAttribute('aria-activedescendant', palItems.length ? 'pal-0' : '');
}
function palMove(d){
  if (!palItems.length) return;
  palAt = (palAt + d + palItems.length) % palItems.length;
  $('palList').querySelectorAll('.pal-i').forEach((b, i) => { b.setAttribute('aria-selected', i === palAt); if (i === palAt) b.scrollIntoView({block: 'nearest'}); });
  $('palQ').setAttribute('aria-activedescendant', 'pal-' + palAt);
}
function palOpen(){
  if (!$('pal').hidden) return;
  palBack = document.activeElement;
  $('pal').hidden = false; $('palScrim').hidden = false; $('palQ').value = ''; palRender(); $('palQ').focus();
}
function palClose(restore){
  if ($('pal').hidden) return;
  $('pal').hidden = true; $('palScrim').hidden = true;
  if (restore !== false && palBack && palBack.focus) palBack.focus();
}
function palRun(i){ const it = palItems[i]; if (!it) return; palClose(false); it.run(); }
$('searchBtn').onclick = palOpen;
$('palClose').onclick = () => palClose();
$('palScrim').onclick = () => palClose();
$('palQ').addEventListener('input', palRender);
$('palQ').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown'){ e.preventDefault(); palMove(1); }
  else if (e.key === 'ArrowUp'){ e.preventDefault(); palMove(-1); }
  else if (e.key === 'Enter'){ e.preventDefault(); palRun(palAt); }
  else if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); palClose(); }
});
$('palList').addEventListener('click', e => { const b = e.target.closest('.pal-i'); if (b) palRun(+b.dataset.i); });
$('palList').addEventListener('mousemove', e => { const b = e.target.closest('.pal-i'); if (b && +b.dataset.i !== palAt){ palAt = +b.dataset.i; palMove(0); } });

/* ---------- keyboard shortcuts ---------- */
const GO = {h: 'home', c: 'coll', d: 'decks', b: 'browse', s: 'scan'};
function showKeys(){
  const row = (keys, what) => `<dt>${keys.map(k => `<kbd>${k}</kbd>`).join('')}</dt><dd>${what}</dd>`;
  A.openSheet('Keyboard shortcuts', `<dl class="keys">
    ${row([mac ? '⌘' : 'Ctrl', 'K'], 'Search cards, decks and actions')}
    ${row(['/'], 'Search')}
    ${row(['G', 'H'], 'Home')}
    ${row(['G', 'C'], 'Collection')}
    ${row(['G', 'D'], 'Decks')}
    ${row(['G', 'B'], 'Browse')}
    ${row(['G', 'S'], 'Scan')}
    ${row(['N'], 'New deck')}
    ${row(['←', '→'], 'Previous or next card')}
    ${row(['Esc'], 'Close')}
    ${row(['?'], 'This list')}
  </dl>`);
}
$('railKeys').onclick = showKeys;
let goT = 0;
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k'){ e.preventDefault(); $('pal').hidden ? palOpen() : palClose(); return; }
  if (!$('pal').hidden || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
  if (A.sheetOpen){
    if (e.key === 'ArrowLeft' && !$('sheetNav').hidden){ e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight' && !$('sheetNav').hidden){ e.preventDefault(); step(1); }
    return;
  }
  const k = e.key.toLowerCase();
  if (goT && Date.now() - goT < 1200 && GO[k]){ e.preventDefault(); goT = 0; k === 'd' ? A.openDeck(null) : A.showTab(GO[k]); return; }
  goT = 0;
  if (e.key === '/'){ e.preventDefault(); palOpen(); }
  else if (e.key === '?'){ e.preventDefault(); showKeys(); }
  else if (k === 'g') goT = Date.now();
  else if (k === 'n'){ e.preventDefault(); HOME_ACTS.new(); }
});

/* ---------- step through the cards of the list a card was opened from ---------- */
let run = [], runAt = -1;
document.addEventListener('click', e => {
  const el = e.target.closest('[data-card]'); if (!el || el.closest('#sheet')) return;
  const box = el.closest('.grid,.list,.hand,#palList');
  run = box && box.id !== 'palList' ? [...new Set([...box.querySelectorAll('[data-card]')].map(x => x.dataset.card))] : [];
}, true);
function navState(){
  const show = run.length > 1 && runAt >= 0;
  $('sheetNav').hidden = !show;
  $('cardPrev').disabled = runAt <= 0; $('cardNext').disabled = runAt >= run.length - 1;
}
function step(d){ const id = run[runAt + d]; if (id) A.openCard(id); }
document.addEventListener('inkscan:sheet', () => { runAt = -1; navState(); });
document.addEventListener('inkscan:card', e => { runAt = run.indexOf(e.detail); navState(); });
$('cardPrev').onclick = () => step(-1);
$('cardNext').onclick = () => step(1);

/* ---------- peek: hover any card on a wide screen to see it large, with its stats ---------- */
const peek = $('peek');
let peekT = 0, peekEl = null;
function peekHide(){ clearTimeout(peekT); peekEl = null; peek.hidden = true; }
document.addEventListener('mouseover', e => {
  if (!wide() || !window.matchMedia('(hover:hover)').matches) return;
  const el = e.target.closest('[data-card]');
  if (el === peekEl) return;
  peekHide();
  if (!el || el.closest('#sheet .detail')) return;
  const c = A.card(el.dataset.card); if (!c) return;
  peekEl = el; const x = e.clientX;
  peekT = setTimeout(() => {
    if (peekEl !== el || !el.isConnected) return;
    const url = A.imgUrl(c, 'normal'), f = A.cardFacts(c), p = A.priceOf(c);
    peek.innerHTML = `<div class="peek-art">${url ? `<img src="${esc(url)}" alt="">` : `<span class="peek-ph">${esc(c.n)}</span>`}</div>
      <div class="peek-info"><b class="peek-n">${esc(c.n)}</b><span class="peek-t">${esc(f.type)}${f.cost ? ` · ${esc(f.cost)}` : ''}</span>
      ${f.stats.length ? `<div class="pstats">${f.stats.slice(0, 6).map(([l, v]) => `<span class="pstat"><b>${esc(v)}</b>${esc(l)}</span>`).join('')}</div>` : ''}
      ${f.rules ? `<div class="peek-tx">${f.rules}</div>` : ''}
      <span class="peek-foot"><b>${p != null ? money(p) : 'No price'}</b>${f.owned ? `You own ${f.owned}` : 'Not in your collection'} · ${esc(c.sn || '')}</span></div>`;
    peek.hidden = false;
    const r = el.getBoundingClientRect(), W = peek.offsetWidth, H = peek.offsetHeight, vw = window.innerWidth;
    const rightOf = Math.min(r.right + 12, x + 160);
    const onRight = rightOf + W <= vw - 8;
    const left = onRight ? rightOf : Math.max(8, r.left - W - 12);
    const top = Math.max(8, Math.min(r.top + r.height / 2 - H / 2, window.innerHeight - H - 8));
    peek.style.left = left + 'px'; peek.style.top = top + 'px';
    peek.style.transformOrigin = `${onRight ? 'left' : 'right'} ${Math.round(Math.max(0, Math.min(H, r.top + r.height / 2 - top)))}px`;
    peek.classList.remove('in'); void peek.offsetWidth; peek.classList.add('in');
  }, 200);
});
for (const ev of ['scroll', 'mousedown', 'keydown']) window.addEventListener(ev, peekHide, true);
document.addEventListener('mouseleave', peekHide);

/* a link such as ./#browse (the portal uses these) opens that view */
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (['home','coll','decks','browse','scan','help'].includes(v)) A.showTab(v); });

if (A.ready) renderHome();
})();
