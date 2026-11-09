/* InkScan Portal: the desktop command center. Views: Overview, Collection, Deck workshop, Simulator,
   Buy planner and Advisor. Data comes from PortalData (data.js), charts from PortalCharts (charts.js),
   simulations from InkSim (sim.js), and the Claude advisor from PortalAdvisor (advisor.js). */
(function(){
  'use strict';
  const D = PortalData, C = PortalCharts, G = InkGames;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
  const money = v => v == null ? '—' : '$' + (v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2));
  const pct = v => v == null || !Number.isFinite(v) ? '—' : (v * 100 >= 99.95 || v === 0 ? Math.round(v * 100) : (v * 100).toFixed(1)) + '%';
  const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
  const today = () => new Date().toISOString().slice(0, 10);
  let toastTimer = 0;
  function toast(msg){ const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3200); }

  let game = D.lsGet('portal.game', 'mtg'), view = 'home', loaded = false, loading = null;
  const S = () => D.state, gameDef = () => G.get(game);
  const colorVar = name => `var(--${String(name || 'colorless').toLowerCase().replace(/[^a-z]/g, '')}, var(--colorless))`;
  function imgUrl(c, size){ if (!c) return ''; if (game === 'lorcana') return c.supplemental || c.iv === null ? '' : `https://cards.lorcast.io/card/digital/${size || 'small'}/${c.id}.avif${c.iv ? '?' + c.iv : ''}`; return gameDef().imgUrl ? gameDef().imgUrl(c, size) : ''; }
  const cardName = c => c ? (game === 'lorcana' && c.v ? `${c.n} - ${c.v}` : c.n) : '';
  const nvName = nv => { const c = S().cat?.rep(nv); return c ? cardName(c) : nv.replace(/\|$/, '').replace(/\|/g, ' '); };
  function dots(colors){ return `<span class="dots">${(colors || []).map(i => `<span class="dot" style="background:${colorVar(i)}" title="${esc(i)}"></span>`).join('')}</span>`; }
  const deckColors = d => [...new Set(Object.keys(d.cards).flatMap(nv => S().cat.rep(nv)?.inks || []))].filter(x => x !== 'Colorless').slice(0, 5);
  const formatLabel = d => game === 'mtg' ? (d.format ? gameDef().formats[d.format]?.label : d.commanders.length ? 'Commander' : '') || '' : '';

  /* ---------- boot ---------- */
  $('game').value = game;
  $('game').onchange = () => { game = $('game').value; D.lsSet('portal.game', game); loaded = false;
    buy.sel = new Set(D.lsGet('portal.buy.' + game, [])); Object.assign(workshop, {id: null, draft: null, dirty: false, compare: '', addQ: ''}); Object.assign(sim, {deck: null, keys: [], oddsKeys: [], result: null});
    boot(); };
  $('reload').onclick = () => { loaded = false; boot(); };
  window.addEventListener('hashchange', () => { view = (location.hash.slice(1) || 'home').split('/')[0]; render(); });
  $('signinForm').onsubmit = async e => {
    e.preventDefault(); $('signinMsg').textContent = 'Signing in…';
    try { await D.signIn($('email').value.trim(), $('pass').value); $('signinMsg').textContent = ''; boot(); }
    catch(err){ $('signinMsg').textContent = /invalid login/i.test(err.message) ? 'That email and password don’t match.' : err.message; }
  };

  async function boot(){
    view = (location.hash.slice(1) || 'home').split('/')[0];
    const s = D.session();
    $('signin').hidden = !!s; $('view').hidden = !s;
    $('who').innerHTML = s ? `${esc(s.email || 'Signed in')} · <button class="link" id="signout" type="button">Sign out</button>` : '';
    if (s) $('signout').onclick = () => { D.signOut(); loaded = false; boot(); };
    if (!s) return;
    if (!loaded){
      $('loading').hidden = false; $('view').hidden = true; $('loadMsg').textContent = `Loading your ${gameDef().name} cards and decks…`; $('loadBar').style.width = '8%';
      const my = loading = D.load(game, (done, total) => { if (loading !== my) return; $('loadBar').style.width = Math.round(8 + 92 * done / Math.max(1, total)) + '%'; $('loadMsg').textContent = `Loading card data from Scryfall: ${done.toLocaleString()} of ${total.toLocaleString()}. The first visit takes a minute; after that it's instant.`; });
      try { await my; if (loading !== my) return; loaded = true; snapshotValue(); }
      catch(err){ $('loading').hidden = true; $('view').hidden = false; $('view').innerHTML = `<div class="empty"><h2>Couldn't load your cards</h2><p class="muted">${esc(err.message)}</p><button class="btn primary" id="retry" type="button">Try again</button></div>`; $('retry').onclick = boot; if (err.status === 401){ D.signOut(); boot(); } return; }
      $('loading').hidden = true; $('view').hidden = false;
    }
    render();
  }
  function render(){
    for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('on', a.dataset.view === view);
    if (!loaded) return;
    C.hideTip();
    const fn = {home: renderHome, collection: renderCollection, decks: renderDecks, simulate: renderSim, buy: renderBuy, advisor: renderAdvisor}[view] || renderHome;
    fn($('view'));
    document.title = `${{home: 'Overview', collection: 'Collection', decks: 'Deck workshop', simulate: 'Simulator', buy: 'Buy planner', advisor: 'Advisor'}[view] || 'Overview'} · InkScan Portal`;
  }

  /* ---------- shared numbers ---------- */
  function collectionTotals(){
    let value = 0, unpriced = 0, copies = 0;
    for (const [id, v] of S().inv){ const r = D.ownedValue(id, v); value += r.value; unpriced += r.unpriced; copies += v.q + v.f + v.rf; }
    return {value, unpriced, copies, unique: S().inv.size};
  }
  // One value per day per game, kept in this browser, so the Collection page can show value over time from today on.
  function snapshotValue(){
    const key = `portal.value.${game}`, hist = D.lsGet(key, {}), t = collectionTotals();
    if (S().cat.byId.size) hist[today()] = Math.round(t.value * 100) / 100;
    D.lsSet(key, hist);
  }
  const allStats = () => S().decks.map(d => ({d, st: D.deckStats(d)}));

  /* ---------- Overview ---------- */
  function renderHome(v){
    const t = collectionTotals(), rows = allStats();
    const built = rows.filter(r => r.d.built).length, ready = rows.filter(r => !r.d.built && r.st.total && !r.st.missing && !r.st.unknown);
    const close = rows.filter(r => !r.d.built && r.st.missing && !r.st.unknown).sort((a, b) => a.st.missCost - b.st.missCost || a.st.missing - b.st.missing).slice(0, 8);
    v.innerHTML = `
      <header class="page-head"><div><h1 class="page-title">Overview</h1><p class="muted">${esc(gameDef().name)} · updated ${new Date(S().loadedAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}</p></div></header>
      <form class="ask" id="ask"><svg class="ic"><use href="#i-spark"/></svg><input id="askIn" placeholder="Ask the advisor: “What can I build from what I own?”" autocomplete="off"><button class="btn primary" type="submit">Ask</button></form>
      <div class="tiles">
        ${tile('Collection value', money(t.value), t.unpriced ? `${plural(t.unpriced, 'card')} unpriced` : 'Market prices')}
        ${tile('Cards owned', t.copies.toLocaleString(), `${t.unique.toLocaleString()} different printings`)}
        ${tile('Decks', rows.length.toLocaleString(), `${built} built`)}
        ${tile('Ready to build', ready.length.toLocaleString(), 'Unbuilt decks you have every card for')}
      </div>
      <div class="grid2">
        <section class="card"><h2 class="sec">Ready to build</h2>${ready.length ? `<ul class="rows">${ready.slice(0, 10).map(r => deckRow(r)).join('')}</ul>` : '<p class="muted">No unbuilt deck is fully covered by your collection yet.</p>'}</section>
        <section class="card"><h2 class="sec">Cheapest to finish</h2>${close.length ? `<ul class="rows">${close.map(r => deckRow(r, true)).join('')}</ul><a class="link" href="#buy">Plan the shopping in Buy planner</a>` : '<p class="muted">No decks are waiting on cards.</p>'}</section>
      </div>`;
    $('ask').onsubmit = e => { e.preventDefault(); const q = $('askIn').value.trim(); if (!q) return; pendingAsk = q; location.hash = 'advisor'; };
    wireDeckLinks(v);
  }
  const tile = (label, value, sub) => `<div class="tile"><div class="tile-l">${esc(label)}</div><div class="tile-v">${esc(value)}</div><div class="tile-s">${esc(sub)}</div></div>`;
  function deckRow({d, st}, cost){
    return `<li><button class="row-btn" data-open-deck="${esc(d.id)}" type="button">${dots(deckColors(d))}<span class="row-n">${esc(d.name)}</span><span class="row-m">${esc([formatLabel(d), `${st.total}/${st.size}`].filter(Boolean).join(' · '))}</span>${cost ? `<span class="row-v">${plural(st.missing, 'card')}${st.missCost ? ` · ${money(st.missCost)}` : ''}${st.missUnpriced ? ` · ${st.missUnpriced} unpriced` : ''}</span>` : ''}</button></li>`;
  }
  function wireDeckLinks(root){ for (const b of root.querySelectorAll('[data-open-deck]')) b.onclick = () => { workshop.id = b.dataset.openDeck; workshop.draft = null; location.hash = 'decks'; }; }

  /* ---------- Collection ---------- */
  const coll = {q: '', color: '', type: '', rarity: '', sort: 'value', shown: 200};
  function collectionRows(){
    const usedBy = new Map();
    for (const d of S().decks) for (const nv of Object.keys(d.cards)) (usedBy.get(nv) || usedBy.set(nv, []).get(nv)).push(d.name);
    const rows = [];
    for (const [id, v] of S().inv){
      const c = S().cat.byId.get(id); const n = v.q + v.f + v.rf; if (!n) continue;
      const val = D.ownedValue(id, v);
      rows.push({id, c, v, n, value: val.value, unpriced: val.unpriced, decks: c ? usedBy.get(c.nv) || [] : [], free: c ? D.freeNV(c.nv) : 0});
    }
    return rows;
  }
  function renderCollection(v){
    const all = collectionRows(), g = gameDef();
    const q = coll.q.toLowerCase();
    let rows = all.filter(r => r.c && (!q || `${cardName(r.c)} ${r.c.ty || ''} ${r.c.tx || ''}`.toLowerCase().includes(q))
      && (!coll.color || r.c.inks.includes(coll.color)) && (!coll.type || String(r.c.ty || '').includes(coll.type)) && (!coll.rarity || r.c.r === coll.rarity));
    const sorters = {value: (a, b) => b.value - a.value, name: (a, b) => cardName(a.c).localeCompare(cardName(b.c)), qty: (a, b) => b.n - a.n, set: (a, b) => String(a.c.s).localeCompare(String(b.c.s)) || (parseInt(a.c.c) || 0) - (parseInt(b.c.c) || 0)};
    rows.sort(sorters[coll.sort]);
    const unknown = all.filter(r => !r.c).length;
    const unused = all.filter(r => r.c && !r.decks.length), unusedValue = unused.reduce((s, r) => s + r.value, 0);
    const bait = all.filter(r => r.c && r.value / r.n >= 1 && r.free > 0 && !r.decks.length).sort((a, b) => b.value - a.value).slice(0, 12);
    v.innerHTML = `
      <header class="page-head"><div><h1 class="page-title">Collection</h1><p class="muted">${plural(all.reduce((s, r) => s + r.n, 0), 'card')} · ${money(all.reduce((s, r) => s + r.value, 0))}${unknown ? ` · ${plural(unknown, 'printing')} without card data` : ''}</p></div></header>
      <div class="grid3">
        <section class="card"><h2 class="sec">Value by set</h2><div id="chSets"></div></section>
        <section class="card"><h2 class="sec">Value by rarity</h2><div id="chRarity"></div></section>
        <section class="card"><h2 class="sec">Value over time</h2><div id="chHist"></div></section>
      </div>
      <div class="grid2">
        <section class="card"><h2 class="sec">Most valuable</h2><ol class="rank">${all.filter(r => r.c).sort((a, b) => b.value - a.value).slice(0, 10).map(r => `<li><span>${esc(cardName(r.c))}</span><span class="muted">${esc(String(r.c.s).toUpperCase())}${r.n > 1 ? ` ×${r.n}` : ''}</span><span class="num">${money(r.value)}</span></li>`).join('')}</ol></section>
        <section class="card"><h2 class="sec">Trade bait</h2><p class="muted small">Cards worth $1 or more that aren't in any deck. ${plural(unused.length, 'printing')} sit outside every deck, worth ${money(unusedValue)} in all.</p><ol class="rank">${bait.map(r => `<li><span>${esc(cardName(r.c))}</span><span class="muted">${r.free} free</span><span class="num">${money(r.value)}</span></li>`).join('') || '<li class="muted">Nothing over $1 sits unused.</li>'}</ol></section>
      </div>
      <section class="card">
        <div class="toolbar">
          <div class="search"><svg class="ic"><use href="#i-search"/></svg><input id="cq" placeholder="Search name, type or text" value="${esc(coll.q)}"></div>
          <select id="cColor"><option value="">All ${esc(g.colorWord.toLowerCase())}s</option>${g.colors.map(x => `<option ${coll.color === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
          <select id="cType"><option value="">All types</option>${g.types.map(x => `<option ${coll.type === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
          <select id="cRarity"><option value="">All rarities</option>${g.rarities.map(x => `<option value="${esc(x)}" ${coll.rarity === x ? 'selected' : ''}>${esc(g.rarityLabel(x))}</option>`).join('')}</select>
          <select id="cSort">${[['value', 'Value'], ['name', 'Name'], ['qty', 'Quantity'], ['set', 'Set']].map(([k, l]) => `<option value="${k}" ${coll.sort === k ? 'selected' : ''}>Sort: ${l}</option>`).join('')}</select>
        </div>
        <table class="tbl"><thead><tr><th>Card</th><th>Set</th><th>Rarity</th><th class="num">Qty</th><th class="num">Free</th><th class="num">Price</th><th class="num">Value</th><th>In decks</th></tr></thead>
        <tbody>${rows.slice(0, coll.shown).map(r => `<tr><td><div class="cell-card">${imgUrl(r.c) ? `<img loading="lazy" src="${esc(imgUrl(r.c))}" alt="">` : '<span class="thumb-ph"></span>'}<div><div class="cn">${esc(cardName(r.c))}</div><div class="cm">${esc(r.c.ty || '')}</div></div></div></td><td>${esc(String(r.c.s).toUpperCase())} #${esc(r.c.c)}</td><td>${esc(g.rarityLabel(r.c.r))}</td><td class="num">${[r.v.q ? String(r.v.q) : '', r.v.f ? `${r.v.f} foil` : '', r.v.rf ? `${r.v.rf} ${esc((g.finishes.rainbow || 'special').toLowerCase())}` : ''].filter(Boolean).join(' + ')}</td><td class="num">${r.free}</td><td class="num">${money(r.c.p ?? r.c.pf ?? null)}</td><td class="num">${money(r.value)}${r.unpriced ? '+' : ''}</td><td class="muted small">${esc(r.decks.slice(0, 2).join(', '))}${r.decks.length > 2 ? ` +${r.decks.length - 2}` : ''}</td></tr>`).join('')}</tbody></table>
        ${rows.length > coll.shown ? `<button class="btn ghost" id="cMore" type="button">Show ${Math.min(200, rows.length - coll.shown)} more of ${rows.length.toLocaleString()}</button>` : rows.length ? '' : '<p class="muted">No cards match.</p>'}
      </section>`;
    const bySet = new Map(); for (const r of all) if (r.c){ const k = String(r.c.s); bySet.set(k, (bySet.get(k) || 0) + r.value); }
    C.hbars($('chSets'), {rows: [...bySet].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, val]) => ({label: S().cat.sets.get(s) || s.toUpperCase(), value: val, color: C.token('--chart-1')})), format: money});
    const rar = g.rarities.map(r0 => [r0, all.filter(r => r.c?.r === r0).reduce((s, r) => s + r.value, 0)]).filter(x => x[1] > 0);
    C.bars($('chRarity'), {categories: rar.map(x => g.rarityLabel(x[0]).replace('Super rare', 'Super')), series: [{name: 'Value', color: C.token('--chart-1'), values: rar.map(x => x[1])}], format: v2 => '$' + Math.round(v2), height: 180, label: 'Collection value by rarity'});
    const hist = Object.entries(D.lsGet(`portal.value.${game}`, {})).sort();
    if (hist.length >= 2) C.line($('chHist'), {x: hist.map(x => x[0].slice(5)), series: [{name: 'Value', color: C.token('--chart-1'), values: hist.map(x => x[1])}], format: v2 => '$' + Math.round(v2), height: 180, xName: 'Date'});
    else $('chHist').innerHTML = `<p class="muted small">The portal saves today's value (${money(hist[0]?.[1] ?? 0)}) each day you open it. The line starts once there are two days.</p>`;
    const re = () => { coll.shown = 200; renderCollection(v); };
    $('cq').oninput = debounce(() => { coll.q = $('cq').value; re(); $('cq').focus(); $('cq').setSelectionRange(coll.q.length, coll.q.length); }, 200);
    $('cColor').onchange = () => { coll.color = $('cColor').value; re(); };
    $('cType').onchange = () => { coll.type = $('cType').value; re(); };
    $('cRarity').onchange = () => { coll.rarity = $('cRarity').value; re(); };
    $('cSort').onchange = () => { coll.sort = $('cSort').value; re(); };
    if ($('cMore')) $('cMore').onclick = () => { coll.shown += 200; renderCollection(v); };
  }
  function debounce(fn, ms){ let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  /* ---------- Deck workshop ---------- */
  const workshop = {id: null, draft: null, dirty: false, q: '', filter: 'all', compare: '', addQ: '', addResults: []};
  function curveOf(cards){
    const groups = game === 'lorcana' ? ['1', '2', '3', '4', '5', '6', '7+'] : ['0', '1', '2', '3', '4', '5', '6', '7+'];
    const vals = groups.map(() => 0);
    for (const [nv, q] of Object.entries(cards)){
      const c = S().cat.rep(nv); if (!c || c.co == null || /\bLand\b/.test(String(c.ty).split('//')[0])) continue;
      const i = Math.min(groups.length - 1, Math.max(0, Math.floor(c.co) - (game === 'lorcana' ? 1 : 0))); vals[i] += q;
    }
    return {groups, vals};
  }
  function typeCounts(cards){
    const m = new Map();
    for (const [nv, q] of Object.entries(cards)){ const c = S().cat.rep(nv); const t = c ? (gameDef().types.find(t0 => String(c.ty).split('//')[0].includes(t0)) || 'Other') : 'Loading'; m.set(t, (m.get(t) || 0) + q); }
    return [...m].sort((a, b) => b[1] - a[1]);
  }
  function colorCounts(cards){
    const m = new Map();
    for (const [nv, q] of Object.entries(cards)){ const c = S().cat.rep(nv); if (!c || /\bLand\b/.test(String(c.ty))) continue; for (const i of c.inks) m.set(i, (m.get(i) || 0) + q); }
    return [...m].sort((a, b) => b[1] - a[1]);
  }
  function renderDecks(v){
    const all = allStats(), q = workshop.q.toLowerCase();
    const list = all.filter(r => (!q || r.d.name.toLowerCase().includes(q)) && (workshop.filter === 'all' || (workshop.filter === 'built' && r.d.built) || (workshop.filter === 'ready' && !r.d.built && !r.st.missing && !r.st.unknown && r.st.total) || (workshop.filter === 'fav' && r.d.fav) || (workshop.filter === r.d.format)))
      .sort((a, b) => (b.d.fav - a.d.fav) || a.d.name.localeCompare(b.d.name, undefined, {numeric: true}));
    if (!workshop.id || !S().decks.some(d => d.id === workshop.id)) workshop.id = workshop.draft?.id && !workshop.draft.updated_at ? workshop.draft.id : list[0]?.d.id || null;
    const base = S().decks.find(d => d.id === workshop.id);
    if (!workshop.draft || workshop.draft.id !== workshop.id) { workshop.draft = base ? structuredClone(base) : workshop.draft; workshop.dirty = workshop.draft && !workshop.draft.updated_at; }
    const formats = game === 'mtg' ? Object.entries(gameDef().formats) : [];
    v.innerHTML = `
      <header class="page-head"><div><h1 class="page-title">Deck workshop</h1><p class="muted">${plural(all.length, 'deck')}</p></div><button class="btn" id="newDeck" type="button"><svg class="ic"><use href="#i-plus"/></svg>New deck</button></header>
      <div class="workshop">
        <aside class="card deck-list">
          <div class="search"><svg class="ic"><use href="#i-search"/></svg><input id="dq" placeholder="Search decks" value="${esc(workshop.q)}"></div>
          <select id="dFilter">${[['all', 'All decks'], ['ready', 'Ready to build'], ['built', 'Built'], ['fav', 'Favorites'], ...formats.map(([k, f]) => [k, f.label])].map(([k, l]) => `<option value="${k}" ${workshop.filter === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
          <ul class="dl">${list.map(({d, st}) => `<li><button type="button" class="dl-i ${d.id === workshop.id ? 'on' : ''}" data-id="${esc(d.id)}"><span class="dl-n">${esc(d.name)}</span><span class="dl-m">${dots(deckColors(d))}${esc([formatLabel(d), `${st.total}/${st.size}`].filter(Boolean).join(' · '))}${d.built ? ' · Built' : ''}</span><span class="meter"><i style="width:${Math.round(st.pct * 100)}%"></i></span></button></li>`).join('') || '<li class="muted small">No decks match.</li>'}</ul>
        </aside>
        <div id="deckPane" class="deck-pane"></div>
      </div>`;
    $('dq').oninput = debounce(() => { workshop.q = $('dq').value; renderDecks(v); $('dq').focus(); $('dq').setSelectionRange(workshop.q.length, workshop.q.length); }, 200);
    $('dFilter').onchange = () => { workshop.filter = $('dFilter').value; renderDecks(v); };
    for (const b of v.querySelectorAll('.dl-i')) b.onclick = () => { if (workshop.dirty && !confirm('Discard unsaved changes to this deck?')) return; workshop.id = b.dataset.id; workshop.draft = null; workshop.compare = ''; renderDecks(v); };
    $('newDeck').onclick = () => {
      if (workshop.dirty && !confirm('Discard unsaved changes to this deck?')) return;
      workshop.draft = {id: D.newId(), name: 'New deck', cards: {}, commanders: [], meta: {}, format: game === 'mtg' ? 'pauper' : null, built: false, fav: false};
      workshop.id = workshop.draft.id; workshop.dirty = true; renderDecks(v);
    };
    renderDeckPane($('deckPane'), v);
  }
  function renderDeckPane(p, v){
    const d = workshop.draft;
    if (!d){ p.innerHTML = '<div class="card empty"><h2>No decks yet</h2><p class="muted">Start one with New deck, or ask the advisor to build one from your collection.</p></div>'; return; }
    const st = D.deckStats(d), g = gameDef(), formats = game === 'mtg' ? Object.entries(g.formats) : [];
    const groups = (g.deckGroups || [['Cards', () => true]]);
    const grouped = groups.map(([label, test]) => [label, []]); const seen = new Set();
    const rows = st.rows.slice().sort((a, b) => (a.c?.co ?? 99) - (b.c?.co ?? 99) || nvName(a.nv).localeCompare(nvName(b.nv)));
    for (const r of rows){ if (r.commander){ continue; } const i = r.c ? groups.findIndex(([, test]) => test(r.c)) : -1; (grouped[i >= 0 ? i : grouped.length - 1] || grouped[0])[1].push(r); seen.add(r.nv); }
    const cmd = st.rows.filter(r => r.commander);
    const others = S().decks.filter(x => x.id !== d.id);
    p.innerHTML = `
      <section class="card">
        <div class="deck-head">
          <input id="dName" class="title-input" value="${esc(d.name)}" aria-label="Deck name">
          <div class="deck-actions">
            ${formats.length ? `<select id="dFormat">${formats.map(([k, f]) => `<option value="${k}" ${d.format === k ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select>` : ''}
            <label class="check"><input type="checkbox" id="dBuilt" ${d.built ? 'checked' : ''}> Built</label>
            <button class="btn" id="dCopy" type="button"><svg class="ic"><use href="#i-copy"/></svg>Copy list</button>
            <button class="btn primary" id="dSave" type="button" ${workshop.dirty ? '' : 'disabled'}>${d.updated_at ? 'Save changes' : 'Save deck'}</button>
          </div>
        </div>
        <div class="tiles">
          ${tile('Cards', `${st.total} / ${st.size}`, st.total === st.size ? 'Full deck' : st.total < st.size ? `${st.size - st.total} to add` : `${st.total - st.size} over`)}
          ${tile('Owned', pct(st.pct), st.unknown ? `${st.unknown} still loading` : st.missing ? `${plural(st.missing, 'card')} missing` : 'You own every card')}
          ${tile('To buy', money(st.missCost), st.missUnpriced ? `${st.missUnpriced} unpriced` : 'Cheapest printings')}
          ${tile(game === 'lorcana' ? 'Average ink cost' : 'Average mana value', avgCost(d.cards), game === 'lorcana' ? `${inkableCount(d.cards)} inkable` : `${landCount(d.cards)} lands`)}
        </div>
      </section>
      <div class="grid3">
        <section class="card"><h2 class="sec">${game === 'lorcana' ? 'Ink curve' : 'Mana curve'}</h2><div id="chCurve"></div></section>
        <section class="card"><h2 class="sec">${esc(g.colorWord)}s</h2><div id="chColors"></div></section>
        <section class="card"><h2 class="sec">Types</h2><div id="chTypes"></div></section>
      </div>
      <section class="card">
        <div class="toolbar">
          <div class="search grow"><svg class="ic"><use href="#i-search"/></svg><input id="addQ" placeholder="${game === 'mtg' ? 'Add a card: name or Scryfall search' : 'Add a card by name'}" value="${esc(workshop.addQ)}"></div>
          <label class="sr" for="cmpSel">Compare with</label>
          <select id="cmpSel"><option value="">Compare with…</option>${others.map(o => `<option value="${esc(o.id)}" ${workshop.compare === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
        </div>
        <div id="addRes" class="add-res"></div>
        <div id="cmp"></div>
        ${cmd.length ? `<h3 class="grp">Commander</h3>${cardTable(cmd)}` : ''}
        ${grouped.filter(([, r]) => r.length).map(([label, r]) => `<h3 class="grp">${esc(label)} <span class="muted">${r.reduce((s, x) => s + x.q, 0)}</span></h3>${cardTable(r)}`).join('')}
        ${st.rows.length ? '' : '<p class="muted">This deck is empty. Add cards with the search above.</p>'}
      </section>
      ${d.guide?.overview ? `<section class="card"><h2 class="sec">How it plays</h2><p>${esc(d.guide.overview)}</p>${d.guide.tip ? `<p class="muted">${esc(d.guide.tip)}</p>` : ''}</section>` : ''}`;
    const cv = curveOf(d.cards);
    C.bars($('chCurve'), {categories: cv.groups, series: [{name: 'Cards', color: C.token('--chart-1'), values: cv.vals}], format: x => String(Math.round(x)), height: 170, label: 'Curve'});
    const cc = colorCounts(d.cards);
    C.hbars($('chColors'), {rows: cc.map(([k, n]) => ({label: k, value: n, color: colorVar(k)})), format: x => String(x)});
    C.hbars($('chTypes'), {rows: typeCounts(d.cards).map(([k, n]) => ({label: k, value: n, color: C.token('--chart-1')})), format: x => String(x)});
    const mark = () => { workshop.dirty = true; renderDeckPane(p, v); };
    $('dName').onchange = () => { d.name = $('dName').value.trim() || d.name; workshop.dirty = true; $('dSave').disabled = false; };
    if ($('dFormat')) $('dFormat').onchange = () => { d.format = $('dFormat').value; mark(); };
    $('dBuilt').onchange = () => { d.built = $('dBuilt').checked; mark(); };
    $('dCopy').onclick = async () => { const text = Object.entries(d.cards).map(([nv, q]) => `${q} ${nvName(nv)}`).join('\n'); try { await navigator.clipboard.writeText(text); toast('List copied.'); } catch(e){ toast('Copy failed. Select the list and copy it.'); } };
    $('dSave').onclick = async () => {
      $('dSave').disabled = true; $('dSave').textContent = 'Saving…';
      try { const saved = await D.saveDeck(d); workshop.id = saved.id; workshop.draft = structuredClone(saved); workshop.dirty = false; toast('Saved. Tap Update in the phone app to bring it over.'); renderDecks(v); }
      catch(err){ toast(err.message); $('dSave').disabled = false; $('dSave').textContent = 'Save changes'; }
    };
    for (const b of p.querySelectorAll('[data-qty]')) b.onclick = () => {
      const nv = b.dataset.nv, n = (d.cards[nv] || 0) + (+b.dataset.qty);
      if (n <= 0){ delete d.cards[nv]; d.commanders = d.commanders.filter(x => x !== nv); } else d.cards[nv] = n;
      mark();
    };
    const runAdd = debounce(async () => {
      const q = workshop.addQ.trim(); if (q.length < 2){ $('addRes').innerHTML = ''; return; }
      $('addRes').innerHTML = '<p class="muted small">Searching…</p>';
      try {
        const r = await D.searchCards(game, q, 12);
        if (workshop.addQ.trim() !== q) return;
        $('addRes').innerHTML = r.cards.length ? r.cards.map(c => `<button type="button" class="chip-btn" data-add="${esc(c.nv)}"><svg class="ic"><use href="#i-plus"/></svg>${esc(cardName(c))}<span class="muted">${D.ownedNV(c.nv) ? ` · own ${D.ownedNV(c.nv)}` : ''}</span></button>`).join('') : '<p class="muted small">No cards found.</p>';
        for (const b of $('addRes').querySelectorAll('[data-add]')) b.onclick = () => { d.cards[b.dataset.add] = (d.cards[b.dataset.add] || 0) + 1; workshop.dirty = true; renderDeckPane(p, v); };
      } catch(err){ $('addRes').innerHTML = `<p class="muted small">${esc(err.message)}</p>`; }
    }, 350);
    $('addQ').oninput = () => { workshop.addQ = $('addQ').value; runAdd(); };
    if (workshop.addQ) runAdd();
    $('cmpSel').onchange = () => { workshop.compare = $('cmpSel').value; renderCompare(d); };
    renderCompare(d);
  }
  function cardTable(rows){
    return `<table class="tbl compact fixed"><colgroup><col style="width:48px"><col><col style="width:20%"><col style="width:88px"><col style="width:64px"><col style="width:80px"><col style="width:88px"></colgroup><thead><tr><th class="num">Qty</th><th>Card</th><th>Cost</th><th class="num">Own</th><th class="num">Need</th><th class="num">Price</th><th></th></tr></thead><tbody>${rows.map(r => `<tr class="${r.need ? 'needs' : ''}">
      <td class="num">${r.q}</td><td><span class="cn">${esc(nvName(r.nv))}</span>${r.c ? '' : ' <span class="muted small">loading</span>'}</td>
      <td class="muted">${esc(r.c ? (game === 'mtg' ? r.c.mc || '' : r.c.co ?? '') : '')}</td>
      <td class="num">${r.free}${r.owned > r.free ? `<span class="muted small"> of ${r.owned}</span>` : ''}</td><td class="num">${r.need ? `<span class="need">${r.need}</span>` : '<span class="ok-t">✓</span>'}</td>
      <td class="num">${money(r.price)}</td>
      <td class="qty-btns"><button type="button" class="icon-btn" data-qty="-1" data-nv="${esc(r.nv)}" aria-label="One fewer ${esc(nvName(r.nv))}"><svg class="ic"><use href="#i-minus"/></svg></button><button type="button" class="icon-btn" data-qty="1" data-nv="${esc(r.nv)}" aria-label="One more ${esc(nvName(r.nv))}"><svg class="ic"><use href="#i-plus"/></svg></button></td></tr>`).join('')}</tbody></table>`;
  }
  function renderCompare(d){
    const host = $('cmp'); if (!host) return;
    const o = S().decks.find(x => x.id === workshop.compare);
    if (!o){ host.innerHTML = ''; return; }
    const keys = [...new Set([...Object.keys(d.cards), ...Object.keys(o.cards)])].sort((a, b) => nvName(a).localeCompare(nvName(b)));
    const onlyA = keys.filter(k => d.cards[k] && !o.cards[k]), onlyB = keys.filter(k => o.cards[k] && !d.cards[k]), both = keys.filter(k => d.cards[k] && o.cards[k]);
    const a = D.deckStats(d), b = D.deckStats(o), ca = curveOf(d.cards), cb = curveOf(o.cards);
    host.innerHTML = `<div class="compare">
      <h3 class="grp">Compared with ${esc(o.name)}</h3>
      <table class="tbl compact"><thead><tr><th></th><th class="num">${esc(d.name)}</th><th class="num">${esc(o.name)}</th></tr></thead><tbody>
        <tr><td>Cards</td><td class="num">${a.total}</td><td class="num">${b.total}</td></tr>
        <tr><td>Owned</td><td class="num">${pct(a.pct)}</td><td class="num">${pct(b.pct)}</td></tr>
        <tr><td>To buy</td><td class="num">${money(a.missCost)}</td><td class="num">${money(b.missCost)}</td></tr>
        <tr><td>${game === 'lorcana' ? 'Average ink cost' : 'Average mana value'}</td><td class="num">${avgCost(d.cards)}</td><td class="num">${avgCost(o.cards)}</td></tr>
      </tbody></table>
      <div id="cmpCurve"></div>
      <div class="grid3 tight">
        <div><h4 class="mini">Only in ${esc(d.name)} (${onlyA.length})</h4><ul class="plain">${onlyA.map(k => `<li>${d.cards[k]} ${esc(nvName(k))}</li>`).join('')}</ul></div>
        <div><h4 class="mini">In both (${both.length})</h4><ul class="plain">${both.map(k => `<li>${d.cards[k]}${d.cards[k] !== o.cards[k] ? `/${o.cards[k]}` : ''} ${esc(nvName(k))}</li>`).join('')}</ul></div>
        <div><h4 class="mini">Only in ${esc(o.name)} (${onlyB.length})</h4><ul class="plain">${onlyB.map(k => `<li>${o.cards[k]} ${esc(nvName(k))}</li>`).join('')}</ul></div>
      </div></div>`;
    C.bars($('cmpCurve'), {categories: ca.groups, series: [{name: d.name, color: C.token('--chart-1'), values: ca.vals}, {name: o.name, color: C.token('--chart-2'), values: cb.vals}], format: x => String(Math.round(x)), height: 170, label: 'Curve comparison'});
  }
  function avgCost(cards){ let n = 0, s = 0; for (const [nv, q] of Object.entries(cards)){ const c = S().cat.rep(nv); if (!c || c.co == null || /\bLand\b/.test(String(c.ty).split('//')[0])) continue; n += q; s += q * c.co; } return n ? (s / n).toFixed(2) : '—'; }
  const landCount = cards => Object.entries(cards).reduce((s, [nv, q]) => s + (/\bLand\b/.test(String(S().cat.rep(nv)?.ty || '').split('//')[0]) ? q : 0), 0);
  const inkableCount = cards => Object.entries(cards).reduce((s, [nv, q]) => s + (S().cat.rep(nv)?.ik ? q : 0), 0);

  /* ---------- Simulator ---------- */
  const sim = {deck: null, mode: 'opening', onPlay: true, keys: [], turns: 10, oddsKeys: [], oddsNeed: 1, result: null, running: false};
  function simDeck(d){ return Object.entries(d.cards).map(([nv, q]) => ({card: S().cat.rep(nv), qty: q, key: nv})).filter(x => x.card); }
  function renderSim(v){
    const decks = S().decks.slice().sort((a, b) => (b.fav - a.fav) || a.name.localeCompare(b.name, undefined, {numeric: true}));
    if (!sim.deck || !decks.some(d => d.id === sim.deck)) sim.deck = workshop.id && decks.some(d => d.id === workshop.id) ? workshop.id : decks[0]?.id;
    const d = decks.find(x => x.id === sim.deck);
    const supported = game === 'mtg' || game === 'lorcana';
    if (!supported && sim.mode === 'goldfish') sim.mode = 'opening';
    const names = d ? Object.keys(d.cards).filter(nv => S().cat.rep(nv) && !/\bBasic\b/.test(S().cat.rep(nv).ty)).sort((a, b) => nvName(a).localeCompare(nvName(b))) : [];
    v.innerHTML = `
      <header class="page-head"><div><h1 class="page-title">Simulator</h1><p class="muted">Thousands of shuffles of a deck, so you can see how it really draws.</p></div></header>
      <section class="card">
        <div class="toolbar">
          <label class="field"><span>Deck</span><select id="sDeck">${decks.map(x => `<option value="${esc(x.id)}" ${x.id === sim.deck ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
          <div class="seg" role="tablist">${[['opening', 'Opening hands'], ['goldfish', game === 'lorcana' ? 'Lore race' : 'Goldfish'], ['odds', 'Draw odds']].filter(([k]) => supported || k !== 'goldfish').map(([k, l]) => `<button type="button" role="tab" aria-selected="${sim.mode === k}" data-mode="${k}">${l}</button>`).join('')}</div>
          <label class="check"><input type="checkbox" id="sPlay" ${sim.onPlay ? 'checked' : ''}> On the play</label>
        </div>
        <div class="sim-opts">
          ${sim.mode === 'goldfish' ? `<label class="field"><span>Track up to 4 key cards (Ctrl or ⌘ click to pick several)</span><select id="sKeys" multiple size="6">${names.map(nv => `<option value="${esc(nv)}" ${sim.keys.includes(nv) ? 'selected' : ''}>${esc(nvName(nv))}</option>`).join('')}</select></label><label class="field"><span>Turns</span><input id="sTurns" type="number" min="4" max="15" value="${sim.turns}"></label>` : ''}
          ${sim.mode === 'odds' ? `<label class="field"><span>Cards you need, all of them (Ctrl or ⌘ click to pick several)</span><select id="sOdds" multiple size="6">${names.map(nv => `<option value="${esc(nv)}" ${sim.oddsKeys.includes(nv) ? 'selected' : ''}>${esc(nvName(nv))} (${d.cards[nv]})</option>`).join('')}</select></label><label class="field"><span>Copies of each, at least</span><input id="sNeed" type="number" min="1" max="4" value="${sim.oddsNeed}"></label>` : ''}
          <button class="btn primary" id="sRun" type="button" ${d ? '' : 'disabled'}>${sim.running ? 'Running…' : 'Run simulation'}</button>
        </div>
      </section>
      <div id="sOut"></div>
      <section class="card"><h2 class="sec">How the model works</h2><ul class="plain small muted">${[...((InkSim.ASSUMPTIONS || {}).general || []), ...((InkSim.ASSUMPTIONS || {})[game] || (InkSim.ASSUMPTIONS || {}).other || [])].map(a => `<li>${esc(a)}</li>`).join('')}</ul></section>`;
    $('sDeck').onchange = () => { sim.deck = $('sDeck').value; sim.keys = []; sim.oddsKeys = []; sim.result = null; renderSim(v); };
    for (const b of v.querySelectorAll('[data-mode]')) b.onclick = () => { sim.mode = b.dataset.mode; sim.result = null; renderSim(v); };
    $('sPlay').onchange = () => { sim.onPlay = $('sPlay').checked; };
    if ($('sKeys')) $('sKeys').onchange = () => { sim.keys = [...$('sKeys').selectedOptions].map(o => o.value).slice(0, 4); };
    if ($('sTurns')) $('sTurns').onchange = () => { sim.turns = Math.max(4, Math.min(15, +$('sTurns').value || 10)); };
    if ($('sOdds')) $('sOdds').onchange = () => { sim.oddsKeys = [...$('sOdds').selectedOptions].map(o => o.value).slice(0, 4); };
    if ($('sNeed')) $('sNeed').onchange = () => { sim.oddsNeed = Math.max(1, Math.min(4, +$('sNeed').value || 1)); };
    $('sRun').onclick = () => {
      if (!d) return; sim.running = true; $('sRun').textContent = 'Running…'; $('sRun').disabled = true;
      setTimeout(() => {
        try { sim.result = runSim(d, sim); }
        catch(err){ sim.result = {error: err.message}; }
        sim.running = false; renderSim(v);
      }, 30);
    };
    if (sim.result && sim.result.deck === sim.deck && sim.result.mode === sim.mode) showSim($('sOut'), sim.result, d);
  }
  function runSim(d, o){
    const deck = simDeck(d), g = game, onPlay = o.onPlay, seed = Date.now() % 1e9;
    if (o.mode === 'opening') return {mode: 'opening', deck: d.id, r: InkSim.openingHands(deck, {game: g, onPlay, seed, handSize: gameDef().deck.handSize})};
    if (o.mode === 'goldfish') return {mode: 'goldfish', deck: d.id, r: InkSim.goldfish(deck, {game: g, onPlay, seed, turns: o.turns, keyCards: o.keys.map(nv => S().cat.rep(nv)?.n).filter(Boolean), life: d.commanders.length || d.format === 'commander' ? 40 : 20})};
    const keys = o.oddsKeys.length ? o.oddsKeys : [];
    if (!keys.length) throw Error('Pick at least one card to draw.');
    const handSize = gameDef().deck.handSize, total = Object.values(d.cards).reduce((s, q) => s + q, 0);
    if (keys.length === 1) return {mode: 'odds', deck: d.id, single: true, label: nvName(keys[0]), r: InkSim.drawOdds({deckSize: total, copies: d.cards[keys[0]], handSize, onPlay, turns: 10, atLeast: o.oddsNeed})};
    return {mode: 'odds', deck: d.id, label: keys.map(nvName).join(' + '), r: InkSim.comboOdds(Object.entries(d.cards).map(([key, qty]) => ({key, qty})), keys.map(k => ({label: nvName(k), keys: [k], need: o.oddsNeed})), {turns: 10, handSize, onPlay, seed})};
  }
  function showSim(host, res, d){
    if (res.error){ host.innerHTML = `<section class="card"><p class="bad-t">${esc(res.error)}</p></section>`; return; }
    const r = res.r, c1 = C.token('--chart-1');
    if (res.mode === 'opening'){
      if (game === 'mtg'){
        host.innerHTML = `<section class="card"><div class="tiles">
          ${tile('Keep 7', pct(r.keepRate7), '2 to 5 lands')}${tile('Average lands', (r.avgLands ?? 0).toFixed(2), 'in the first 7')}
          ${tile('Mulligan to 5 or fewer', pct((r.mulliganTo?.[5] || 0) + (r.mulliganTo?.['4-'] || 0)), 'London mulligan')}${tile('Color trouble', pct(r.colorScrew), 'kept hands that can\'t cast a 1–2 drop by turn 2')}</div></section>
          <div class="grid2"><section class="card"><h2 class="sec">Lands in the opening 7</h2><div id="o1"></div></section><section class="card"><h2 class="sec">Final hand size</h2><div id="o2"></div></section></div>
          ${samples(r.sampleHands)}`;
        C.bars($('o1'), {categories: (r.landDist || []).map((_, i) => String(i)), series: [{name: 'Hands', color: c1, values: r.landDist || []}], format: pct, height: 190});
        const m = r.mulliganTo || {}; C.bars($('o2'), {categories: ['7', '6', '5', '4 or fewer'], series: [{name: 'Hands', color: c1, values: [m[7] || 0, m[6] || 0, m[5] || 0, m['4-'] || 0]}], format: pct, height: 190});
      } else if (game === 'lorcana'){
        host.innerHTML = `<section class="card"><div class="tiles">
          ${tile('Keep without mulligan', pct(r.keepRate), '3+ inkable, 2+ cheap')}${tile('Average inkable', (r.avgInkable ?? 0).toFixed(2), 'in the first 7')}
          ${tile('1-drop on turn 1', pct(r.pOneDropByT1), '')}${tile('3-drop on turn 3', pct(r.pThreeDropByT3 ?? r.pThreeByT3), '')}</div></section>
          <section class="card"><h2 class="sec">Inkable cards in the opening 7</h2><div id="o1"></div></section>${samples(r.sampleHands)}`;
        C.bars($('o1'), {categories: (r.inkableDist || []).map((_, i) => String(i)), series: [{name: 'Hands', color: c1, values: r.inkableDist || []}], format: pct, height: 190});
      } else {
        host.innerHTML = `<section class="card"><h2 class="sec">Card types in the opening hand (average)</h2><div id="o1"></div></section>${samples(r.sampleHands)}`;
        C.hbars($('o1'), {rows: Object.entries(r.typeDist || {}).map(([k, val]) => ({label: k, value: typeof val === 'number' ? val : val.avg ?? 0, color: c1})), format: x => x.toFixed(2)});
      }
      return;
    }
    if (res.mode === 'goldfish'){
      const T = Math.max(1, ((r.landDropRate || r.inkDropRate || []).length || sim.turns + 1) - 1), x = Array.from({length: T}, (_, i) => String(i + 1));
      const win = game === 'lorcana' ? r.winTurnDist : r.killTurnDist, med = game === 'lorcana' ? r.medianWinTurn : r.medianKillTurn, avg = game === 'lorcana' ? r.avgWinTurn : r.avgKillTurn;
      const never = win?.never || 0;
      host.innerHTML = `<section class="card"><div class="tiles">
        ${tile(game === 'lorcana' ? 'Median turn to 20 lore' : 'Median kill turn', med == null ? '—' : `Turn ${med}`, avg ? `average ${avg.toFixed(1)}` : '')}
        ${tile(`Done by turn ${T}`, pct(1 - never), 'with no opponent')}
        ${tile(game === 'lorcana' ? 'Ink drop on turn 4' : 'Land drop on turn 4', pct((r.landDropRate || r.inkDropRate || [])[4]), 'had one to play that turn')}
        ${tile(game === 'lorcana' ? 'Lore by turn 5' : 'Damage by turn 5', ((game === 'lorcana' ? r.loreByTurn : r.avgDamageByTurn) || [])[5]?.toFixed(1) ?? '—', 'average')}</div></section>
        <div class="grid2"><section class="card"><h2 class="sec">${game === 'lorcana' ? 'Turn you reach 20 lore' : 'Kill turn'}</h2><div id="g1"></div></section>
        <section class="card"><h2 class="sec">${game === 'lorcana' ? 'Lore by turn (average)' : 'Damage by turn (average)'}</h2><div id="g2"></div></section></div>
        ${Object.keys(r.castBy || {}).length ? `<section class="card"><h2 class="sec">Key cards on the table by turn</h2><table class="tbl compact"><thead><tr><th>Card</th>${x.map(t => `<th class="num">T${t}</th>`).join('')}</tr></thead><tbody>${Object.entries(r.castBy).map(([n, arr]) => `<tr><td>${esc(n)}</td>${x.map((_, i) => `<td class="num">${pct(arr[i + 1] ?? 0)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>` : ''}`;
      const wd = Object.entries(win || {}).filter(([k]) => k !== 'never').sort((a, b) => +a[0] - +b[0]);
      C.bars($('g1'), {categories: [...wd.map(([k]) => 'T' + k), 'Later'], series: [{name: 'Games', color: c1, values: [...wd.map(([, p]) => p), never]}], format: pct, height: 190});
      const series = (game === 'lorcana' ? r.loreByTurn : r.avgDamageByTurn) || [];
      C.line($('g2'), {x, series: [{name: game === 'lorcana' ? 'Lore' : 'Damage', color: c1, values: x.map((_, i) => series[i + 1] ?? 0)}], format: n => n.toFixed(1), height: 190, xName: 'Turn'});
      return;
    }
    const pts = Array.isArray(r) ? r : r.points || [];
    host.innerHTML = `<section class="card"><h2 class="sec">Chance to have ${esc(res.label)}${sim.oddsNeed > 1 ? ` (${sim.oddsNeed}+ of each)` : ''} by turn</h2><div id="d1"></div>
      <table class="tbl compact"><thead><tr><th>Turn</th>${pts.map(p => `<th class="num">${p.turn}</th>`).join('')}</tr></thead><tbody><tr><td>Chance</td>${pts.map(p => `<td class="num">${pct(p.p)}</td>`).join('')}</tr></tbody></table></section>`;
    C.line($('d1'), {x: pts.map(p => String(p.turn)), series: [{name: 'Chance', color: c1, values: pts.map(p => p.p)}], format: pct, max: 1, height: 200, xName: 'Turn'});
  }
  const samples = hands => hands?.length ? `<section class="card"><h2 class="sec">Sample opening hands</h2><ol class="hands">${hands.slice(0, 5).map(hd => `<li>${hd.map(n => `<span class="hand-card">${esc(n)}</span>`).join('')}</li>`).join('')}</ol></section>` : '';

  /* ---------- Buy planner ---------- */
  const buy = {sel: new Set(D.lsGet('portal.buy.' + game, [])), shared: false};
  function buyPlan(ids, shared){
    const need = new Map();
    const chosen = S().decks.filter(d => ids.includes(d.id));
    for (const d of chosen) for (const [nv, q] of Object.entries(d.cards)){
      const e = need.get(nv) || {nv, want: 0, decks: []}; e.want = shared ? Math.max(e.want, q) : e.want + q; e.decks.push(d.name); need.set(nv, e);
    }
    const rows = [];
    for (const e of need.values()){
      const free = D.freeNV(e.nv), qty = Math.max(0, e.want - free); if (!qty) continue;
      const price = D.cheapest(e.nv); rows.push({...e, free, qty, price, line: price == null ? null : price * qty});
    }
    rows.sort((a, b) => (b.line ?? -1) - (a.line ?? -1));
    return {rows, total: rows.reduce((s, r) => s + (r.line || 0), 0), unpriced: rows.filter(r => r.price == null).reduce((s, r) => s + r.qty, 0), cards: rows.reduce((s, r) => s + r.qty, 0)};
  }
  function renderBuy(v){
    const all = allStats().filter(r => !r.d.built).sort((a, b) => a.st.missCost - b.st.missCost);
    for (const id of [...buy.sel]) if (!all.some(r => r.d.id === id)) buy.sel.delete(id);
    const plan = buyPlan([...buy.sel], buy.shared);
    v.innerHTML = `
      <header class="page-head"><div><h1 class="page-title">Buy planner</h1><p class="muted">Pick the decks you want to finish. Cards you already own, and cards shared between decks, are counted once.</p></div></header>
      <div class="buy">
        <section class="card buy-decks"><h2 class="sec">Decks to finish</h2>
          <label class="check"><input type="checkbox" id="bShared" ${buy.shared ? 'checked' : ''}> Build one at a time (share copies between these decks)</label>
          <ul class="plain checks">${all.map(({d, st}) => `<li><label class="check row"><input type="checkbox" data-buy="${esc(d.id)}" ${buy.sel.has(d.id) ? 'checked' : ''}><span class="grow">${esc(d.name)}</span><span class="muted small">${st.unknown ? 'loading' : st.missing ? `${st.missing} · ${money(st.missCost)}` : 'ready'}</span></label></li>`).join('')}</ul>
        </section>
        <section class="card">
          <div class="buy-head"><div>${tile('Shopping list', money(plan.total), `${plural(plan.cards, 'card')}${plan.unpriced ? ` · ${plan.unpriced} unpriced` : ''}`)}</div>
            <div class="deck-actions"><button class="btn primary" id="bCopy" type="button" ${plan.rows.length ? '' : 'disabled'}><svg class="ic"><use href="#i-copy"/></svg>Copy for TCGplayer</button><a class="btn" href="https://www.tcgplayer.com/massentry" target="_blank" rel="noopener">Open Mass Entry</a></div></div>
          ${plan.rows.length ? `<table class="tbl compact"><thead><tr><th class="num">Buy</th><th>Card</th><th class="num">Own free</th><th class="num">Each</th><th class="num">Total</th><th>For</th></tr></thead><tbody>${plan.rows.map(r => `<tr><td class="num">${r.qty}</td><td>${esc(nvName(r.nv))}</td><td class="num">${r.free}</td><td class="num">${money(r.price)}</td><td class="num">${money(r.line)}</td><td class="muted small">${esc(r.decks.slice(0, 3).join(', '))}${r.decks.length > 3 ? ` +${r.decks.length - 3}` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Tick one or more decks to build a shopping list.</p>'}
        </section>
      </div>
      <section class="card"><h2 class="sec">Cheapest decks to finish</h2><div id="bRank"></div></section>`;
    for (const b of v.querySelectorAll('[data-buy]')) b.onchange = () => { if (b.checked) buy.sel.add(b.dataset.buy); else buy.sel.delete(b.dataset.buy); D.lsSet('portal.buy.' + game, [...buy.sel]); renderBuy(v); };
    $('bShared').onchange = () => { buy.shared = $('bShared').checked; renderBuy(v); };
    $('bCopy').onclick = async () => { const text = plan.rows.map(r => `${r.qty} ${nvName(r.nv).split(' // ')[0]}`).join('\n'); try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into TCGplayer Mass Entry.'); } catch(e){ toast('Copy failed.'); } };
    C.hbars($('bRank'), {rows: all.filter(r => r.st.missing && !r.st.unknown).slice(0, 12).map(r => ({label: r.d.name, sub: `${r.st.missing} cards`, value: r.st.missCost, color: C.token('--chart-1')})), format: money});
  }

  /* ---------- Advisor ---------- */
  let pendingAsk = '';
  function renderAdvisor(v){
    PortalAdvisor.mount(v, {game, gameDef, nvName, cardName, toast, buyPlan, runSim: (d, opts) => runSim(d, opts), simDeck,
      onDeckSaved: d => { workshop.id = d.id; workshop.draft = null; }});
    if (pendingAsk){ const q = pendingAsk; pendingAsk = ''; PortalAdvisor.ask(q); }
  }

  boot();
})();
