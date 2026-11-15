/* The advisor's helpers that don't depend on a screen: card names, simulations and shopping lists for one
   game, over PortalData. The portal and the phone app both build the advisor's context from here. */
(function(root){
  'use strict';
  const D = root.PortalData, G = root.InkGames;
  function make(game){
    const S = () => D.state, gameDef = () => G.get(game);
    const cardName = c => c ? (game === 'lorcana' && c.v ? `${c.n} - ${c.v}` : c.n) : '';
    const nvName = nv => { const c = S().cat?.rep(nv); return c ? cardName(c) : nv.replace(/\|$/, '').replace(/\|/g, ' '); };
    const simDeck = d => Object.entries(d.cards).map(([nv, q]) => ({card: S().cat.rep(nv), qty: q, key: nv})).filter(x => x.card);
    function runSim(d, o){
      const deck = simDeck(d), onPlay = o.onPlay, seed = Date.now() % 1e9;
      if (o.mode === 'opening') return {mode: 'opening', deck: d.id, r: root.InkSim.openingHands(deck, {game, onPlay, seed, handSize: gameDef().deck.handSize})};
      if (o.mode === 'goldfish') return {mode: 'goldfish', deck: d.id, r: root.InkSim.goldfish(deck, {game, onPlay, seed, turns: o.turns, keyCards: o.keys.map(nv => S().cat.rep(nv)?.n).filter(Boolean), life: d.commanders.length || d.format === 'commander' ? 40 : 20})};
      const keys = o.oddsKeys.length ? o.oddsKeys : [];
      if (!keys.length) throw Error('Pick at least one card to draw.');
      const handSize = gameDef().deck.handSize, total = Object.values(d.cards).reduce((s, q) => s + q, 0);
      if (keys.length === 1) return {mode: 'odds', deck: d.id, single: true, label: nvName(keys[0]), r: root.InkSim.drawOdds({deckSize: total, copies: d.cards[keys[0]], handSize, onPlay, turns: 10, atLeast: o.oddsNeed})};
      return {mode: 'odds', deck: d.id, label: keys.map(nvName).join(' + '), r: root.InkSim.comboOdds(Object.entries(d.cards).map(([key, qty]) => ({key, qty})), keys.map(k => ({label: nvName(k), keys: [k], need: o.oddsNeed})), {turns: 10, handSize, onPlay, seed})};
    }
    function buyPlan(ids, shared){
      const need = new Map();
      for (const d of S().decks.filter(x => ids.includes(x.id))) for (const [nv, q] of Object.entries(d.cards)){
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
    return {game, gameDef, cardName, nvName, simDeck, runSim, buyPlan};
  }
  root.PortalAdvisorKit = {make};
})(self);
