/* InkScan Portal advisor: a chat with Claude that can read the collection and decks, search cards, run
   simulations, price shopping lists and propose decks. Claude runs on the Supabase "advisor" function
   (the API key stays there); the tools run here in the browser against the loaded data.
   The conversation is kept per game in this browser and is only ever appended to. */
(function(root){
  'use strict';
  const D = PortalData;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
  const money = v => v == null ? null : Math.round(v * 100) / 100;
  const MAX_STEPS = 16;
  let ctx = null, host = null, busy = false, live = null;
  const key = () => `portal.chat.${ctx.game}`;
  const chat = () => D.lsGet(key(), {messages: [], saved: {}});
  const store = c => { if (!D.lsSet(key(), c)) ctx.toast('This conversation is too big to keep in the browser. Start a new one.'); };

  const TOOL_LABEL = {get_collection: 'Read your collection', list_decks: 'Listed your decks', get_deck: 'Opened a deck', search_cards: 'Searched cards', simulate: 'Ran a simulation', buy_plan: 'Priced a shopping list', propose_deck: 'Drafted a deck'};
  const SUGGEST = {
    mtg: ['Which of my decks are closest to finished, and what should I buy first?', 'Build a Pauper deck using only cards I own (lands aside).', 'Goldfish my Voja deck and tell me where it stumbles.', 'What in my collection is worth trading away?'],
    lorcana: ['Build the best 60-card deck I can from what I own.', 'Which two inks does my collection support best?', 'Simulate my strongest deck and tell me how fast it reaches 20 lore.', 'What should I buy next to make my best deck stronger?'],
    onepiece: ['Which of my decks is closest to complete?', 'What should I buy next?'],
    pokemon: ['Which of my decks is closest to complete?', 'What should I buy next?']
  };

  /* ---------- tools ---------- */
  const S = () => D.state;
  const sameGame = g => !g || g === ctx.game;
  const otherGame = g => ({error: `The portal currently has ${ctx.gameDef().name} loaded. Ask the user to switch the game picker to ${InkGames.get(g).name} for that.`});
  const cardInfo = (c, extra) => c ? Object.assign({name: ctx.cardName(c), type: c.ty || undefined, cost: ctx.game === 'mtg' ? (c.mc || undefined) : c.co ?? undefined, mana_value: ctx.game === 'mtg' ? c.co : undefined,
    colors: c.i || undefined, rarity: c.r || undefined, set: c.s ? String(c.s).toUpperCase() : undefined, inkable: ctx.game === 'lorcana' ? !!c.ik : undefined, lore: ctx.game === 'lorcana' ? c.lo ?? undefined : undefined,
    power: c.st ?? undefined, toughness: ctx.game === 'mtg' ? c.wp ?? undefined : undefined, text: c.tx || undefined,
    legal: ctx.game === 'mtg' && c.lgs ? Object.entries(c.lgs).filter(([, v]) => v === 'legal').map(([k]) => k) : undefined,
    price_usd: money(c.p ?? c.pf)}, extra || {}) : null;
  function deckSummary(d){ const st = D.deckStats(d); return {id: d.id, name: d.name, format: d.format || (d.commanders.length ? 'commander' : undefined), cards: st.total, size: st.size, built: d.built || undefined, still_to_add: d.built && d.todo ? Object.fromEntries(Object.entries(d.todo).map(([nv, n]) => [ctx.nvName(nv), n])) : undefined, favorite: d.fav || undefined, missing: st.missing, cost_to_finish_usd: money(st.missCost), still_loading: st.unknown || undefined}; }
  async function cardsFromNames(list){
    const cards = {}, unresolved = [];
    for (const {name, qty} of list || []){ const nv = await D.resolveName(ctx.game, name); if (nv) cards[nv] = (cards[nv] || 0) + Math.max(1, qty | 0); else unresolved.push(name); }
    return {cards, unresolved};
  }
  const TOOLS = {
    async get_collection({game, filter, limit}){
      if (!sameGame(game)) return otherGame(game);
      const f = String(filter || '').toLowerCase(), byNV = new Map();
      for (const [id, v] of S().inv){ const c = S().cat.byId.get(id); if (!c) continue; const e = byNV.get(c.nv) || {c, n: 0, value: 0}; e.n += v.q + v.f + v.rf; e.value += D.ownedValue(id, v).value; byNV.set(c.nv, e); }
      let rows = [...byNV.values()].filter(e => !f || `${ctx.cardName(e.c)} ${e.c.ty || ''} ${e.c.tx || ''}`.toLowerCase().includes(f));
      rows.sort((a, b) => ctx.cardName(a.c).localeCompare(ctx.cardName(b.c)));
      const total = rows.length; rows = rows.slice(0, Math.max(1, Math.min(1500, limit || 400)));
      return {game: ctx.game, distinct_cards: total, returned: rows.length, cards: rows.map(e => ({...cardInfo(e.c, {owned: e.n, free: D.freeNV(e.c.nv), value_usd: money(e.value)}), text: undefined, legal: undefined, set: undefined}))};
    },
    async list_decks({game}){ if (!sameGame(game)) return otherGame(game); return {game: ctx.game, decks: S().decks.map(deckSummary)}; },
    async get_deck({deck_id}){
      const d = S().decks.find(x => x.id === deck_id); if (!d) return {error: 'No deck with that id. Use list_decks.'};
      const st = D.deckStats(d);
      return {...deckSummary(d), commanders: d.commanders.map(ctx.nvName), guide: d.guide || undefined,
        list: st.rows.map(r => r.c ? {qty: r.q, ...cardInfo(r.c, {owned_free: r.free, need_to_buy: r.need || undefined}), legal: undefined, set: undefined} : {qty: r.q, name: ctx.nvName(r.nv), note: 'card data still loading'})};
    },
    async search_cards({game, query, limit}){
      if (!sameGame(game)) return otherGame(game);
      const r = await D.searchCards(ctx.game, query, limit || 20);
      return {total: r.total, cards: r.cards.map(c => cardInfo(c, {owned: D.ownedNV(c.nv)}))};
    },
    async simulate({kind, deck_id, game, cards, key_cards, on_play, turns}){
      if (!sameGame(game)) return otherGame(game);
      let d = deck_id ? S().decks.find(x => x.id === deck_id) : null, unresolved = [];
      if (!d){ if (!cards?.length) return {error: 'Give deck_id or cards.'}; const r = await cardsFromNames(cards); unresolved = r.unresolved; d = {id: 'draft', name: 'Draft', cards: r.cards, commanders: [], format: null}; }
      const keyNVs = []; for (const n of key_cards || []){ const nv = await D.resolveName(ctx.game, n); if (nv && d.cards[nv]) keyNVs.push(nv); }
      const opts = {mode: kind, onPlay: on_play !== false, turns: Math.max(4, Math.min(15, turns || 10)), keys: keyNVs.slice(0, 4), oddsKeys: keyNVs.slice(0, 4), oddsNeed: 1};
      if (kind === 'goldfish' && !['mtg', 'lorcana'].includes(ctx.game)) return {error: 'Goldfish runs for Magic and Lorcana only.'};
      if (kind === 'odds' && !keyNVs.length) return {error: 'Name the cards to draw in key_cards (they must be in the deck).'};
      const res = ctx.runSim(d, opts), r = structuredClone(res.r);
      if (r.sampleHands) r.sampleHands = r.sampleHands.slice(0, 3);
      return {deck: d.name, kind, on_play: opts.onPlay, result: r, assumptions: (InkSim.ASSUMPTIONS || {})[ctx.game] || (InkSim.ASSUMPTIONS || {}).other, unresolved: unresolved.length ? unresolved : undefined};
    },
    async buy_plan({deck_ids}){
      const ids = (deck_ids || []).filter(id => S().decks.some(d => d.id === id)); if (!ids.length) return {error: 'No matching decks. Use list_decks for ids.'};
      const p = ctx.buyPlan(ids, false);
      return {decks: ids.map(id => S().decks.find(d => d.id === id).name), total_usd: money(p.total), cards_to_buy: p.cards, unpriced_cards: p.unpriced, list: p.rows.slice(0, 200).map(r => ({qty: r.qty, name: ctx.nvName(r.nv), each_usd: money(r.price), for: r.decks}))};
    },
    async propose_deck(input, id){
      if (!sameGame(input.game)) return otherGame(input.game);
      const {cards, unresolved} = await cardsFromNames(input.cards);
      const commanders = []; for (const n of input.commanders || []){ const nv = await D.resolveName(ctx.game, n); if (nv){ commanders.push(nv); if (!cards[nv]) cards[nv] = 1; } else unresolved.push(n); }
      const draft = {id: D.newId(), name: String(input.name || 'New deck').slice(0, 80), cards, commanders, meta: {}, format: ctx.game === 'mtg' ? (InkGames.get('mtg').formats[input.format] ? input.format : commanders.length ? 'commander' : null) : null, built: false, fav: false,
        guide: input.notes ? {overview: String(input.notes).slice(0, 1200), source: 'Drafted by the InkScan Portal advisor.'} : null};
      const c = chat(); c.proposals = c.proposals || {}; c.proposals[id] = draft; store(c);
      const st = D.deckStats(draft);
      return {shown_to_user: true, saved: false, cards: st.total, owned_pct: Math.round(st.pct * 100), missing: st.missing, cost_to_finish_usd: money(st.missCost), unresolved: unresolved.length ? unresolved : undefined};
    }
  };

  /* ---------- relay ---------- */
  async function call(messages, onEvent){
    const tok = await D.token(); if (!tok) throw Error('Sign in again to use the advisor.');
    const r = await fetch(`${D.SB_URL}/functions/v1/advisor`, {method: 'POST', headers: {Authorization: 'Bearer ' + tok, apikey: D.SB_KEY, 'Content-Type': 'application/json'}, body: JSON.stringify({messages, today: new Date().toISOString().slice(0, 10)})});
    if (!r.ok){ const j = await r.json().catch(() => ({})); throw Error(j.error || (r.status === 404 ? 'The advisor function isn\'t deployed yet.' : `The advisor answered ${r.status}.`)); }
    const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '', final = null;
    for (;;){
      const {value, done} = await reader.read(); if (done) break;
      buf += dec.decode(value, {stream: true}); let i;
      while ((i = buf.indexOf('\n')) >= 0){ const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; const ev = JSON.parse(line); if (ev.t === 'final') final = ev; else if (ev.t === 'error') throw Error(ev.v); else onEvent(ev); }
    }
    if (!final) throw Error('The advisor stopped before answering. Try again.');
    return final;
  }

  async function ask(text){
    if (busy || !text.trim()) return;
    busy = true; const c = chat();
    c.messages.push({role: 'user', content: [{type: 'text', text: text.trim()}]}); store(c); paint();
    try {
      for (let step = 0; step < MAX_STEPS; step++){
        live = {text: '', status: 'Thinking…'}; paintLive();
        const fin = await call(chat().messages, ev => {
          if (ev.t === 'text'){ live.text += ev.v; live.status = ''; }
          else if (ev.t === 'think') live.status = 'Thinking…';
          else if (ev.t === 'start' && ev.kind === 'tool_use') live.status = (TOOL_LABEL[ev.name] || 'Working') + '…';
          paintLive();
        });
        const c2 = chat(); c2.messages.push(fin.message); store(c2); live = null; paint();
        if (fin.stop === 'refusal'){ note('Claude declined this request. Rephrase it or start a new conversation.'); break; }
        if (fin.stop === 'max_tokens'){ note('The answer was cut off at the length limit.'); break; }
        if (fin.stop !== 'tool_use') break;
        const uses = fin.message.content.filter(b => b.type === 'tool_use'), results = [];
        live = {text: '', status: uses.map(u => TOOL_LABEL[u.name] || u.name).join(' · ') + '…'}; paintLive();
        for (const u of uses){
          let out, isErr = false;
          try { out = TOOLS[u.name] ? await TOOLS[u.name](u.input || {}, u.id) : {error: 'Unknown tool'}; if (out?.error) isErr = true; }
          catch(err){ out = {error: err.message}; isErr = true; }
          results.push({type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out), ...(isErr ? {is_error: true} : {})});
        }
        const c3 = chat(); c3.messages.push({role: 'user', content: results}); store(c3);
        if (step === MAX_STEPS - 1) note('Stopped after many steps. Ask a follow-up to continue.');
      }
    } catch(err){ note(err.message); }
    finally { busy = false; live = null; paint(); }
  }
  function note(msg){ const c = chat(); c.notes = c.notes || {}; c.notes[c.messages.length] = msg; store(c); }

  /* ---------- rendering ---------- */
  // Small, safe Markdown: escape first, then headings, bold, code, lists and pipe tables.
  function md(src){
    const lines = esc(src).split('\n'), out = []; let list = null, table = null;
    const inline = s => s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    const flush = () => { if (list){ out.push(`<${list.t}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.t}>`); list = null; } if (table){ const [hd, ...body] = table.filter(r => !/^\s*\|?\s*:?-{2,}/.test(r)); const cells = r => r.replace(/^\s*\||\|\s*$/g, '').split('|').map(x => inline(x.trim())); out.push(`<table class="tbl compact"><thead><tr>${cells(hd).map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${cells(r).map(x => `<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table>`); table = null; } };
    for (const l of lines){
      let m;
      if (/^\s*\|.*\|\s*$/.test(l)){ if (list) flush(); (table = table || []).push(l); continue; }
      if (table) flush();
      if ((m = /^\s*[-*]\s+(.*)/.exec(l))){ if (list?.t !== 'ul'){ flush(); list = {t: 'ul', items: []}; } list.items.push(m[1]); continue; }
      if ((m = /^\s*\d+[.)]\s+(.*)/.exec(l))){ if (list?.t !== 'ol'){ flush(); list = {t: 'ol', items: []}; } list.items.push(m[1]); continue; }
      flush();
      if ((m = /^#{1,4}\s+(.*)/.exec(l))) out.push(`<h4>${inline(m[1])}</h4>`);
      else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
    }
    flush(); return out.join('');
  }
  function proposalHTML(id, p, saved){
    const st = D.deckStats(p), rows = st.rows.slice().sort((a, b) => ctx.nvName(a.nv).localeCompare(ctx.nvName(b.nv)));
    return `<div class="proposal"><div class="proposal-head"><div><div class="proposal-n">${esc(p.name)}</div><div class="muted small">${st.total} cards · own ${Math.round(st.pct * 100)}% · ${st.missing ? `${st.missing} to buy, about $${st.missCost.toFixed(2)}` : 'you own every card'}</div></div>
      ${saved ? `<span class="chip ok">Saved</span>` : `<button class="btn sm" type="button" data-save="${esc(id)}">Save to InkScan</button>`}</div>
      <details><summary>Show the list</summary><ul class="plain cols">${rows.map(r => `<li>${r.q} ${esc(ctx.nvName(r.nv))}${r.need ? ` <span class="need">buy ${r.need}</span>` : ''}</li>`).join('')}</ul></details></div>`;
  }
  function paint(){
    if (!host) return;
    const c = chat(), log = host.querySelector('#chatLog'); if (!log) return;
    const parts = [];
    c.messages.forEach((m, i) => {
      if (m.role === 'user'){ const t = m.content.filter(b => b.type === 'text').map(b => b.text).join('\n'); if (t) parts.push(`<div class="msg-u">${esc(t)}</div>`); }
      else {
        const bits = [];
        for (const b of m.content){
          if (b.type === 'text' && b.text.trim()) bits.push(md(b.text));
          else if (b.type === 'tool_use' && b.name === 'propose_deck' && c.proposals?.[b.id]) bits.push(proposalHTML(b.id, c.proposals[b.id], c.saved?.[b.id]));
          else if (b.type === 'tool_use') bits.push(`<span class="tool-chip">${esc(TOOL_LABEL[b.name] || b.name)}</span>`);
        }
        if (bits.length) parts.push(`<div class="msg-a">${bits.join('')}</div>`);
      }
      if (c.notes?.[i + 1]) parts.push(`<div class="msg-note">${esc(c.notes[i + 1])}</div>`);
    });
    if (!c.messages.length) parts.push(`<div class="chat-empty"><h2>Ask about your ${esc(ctx.gameDef().name)} cards</h2><p class="muted">The advisor reads your collection and decks, checks real card data, runs simulations and can draft decks for you to save.</p><div class="suggest">${(SUGGEST[ctx.game] || []).map(s => `<button type="button" class="chip-btn" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`);
    log.innerHTML = parts.join('') + '<div id="liveMsg"></div>';
    for (const b of log.querySelectorAll('[data-suggest]')) b.onclick = () => ask(b.dataset.suggest);
    for (const b of log.querySelectorAll('[data-save]')) b.onclick = () => saveProposal(b.dataset.save, b);
    paintLive();
    host.querySelector('#chatSend').disabled = busy;
    log.scrollTop = log.scrollHeight;
  }
  function paintLive(){
    const el = host?.querySelector('#liveMsg'); if (!el) return;
    el.innerHTML = live ? `<div class="msg-a live">${live.text ? md(live.text) : ''}${live.status ? `<div class="typing">${esc(live.status)}</div>` : ''}</div>` : '';
    const log = host.querySelector('#chatLog'); log.scrollTop = log.scrollHeight;
  }
  async function saveProposal(id, btn){
    const c = chat(), p = c.proposals?.[id]; if (!p) return;
    btn.disabled = true; btn.textContent = 'Saving…';
    try { const saved = await D.saveDeck(structuredClone(p)); const c2 = chat(); c2.saved = c2.saved || {}; c2.saved[id] = saved.id; store(c2); ctx.onDeckSaved?.(saved); ctx.toast(`Saved “${saved.name}”. Tap Update in the phone app to bring it over.`); paint(); }
    catch(err){ ctx.toast(err.message); btn.disabled = false; btn.textContent = 'Save to InkScan'; }
  }

  function mount(v, context){
    ctx = context; host = v;
    v.innerHTML = `
      <header class="page-head"><div><h1 class="page-title">Advisor</h1><p class="muted">Claude, with your ${esc(ctx.gameDef().name)} collection and decks in reach.</p></div><button class="btn" id="chatNew" type="button">New conversation</button></header>
      <section class="card chat"><div id="chatLog" class="chat-log" aria-live="polite"></div>
        <form id="chatForm" class="chat-form"><textarea id="chatIn" rows="2" placeholder="Ask anything: deck ideas, cuts, rules, what to buy…"></textarea><button class="btn primary" id="chatSend" type="submit" aria-label="Send"><svg class="ic"><use href="#i-send"/></svg>Send</button></form></section>`;
    const input = v.querySelector('#chatIn');
    v.querySelector('#chatForm').onsubmit = e => { e.preventDefault(); const q = input.value; input.value = ''; ask(q); };
    input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); v.querySelector('#chatForm').requestSubmit(); } };
    v.querySelector('#chatNew').onclick = () => { if (busy) return; if (chat().messages.length && !confirm('Start a new conversation? This one will be cleared.')) return; D.lsSet(key(), {messages: [], saved: {}}); paint(); };
    paint(); input.focus();
  }
  root.PortalAdvisor = {mount, ask, _tools: TOOLS, _md: md};
})(self);
