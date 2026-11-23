/* Planned upgrades: each deck can carry a list of cards to bring in and cards to take out, kept apart from
   the deck list until the cards are in hand. The cards to bring in are that deck's own wish list.
   A plan is {in: {card: copies}, out: {card: copies}}; cards are named the way deck lists name them.
   Nothing here touches the screen or the cloud: the phone app and the portal both work from these helpers. */
(function(root){
  'use strict';
  const MAX = 99;
  const side = (o, keep) => {
    const out = {};
    if (o && typeof o === 'object' && !Array.isArray(o)) for (const k of Object.keys(o).sort()){ const n = keep(k, o[k]); if (Number.isInteger(n) && n > 0) out[k] = Math.min(n, MAX); }
    return out;
  };
  /* A plan in its tidy form, or null when there is nothing in it. A card can only be planned to come out
     while it is in the deck, and no more copies than the deck holds. */
  function clean(plan, cards){
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null;
    const ins = side(plan.in, (k, n) => n), outs = side(plan.out, (k, n) => Number.isInteger(n) && Number.isInteger(cards?.[k]) ? Math.min(n, cards[k]) : 0);
    if (!Object.keys(ins).length && !Object.keys(outs).length) return null;
    return {in: ins, out: outs};
  }
  // The plan with one card's count changed (0 takes it off the plan).
  function set(plan, which, nv, n, cards){
    const next = {in: {...(plan?.in || {})}, out: {...(plan?.out || {})}};
    if (n > 0) next[which][nv] = n; else delete next[which][nv];
    return clean(next, cards);
  }
  const total = o => Object.values(o || {}).reduce((s, n) => s + n, 0);
  /* How much of the plan is in hand. spare(card) is how many copies the collection has for this deck beyond
     the ones the deck already uses. */
  function progress(plan, spare){
    const rows = Object.entries(plan?.in || {}).map(([nv, q]) => ({nv, q, have: Math.max(0, Math.min(q, spare(nv) | 0))}));
    const want = total(plan?.in), have = rows.reduce((s, r) => s + r.have, 0);
    return {rows, want, have, out: total(plan?.out), ready: want + total(plan?.out) > 0 && have === want};
  }
  /* The deck list and the plan after moving copies across: n copies of a card to bring in go into the deck,
     or n copies of a card to take out leave it. The plan loses what was moved. */
  function move(cards, plan, which, nv, n){
    const next = {...cards}, planned = plan?.[which]?.[nv] || 0, k = Math.min(n, planned);
    if (k <= 0) return {cards: next, plan: clean(plan, next), moved: 0};
    const moved = which === 'in' ? k : Math.min(k, next[nv] || 0);
    if (which === 'in') next[nv] = (next[nv] || 0) + moved;
    else if ((next[nv] || 0) - moved > 0) next[nv] -= moved; else delete next[nv];
    const left = {in: {...(plan.in || {})}, out: {...(plan.out || {})}};
    if (planned - k > 0) left[which][nv] = planned - k; else delete left[which][nv];
    return {cards: next, plan: clean(left, next), moved};
  }
  const api = {clean, set, total, progress, move};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.InkUpgrades = api;
})(typeof self !== 'undefined' ? self : globalThis);
