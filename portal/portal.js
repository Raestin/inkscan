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

  /* ---------- Card viewer: hover a card to see it large with its stats, click to open it ---------- */
  const cardReg = new Map();
  const cardAttr = (c, peekOnly) => { if (!c) return ''; cardReg.set(String(c.id), c); return ` data-${peekOnly ? 'peek' : 'card'}="${esc(c.id)}"`; };
  const findCard = id => cardReg.get(id) || S().cat?.byId.get(id) || null;
  const pips = s => esc(s).replace(/\{([^}]+)\}/g, (_, x) => `<i class="pip pip-${x.replace(/[^A-Za-z0-9]/g, '').toLowerCase()}">${x}</i>`);
  const rulesHTML = t => String(t || '').split(/\n+/).filter(Boolean).map(l => `<p>${pips(l)}</p>`).join('');
  function cardStats(c){
    const rows = game === 'lorcana' ? [['Cost', c.co], ['Inkable', c.ik == null ? null : c.ik ? 'Yes' : 'No'], ['Strength', c.st], ['Willpower', c.wp], ['Lore', c.lo], ['Move', c.mv]] : gameDef().stats ? gameDef().stats(c) : [];
    const land = /\bLand\b/.test(c.ty || '');
    return rows.filter(x => x[1] != null && x[1] !== '' && !(land && x[0] === 'Mana value'));
  }
  const typeLine = c => [game === 'lorcana' ? c.i : '', String(c.ty || '').replace(/\//g, ' · '), c.cl ? String(c.cl).replace(/\//g, ' · ') : ''].filter(Boolean).join(' · ');
  function ownLine(c){
    const v = S().inv.get(c.id) || {q: 0, f: 0, rf: 0}, here = v.q + v.f + v.rf, all = D.ownedNV(c.nv), free = D.freeNV(c.nv);
    if (!all) return 'You don’t own this card';
    return `You own ${all}${here && here !== all ? ` (${here} of this printing)` : ''} · ${free} free`;
  }
  /* ---------- family: who has which copies ---------- */
  const fam = () => S().family, famPerson = id => fam()?.people.find(p => p.id === id), famName = id => famPerson(id)?.name || 'Someone';
  const finWords = v => [[v.q, 'normal'], [v.f, 'foil'], [v.rf, 'rainbow foil']].filter(x => x[0]).map(x => `${x[0]} ${x[1]}`).join(', ');
  const ptag = (p, n, full) => p ? `<span class="ptag p${p.slot}" title="${esc(p.name)}">${esc(full ? p.name : p.initials)}${n ? `<b>${n}</b>` : ''}</span>` : '';
  // On card art a tag only appears when someone other than the family owner has a copy; lists always name everyone.
  function ptags(id, full){
    if (!fam()) return '';
    const sh = D.shares(id), who = fam().people.filter(p => sh[p.id]);
    if (!who.length || (!full && who.length === 1 && who[0].owner)) return '';
    return `<span class="ptags${full ? '' : ' on-art'}">${who.map(p => ptag(p, InkFamily.count(sh[p.id]), full)).join('')}</span>`;
  }
  const cvMove = {id: null, from: '', to: '', fin: 'q'};
  function cvMoveHTML(c){
    if (!fam()) return '';
    const sh = D.shares(c.id), holders = fam().people.filter(p => sh[p.id]);
    if (!holders.length) return '';
    if (cvMove.id !== c.id || !sh[cvMove.from]){ cvMove.id = c.id; cvMove.from = (holders.find(p => p.id !== fam().me) || holders[0]).id; cvMove.to = ''; }
    const others = fam().people.filter(p => p.id !== cvMove.from);
    if (!others.some(p => p.id === cvMove.to)) cvMove.to = (others.find(p => p.id === fam().me) || others[0]).id;
    const fins = InkFamily.FIN.filter(k => sh[cvMove.from][k]); if (!fins.includes(cvMove.fin)) cvMove.fin = fins[0];
    const max = sh[cvMove.from][cvMove.fin], label = {q: 'Normal', f: 'Foil', rf: 'Rainbow foil'};
    const opt = (list, cur) => list.map(p => `<option value="${esc(p.id)}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    return `<div class="cv-move"><span class="mini">Move copies</span><div class="cv-move-row">
      <label class="field"><span>From</span><select id="cvmFrom">${opt(holders, cvMove.from)}</select></label>
      <label class="field"><span>To</span><select id="cvmTo">${opt(others, cvMove.to)}</select></label>
      ${fins.length > 1 ? `<label class="field"><span>Finish</span><select id="cvFin">${fins.map(k => `<option value="${k}" ${k === cvMove.fin ? 'selected' : ''}>${label[k]}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>Copies</span><select id="cvN">${Array.from({length: max}, (_, i) => `<option>${i + 1}</option>`).join('')}</select></label>
      <button class="btn" id="cvGo" type="button">Move</button></div><p class="muted small" id="cvMsg" role="status"></p></div>`;
  }
  function cvMoveWire(c){
    if (!$('cvGo')) return;
    $('cvmFrom').onchange = () => { cvMove.from = $('cvmFrom').value; cvShow(c.id); };
    $('cvmTo').onchange = () => { cvMove.to = $('cvmTo').value; };
    if ($('cvFin')) $('cvFin').onchange = () => { cvMove.fin = $('cvFin').value; cvShow(c.id); };
    $('cvGo').onclick = async () => {
      const n = +$('cvN').value, to = cvMove.to;
      $('cvGo').disabled = true; $('cvMsg').textContent = 'Moving…';
      try {
        const moved = await D.transfer([{c: c.id, from: cvMove.from, to, q: cvMove.fin === 'q' ? n : 0, f: cvMove.fin === 'f' ? n : 0, r: cvMove.fin === 'rf' ? n : 0}]);
        toast(moved ? `Moved ${moved} to ${famName(to)}` : 'Nothing moved. Those copies had already changed hands.');
        const keepRun = cvRun, keepFrom = cvFrom; render(); cvRun = keepRun; cvFrom = keepFrom; cvShow(c.id);
      } catch(err){ $('cvGo').disabled = false; $('cvMsg').textContent = err.message || 'That move did not work. Try again.'; }
    };
  }
  function famMovesHTML(limit){
    const groups = [];
    for (const m of [...fam().moves].sort((a, b) => String(b.at).localeCompare(String(a.at)))){
      const n = (m.q || 0) + (m.f || 0) + (m.r || 0), key = m.deck ? [m.deck, m.at, m.from, m.to].join('|') : null, g = key && groups.find(x => x.key === key);
      if (g) g.n += n; else groups.push({key, n, m});
    }
    return groups.slice(0, limit).map(({n, m}) => { const c = S().cat.byId.get(m.c);
      return `<li><span class="row-n">${esc(famName(m.from))} to ${esc(famName(m.to))}</span><span class="row-m">${m.deck ? `${esc(m.deck)} (${plural(n, 'card')})` : `${n}× ${esc(c ? cardName(c) : 'a card')}`}</span><span class="row-v">${esc(new Date(m.at).toLocaleDateString([], {month: 'short', day: 'numeric'}))}</span></li>`; }).join('');
  }
  function famHomeHTML(){
    if (!fam()) return '';
    const sum = new Map(fam().people.map(p => [p.id, {n: 0, value: 0}]));
    for (const id of S().inv.keys()) for (const [pid, v] of Object.entries(D.shares(id))){ const t = sum.get(pid); if (!t) continue; t.n += InkFamily.count(v); t.value += D.ownedValue(id, v).value; }
    const decksOf = id => S().decks.filter(d => D.deckOwner(d) === id).length, moves = famMovesHTML(8);
    return `<div class="grid2">
      <section class="card" id="famCard"><h2 class="sec">Family</h2><ul class="rows fam-rows">${fam().people.map(p => { const t = sum.get(p.id);
        return `<li>${ptag(p, 0, true)}<span class="row-m">${plural(t.n, 'card')} · ${plural(decksOf(p.id), 'deck')}</span><span class="row-v">${money(t.value)}</span></li>`; }).join('')}</ul></section>
      <section class="card" id="famMoves"><h2 class="sec">Recent moves</h2>${moves ? `<ul class="rows fam-rows">${moves}</ul>` : '<p class="muted">No cards have changed hands yet. Open a card or a deck to move it to someone.</p>'}</section>
    </div>`;
  }
  function famDeckHTML(d){
    if (!fam() || !d.updated_at) return '';
    const own = D.deckOwner(d), others = fam().people.filter(p => p.id !== own);
    return `<div class="deck-owner"><span class="mini">Owner</span>${ptag(famPerson(own), 0, true)}<label class="sr" for="dMoveTo">Move deck to</label><select id="dMoveTo">${others.map(p => `<option value="${esc(p.id)}" ${p.id === fam().me ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select><button class="btn sm" id="dMove" type="button">Move deck</button><span class="muted small">The owner's copies of its cards move with it.</span></div>`;
  }
  async function famMoveDeck(v){
    const base = S().decks.find(x => x.id === workshop.id), to = $('dMoveTo').value; if (!base || !famPerson(to)) return;
    if (workshop.dirty){ toast('Save your changes to this deck first.'); return; }
    const from = D.deckOwner(base);
    // A built deck holds its listed copies minus the ones still to add; those are the copies that change hands.
    const want = Object.fromEntries(Object.keys(base.cards).map(nv => [nv, base.built ? D.heldNV(base, nv) : base.cards[nv]]));
    const total = Object.values(want).reduce((a, n) => a + n, 0);
    const items = InkFamily.deckItems(want, from, to, nv => (S().cat.byNV.get(nv) || []).map(c => c.id), D.shares);
    $('dMove').disabled = true;
    try {
      const saved = await D.saveDeck({...base, owner: to});
      workshop.draft = structuredClone(saved); workshop.dirty = false;
      let moved = 0;
      try { moved = items.length ? await D.transfer(items, saved) : 0; }
      catch(err){ toast(`${saved.name} now belongs to ${famName(to)}, but its cards could not be moved: ${err.message}`); renderDecks(v); return; }
      toast(`${saved.name} now belongs to ${famName(to)}. ${moved} of ${total} cards moved with it.`);
    } catch(err){ toast(err.message); }
    renderDecks(v);
  }

  const priceLine = c => [c.p != null ? money(c.p) : '', c.pf != null ? `${money(c.pf)} foil` : ''].filter(Boolean).join(' · ') || 'No price';

  const peek = $('peek'); let peekT = 0, peekEl = null;
  const canHover = () => window.matchMedia('(hover:hover) and (min-width:1024px)').matches;
  function peekHide(){ clearTimeout(peekT); peekEl = null; peek.hidden = true; }
  document.addEventListener('mouseover', e => {
    if (!loaded || !canHover()) return;
    const el = e.target.closest?.('[data-card],[data-peek]');
    if (el === peekEl) return;
    peekHide();
    if (!el || el.closest('#cv')) return;
    const c = findCard(el.dataset.card || el.dataset.peek); if (!c) return;
    peekEl = el; const x = e.clientX;
    peekT = setTimeout(() => {
      if (peekEl !== el || !el.isConnected) return;
      const u = imgUrl(c, 'normal'), st = cardStats(c);
      peek.innerHTML = `<div class="peek-art">${u ? `<img src="${esc(u)}" alt="">` : `<span class="peek-ph">${esc(cardName(c))}</span>`}</div>
        <div class="peek-info"><b class="peek-n">${esc(cardName(c))}</b><span class="peek-t">${esc(typeLine(c))}</span>
        ${game === 'mtg' && c.mc ? `<span class="peek-cost">${pips(c.mc)}</span>` : ''}
        ${st.length ? `<div class="pstats">${st.slice(0, 6).map(([l, val]) => `<span class="pstat"><b>${esc(val)}</b>${esc(l)}</span>`).join('')}</div>` : ''}
        ${c.tx ? `<div class="peek-tx">${rulesHTML(c.tx)}</div>` : ''}
        <span class="peek-foot"><b>${esc(priceLine(c))}</b>${esc(ownLine(c))}</span></div>`;
      peek.hidden = false;
      const r = el.getBoundingClientRect(), W = peek.offsetWidth, H = peek.offsetHeight, vw = window.innerWidth;
      const rightOf = Math.min(r.right + 12, x + 32);
      const onRight = rightOf + W <= vw - 8;
      const left = onRight ? rightOf : Math.max(8, Math.min(r.left, x - 20) - W - 12);
      const top = Math.max(8, Math.min(r.top + r.height / 2 - H / 2, window.innerHeight - H - 8));
      peek.style.left = left + 'px'; peek.style.top = top + 'px';
      peek.style.transformOrigin = `${onRight ? 'left' : 'right'} ${Math.round(Math.max(0, Math.min(H, r.top + r.height / 2 - top)))}px`;
      peek.classList.remove('in'); void peek.offsetWidth; peek.classList.add('in');
    }, 180);
  });
  for (const ev of ['scroll', 'mousedown', 'keydown']) window.addEventListener(ev, peekHide, true);
  document.addEventListener('mouseleave', peekHide);

  const cvEl = $('cv'); let cvRun = [], cvAt = -1, cvFrom = null;
  function cvShow(id){
    const c = findCard(id); if (!c) return;
    cvAt = cvRun.indexOf(String(id));
    const u = imgUrl(c, game === 'lorcana' ? 'large' : 'normal'), st = cardStats(c), g = gameDef();
    const decks = S().decks.filter(d => d.cards[c.nv]);
    $('cvBody').innerHTML = `<div class="cv-art">${u ? `<img src="${esc(u)}" alt="${esc(cardName(c))}">` : `<span class="peek-ph">${esc(cardName(c))}</span>`}</div>
      <div class="cv-info">
        <h2 class="cv-n" id="cvName">${esc(cardName(c))}</h2>
        <p class="cv-t">${dots(c.inks)}${esc(typeLine(c))}${game === 'mtg' && c.mc ? `<span class="peek-cost">${pips(c.mc)}</span>` : ''}</p>
        ${st.length ? `<div class="cv-stats">${st.map(([l, val]) => `<div class="cv-stat"><b>${esc(val)}</b><span>${esc(l)}</span></div>`).join('')}</div>` : ''}
        ${c.tx ? `<div class="cv-tx">${rulesHTML(c.tx)}</div>` : ''}
        ${c.fl ? `<p class="cv-fl">${esc(c.fl)}</p>` : ''}
        <dl class="cv-kv">
          <dt>Set</dt><dd>${esc(c.sn || S().cat.sets.get(String(c.s)) || String(c.s || '').toUpperCase())}${c.c ? ` · #${esc(c.c)}` : ''}</dd>
          ${c.r ? `<dt>Rarity</dt><dd>${esc(g.rarityLabel(c.r))}</dd>` : ''}
          <dt>Price</dt><dd>${esc(priceLine(c))}</dd>
          <dt>Owned</dt><dd>${esc(ownLine(c))}</dd>
          ${fam() && ptags(c.id, true) ? `<dt>Who has it</dt><dd>${fam().people.filter(p => D.shares(c.id)[p.id]).map(p => `<span class="cv-who">${ptag(p, 0, true)}<span class="muted">${esc(finWords(D.shares(c.id)[p.id]))}</span></span>`).join('')}</dd>` : ''}
          ${c.il ? `<dt>Artist</dt><dd>${esc(c.il)}</dd>` : ''}
        </dl>
        ${cvMoveHTML(c)}
        ${decks.length ? `<div class="cv-decks"><span class="mini">In your decks</span><div class="chips">${decks.map(d => `<button type="button" class="chip-btn" data-cv-deck="${esc(d.id)}">${dots(deckColors(d))}${esc(d.name)} <span class="muted">×${d.cards[c.nv]}</span></button>`).join('')}</div></div>` : ''}
      </div>`;
    $('cvPrev').hidden = $('cvNext').hidden = cvRun.length < 2 || cvAt < 0;
    $('cvPrev').disabled = cvAt <= 0; $('cvNext').disabled = cvAt >= cvRun.length - 1;
    $('cvCount').textContent = cvRun.length > 1 && cvAt >= 0 ? `${cvAt + 1} of ${cvRun.length}` : '';
    cvMoveWire(c);
    for (const b of cvEl.querySelectorAll('[data-cv-deck]')) b.onclick = () => {
      if (workshop.dirty && workshop.id !== b.dataset.cvDeck && !confirm('Discard unsaved changes to this deck?')) return;
      if (workshop.id !== b.dataset.cvDeck){ workshop.id = b.dataset.cvDeck; workshop.draft = null; }
      cvClose(true); if (view === 'decks') render(); else location.hash = 'decks';
    };
  }
  function cvOpen(id, from){
    const box = from?.closest('tbody,.topcards,.rank,.hand-row,.gallery,.chips,.phase-cards');
    cvRun = box ? [...new Set([...box.querySelectorAll('[data-card]')].map(x => x.dataset.card))] : [String(id)];
    cvFrom = from || null; peekHide(); cvEl.hidden = false; document.body.classList.add('cv-open'); cvShow(id); $('cvX').focus();
  }
  function cvClose(skipFocus){ if (cvEl.hidden) return; cvEl.hidden = true; document.body.classList.remove('cv-open'); if (!skipFocus && cvFrom?.isConnected) (cvFrom.matches('button,a') ? cvFrom : cvFrom.querySelector('button') || cvFrom).focus?.(); cvFrom = null; }
  const cvStep = d => { const id = cvRun[cvAt + d]; if (id) cvShow(id); };
  $('cvX').onclick = () => cvClose(); $('cvPrev').onclick = () => cvStep(-1); $('cvNext').onclick = () => cvStep(1);
  cvEl.addEventListener('mousedown', e => { if (e.target === cvEl) cvClose(); });
  document.addEventListener('keydown', e => {
    if (cvEl.hidden) return;
    if (e.key === 'Escape'){ e.preventDefault(); cvClose(); }
    else if (e.key === 'ArrowLeft') cvStep(-1);
    else if (e.key === 'ArrowRight') cvStep(1);
    else if (e.key === 'Tab'){ const f = [...cvEl.querySelectorAll('button:not([hidden]):not(:disabled)')]; if (!f.length) return; const i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); }
  });
  document.addEventListener('click', e => {
    const el = e.target.closest?.('[data-card]'); if (!el || el.closest('#cv') || e.target.closest('[data-qty],a[href],input,select,label')) return;
    cvOpen(el.dataset.card, el);
  });
  const nameBtn = (c, label) => c ? `<button type="button" class="cardlink">${esc(label ?? cardName(c))}</button>` : `<span class="cn">${esc(label || '')}</span>`;
  const cardChip = (c, q) => `<button type="button" class="cchip"${cardAttr(c)}>${q ? `<b>${q}</b>` : ''}${esc(cardName(c))}</button>`;
  // a deck's own colours as a list, for the edge of its row and the band over its header
  const deckGrad = d => { const cs = deckColors(d).map(colorVar); return cs.length > 1 ? cs.join(',') : cs.length ? `${cs[0]},${cs[0]}` : 'var(--chart-1),var(--chart-2)'; };

  /* ---------- boot ---------- */
  $('game').value = game; document.documentElement.dataset.game = game;
  $('game').onchange = () => { game = $('game').value; D.lsSet('portal.game', game); document.documentElement.dataset.game = game; loaded = false; cardReg.clear(); cvClose(true); workshop.colors = [];
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
    C.hideTip(); peekHide();
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
    const top = collectionRows().filter(r => r.c && r.value > 0).sort((a, b) => b.value - a.value).slice(0, 8);
    const close = rows.filter(r => !r.d.built && r.st.missing && !r.st.unknown).sort((a, b) => a.st.missCost - b.st.missCost || a.st.missing - b.st.missing).slice(0, 8);
    v.innerHTML = `
      <header class="page-head"><div><h1 class="page-title">Overview</h1><p class="muted">${esc(gameDef().name)} · updated ${new Date(S().loadedAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}</p></div></header>
      <form class="ask" id="ask"><svg class="ic"><use href="#i-spark"/></svg><input id="askIn" placeholder="Ask the advisor: “What can I build from what I own?”" autocomplete="off"><button class="btn primary" type="submit">Ask</button></form>
      <section class="hero">
        <div class="hero-main"><span class="hero-l">Collection value</span><strong class="hero-v">${money(t.value)}</strong><span class="hero-s">${plural(t.copies, 'card')} · ${t.unpriced ? `${plural(t.unpriced, 'card')} unpriced` : 'market prices'}</span>
          <div class="hero-acts"><a class="hero-btn" href="#collection">Open collection</a><a class="hero-btn" href="#decks">Deck workshop</a></div></div>
        <div class="hero-fan">${top.slice(0, 3).map((r, i) => { const u = imgUrl(r.c, 'normal'); return u ? `<button type="button" class="fan f${i}"${cardAttr(r.c)} aria-label="${esc(cardName(r.c))}"><img src="${esc(u)}" alt=""></button>` : ''; }).join('')}</div>
      </section>
      <div class="tiles">
        ${top.length ? tile('Top card', money(top[0].value), cardName(top[0].c)) : tile('Top card', '—', 'No priced cards yet')}
        ${tile('Cards owned', t.copies.toLocaleString(), `${t.unique.toLocaleString()} different printings`)}
        ${tile('Decks', rows.length.toLocaleString(), `${built} built`)}
        ${tile('Ready to build', ready.length.toLocaleString(), 'Unbuilt decks you have every card for')}
      </div>
      ${famHomeHTML()}
      <div class="grid2">
        ${ready.length ? `<section class="card"><h2 class="sec">Ready to build</h2><ul class="rows">${ready.slice(0, 10).map(r => deckRow(r)).join('')}</ul></section>`
          : `<section class="card"><h2 class="sec">Your decks</h2>${rows.length ? `<ul class="rows">${[...rows].sort((a, b) => (Date.parse(b.d.updated_at) || 0) - (Date.parse(a.d.updated_at) || 0)).slice(0, 8).map(r => deckRow(r, false, true)).join('')}</ul>` : '<p class="muted">No decks yet. Start one in the Deck workshop.</p>'}</section>`}
        <section class="card"><h2 class="sec">Cheapest to finish</h2>${close.length ? `<ul class="rows">${close.map(r => deckRow(r, true)).join('')}</ul><a class="link" href="#buy">Plan the shopping in Buy planner</a>` : '<p class="muted">No decks are waiting on cards.</p>'}</section>
      </div>
      ${top.length ? `<section class="card"><h2 class="sec">Most valuable cards</h2><div class="topcards">${top.map(r => { const u = imgUrl(r.c, 'normal'); return `<button type="button" class="topcard"${cardAttr(r.c)}>${u ? `<img src="${esc(u)}" alt="" loading="lazy">` : '<span class="ph"></span>'}<b>${esc(cardName(r.c))}</b><span>${money(r.value)}${r.n > 1 ? ` · ${r.n} copies` : ''}</span></button>`; }).join('')}</div></section>` : ''}`;
    $('ask').onsubmit = e => { e.preventDefault(); const q = $('askIn').value.trim(); if (!q) return; pendingAsk = q; location.hash = 'advisor'; };
    wireDeckLinks(v);
  }
  const tile = (label, value, sub) => `<div class="tile"><div class="tile-l">${esc(label)}</div><div class="tile-v">${esc(value)}</div><div class="tile-s">${esc(sub)}</div></div>`;
  function deckRow({d, st}, cost, bar){
    return `<li><button class="row-btn" data-open-deck="${esc(d.id)}" type="button">${dots(deckColors(d))}<span class="row-n">${esc(d.name)}</span><span class="row-m">${esc([formatLabel(d), `${st.total}/${st.size}`].filter(Boolean).join(' · '))}</span>${cost ? `<span class="row-v">${plural(st.missing, 'card')}${st.missCost ? ` · ${money(st.missCost)}` : ''}${st.missUnpriced ? ` · ${st.missUnpriced} unpriced` : ''}</span>` : ''}${bar ? `<span class="row-bar${st.missing ? '' : ' full'}"><i style="width:${st.total ? Math.round(100 * (st.total - st.missing) / st.total) : 0}%"></i></span>` : ''}</button></li>`;
  }
  function wireDeckLinks(root){ for (const b of root.querySelectorAll('[data-open-deck]')) b.onclick = () => { workshop.id = b.dataset.openDeck; workshop.draft = null; location.hash = 'decks'; }; }

  /* ---------- Collection ---------- */
  const coll = {q: '', color: '', type: '', rarity: '', owner: '', sort: 'value', shown: 200, view: D.lsGet('portal.collView', 'gallery')};
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
    const g = gameDef(), who = fam() && famPerson(coll.owner) ? coll.owner : '';
    // With one person picked, every number on the page is that person's copies only.
    const all = !who ? collectionRows() : collectionRows().map(r => { const sh = D.shares(r.id)[who]; if (!sh) return null;
      const val = D.ownedValue(r.id, sh); return {...r, v: sh, n: InkFamily.count(sh), value: val.value, unpriced: val.unpriced}; }).filter(Boolean);
    const q = coll.q.toLowerCase();
    let rows = all.filter(r => r.c && (!q || `${cardName(r.c)} ${r.c.ty || ''} ${r.c.tx || ''}`.toLowerCase().includes(q))
      && (!coll.color || r.c.inks.includes(coll.color)) && (!coll.type || String(r.c.ty || '').includes(coll.type)) && (!coll.rarity || r.c.r === coll.rarity));
    const sorters = {value: (a, b) => b.value - a.value, name: (a, b) => cardName(a.c).localeCompare(cardName(b.c)), qty: (a, b) => b.n - a.n, set: (a, b) => String(a.c.s).localeCompare(String(b.c.s)) || (parseInt(a.c.c) || 0) - (parseInt(b.c.c) || 0)};
    rows.sort(sorters[coll.sort]);
    const unknown = all.filter(r => !r.c).length;
    const unused = all.filter(r => r.c && !r.decks.length), unusedValue = unused.reduce((s, r) => s + r.value, 0);
    const bait = all.filter(r => r.c && r.value / r.n >= 1 && r.free > 0 && !r.decks.length).sort((a, b) => b.value - a.value).slice(0, 12);
    v.innerHTML = `
      <header class="page-head"><div><h1 class="page-title">Collection</h1><p class="muted">${who ? `${esc(famName(who))} · ` : ''}${plural(all.reduce((s, r) => s + r.n, 0), 'card')} · ${money(all.reduce((s, r) => s + r.value, 0))}${unknown ? ` · ${plural(unknown, 'printing')} without card data` : ''}</p></div></header>
      <div class="grid3">
        <section class="card"><h2 class="sec">Value by set</h2><div id="chSets"></div></section>
        <section class="card"><h2 class="sec">Value by rarity</h2><div id="chRarity"></div></section>
        <section class="card"><h2 class="sec">Value over time</h2><div id="chHist"></div></section>
      </div>
      <div class="grid2">
        <section class="card"><h2 class="sec">Most valuable</h2><ol class="rank">${all.filter(r => r.c).sort((a, b) => b.value - a.value).slice(0, 10).map(r => `<li${cardAttr(r.c)}>${nameBtn(r.c)}<span class="muted">${esc(String(r.c.s).toUpperCase())}${r.n > 1 ? ` ×${r.n}` : ''}</span><span class="num">${money(r.value)}</span></li>`).join('')}</ol></section>
        <section class="card"><h2 class="sec">Trade bait</h2><p class="muted small">Cards worth $1 or more that aren't in any deck. ${plural(unused.length, 'printing')} sit outside every deck, worth ${money(unusedValue)} in all.</p><ol class="rank">${bait.map(r => `<li${cardAttr(r.c)}>${nameBtn(r.c)}<span class="muted">${r.free} free</span><span class="num">${money(r.value)}</span></li>`).join('') || '<li class="muted">Nothing over $1 sits unused.</li>'}</ol></section>
      </div>
      <section class="card">
        <div class="toolbar">
          <div class="search"><svg class="ic"><use href="#i-search"/></svg><input id="cq" placeholder="Search name, type or text" value="${esc(coll.q)}"></div>
          <select id="cColor"><option value="">All ${esc(g.colorWord.toLowerCase())}s</option>${g.colors.map(x => `<option ${coll.color === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
          <select id="cType"><option value="">All types</option>${g.types.map(x => `<option ${coll.type === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
          <select id="cRarity"><option value="">All rarities</option>${g.rarities.map(x => `<option value="${esc(x)}" ${coll.rarity === x ? 'selected' : ''}>${esc(g.rarityLabel(x))}</option>`).join('')}</select>
          ${fam() ? `<select id="cOwner" aria-label="Owner"><option value="">Everyone</option>${fam().people.map(p => `<option value="${esc(p.id)}" ${who === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}
          <div class="seg" role="group" aria-label="Layout">${[['gallery', 'Gallery'], ['list', 'List']].map(([k, l]) => `<button type="button" aria-pressed="${coll.view === k}" data-cview="${k}">${l}</button>`).join('')}</div>
          <select id="cSort">${[['value', 'Value'], ['name', 'Name'], ['qty', 'Quantity'], ['set', 'Set']].map(([k, l]) => `<option value="${k}" ${coll.sort === k ? 'selected' : ''}>Sort: ${l}</option>`).join('')}</select>
        </div>
        ${coll.view === 'gallery' ? `<div class="gallery">${rows.slice(0, coll.shown).map(r => { const u = imgUrl(r.c, 'normal'); return `<button type="button" class="ctile"${cardAttr(r.c)}><span class="ctile-art">${u ? `<img loading="lazy" src="${esc(u)}" alt="">` : `<span class="peek-ph">${esc(cardName(r.c))}</span>`}${r.n > 1 ? `<span class="ctile-q">×${r.n}</span>` : ''}${ptags(r.id)}</span><b>${esc(cardName(r.c))}</b><span>${money(r.value)}${r.unpriced ? '+' : ''} · ${esc(String(r.c.s).toUpperCase())}</span></button>`; }).join('')}</div>` : `<table class="tbl"><thead><tr><th>Card</th><th>Set</th><th>Rarity</th><th class="num">Qty</th><th class="num">Free</th><th class="num">Price</th><th class="num">Value</th><th>In decks</th></tr></thead>
        <tbody>${rows.slice(0, coll.shown).map(r => `<tr${cardAttr(r.c)}><td><div class="cell-card">${imgUrl(r.c) ? `<img loading="lazy" src="${esc(imgUrl(r.c))}" alt="">` : '<span class="thumb-ph"></span>'}<div><div class="cn">${nameBtn(r.c)}</div><div class="cm">${esc(r.c.ty || '')}</div>${ptags(r.id, true)}</div></div></td><td>${esc(String(r.c.s).toUpperCase())} #${esc(r.c.c)}</td><td>${esc(g.rarityLabel(r.c.r))}</td><td class="num">${[r.v.q ? String(r.v.q) : '', r.v.f ? `${r.v.f} foil` : '', r.v.rf ? `${r.v.rf} ${esc((g.finishes.rainbow || 'special').toLowerCase())}` : ''].filter(Boolean).join(' + ')}</td><td class="num">${r.free}</td><td class="num">${money(r.c.p ?? r.c.pf ?? null)}</td><td class="num">${money(r.value)}${r.unpriced ? '+' : ''}</td><td class="muted small">${esc(r.decks.slice(0, 2).join(', '))}${r.decks.length > 2 ? ` +${r.decks.length - 2}` : ''}</td></tr>`).join('')}</tbody></table>`}
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
    if ($('cOwner')) $('cOwner').onchange = () => { coll.owner = $('cOwner').value; re(); };
    for (const b of v.querySelectorAll('[data-cview]')) b.onclick = () => { coll.view = b.dataset.cview; D.lsSet('portal.collView', coll.view); re(); };
    if ($('cMore')) $('cMore').onclick = () => { coll.shown += 200; renderCollection(v); };
  }
  function debounce(fn, ms){ let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  /* ---------- Deck workshop ---------- */
  const workshop = {id: null, draft: null, dirty: false, q: '', filter: 'all', sort: D.lsGet('portal.deckSort', 'name'), colors: [], compare: '', addQ: '', addResults: []};
  const DECK_SORTS = [['name', 'Name'], ['easiest', 'Easiest to build'], ['fewest', 'Fewest cards missing'], ['cheapest', 'Cheapest to finish'], ['recent', 'Recently changed']];
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
    const isReady = r => !r.d.built && !r.st.missing && !r.st.unknown && r.st.total;
    const tests = {all: () => true, notbuilt: r => !r.d.built, ready: isReady, close: r => !r.d.built && r.st.total && r.st.missing > 0 && r.st.missing <= 5, missing: r => !r.d.built && r.st.missing > 0, built: r => r.d.built, fav: r => r.d.fav};
    const own = r => r.st.total ? (r.st.total - r.st.missing) / r.st.total : -1;
    const last = r => (r.d.built ? 2 : 0) + (r.st.total ? 0 : 1);   // decks already built, and empty ones, sink in the build-first orders
    const byName = (a, b) => a.d.name.localeCompare(b.d.name, undefined, {numeric: true});
    const sorts = {
      name: (a, b) => (b.d.fav - a.d.fav) || byName(a, b),
      easiest: (a, b) => last(a) - last(b) || own(b) - own(a) || a.st.missCost - b.st.missCost || byName(a, b),
      fewest: (a, b) => last(a) - last(b) || a.st.missing - b.st.missing || a.st.missCost - b.st.missCost || byName(a, b),
      cheapest: (a, b) => last(a) - last(b) || a.st.missCost - b.st.missCost || a.st.missing - b.st.missing || byName(a, b),
      recent: (a, b) => (Date.parse(b.d.updated_at) || 0) - (Date.parse(a.d.updated_at) || 0) || byName(a, b)
    };
    const list = all.filter(r => (!q || r.d.name.toLowerCase().includes(q)) && (tests[workshop.filter] ? tests[workshop.filter](r) : workshop.filter === r.d.format)
      && (!workshop.colors.length || workshop.colors.every(c => deckColors(r.d).includes(c)))).sort(sorts[workshop.sort] || sorts.name);
    const ranked = workshop.sort !== 'name' && workshop.sort !== 'recent';
    if (!workshop.id || !S().decks.some(d => d.id === workshop.id)) workshop.id = workshop.draft?.id && !workshop.draft.updated_at ? workshop.draft.id : list[0]?.d.id || null;
    const base = S().decks.find(d => d.id === workshop.id);
    if (!workshop.draft || workshop.draft.id !== workshop.id) { workshop.draft = base ? structuredClone(base) : workshop.draft; workshop.dirty = workshop.draft && !workshop.draft.updated_at; }
    const formats = game === 'mtg' ? Object.entries(gameDef().formats) : [];
    v.innerHTML = `
      <header class="page-head"><div><h1 class="page-title">Deck workshop</h1><p class="muted">${plural(all.length, 'deck')}</p></div><button class="btn" id="newDeck" type="button"><svg class="ic"><use href="#i-plus"/></svg>New deck</button></header>
      <div class="workshop">
        <aside class="card deck-list">
          <div class="search"><svg class="ic"><use href="#i-search"/></svg><input id="dq" placeholder="Search decks" value="${esc(workshop.q)}"></div>
          <div class="dl-ctl">
            <label class="field"><span>Show</span><select id="dFilter">${[['all', 'All decks'], ['notbuilt', 'Not built yet'], ['ready', 'Ready to build'], ['close', 'Missing 5 or fewer'], ['missing', 'Missing cards'], ['built', 'Built'], ['fav', 'Favorites'], ...formats.map(([k, f]) => [k, f.label])].map(([k, l]) => `<option value="${k}" ${workshop.filter === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
            <label class="field"><span>Sort</span><select id="dSort">${DECK_SORTS.map(([k, l]) => `<option value="${k}" ${workshop.sort === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          </div>
          <div class="cpick" role="group" aria-label="${esc(gameDef().colorWord)}s">${gameDef().colors.filter(x => x !== 'Colorless').map(x => `<button type="button" class="cdot" data-col="${esc(x)}" aria-pressed="${workshop.colors.includes(x)}" aria-label="${esc(x)}" title="${esc(x)}"><i style="background:${colorVar(x)}"></i></button>`).join('')}<span class="muted small dl-count">${list.length === all.length ? plural(all.length, 'deck') : `${list.length} of ${all.length}`}</span></div>
          <ul class="dl">${list.map(({d, st}, i) => { const o = st.total ? Math.round(100 * (st.total - st.missing) / st.total) : 0;
            const state = d.built ? 'Built' : !st.total ? 'Empty' : st.unknown ? 'Loading cards' : st.missing ? `${plural(st.missing, 'card')} to get${st.missCost ? ` · ${money(st.missCost)}` : ''}` : 'Ready to build';
            return `<li><button type="button" class="dl-i ${d.id === workshop.id ? 'on' : ''}" data-id="${esc(d.id)}" style="--deck:${deckGrad(d)}"><span class="dl-top">${ranked ? `<span class="dl-r">${i + 1}</span>` : ''}<span class="dl-n">${esc(d.name)}</span>${fam() ? ptag(famPerson(D.deckOwner(d))) : ''}<span class="dl-p${st.total && !st.missing ? ' full' : ''}">${st.total ? o + '%' : ''}</span></span><span class="dl-m">${dots(deckColors(d))}${esc([formatLabel(d), `${st.total}/${st.size}`].filter(Boolean).join(' · '))}</span><span class="dl-m">${esc(state)}</span><span class="meter${st.total && !st.missing ? ' full' : ''}"><i style="width:${o}%"></i></span></button></li>`; }).join('') || '<li class="muted small dl-none">No decks match.</li>'}</ul>
        </aside>
        <div id="deckPane" class="deck-pane"></div>
      </div>`;
    $('dq').oninput = debounce(() => { workshop.q = $('dq').value; renderDecks(v); $('dq').focus(); $('dq').setSelectionRange(workshop.q.length, workshop.q.length); }, 200);
    $('dFilter').onchange = () => { workshop.filter = $('dFilter').value; renderDecks(v); };
    $('dSort').onchange = () => { workshop.sort = $('dSort').value; D.lsSet('portal.deckSort', workshop.sort); renderDecks(v); };
    for (const b of v.querySelectorAll('.cdot')) b.onclick = () => { const c = b.dataset.col; workshop.colors = workshop.colors.includes(c) ? workshop.colors.filter(x => x !== c) : [...workshop.colors, c]; renderDecks(v); v.querySelector(`.cdot[data-col="${c}"]`)?.focus(); };
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
    const lead = (d.commanders.map(nv => S().cat.rep(nv)).find(c => c && imgUrl(c, 'normal'))) || st.rows.filter(r => r.c && imgUrl(r.c, 'normal') && !/\bLand\b/.test(String(r.c.ty).split('//')[0])).sort((a, b) => (b.c.p || 0) - (a.c.p || 0))[0]?.c;
    p.innerHTML = `
      <section class="card deck-top">
        ${lead ? `<div class="deck-art" style="background-image:url('${esc(imgUrl(lead, 'normal'))}')"></div>` : ''}<div class="deck-band" style="--deck:${deckGrad(d)}"></div>
        <div class="deck-head">
          <input id="dName" class="title-input" value="${esc(d.name)}" aria-label="Deck name">
          <div class="deck-actions">
            ${formats.length ? `<select id="dFormat">${formats.map(([k, f]) => `<option value="${k}" ${d.format === k ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select>` : ''}
            <label class="check"><input type="checkbox" id="dBuilt" ${d.built ? 'checked' : ''}> Built</label>
            <button class="btn" id="dCopy" type="button"><svg class="ic"><use href="#i-copy"/></svg>Copy list</button>
            <button class="btn primary" id="dSave" type="button" ${workshop.dirty ? '' : 'disabled'}>${d.updated_at ? 'Save changes' : 'Save deck'}</button>
          </div>
        </div>
        ${famDeckHTML(d)}
        ${d.built && d.todo ? `<p class="todo-note">Still to add to this deck: ${Object.entries(d.todo).map(([nv, n]) => `${n} ${esc(nvName(nv))}`).join(', ')}. They stay on your shopping list and aren't taken from other decks. <button type="button" class="link" id="todoDone">I've added them</button></p>` : ''}
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
      ${strategyHTML(d)}
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
      </section>`;
    const cv = curveOf(d.cards);
    C.bars($('chCurve'), {categories: cv.groups, series: [{name: 'Cards', color: C.token('--chart-1'), values: cv.vals}], format: x => String(Math.round(x)), height: 170, label: 'Curve'});
    const cc = colorCounts(d.cards);
    C.hbars($('chColors'), {rows: cc.map(([k, n]) => ({label: k, value: n, color: colorVar(k)})), format: x => String(x)});
    C.hbars($('chTypes'), {rows: typeCounts(d.cards).map(([k, n]) => ({label: k, value: n, color: C.token('--chart-1')})), format: x => String(x)});
    const mark = () => { workshop.dirty = true; renderDeckPane(p, v); };
    $('dName').onchange = () => { d.name = $('dName').value.trim() || d.name; workshop.dirty = true; $('dSave').disabled = false; };
    if ($('dFormat')) $('dFormat').onchange = () => { d.format = $('dFormat').value; mark(); };
    // Marking built: cards without enough free copies are listed as still to add, not taken from other decks.
    $('dBuilt').onchange = () => {
      d.built = $('dBuilt').checked;
      if (d.built){ const todo = {}; for (const [nv, q] of Object.entries(d.cards)){ const free = Math.min(q, D.freeNV(nv, d.id)); if (free < q) todo[nv] = q - free; } d.todo = Object.keys(todo).length ? todo : null; }
      else d.todo = null;
      mark();
    };
    if ($('todoDone')) $('todoDone').onclick = () => { d.todo = null; mark(); };
    $('dCopy').onclick = async () => { const text = Object.entries(d.cards).map(([nv, q]) => `${q} ${nvName(nv)}`).join('\n'); try { await navigator.clipboard.writeText(text); toast('List copied.'); } catch(e){ toast('Copy failed. Select the list and copy it.'); } };
    if ($('dMove')) $('dMove').onclick = () => famMoveDeck(v);
    $('dSave').onclick = async () => {
      $('dSave').disabled = true; $('dSave').textContent = 'Saving…';
      try { const saved = await D.saveDeck(d); workshop.id = saved.id; workshop.draft = structuredClone(saved); workshop.dirty = false; toast('Saved. Tap Update in the phone app to bring it over.'); renderDecks(v); }
      catch(err){ toast(err.message); $('dSave').disabled = false; $('dSave').textContent = 'Save changes'; }
    };
    for (const b of p.querySelectorAll('[data-qty]')) b.onclick = () => {
      const nv = b.dataset.nv, n = (d.cards[nv] || 0) + (+b.dataset.qty);
      if (n <= 0){ delete d.cards[nv]; d.commanders = d.commanders.filter(x => x !== nv); } else d.cards[nv] = n;
      if (d.todo?.[nv]){ if (n <= 0) delete d.todo[nv]; else d.todo[nv] = Math.min(d.todo[nv], n); if (!Object.keys(d.todo).length) d.todo = null; }
      mark();
    };
    const runAdd = debounce(async () => {
      const q = workshop.addQ.trim(); if (q.length < 2){ $('addRes').innerHTML = ''; return; }
      $('addRes').innerHTML = '<p class="muted small">Searching…</p>';
      try {
        const r = await D.searchCards(game, q, 12);
        if (workshop.addQ.trim() !== q) return;
        $('addRes').innerHTML = r.cards.length ? r.cards.map(c => `<button type="button" class="chip-btn" data-add="${esc(c.nv)}"${cardAttr(c, true)}><svg class="ic"><use href="#i-plus"/></svg>${esc(cardName(c))}<span class="muted">${D.ownedNV(c.nv) ? ` · own ${D.ownedNV(c.nv)}` : ''}</span></button>`).join('') : '<p class="muted small">No cards found.</p>';
        for (const b of $('addRes').querySelectorAll('[data-add]')) b.onclick = () => { d.cards[b.dataset.add] = (d.cards[b.dataset.add] || 0) + 1; workshop.dirty = true; renderDeckPane(p, v); };
      } catch(err){ $('addRes').innerHTML = `<p class="muted small">${esc(err.message)}</p>`; }
    }, 350);
    $('addQ').oninput = () => { workshop.addQ = $('addQ').value; runAdd(); };
    if (workshop.addQ) runAdd();
    if ($('stratAsk')) $('stratAsk').onclick = () => { pendingAsk = $('stratAsk').dataset.ask; location.hash = 'advisor'; };
    if ($('stratSim')) $('stratSim').onclick = () => { if (!S().decks.some(x => x.id === d.id)){ toast('Save the deck first, then run it in the Simulator.'); return; } sim.deck = d.id; sim.result = null; sim.mode = 'opening'; location.hash = 'simulate'; };
    $('cmpSel').onchange = () => { workshop.compare = $('cmpSel').value; renderCompare(d); };
    renderCompare(d);
  }
  function cardTable(rows){
    return `<table class="tbl compact fixed"><colgroup><col style="width:48px"><col><col style="width:20%"><col style="width:88px"><col style="width:64px"><col style="width:80px"><col style="width:88px"></colgroup><thead><tr><th class="num">Qty</th><th>Card</th><th>Cost</th><th class="num">Own</th><th class="num">Need</th><th class="num">Price</th><th></th></tr></thead><tbody>${rows.map(r => `<tr class="${r.need ? 'needs' : ''}"${cardAttr(r.c)}>
      <td class="num">${r.q}</td><td>${nameBtn(r.c, nvName(r.nv))}${r.c ? '' : ' <span class="muted small">loading</span>'}</td>
      <td class="muted">${r.c ? (game === 'mtg' ? pips(r.c.mc || '') : esc(r.c.co ?? '')) : ''}</td>
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

  /* ---------- How the deck plays: read from the list's curve and card text ---------- */
  function hyper(N, K, n, lo, hi){
    const lc = (a, b) => { if (b < 0 || b > a) return -Infinity; let s = 0; for (let i = 1; i <= b; i++) s += Math.log((a - b + i) / i); return s; };
    let p = 0; for (let k = lo; k <= Math.min(hi, K, n); k++) p += Math.exp(lc(K, k) + lc(N - K, n - k) - lc(N, n));
    return Math.max(0, Math.min(1, p));
  }
  const ROLES = {
    mtg: [
      ['Creatures', c => /Creature/.test(c.ty), 'The bodies that attack and block.'],
      ['Removal', (c, t) => /\b(destroy|exile) target (?!card|spell|.*graveyard)|deals? (\d+|x) damage to (any target|target (creature|planeswalker|attacking|blocking))|target creature gets -\d|\bfights? (another |up to one )?target|target (player|opponent) sacrifices|return target (creature|nonland permanent|permanent) to its owner's hand/.test(t), 'Deals with one opposing card.'],
      ['Counterspells', (c, t) => /counter target/.test(t), 'Stops a spell before it lands.'],
      ['Sweepers', (c, t) => /(destroy|exile) all|deals? (\d+|x) damage to each creature|all creatures get -|each (player|opponent) sacrifices/.test(t), 'Clears the whole board.'],
      ['Card draw', (c, t) => /draws? (a|two|three|four|x|\d+) cards?|draw cards equal/.test(t), 'Keeps your hand full.'],
      ['Ramp', (c, t) => !/\bLand\b/.test(String(c.ty).split('//')[0]) && /add \{|add (one|two|three|x) mana|search your library for (a|up to \w+) (basic )?(land|forest|plains|island|swamp|mountain)|put (a|that|up to \w+) (basic )?land cards? .*onto the battlefield/.test(t), 'Extra mana ahead of schedule.'],
      ['Recursion', (c, t) => /return .{0,60}from (your|a) graveyard/.test(t), 'Gets cards back from the graveyard.'],
      ['Evasive threats', (c, t) => /Creature/.test(c.ty) && /\bflying\b|\bmenace\b|\btrample\b|can't be blocked/.test(t), 'Hard to block.']
    ],
    lorcana: [
      ['Characters', c => /Character/.test(c.ty), 'Quest for lore and challenge.'],
      ['Strong questers', c => /Character/.test(c.ty) && (c.lo || 0) >= 2, 'Characters that quest for 2 lore or more.'],
      ['Removal', (c, t) => /banish (chosen|target|all|each)|deals? \d+ damage to (chosen|each|all)|return chosen .{0,40}to (their|its) player's hand|chosen .{0,30}gets -\d/.test(t), 'Deals with opposing characters.'],
      ['Songs', c => /Song/.test(c.ty), 'Actions your characters can sing for free.'],
      ['Card draw', (c, t) => /draws? (a|two|three|x|\d+) cards?/.test(t), 'Keeps your hand full.'],
      ['Ink ramp', (c, t) => /into your inkwell/.test(t), 'Extra ink ahead of schedule.'],
      ['Evasive', (c, t) => /\bevasive\b/.test(t), 'Only evasive characters can challenge them.'],
      ['Protection', (c, t) => /\bbodyguard\b|\bward\b|\bresist\b/.test(t), 'Bodyguard, Ward and Resist.']
    ]
  };
  function deckPlan(d){
    const mtg = game === 'mtg', lor = game === 'lorcana';
    const isLand = c => mtg && /\bLand\b/.test(String(c.ty).split('//')[0]);
    const all = Object.entries(d.cards).map(([nv, q]) => ({nv, q, c: S().cat.rep(nv)})).filter(x => x.c);
    const total = all.reduce((s, x) => s + x.q, 0); if (!total) return null;
    const spells = all.filter(x => !isLand(x.c)), nSpells = spells.reduce((s, x) => s + x.q, 0);
    const lands = total - nSpells;
    const cmdSet = new Set(d.commanders), full = D.deckStats(d).size || total, short = total < full * .9;
    const costed = spells.filter(x => x.c.co != null), avg = costed.reduce((s, x) => s + x.q * x.c.co, 0) / Math.max(1, costed.reduce((s, x) => s + x.q, 0));
    const sum = list => list.reduce((s, x) => s + x.q, 0);
    const roles = (ROLES[game] || []).map(([label, test, hint]) => { const list = spells.filter(x => test(x.c, String(x.c.tx || '').toLowerCase())); return {label, hint, list, n: sum(list)}; });
    const role = l => roles.find(r => r.label === l)?.n || 0;
    const byQty = (a, b) => b.q - a.q || (b.c.p || 0) - (a.c.p || 0) || cardName(a.c).localeCompare(cardName(b.c));
    const lo = lor ? 2 : 2, hi = lor ? 5 : 4;
    const main = costed.filter(x => !cmdSet.has(x.nv));
    const early = main.filter(x => x.c.co <= lo).sort(byQty), mid = main.filter(x => x.c.co > lo && x.c.co <= hi).sort(byQty), late = main.filter(x => x.c.co > hi).sort((a, b) => b.c.co - a.c.co || byQty(a, b));
    const commander = d.commanders.map(nv => S().cat.rep(nv)).filter(Boolean);
    const big = mtg && (commander.length || d.format === 'commander' || total > 80);
    const singleton = all.every(x => x.q === 1 || isLand(x.c));
    const core = singleton ? [] : spells.filter(x => x.q >= 3).sort(byQty).slice(0, 8);
    const interact = role('Removal') + role('Counterspells') + role('Sweepers'), creat = role(mtg ? 'Creatures' : 'Characters');
    let kind = 'Midrange', plan = '';
    if (mtg && big){
      kind = avg < 2.7 ? 'Low-curve Commander' : avg < 3.5 ? 'Commander' : 'Top-heavy Commander';
      plan = `${commander.length ? `Everything is built around ${commander.map(cardName).join(' and ')}. ` : ''}Spend the first turns on lands and ramp so the commander lands with mana to spare, keep cards flowing, and hold removal for whatever stops your plan rather than the first thing that appears.`;
    } else if (mtg){
      if (avg <= 2.1 && creat >= nSpells * .4){ kind = 'Aggro'; plan = 'Get on the board on turns 1 and 2, keep attacking, and finish before slower decks settle. Spend removal on blockers; every turn the game goes on favours the other side.'; }
      else if (interact >= nSpells * .3 && creat <= nSpells * .35){ kind = 'Control'; plan = 'Answer what matters, keep cards flowing, and win late with a handful of finishers. There is no hurry: save answers for the cards that actually threaten you.'; }
      else if (avg >= 3.2 || role('Ramp') >= 8){ kind = 'Ramp'; plan = 'Spend the first turns building mana, then land threats a turn or two before they can be handled. Hands without early mana are the ones to send back.'; }
      else { kind = 'Midrange'; plan = 'Trade early, then take over with stronger cards from turn 3 on. Play the attacker when you are ahead and the defender when you are behind; the deck has tools for both.'; }
    } else if (lor){
      if (avg <= 2.9 && creat >= nSpells * .7){ kind = 'Aggro'; plan = 'Put a character down every turn and quest. You win the race to 20 lore by making the other side spend their turns answering you.'; }
      else if (interact + role('Songs') >= nSpells * .28){ kind = 'Control'; plan = 'Clear their characters with removal and songs, keep your own hand full, and out-lore them late with a few sturdy questers.'; }
      else { kind = 'Midrange'; plan = 'Build a board through the middle turns, challenge when the trade is good and quest when it is safe. The deck wins by having the better characters on the table from turn 4 on.'; }
    } else plan = 'Lay out your early plays, build through the middle turns and close with your biggest cards.';
    const good = [], watch = [];
    const cols = deckColors(d).length;
    if (mtg){
      const cheap = roles.filter(r => r.label === 'Ramp' || r.label === 'Card draw').flatMap(r => r.list).filter(x => x.c.co != null && x.c.co <= 2);
      const want = Math.round((big ? 31.42 + 3.13 * avg : 19.59 + 1.9 * avg) * (big ? total / 100 : total / 60) - .28 * sum([...new Set(cheap)]));
      if (short) watch.push(`This list has ${total} of ${full} cards, so every number here will move as you fill it in.`);
      else if (lands && Math.abs(lands - want) >= 3) watch.push(`${lands} lands for an average mana value of ${avg.toFixed(2)}. Frank Karsten's land-count rule of thumb points to about ${want}.`);
      else if (lands) good.push(`${lands} lands suits an average mana value of ${avg.toFixed(2)}.`);
      const iWant = big ? 10 : 8, dWant = big ? 10 : 6;
      if (interact >= iWant) good.push(`${interact} ways to answer an opposing card.`); else if (interact <= (big ? 5 : 3)) watch.push(`Only ${interact} ${interact === 1 ? 'way' : 'ways'} to answer an opposing card. A single strong threat can run away with the game.`);
      if (role('Card draw') >= dWant) good.push(`${role('Card draw')} sources of card draw keep it from running dry.`); else if (role('Card draw') <= (big ? 5 : 2) && kind !== 'Aggro') watch.push(`Only ${role('Card draw')} card-draw ${role('Card draw') === 1 ? 'source' : 'sources'}. It can run out of things to do in a long game.`);
      if (big && !short && role('Ramp') < 8) watch.push(`${role('Ramp')} ramp cards. Most Commander lists want around 10.`);
      if (!big && sum(early) >= 14) good.push(`${sum(early)} plays at 2 mana or less, so it is rarely stuck early.`); else if (!big && sum(early) <= 6 && kind !== 'Control') watch.push(`Only ${sum(early)} plays at 2 mana or less. Expect slow starts.`);
      if (role('Evasive threats') >= (big ? 10 : 8)) good.push(`${role('Evasive threats')} threats that are hard to block.`);
      if (cols >= 3 && !big) watch.push(`${cols} colours in a ${total}-card list. Check “Color trouble” in the Simulator.`);
    } else if (lor){
      const ink = sum(all.filter(x => x.c.ik)), un = total - ink;
      if (short) watch.push(`This list has ${total} of ${full} cards, so every number here will move as you fill it in.`);
      if (un > 14) watch.push(`${un} cards can’t be put in the inkwell. Hands can stall on ink.`); else good.push(`${ink} of ${total} cards are inkable, so ink drops come easily.`);
      if (role('Strong questers') >= 12) good.push(`${role('Strong questers')} characters quest for 2 lore or more.`);
      if (role('Removal') <= 4) watch.push(`Only ${role('Removal')} removal ${role('Removal') === 1 ? 'card' : 'cards'}. A character you can’t challenge will be hard to shift.`); else if (role('Removal') >= 9) good.push(`${role('Removal')} ways to deal with opposing characters.`);
      if (role('Card draw') <= 3) watch.push(`Only ${role('Card draw')} card-draw ${role('Card draw') === 1 ? 'source' : 'sources'}. It leans on the top of the deck late.`); else if (role('Card draw') >= 7) good.push(`${role('Card draw')} sources of card draw.`);
      if (sum(early) <= 10) watch.push(`Only ${sum(early)} plays at 2 ink or less. Turn 1 and 2 will often be ink only.`); else if (sum(early) >= 16) good.push(`${sum(early)} plays at 2 ink or less.`);
    }
    const size = gameDef().deck?.handSize || 7;
    let hand = [];
    if (mtg && lands){
      hand = [[pct(hyper(total, lands, size, big ? 3 : 2, big ? 5 : 4)), big ? '3 to 5 lands in the opening 7' : '2 to 4 lands in the opening 7'], [pct(1 - hyper(total, sum(early), size, 0, 0)), 'a play at 2 mana or less'], [pct(hyper(total, lands, size, 0, 1)), 'one land or none: send it back']];
    } else if (lor){
      const ink = sum(all.filter(x => x.c.ik));
      hand = [[pct(hyper(total, ink, size, 3, size)), '3 or more inkable cards in the opening 7'], [pct(1 - hyper(total, sum(early), size, 0, 1)), 'two or more plays at 2 ink or less'], [pct(1 - hyper(total, sum(costed.filter(x => x.c.co === 1)), size, 0, 0)), 'a 1-cost play for turn 1']];
    }
    const keep = mtg ? (big ? 'Keep 3 to 5 lands with ramp or card draw. A hand that does nothing before turn 4 goes back.' : kind === 'Aggro' ? 'Keep 2 or 3 lands and at least two plays you can make by turn 2.' : kind === 'Control' ? 'Keep 3 or 4 lands with an early answer or a way to draw cards.' : 'Keep 2 to 4 lands and something to do by turn 2.')
      : lor ? 'Keep 3 or more inkable cards and two cheap plays. Lorcana lets you put back any number of cards once, so send back expensive cards and uninkables you don’t need early.' : '';
    return {kind, plan, avg, lands, total, roles: roles.filter(r => r.n), early, mid, late, lo, hi, core, commander, good, watch, hand, keep, sum};
  }
  function strategyHTML(d){
    const P = deckPlan(d), g = d.guide || {}, t = x => typeof x === 'string' ? esc(x) : '';
    const unit = game === 'lorcana' ? 'ink' : game === 'mtg' ? 'mana' : 'cost';
    const byName = new Map(Object.keys(d.cards).map(nv => S().cat.rep(nv)).filter(Boolean).flatMap(c => [[String(c.n).toLowerCase(), c], [cardName(c).toLowerCase(), c]]));
    const keyChip = n => { const c = byName.get(String(n).toLowerCase()); return c ? cardChip(c) : `<span class="cchip plain-chip">${esc(n)}</span>`; };
    const phase = (title, when, list, note) => !list.length && !note ? '' : `<div class="phase"><div class="phase-h"><b>${title}</b><span>${when}${list.length ? ` · ${plural(P.sum(list), 'card')}` : ''}</span></div>${note ? `<p>${t(note)}</p>` : ''}<div class="phase-cards">${list.slice(0, 8).map(x => cardChip(x.c, x.q)).join('')}${list.length > 8 ? `<span class="muted small">+${list.length - 8} more</span>` : ''}</div></div>`;
    const saved = g.overview || g.early || g.middle || g.late || g.tip || (Array.isArray(g.win) && g.win.length) || (Array.isArray(g.keys) && g.keys.length);
    if (!P && !saved) return '';
    const ask = `Write me a full strategy guide for my deck “${d.name}”: the game plan turn by turn, what to keep and mulligan, the key cards and combos, how to play against aggro and control, and the first three changes you would make.`;
    return `<section class="card strategy" id="strategy">
      <div class="strat-head"><div><h2 class="sec">How this deck plays</h2>${P ? `<p class="muted small">Read from this list’s curve and card text. Card-text matching is approximate.</p>` : ''}</div><button type="button" class="btn" id="stratAsk" data-ask="${esc(ask)}"><svg class="ic"><use href="#i-spark"/></svg>Ask the advisor for a full guide</button></div>
      ${P ? `<div class="plan"><span class="plan-kind">${esc(P.kind)}</span><p>${esc(P.plan)}</p></div>` : ''}
      ${Array.isArray(g.themes) && g.themes.length ? `<div class="chips">${g.themes.slice(0, 8).map(x => `<span class="chip">${t(x)}</span>`).join('')}</div>` : ''}
      ${g.overview ? `<div class="guide-note"><span class="mini">Saved guide</span><p>${t(g.overview)}</p></div>` : ''}
      ${P ? `<h3 class="grp">Turn by turn</h3><div class="phases">
        ${P.commander.length ? `<div class="phase"><div class="phase-h"><b>Commander</b><span>always available</span></div><div class="phase-cards">${P.commander.map(c => cardChip(c)).join('')}</div></div>` : ''}
        ${phase('Early', `${P.lo} ${unit} or less`, P.early, g.early)}${phase('Middle', `${P.lo + 1} to ${P.hi} ${unit}`, P.mid, g.middle)}${phase('Closing', `${P.hi + 1} ${unit} and up`, P.late, g.late)}
      </div>` : g.early || g.middle || g.late ? `<h3 class="grp">Turn by turn</h3><dl class="cv-kv">${g.early ? `<dt>Early</dt><dd>${t(g.early)}</dd>` : ''}${g.middle ? `<dt>Middle</dt><dd>${t(g.middle)}</dd>` : ''}${g.late ? `<dt>Closing</dt><dd>${t(g.late)}</dd>` : ''}</dl>` : ''}
      ${P?.core.length ? `<h3 class="grp">The core <span class="muted">cards you run three or more of</span></h3><div class="chips">${P.core.map(x => cardChip(x.c, x.q)).join('')}</div>` : ''}
      ${Array.isArray(g.keys) && g.keys.length ? `<h3 class="grp">Key cards</h3><div class="chips">${g.keys.map(keyChip).join('')}</div>` : ''}
      ${Array.isArray(g.win) && g.win.length ? `<h3 class="grp">Wins with</h3><ul class="bullets">${g.win.map(x => `<li>${t(x)}</li>`).join('')}</ul>` : ''}
      ${P?.roles.length ? `<h3 class="grp">What it’s made of <span class="muted">open a row to see the cards</span></h3><div class="roles">${P.roles.map(r => `<details class="role"><summary><span class="role-l">${esc(r.label)}</span><span class="role-bar"><i style="width:${Math.min(100, Math.round(100 * r.n / Math.max(1, P.total - P.lands)))}%"></i></span><b>${r.n}</b></summary><p class="muted small">${esc(r.hint)}</p><div class="chips">${r.list.sort((a, b) => (a.c.co ?? 99) - (b.c.co ?? 99)).map(x => cardChip(x.c, x.q)).join('')}</div></details>`).join('')}</div>` : ''}
      ${P?.hand.length ? `<h3 class="grp">Opening hand</h3><p>${esc(P.keep)}</p><div class="odds">${P.hand.map(([v, l]) => `<div class="odd"><b>${v}</b><span>${esc(l)}</span></div>`).join('')}</div><p class="small"><button type="button" class="link" id="stratSim">Shuffle it a few thousand times in the Simulator</button></p>` : ''}
      ${P && (P.good.length || P.watch.length) ? `<div class="grid2 verdict">${P.good.length ? `<div><h3 class="grp">Strengths</h3><ul class="bullets ok">${P.good.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}${P.watch.length ? `<div><h3 class="grp">Watch out for</h3><ul class="bullets warn">${P.watch.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}</div>` : ''}
      ${g.tip ? `<h3 class="grp">Tip</h3><p>${t(g.tip)}</p>` : ''}
      ${Array.isArray(g.sideboard) && g.sideboard.length ? `<h3 class="grp">Sideboard</h3>${g.sideboard_plan ? `<p>${t(g.sideboard_plan)}</p>` : ''}<ul class="bullets">${g.sideboard.map(x => `<li>${+x?.[0] || 1} ${t(String(x?.[1] || ''))}</li>`).join('')}</ul>` : ''}
      ${saved && g.source ? `<p class="muted small">${t(g.source)}</p>` : ''}
    </section>`;
  }

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
          ${samples(r.sampleHands, d)}`;
        C.bars($('o1'), {categories: (r.landDist || []).map((_, i) => String(i)), series: [{name: 'Hands', color: c1, values: r.landDist || []}], format: pct, height: 190});
        const m = r.mulliganTo || {}; C.bars($('o2'), {categories: ['7', '6', '5', '4 or fewer'], series: [{name: 'Hands', color: c1, values: [m[7] || 0, m[6] || 0, m[5] || 0, m['4-'] || 0]}], format: pct, height: 190});
      } else if (game === 'lorcana'){
        host.innerHTML = `<section class="card"><div class="tiles">
          ${tile('Keep without mulligan', pct(r.keepRate), '3+ inkable, 2+ cheap')}${tile('Average inkable', (r.avgInkable ?? 0).toFixed(2), 'in the first 7')}
          ${tile('1-drop on turn 1', pct(r.pOneDropByT1), '')}${tile('3-drop on turn 3', pct(r.pThreeDropByT3 ?? r.pThreeByT3), '')}</div></section>
          <section class="card"><h2 class="sec">Inkable cards in the opening 7</h2><div id="o1"></div></section>${samples(r.sampleHands, d)}`;
        C.bars($('o1'), {categories: (r.inkableDist || []).map((_, i) => String(i)), series: [{name: 'Hands', color: c1, values: r.inkableDist || []}], format: pct, height: 190});
      } else {
        host.innerHTML = `<section class="card"><h2 class="sec">Card types in the opening hand (average)</h2><div id="o1"></div></section>${samples(r.sampleHands, d)}`;
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
  function samples(hands, d){
    if (!hands?.length) return '';
    const by = new Map(); for (const {card} of simDeck(d)){ by.set(String(card.n), card); by.set(cardName(card), card); if (card.v) by.set(`${card.n} - ${card.v}`, card); }
    return `<section class="card"><h2 class="sec">Sample opening hands</h2><p class="muted small">Hover a card to see it larger with its stats. Click it for the full card.</p><ol class="hands">${hands.slice(0, 5).map((hd, i) => `<li><span class="hand-l">Hand ${i + 1}</span><div class="hand-row">${hd.map(n => { const c = by.get(String(n)), u = c && imgUrl(c, 'normal'); return c ? `<button type="button" class="hand-card${u ? ' art' : ''}"${cardAttr(c)} aria-label="${esc(n)}">${u ? `<img src="${esc(u)}" alt="" loading="lazy">` : esc(n)}</button>` : `<span class="hand-card">${esc(n)}</span>`; }).join('')}</div></li>`).join('')}</ol></section>`;
  }

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
