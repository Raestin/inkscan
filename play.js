/* InkScan game tracker: life, lore, prizes, counters and tokens for a game at the table.
   The first half is the game itself (plain data, no screen) so it can be tested on its own; the second half
   draws it full-screen over the app. A game in progress is kept on this device per card game, so closing the
   tracker or the app never loses it. Nothing here is sent to the cloud. */
(function(root){
  'use strict';

  /* ---------- what each card game tracks ---------- */
  const GAMES = {
    mtg: {
      main: {label: 'Life', start: 20, starts: [20, 25, 30, 40]}, players: [2, 6], list: 'Tokens and counters',
      counters: [{k: 'poison', name: 'Poison', lose: 10}, {k: 'energy', name: 'Energy'}, {k: 'exp', name: 'Experience'}, {k: 'tax', name: 'Commander tax', step: 2}, {k: 'storm', name: 'Storm'}],
      flags: [{k: 'monarch', name: 'Monarch', one: true}, {k: 'init', name: 'Initiative', one: true}, {k: 'bless', name: "City's blessing"}],
      tokens: ['Treasure', 'Food', 'Clue', 'Blood', 'Map', '1/1 Soldier', '1/1 Spirit (flying)', '1/1 Goblin', '1/1 Saproling', '1/1 Elf Warrior', '1/1 Thopter (flying)', '2/2 Zombie', '3/3 Beast', '4/4 Angel (flying)', '+1/+1 counters']
    },
    lorcana: {
      main: {label: 'Lore', start: 0, min: 0, win: 20}, players: [2, 4], list: 'Damage and counters',
      counters: [], flags: [], tokens: ['Damage', 'Ink ready', 'Cards under'], named: 'Damage on a character'
    },
    onepiece: {
      main: {label: 'Life', start: 5, starts: [4, 5, 6], min: 0, zero: 'No life left'}, players: [2, 2], list: 'Counters',
      counters: [{k: 'don', name: 'DON!!', max: 10, pin: true}], flags: [], tokens: ['Rested DON!!', 'Attached DON!!', 'Trash']
    },
    pokemon: {
      main: {label: 'Prizes left', start: 6, starts: [6, 4, 3], min: 0, max: 'start', win: 0}, players: [2, 2], list: 'Damage',
      counters: [], flags: ['Poisoned', 'Burned', 'Asleep', 'Confused', 'Paralyzed'].map(n => ({k: n.toLowerCase(), name: n})),
      tokens: ['Active', 'Bench 1', 'Bench 2', 'Bench 3', 'Bench 4', 'Bench 5'], tokenStep: 10, flagsTitle: 'Active Pokémon is'
    }
  };
  const cfg = game => GAMES[game] || GAMES.mtg;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let seq = 0;
  const newId = () => 't' + Date.now().toString(36) + (seq++).toString(36);
  const MAX_LOG = 400, JOIN_MS = 2500;

  function tracker(o){ return {id: newId(), k: o.k || null, name: String(o.name || 'Counter').slice(0, 40), n: o.n || 0, step: o.step || 1, max: o.max ?? null, lose: o.lose ?? null, kind: o.kind || 'token', pin: !!o.pin, from: o.from ?? null}; }

  function newGame(game, o){
    o = o || {};
    const c = cfg(game), n = clamp(o.players || 2, c.players[0], c.players[1]), commander = game === 'mtg' && !!o.commander;
    const start = Number.isFinite(o.start) ? o.start : commander ? 40 : c.main.start;
    const players = Array.from({length: n}, (_, i) => ({name: String(o.names?.[i] || (i === 0 ? 'You' : n === 2 ? 'Opponent' : `Player ${i + 1}`)).slice(0, 24), main: start, trackers: []}));
    players.forEach((p, i) => {
      for (const d of c.counters) if (d.pin) p.trackers.push(tracker({...d, kind: 'counter'}));
      if (commander) players.forEach((_, j) => { if (j !== i) p.trackers.push(tracker({name: 'Commander damage', lose: 21, pin: true, kind: 'cmd', from: j})); });
    });
    return {v: 1, game, commander, start, players, turn: 1, active: 0, log: [], at: o.now || Date.now()};
  }

  const trackerName = (s, t) => t.kind === 'cmd' ? `Cmdr dmg: ${s.players[t.from]?.name || 'opponent'}` : t.name;
  function labelOf(s, p, id){ if (id === 'main') return cfg(s.game).main.label; const t = s.players[p].trackers.find(x => x.id === id); return t ? trackerName(s, t) : ''; }
  function push(s, e){ s.log.push(e); if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG); }

  // Add or subtract on a player's main number ('main') or one of their trackers. Quick taps in a row join into
  // one line of the history, so "−7" reads as one hit and one Undo takes it back.
  function change(s, p, id, delta, now){
    now = now || Date.now();
    const c = cfg(s.game), pl = s.players[p]; if (!pl || !delta) return false;
    const sets = [];
    if (id === 'main'){
      const to = clamp(pl.main + delta, c.main.min ?? -999, c.main.max === 'start' ? s.start : 9999);
      if (to === pl.main) return false;
      sets.push({id, from: pl.main, to}); pl.main = to;
    } else {
      const t = pl.trackers.find(x => x.id === id); if (!t || t.kind === 'flag') return false;
      const to = clamp(t.n + delta * t.step, 0, t.max ?? 99999); if (to === t.n) return false;
      const d = to - t.n; sets.push({id, from: t.n, to}); t.n = to;
      // commander damage is damage: it comes off the life total as well
      if (t.kind === 'cmd'){ sets.push({id: 'main', from: pl.main, to: pl.main - d}); pl.main -= d; }
    }
    const last = s.log[s.log.length - 1];
    if (last && last.type === 'set' && last.p === p && last.id === id && last.turn === s.turn && now - last.t < JOIN_MS){
      for (const x of sets){ const y = last.sets.find(z => z.id === x.id); if (y) y.to = x.to; else last.sets.push(x); }
      last.t = now;
      if (last.sets.every(x => x.from === x.to)) s.log.pop();
    } else push(s, {type: 'set', p, id, label: labelOf(s, p, id), sets, t: now, turn: s.turn});
    return true;
  }

  function addTracker(s, p, o, now){
    const pl = s.players[p]; if (!pl) return null;
    const same = pl.trackers.find(t => t.kind === (o.kind || 'token') && (o.k ? t.k === o.k : t.name.toLowerCase() === String(o.name).toLowerCase()));
    if (same) return same;
    const t = tracker(o), moved = [];
    // one holder at a time (the monarch, the initiative): taking it takes it from whoever had it
    if (o.kind === 'flag' && o.one) s.players.forEach((q, i) => { const at = q.trackers.findIndex(x => x.kind === 'flag' && x.k === o.k); if (at >= 0) moved.push({p: i, at, tracker: q.trackers.splice(at, 1)[0]}); });
    pl.trackers.push(t);
    push(s, {type: 'add', p, id: t.id, label: t.name, moved, t: now || Date.now(), turn: s.turn});
    return t;
  }
  function removeTracker(s, p, id, now){
    const pl = s.players[p], at = pl ? pl.trackers.findIndex(t => t.id === id) : -1; if (at < 0) return false;
    const [t] = pl.trackers.splice(at, 1);
    push(s, {type: 'remove', p, at, tracker: t, label: trackerName(s, t), t: now || Date.now(), turn: s.turn});
    return true;
  }

  const out = (s, i) => status(s, i)?.kind === 'out';
  function nextTurn(s, now){
    const n = s.players.length, from = {turn: s.turn, active: s.active};
    let a = s.active;
    for (let i = 0; i < n; i++){ a = (a + 1) % n; if (a === 0) s.turn++; if (!out(s, a)) break; }
    s.active = a;
    push(s, {type: 'turn', from, to: s.active, t: now || Date.now(), turn: s.turn});
  }

  // Takes back the last line of the history. Returns a short description, or null when there is nothing left.
  function undo(s){
    const e = s.log.pop(); if (!e) return null;
    if (e.type === 'turn'){ s.turn = e.from.turn; s.active = e.from.active; return 'Turn taken back'; }
    const pl = s.players[e.p]; if (!pl) return null;
    if (e.type === 'set'){
      for (const x of e.sets){ if (x.id === 'main') pl.main = x.from; else { const t = pl.trackers.find(y => y.id === x.id); if (t) t.n = x.from; } }
      return `${pl.name}: ${e.label} back to ${e.sets[0].from}`;
    }
    if (e.type === 'add'){
      pl.trackers = pl.trackers.filter(t => t.id !== e.id);
      for (const m of e.moved || []) s.players[m.p]?.trackers.splice(m.at, 0, m.tracker);
      return `${pl.name}: ${e.label} removed`;
    }
    if (e.type === 'remove'){ pl.trackers.splice(Math.min(e.at, pl.trackers.length), 0, e.tracker); return `${pl.name}: ${e.label} is back`; }
    return null;
  }

  // Has this player won, lost, or run out? null while they are still in it.
  function status(s, i){
    const c = cfg(s.game), p = s.players[i]; if (!p) return null;
    if (c.main.win != null && (c.main.win === 0 ? p.main <= 0 : p.main >= c.main.win)) return {kind: 'win', label: 'Wins'};
    if (c.main.zero && p.main <= 0) return {kind: 'warn', label: c.main.zero};
    if (s.game === 'mtg'){
      if (p.main <= 0) return {kind: 'out', label: 'Out'};
      const t = p.trackers.find(x => x.lose != null && x.n >= x.lose);
      if (t) return {kind: 'out', label: t.kind === 'cmd' ? 'Out: commander damage' : `Out: ${t.name.toLowerCase()}`};
    }
    return null;
  }

  function historyLines(s){
    return s.log.map(e => {
      const who = e.p != null ? s.players[e.p]?.name || '' : '';
      if (e.type === 'turn') return {turn: e.turn, text: `${s.players[e.to]?.name || 'Next player'}'s turn`};
      if (e.type === 'set'){ const x = e.sets[0], d = x.to - x.from; return {turn: e.turn, text: `${who}: ${e.label} ${x.from} → ${x.to}`, delta: (d > 0 ? '+' : '−') + Math.abs(d)}; }
      return {turn: e.turn, text: `${who}: ${e.label} ${e.type === 'add' ? 'added' : 'removed'}`};
    });
  }

  const core = {GAMES, cfg, newGame, change, addTracker, removeTracker, nextTurn, undo, status, historyLines, trackerName};
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  root.InkPlay = core;
  if (!root.document) return;

  /* ---------- the screen ---------- */
  const doc = root.document, A = () => root.InkApp || {};
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
  const ic = n => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const ls = {get(k, d){ try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch(e){ return d; } }, set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }};
  let el = null, state = null, game = 'mtg', isOpen = false, lock = null, deltaT = {}, dlgP = null;
  const key = () => `inkscan.play.${game}`;
  const prefs = () => ({flip: true, awake: true, ...ls.get('inkscan.play.prefs', {})});
  const setPref = (k, v) => ls.set('inkscan.play.prefs', {...prefs(), [k]: v});
  const save = () => ls.set(key(), state);
  const buzz = () => { try { navigator.vibrate?.(8); } catch(e){} };

  function ensure(){
    if (el) return;
    el = doc.createElement('div'); el.id = 'play'; el.className = 'play'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Game tracker');
    doc.body.append(el);
    el.addEventListener('click', onClick);
    el.addEventListener('pointerdown', onDown);
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, stopHold, true);
    el.addEventListener('contextmenu', e => { if (e.target.closest('.pp-zone')) e.preventDefault(); });
    el.addEventListener('submit', onSubmit);
    root.addEventListener('popstate', () => { if (isOpen) close(true); });
    doc.addEventListener('visibilitychange', () => { if (isOpen && !doc.hidden) awake(); });
    doc.addEventListener('keydown', e => { if (isOpen && e.key === 'Escape'){ e.stopPropagation(); if (el.querySelector('.play-dlg')) closeDlg(); else close(); } }, true);
  }
  async function awake(){
    try { if (lock){ await lock.release(); lock = null; } if (isOpen && prefs().awake && navigator.wakeLock) lock = await navigator.wakeLock.request('screen'); } catch(e){ lock = null; }
  }

  function open(o){
    ensure(); o = o || {};
    game = o.game || A().game || 'mtg';
    state = ls.get(key(), null);
    if (state && (state.v !== 1 || state.game !== game || !Array.isArray(state.players))) state = null;
    el.hidden = false; doc.documentElement.classList.add('playing');
    if (!isOpen){ isOpen = true; try { history.pushState({play: 1}, ''); } catch(e){} }
    awake();
    if (state) render(); else { el.innerHTML = ''; setup(o); }
  }
  function close(fromPop){
    if (!isOpen) return;
    isOpen = false; stopHold(); el.hidden = true; el.innerHTML = ''; doc.documentElement.classList.remove('playing');
    if (lock){ lock.release().catch(() => {}); lock = null; }
    if (!fromPop){ try { history.back(); } catch(e){} }
  }

  /* ---------- drawing ---------- */
  function chip(s, p, t){
    if (t.kind === 'flag') return `<span class="tk flag" data-id="${t.id}"><span class="tk-l"><b>${esc(t.name)}</b></span><button type="button" data-act="drop" aria-label="Remove ${esc(t.name)}">×</button></span>`;
    const name = trackerName(s, t), at = t.lose != null && t.n >= t.lose;
    return `<span class="tk${at ? ' hot' : ''}" data-id="${t.id}"><button type="button" data-tstep="-1" aria-label="${esc(name)} minus ${t.step}">−</button><span class="tk-l"><small>${esc(name)}</small><b data-val="${t.id}">${t.n}</b></span><button type="button" data-tstep="1" aria-label="${esc(name)} plus ${t.step}">+</button></span>`;
  }
  function panel(s, i){
    const c = cfg(s.game), p = s.players[i], st = status(s, i);
    return `<section class="pp pc${i % 6}${s.active === i ? ' active' : ''}${st ? ' is-' + st.kind : ''}" data-p="${i}" aria-label="${esc(p.name)}">
      <header class="pp-head"><button type="button" class="pp-name" data-act="name">${esc(p.name)}</button><span class="pp-badge" data-badge>${st ? esc(st.label) : s.active === i ? 'Turn' : ''}</span></header>
      <div class="pp-main">
        <button type="button" class="pp-zone minus" data-step="-1" aria-label="${esc(p.name)}: ${esc(c.main.label)} minus 1"><span aria-hidden="true">−</span></button>
        <div class="pp-num"><i class="pp-delta" data-delta></i><b data-val="main">${p.main}</b><small>${esc(c.main.label)}${c.main.win ? ` · first to ${c.main.win}` : ''}</small></div>
        <button type="button" class="pp-zone plus" data-step="1" aria-label="${esc(p.name)}: ${esc(c.main.label)} plus 1"><span aria-hidden="true">+</span></button>
      </div>
      <div class="pp-strip">${p.trackers.map(t => chip(s, i, t)).join('')}<button type="button" class="tk add" data-act="add">${ic('plus')}Add</button></div>
    </section>`;
  }
  function bar(s){
    return `<div class="play-bar">
      <button type="button" class="iconbtn" data-act="close" aria-label="Close the tracker">${ic('x')}</button>
      <button type="button" class="play-turn" data-act="next" aria-label="Next turn"><b data-turn></b><small>Tap for next turn</small></button>
      <button type="button" class="iconbtn" data-act="dice" aria-label="Dice and coin">${ic('dice')}</button>
      <button type="button" class="iconbtn" data-act="undo" aria-label="Undo">${ic('undo')}</button>
      <button type="button" class="iconbtn" data-act="menu" aria-label="More">${ic('more')}</button>
    </div>`;
  }
  function render(){
    const s = state, n = s.players.length;
    el.className = `play n${n}${n === 2 && prefs().flip ? ' flip' : ''}`;
    el.dataset.game = s.game;
    // two players sit across the phone: the opponent on top, the bar between them
    const order = n === 2 ? [1, 0] : s.players.map((_, i) => i);
    el.innerHTML = n === 2 ? panel(s, 1) + bar(s) + panel(s, 0) : bar(s) + `<div class="play-grid">${order.map(i => panel(s, i)).join('')}</div>`;
    sync();
  }
  // Refresh numbers and badges in place, so a held button keeps repeating on the same element.
  function sync(){
    const s = state; if (!s || !isOpen) return;
    for (const sec of el.querySelectorAll('.pp')){
      const i = +sec.dataset.p, p = s.players[i], st = status(s, i);
      for (const v of sec.querySelectorAll('[data-val]')){
        const id = v.dataset.val, t = id === 'main' ? null : p.trackers.find(x => x.id === id);
        v.textContent = id === 'main' ? p.main : t ? t.n : '';
        if (t) v.closest('.tk').classList.toggle('hot', t.lose != null && t.n >= t.lose);
      }
      sec.className = `pp pc${i % 6}${s.active === i ? ' active' : ''}${st ? ' is-' + st.kind : ''}`;
      sec.querySelector('[data-badge]').textContent = st ? st.label : s.active === i ? 'Turn' : '';
      const last = s.log[s.log.length - 1], d = sec.querySelector('[data-delta]');
      const m = last && last.type === 'set' && last.p === i && Date.now() - last.t < JOIN_MS ? last.sets.find(x => x.id === 'main') : null;
      d.textContent = m && m.to !== m.from ? (m.to > m.from ? '+' : '−') + Math.abs(m.to - m.from) : '';
    }
    const t = el.querySelector('[data-turn]'); if (t) t.textContent = `Round ${s.turn} · ${s.players[s.active].name}`;
  }
  function bump(p, id, delta){
    if (!change(state, p, id, delta)) return false;
    save(); sync(); buzz();
    clearTimeout(deltaT[p]); deltaT[p] = setTimeout(sync, JOIN_MS + 50);
    return true;
  }

  /* ---------- taps ---------- */
  let hold = null;
  function stopHold(){ if (hold){ clearTimeout(hold.t); clearInterval(hold.i); hold = null; } }
  function onDown(e){
    const z = e.target.closest('.pp-zone'); if (!z || e.button > 0) return;
    const p = +z.closest('.pp').dataset.p, d = +z.dataset.step;
    stopHold(); bump(p, 'main', d);
    hold = {t: setTimeout(() => { hold.i = setInterval(() => { if (!bump(p, 'main', d)) stopHold(); }, 90); }, 420)};
  }
  function onClick(e){
    const b = e.target.closest('button'); if (!b || !el.contains(b)) return;
    if (b.dataset.pick != null) return onPick(b);
    const sec = b.closest('.pp'), p = sec ? +sec.dataset.p : null;
    // the big zones act on pointer-down; a keyboard "click" (no pointer) still counts
    if (b.dataset.step){ if (e.detail === 0) bump(p, 'main', +b.dataset.step); return; }
    if (b.dataset.tstep){
      const id = b.closest('.tk').dataset.id, t = state.players[p].trackers.find(x => x.id === id); if (!t) return;
      if (+b.dataset.tstep < 0 && t.n === 0 && !t.pin){ removeTracker(state, p, id); save(); render(); return; }
      bump(p, id, +b.dataset.tstep); return;
    }
    const act = b.dataset.act;
    if (act === 'close') return close();
    if (act === 'next'){ nextTurn(state); save(); sync(); buzz(); return; }
    if (act === 'undo'){ const m = undo(state); save(); render(); A().toast?.(m || 'Nothing to undo'); return; }
    if (act === 'drop'){ removeTracker(state, p, b.closest('.tk').dataset.id); save(); render(); return; }
    if (act === 'name'){ const v = prompt('Player name', state.players[p].name); if (v && v.trim()){ state.players[p].name = v.trim().slice(0, 24); save(); render(); } return; }
    if (act === 'add') return addDlg(p);
    if (act === 'dice') return diceDlg();
    if (act === 'menu') return menuDlg();
    if (act === 'dlg-close') return closeDlg();
  }

  /* ---------- dialogs ---------- */
  function dlg(title, html){
    clearDlg();
    el.insertAdjacentHTML('beforeend', `<div class="play-scrim" data-scrim></div><div class="play-dlg" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button type="button" class="iconbtn small" data-act="dlg-close" aria-label="Close">${ic('x')}</button></header><div class="play-dlg-body">${html}</div></div>`);
    el.querySelector('[data-scrim]').onclick = closeDlg;
  }
  function clearDlg(){ for (const x of el.querySelectorAll('.play-scrim,.play-dlg')) x.remove(); dlgP = null; }
  // Closing the set-up of a first game, with no game to go back to, closes the tracker.
  function closeDlg(){ clearDlg(); if (!state && isOpen) close(); }
  const seg = (name, opts, cur) => `<div class="seg full" role="group">${opts.map(([v, l]) => `<button type="button" data-pick="${name}" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(l)}</button>`).join('')}</div>`;

  let draft = null;
  function setup(o){
    const c = cfg(game), deck = o?.deck || null, cmd = game === 'mtg' && !!(deck && (deck.format === 'commander' || deck.commanders?.length));
    draft = draft && draft.game === game && !o?.deck ? draft : {game, players: cmd ? 4 : 2, commander: cmd, start: cmd ? 40 : c.main.start};
    drawSetup();
  }
  function drawSetup(){
    const c = cfg(game), d = draft, counts = []; for (let n = c.players[0]; n <= c.players[1]; n++) counts.push([n, String(n)]);
    dlg(`New ${A().gameName || ''} game`.replace('  ', ' '), `
      ${counts.length > 1 ? `<label class="play-f"><span>Players</span>${seg('players', counts, d.players)}</label>` : ''}
      ${game === 'mtg' ? `<label class="play-f"><span>Format</span>${seg('commander', [['', 'Standard game'], ['1', 'Commander']], d.commander ? '1' : '')}</label>` : ''}
      ${c.main.starts ? `<label class="play-f"><span>Starting ${esc(c.main.label.toLowerCase().replace(' left', ''))}</span>${seg('start', c.main.starts.map(v => [v, String(v)]), d.start)}</label>` : ''}
      <button type="button" class="btn primary block" data-pick="start-game">Start</button>`);
  }
  function onPick(b){
    const k = b.dataset.pick, v = b.dataset.v;
    if (k === 'players'){ draft.players = +v; return drawSetup(); }
    if (k === 'commander'){ draft.commander = !!v; draft.start = v ? 40 : 20; return drawSetup(); }
    if (k === 'start'){ draft.start = +v; return drawSetup(); }
    if (k === 'start-game'){
      const old = state?.players.map(p => p.name), keep = old && old.length === draft.players ? old : null;
      state = newGame(game, {...draft, names: keep}); draft = null; save(); closeDlg(); render(); return;
    }
    if (k === 'counter' || k === 'flag' || k === 'token'){
      const c = cfg(game), p = dlgP;
      const def = k === 'counter' ? c.counters.find(x => x.k === v) : k === 'flag' ? c.flags.find(x => x.k === v) : {name: v, step: c.tokenStep || 1, n: c.tokenStep ? 0 : 1};
      if (def) addTracker(state, p, {...def, kind: k});
      save(); closeDlg(); render(); return;
    }
    if (k === 'pref'){ setPref(v, !prefs()[v]); if (v === 'awake') awake(); closeDlg(); render(); return; }
    if (k === 'new'){ if (!confirm('Start a new game? This one will be cleared.')) return; draft = null; closeDlg(); setup({}); return; }
    if (k === 'history') return historyDlg();
    if (k === 'roll') return roll(v);
  }
  function addDlg(p){
    const c = cfg(game), have = state.players[p].trackers, has = (kind, k) => have.some(t => t.kind === kind && (t.k === k || t.name === k));
    const row = (kind, list) => list.length ? `<div class="play-picks">${list.map(([v, l]) => `<button type="button" class="chip-btn" data-pick="${kind}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>` : '';
    const counters = c.counters.filter(x => !has('counter', x.k) && (x.k !== 'tax' || state.commander)).map(x => [x.k, x.name]);
    const flags = c.flags.filter(x => !has('flag', x.k)).map(x => [x.k, x.name]);
    const tokens = c.tokens.filter(n => !has('token', n)).map(n => [n, n]);
    dlg(`Add for ${state.players[p].name}`, `
      ${counters.length ? `<h3>Counters</h3>${row('counter', counters)}` : ''}
      ${flags.length ? `<h3>${esc(c.flagsTitle || 'Status')}</h3>${row('flag', flags)}` : ''}
      ${tokens.length ? `<h3>${esc(c.list)}</h3>${row('token', tokens)}` : ''}
      <h3>${esc(c.named || 'Something else')}</h3>
      <form class="play-custom" data-form="custom"><input type="text" name="name" maxlength="40" placeholder="${game === 'lorcana' ? 'Character name' : game === 'pokemon' ? 'Pokémon name' : 'Name, for example 2/2 Bear'}" autocomplete="off"><button class="btn primary" type="submit">Add</button></form>`);
    dlgP = p;
  }
  function onSubmit(e){
    const f = e.target.closest('[data-form="custom"]'); if (!f) return;
    e.preventDefault();
    const c = cfg(game), name = f.elements.name.value.trim(); if (!name || dlgP == null) return;
    addTracker(state, dlgP, {name: c.named && game === 'lorcana' ? `Damage: ${name}` : name, kind: 'token', step: c.tokenStep || 1, n: c.tokenStep ? 0 : 1});
    save(); closeDlg(); render();
  }
  function menuDlg(){
    const p = prefs(), two = state.players.length === 2;
    dlg('Game', `<div class="menu">
      <button type="button" class="menurow" data-pick="new">${ic('plus')}<span><b>New game</b><small>Reset every number and start again</small></span></button>
      <button type="button" class="menurow" data-pick="history">${ic('list')}<span><b>History</b><small>Every change this game, newest first</small></span></button>
      ${two ? `<button type="button" class="menurow" data-pick="pref" data-v="flip">${ic('hand')}<span><b>Opponent's side faces them: ${p.flip ? 'on' : 'off'}</b><small>For a phone lying flat between two players</small></span></button>` : ''}
      <button type="button" class="menurow" data-pick="pref" data-v="awake">${ic('check')}<span><b>Keep the screen on: ${p.awake ? 'on' : 'off'}</b><small>While the tracker is open</small></span></button>
    </div><p class="note">Tap a name to change it. Hold − or + to count quickly. Take a counter below zero to remove it.</p>`);
  }
  function historyDlg(){
    const lines = historyLines(state).reverse();
    dlg('History', lines.length ? `<ol class="play-log">${lines.map(l => `<li><small>Round ${l.turn}</small><span>${esc(l.text)}</span>${l.delta ? `<b>${esc(l.delta)}</b>` : ''}</li>`).join('')}</ol>` : '<p class="note">Nothing has changed yet.</p>');
  }
  function diceDlg(){
    dlg('Dice and coin', `<div class="play-roll" data-roll aria-live="polite"><b>?</b><small>Pick one</small></div>
      <div class="play-picks center">${[['coin', 'Flip a coin'], ['6', 'Roll a D6'], ['20', 'Roll a D20'], ['first', 'Who goes first']].map(([v, l]) => `<button type="button" class="btn" data-pick="roll" data-v="${v}">${l}</button>`).join('')}</div>`);
  }
  const rand = n => { const a = new Uint32Array(1); (root.crypto || {getRandomValues: x => { x[0] = Math.random() * 2 ** 32; return x; }}).getRandomValues(a); return a[0] % n; };
  function roll(v){
    const box = el.querySelector('[data-roll]'); if (!box) return;
    const r = v === 'coin' ? [rand(2) ? 'Heads' : 'Tails', 'Coin'] : v === 'first' ? [state.players[rand(state.players.length)].name, 'goes first'] : [String(1 + rand(+v)), `D${v}`];
    box.innerHTML = `<b>${esc(r[0])}</b><small>${esc(r[1])}</small>`; box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop'); buzz();
  }

  root.InkPlay = {...core, open, close, get isOpen(){ return isOpen; }};
})(typeof self !== 'undefined' ? self : globalThis);
