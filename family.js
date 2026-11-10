/* InkScan family ownership: pure helpers shared by the app and the Portal.
   The collection holds one family total per card. The cloud records the copies that belong to each family
   member other than the family owner; whatever is left belongs to the family owner. */
(function(root){
  'use strict';
  const FIN = ['q', 'f', 'rf'];
  const count = v => (v?.q || 0) + (v?.f || 0) + (v?.rf || 0);

  // Cloud rows [{c, p, q, f, r}] -> {cardId: {personId: {q, f, rf}}}
  function index(rows){
    const out = {};
    for (const r of rows || []){
      if (!r || typeof r.c !== 'string' || typeof r.p !== 'string') continue;
      const v = {q: Math.max(0, r.q | 0), f: Math.max(0, r.f | 0), rf: Math.max(0, r.r | 0)};
      if (count(v)) (out[r.c] || (out[r.c] = {}))[r.p] = v;
    }
    return out;
  }
  // Changes made on this device that the cloud has not confirmed yet: [{c, p, q, f, r}] deltas.
  function applyDeltas(holdings, items, ownerId){
    for (const it of items || []){
      if (!it || it.p === ownerId) continue;
      const card = holdings[it.c] || (holdings[it.c] = {}), v = card[it.p] || (card[it.p] = {q: 0, f: 0, rf: 0});
      v.q = Math.max(0, v.q + (it.q || 0)); v.f = Math.max(0, v.f + (it.f || 0)); v.rf = Math.max(0, v.rf + (it.r || 0));
      if (!count(v)) delete card[it.p];
    }
    return holdings;
  }
  // Who has which copies of one card. Nobody can hold more than exists; the rest is the family owner's.
  function split(total, holds, ownerId){
    const out = {}, left = {q: total?.q || 0, f: total?.f || 0, rf: total?.rf || 0};
    for (const pid of Object.keys(holds || {}).sort()){
      if (pid === ownerId) continue;
      const v = {q: 0, f: 0, rf: 0};
      for (const k of FIN){ const n = Math.max(0, Math.min(holds[pid][k] || 0, left[k])); v[k] = n; left[k] -= n; }
      if (count(v)) out[pid] = v;
    }
    if (count(left) && ownerId) out[ownerId] = left;
    return out;
  }
  // Who loses a copy when one is removed: the person acting if they have one, then the family owner, then whoever has most.
  function removalFrom(shares, field, actor, ownerId){
    if (shares[actor]?.[field] > 0) return actor;
    if (shares[ownerId]?.[field] > 0) return ownerId;
    let best = null;
    for (const [pid, v] of Object.entries(shares)) if (v[field] > 0 && (!best || v[field] > shares[best][field])) best = pid;
    return best || actor;
  }
  // The copies to hand over when a whole deck changes hands: for each card the deck lists, up to that many of the
  // giver's copies, normal finish first. printings(nv) -> [cardId], sharesOf(cardId) -> split() result.
  function deckItems(deckCards, from, to, printings, sharesOf){
    const items = [];
    for (const [nv, want] of Object.entries(deckCards || {})){
      let need = want | 0;
      const ids = printings(nv) || [];
      for (const k of FIN){
        for (const id of ids){
          if (need <= 0) break;
          const have = sharesOf(id)[from]?.[k] || 0, n = Math.min(have, need);
          if (!n) continue;
          let it = items.find(x => x.c === id);
          if (!it) items.push(it = {c: id, from, to, q: 0, f: 0, r: 0});
          it[k === 'rf' ? 'r' : k] += n; need -= n;
        }
      }
    }
    return items;
  }
  const initials = name => { const w = String(name || '?').trim().split(/\s+/); return ((w[0]?.[0] || '?') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase(); };
  // A stable colour slot per person: the family owner is 0, everyone else by the order they joined.
  function people(members, ownerId){
    const list = (members || []).filter(m => m && m.id).map(m => ({id: m.id, name: m.name || (m.email || 'Member').split('@')[0].replace(/^./, ch => ch.toUpperCase()), email: m.email || '', owner: m.id === ownerId}));
    list.sort((a, b) => (b.owner ? 1 : 0) - (a.owner ? 1 : 0));
    list.forEach((p, i) => { p.slot = i % 6; p.initials = initials(p.name); });
    return list;
  }
  const api = {FIN, count, index, applyDeltas, split, removalFrom, deckItems, initials, people};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.InkFamily = api;
})(typeof self !== 'undefined' ? self : globalThis);
