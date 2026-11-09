/* InkSim: deck simulation engine for the InkScan command-center portal.
   Pure JavaScript, no DOM, no dependencies. Runs in the browser (self.InkSim), inside a
   Web Worker (self.InkSim) and in Node (module.exports).

   Conventions shared by every simulator:
   - A deck is an array of {card, qty}; card is the app's compact card object (see games.js).
     comboOdds is the one exception: it takes [{key, qty}].
   - Every Monte Carlo function takes opts.seed and is deterministic for a given seed.
   - Per-turn arrays (landDropRate, avgMana, castBy[name], loreByTurn, ...) are indexed by
     turn number: index 0 is null, index t is turn t, length is turns + 1.
   - Distributions keyed by turn are plain objects {1: p, 2: p, ..., never: p}.
   - Everything returned is plain JSON (numbers, strings, arrays, objects). */
(function(root){
  'use strict';

  /* ------------------------------------------------------------------ RNG */

  // mulberry32: tiny, fast, good enough for card shuffles. Returns floats in [0, 1).
  function seededRng(seed){
    let a = (Number(seed) >>> 0) || 0x9e3779b9;
    return function(){
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const defaultSeed = () => (Date.now() ^ 0x5bd1e995) >>> 0;

  // Fisher-Yates over positions [from, from+count) of arr (length n). Only the shuffled
  // prefix is uniform, which is all we ever read: hands and the next few draws.
  function partialShuffle(arr, n, from, count, rng){
    const end = Math.min(n, from + count);
    for (let i = from; i < end; i++){
      const j = i + ((rng() * (n - i)) | 0);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
  }

  /* ------------------------------------------------------------ exact math */

  const LF = [0];
  function logFact(n){
    for (let i = LF.length; i <= n; i++) LF[i] = LF[i - 1] + Math.log(i);
    return LF[n];
  }
  const logChoose = (n, k) => (k < 0 || k > n) ? -Infinity : logFact(n) - logFact(k) - logFact(n - k);

  // Exact P(at least `atLeast` of `copies` copies among `draws` cards from `deckSize`).
  function hypergeom({deckSize, copies, draws, atLeast = 1}){
    const N = Math.max(0, deckSize | 0), K = Math.max(0, Math.min(copies | 0, N));
    const n = Math.max(0, Math.min(draws | 0, N)), a = Math.max(0, atLeast | 0);
    if (a === 0) return 1;
    if (a > K || a > n) return 0;
    const denom = logChoose(N, n);
    let p = 0;
    for (let k = a, hi = Math.min(K, n); k <= hi; k++){
      p += Math.exp(logChoose(K, k) + logChoose(N - K, n - k) - denom);
    }
    return Math.min(1, Math.max(0, p));
  }

  // Per-turn odds. Cards seen by turn T: handSize + T - 1 on the play, handSize + T on the
  // draw (MTG and Lorcana both skip the first player's turn-1 draw).
  function drawOdds({deckSize, copies, handSize = 7, onPlay = true, turns = 10, atLeast = 1}){
    const out = [];
    for (let t = 1; t <= turns; t++){
      const cards = Math.min(deckSize, handSize + t - (onPlay ? 1 : 0));
      out.push({turn: t, cards, p: hypergeom({deckSize, copies, draws: cards, atLeast})});
    }
    return out;
  }

  /* ---------------------------------------------------------- combo odds */

  // Monte Carlo: P(every group has >= need of its keys among cards seen by turn T).
  // A card whose key sits in two groups counts toward both.
  function comboOdds(deck, groups, opts = {}){
    const turns = opts.turns ?? 10, handSize = opts.handSize ?? 7, onPlay = opts.onPlay ?? true;
    const iterations = opts.iterations ?? 20000, rng = seededRng(opts.seed ?? defaultSeed());
    const keyIndex = new Map(), slots = [];
    (deck || []).forEach(e => {
      const q = Math.max(0, e.qty | 0); if (!q) return;
      if (!keyIndex.has(e.key)) keyIndex.set(e.key, keyIndex.size);
      for (let i = 0; i < q; i++) slots.push(keyIndex.get(e.key));
    });
    const N = slots.length, G = (groups || []).length;
    const res = [];
    if (!N || !G){ for (let t = 1; t <= turns; t++) res.push({turn: t, p: G ? 0 : 1}); return res; }
    // keyGroups[k] = list of group indexes that key k feeds
    const keyGroups = Array.from({length: keyIndex.size}, () => []);
    const need = new Int32Array(G);
    groups.forEach((g, gi) => {
      need[gi] = Math.max(0, g.need ?? 1);
      new Set(g.keys || []).forEach(k => { if (keyIndex.has(k)) keyGroups[keyIndex.get(k)].push(gi); });
    });
    const perm = Int32Array.from(slots), counts = new Int32Array(G);
    const hit = new Float64Array(turns + 1);
    const seenAt = t => Math.min(N, handSize + t - (onPlay ? 1 : 0));
    const depth = seenAt(turns);
    for (let it = 0; it < iterations; it++){
      partialShuffle(perm, N, 0, depth, rng);
      counts.fill(0);
      let unmet = 0; for (let g = 0; g < G; g++) if (need[g] > 0) unmet++;
      let pos = 0, first = unmet === 0 ? 1 : 0;
      for (let t = 1; t <= turns && !first; t++){
        const upto = seenAt(t);
        for (; pos < upto; pos++){
          const gs = keyGroups[perm[pos]];
          for (let x = 0; x < gs.length; x++){ const g = gs[x]; if (++counts[g] === need[g]) unmet--; }
        }
        if (unmet === 0) first = t;
      }
      if (first) hit[first]++;
    }
    let cum = 0;
    for (let t = 1; t <= turns; t++){ cum += hit[t]; res.push({turn: t, p: cum / iterations}); }
    return res;
  }

  /* ------------------------------------------------------- card parsing */

  const W = 1, U = 2, B = 4, R = 8, G = 16, WILD = 31;
  const COLOR_BIT = {W, U, B, R, G};
  const POP = new Uint8Array(32);
  for (let i = 0; i < 32; i++) POP[i] = (i & 1) + ((i >> 1) & 1) + ((i >> 2) & 1) + ((i >> 3) & 1) + ((i >> 4) & 1);
  const BASIC_TYPES = [[/\bPlains\b/, W], [/\bIsland\b/, U], [/\bSwamp\b/, B], [/\bMountain\b/, R], [/\bForest\b/, G]];
  const BURN_RE = /deals (\d+) damage to (any target|target player|each opponent|target creature or player|target player or planeswalker)/i;

  const front = (s, sep) => String(s || '').split(sep)[0];
  const back = (s, sep) => String(s || '').split(sep)[1] || '';

  // Front-face mana cost -> {generic, pips:[colorMask...], hasX, mv}.
  // Hybrid {W/U} is one pip payable by either color; Phyrexian {G/P} is paid with life
  // (counts as generic); {2/W} is treated as a W pip; {C} and {S} are treated as generic.
  function parseManaCost(mc){
    const out = {generic: 0, pips: [], hasX: false, mv: 0};
    const re = /\{([^}]+)\}/g; let m;
    while ((m = re.exec(front(mc, ' // ')))){
      const t = m[1].toUpperCase();
      if (/^\d+$/.test(t)) out.generic += +t;
      else if (t === 'X' || t === 'Y' || t === 'Z') out.hasX = true;
      else if (COLOR_BIT[t]) out.pips.push(COLOR_BIT[t]);
      else if (t === 'C' || t === 'S') out.generic += 1;
      else if (t.includes('/')){
        const parts = t.split('/');
        if (parts.includes('P')) out.generic += 1;
        else {
          let mask = 0; parts.forEach(p => { mask |= COLOR_BIT[p] || 0; });
          if (mask) out.pips.push(mask); else out.generic += 1;
        }
      }
    }
    out.mv = out.generic + out.pips.length;
    return out;
  }

  // Colors a land (or one face of one) can produce: basic land types plus every mana symbol
  // in an "Add ..." clause. "any color" and basic-fetching lands count as wild.
  function landColors(typeLine, text){
    let mask = 0;
    for (const [re, bit] of BASIC_TYPES) if (re.test(typeLine)) mask |= bit;
    if (/any color|any type/i.test(text)) return WILD;
    const re = /\badd\b([^.\n]*)/gi; let m;
    while ((m = re.exec(text))){
      const sy = m[1].match(/\{[WUBRG]\}/g) || [];
      sy.forEach(s => { mask |= COLOR_BIT[s[1]]; });
    }
    if (!mask && /search your library for an? [^.]*\b(basic|land)\b/i.test(text)) return WILD;
    return mask;
  }
  const entersTapped = text => /(enters( the battlefield)? tapped|onto the battlefield tapped)/i.test(text) &&
    !/unless|you may pay|if you don't/i.test(text);

  // "{T}: Add ..." on a nonland permanent -> {count, mask}. "{G} or {U}" is one mana of either;
  // "{C}{C}" is two. "any color" is one wild mana.
  function manaAbility(text){
    const m = /\{T\}(?:, [^:]*)?: Add ([^.\n]*)/i.exec(text || '');
    if (!m) return null;
    if (/any color|any type|commander's color/i.test(m[1])) return {count: 1, mask: WILD};
    const sy = m[1].match(/\{[WUBRGC]\}/g) || [];
    let mask = 0; sy.forEach(s => { mask |= COLOR_BIT[s[1]] || 0; });
    const count = /\bor\b/i.test(m[1]) ? 1 : Math.max(1, Math.min(3, sy.length));
    return {count, mask};
  }

  function normName(s){ return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function nameMatches(card, wanted){
    const w = normName(wanted);
    return w === normName(card.n) || w === normName(front(card.n, ' // ')) ||
      (card.v && w === normName(card.n + ' - ' + card.v));
  }
  function displayName(card){ return card.v ? `${card.n} - ${card.v}` : String(card.n || '?'); }

  // Guess the game when opts.game is missing: MTG cards carry mana costs or Land types,
  // Lorcana cards carry Character/Action/Item/Location types with lore.
  function detectGame(deck){
    const cards = (deck || []).map(e => e.card || {});
    if (cards.some(c => /\{/.test(c.mc || '') || /\bLand\b/.test(c.ty || ''))) return 'mtg';
    if (cards.some(c => /^(Character|Action|Item|Location)/.test(c.ty || '') && 'ik' in c)) return 'lorcana';
    return 'other';
  }

  // Expand a deck into unique cards plus a flat Int32Array of unique indexes.
  function expand(deck){
    const uniq = [], slots = [];
    (deck || []).forEach(e => {
      const q = Math.max(0, e && e.qty | 0); if (!q || !e.card) return;
      const u = uniq.length; uniq.push(e.card);
      for (let i = 0; i < q; i++) slots.push(u);
    });
    return {uniq, slots: Int32Array.from(slots), N: slots.length};
  }

  /* -------------------------------------------------------- MTG compile */

  function compileMtg(deck){
    const {uniq, slots, N} = expand(deck);
    const M = uniq.length;
    const c = {
      uniq, slots, N, M, names: uniq.map(x => String(x.n || '?')),
      isLand: new Uint8Array(M),   // front face is a Land
      mdfc: new Uint8Array(M),     // front face is a spell, back face is a Land
      landMask: new Int32Array(M), landTapped: new Uint8Array(M),
      castable: new Uint8Array(M), mv: new Int32Array(M), generic: new Int32Array(M), hasX: new Uint8Array(M),
      pipStart: new Int32Array(M), pipLen: new Int32Array(M), pips: null, needMask: new Int32Array(M),
      isCreature: new Uint8Array(M), power: new Int32Array(M), haste: new Uint8Array(M),
      burn: new Int32Array(M), manaCount: new Int32Array(M), manaMask: new Int32Array(M)
    };
    const pipList = [];
    uniq.forEach((card, u) => {
      const fType = front(card.ty, ' // '), bType = back(card.ty, ' // ');
      const fText = front(card.tx, '\n//\n'), bText = back(card.tx, '\n//\n');
      if (/\bLand\b/.test(fType)){
        c.isLand[u] = 1;
        c.landMask[u] = landColors(fType, fText);
        c.landTapped[u] = entersTapped(fText) ? 1 : 0;
        return;
      }
      if (/\bLand\b/.test(bType)){
        c.mdfc[u] = 1;
        c.landMask[u] = landColors(bType, bText);
        c.landTapped[u] = entersTapped(bText) ? 1 : 0;
      }
      const cost = parseManaCost(card.mc);
      const hasCost = /\{/.test(front(card.mc, ' // '));
      if (!hasCost && Number(card.co) > 0) cost.generic = cost.mv = Number(card.co) | 0;
      // No printed cost and mana value 0 (suspend-only cards, etc.): never cast.
      c.castable[u] = (hasCost || Number(card.co) > 0) ? 1 : 0;
      c.mv[u] = cost.mv; c.generic[u] = cost.generic; c.hasX[u] = cost.hasX ? 1 : 0;
      // Most restrictive pips first so the greedy payer handles them before flexible ones.
      cost.pips.sort((a, b) => POP[a] - POP[b]);
      c.pipStart[u] = pipList.length; c.pipLen[u] = cost.pips.length;
      cost.pips.forEach(p => { pipList.push(p); c.needMask[u] |= p; });
      if (/\bCreature\b/.test(fType)){
        c.isCreature[u] = 1;
        c.power[u] = Number.isFinite(Number(card.st)) && card.st !== null ? Math.max(0, Number(card.st) | 0) : 0;
        c.haste[u] = /\bhaste\b/i.test(fText) ? 1 : 0;
      }
      if (/\b(Instant|Sorcery)\b/.test(fType)){
        const m = BURN_RE.exec(fText); if (m) c.burn[u] = +m[1];
      } else {
        const ab = manaAbility(fText);
        if (ab){ c.manaCount[u] = ab.count; c.manaMask[u] = ab.mask; }
      }
    });
    c.pips = Int32Array.from(pipList);
    return c;
  }

  // Greedy payment: each colored pip takes the least flexible unused source that can pay it,
  // then generic takes the least flexible leftovers. Not a perfect matching, but it only
  // misses in contrived multi-hybrid cases. Returns true if payable; commits when commit=1.
  const tmpPick = new Int32Array(64);
  function canPay(c, u, srcMask, srcUsed, nSrc, commit){
    const mv = c.mv[u];
    let free = 0; for (let s = 0; s < nSrc; s++) if (!srcUsed[s]) free++;
    if (free < mv) return false;
    let picked = 0;
    const ps = c.pipStart[u], pl = c.pipLen[u];
    for (let p = 0; p < pl; p++){
      const need = c.pips[ps + p];
      let best = -1, bestPop = 99;
      for (let s = 0; s < nSrc; s++){
        if (srcUsed[s] || !(srcMask[s] & need)) continue;
        const pc = POP[srcMask[s]]; if (pc < bestPop){ bestPop = pc; best = s; }
      }
      if (best < 0){ for (let i = 0; i < picked; i++) srcUsed[tmpPick[i]] = 0; return false; }
      srcUsed[best] = 1; tmpPick[picked++] = best;
    }
    for (let g = c.generic[u]; g > 0; g--){
      let best = -1, bestPop = 99;
      for (let s = 0; s < nSrc; s++){
        if (srcUsed[s]) continue;
        const pc = POP[srcMask[s]]; if (pc < bestPop){ bestPop = pc; best = s; }
      }
      srcUsed[best] = 1; tmpPick[picked++] = best;  // free >= mv guarantees best >= 0
    }
    if (!commit) for (let i = 0; i < picked; i++) srcUsed[tmpPick[i]] = 0;
    return true;
  }

  const landish = (c, u) => c.isLand[u] || c.mdfc[u];

  // London mulligan for MTG. perm holds a fresh partial shuffle; the 7 drawn are perm[0..6].
  // Writes the kept hand into hand[] and returns {size, mulls}. Bottomed cards are dropped:
  // they sit under the library and are never reached in a 10-turn sim.
  function mtgMulligan(c, perm, hand, rng, keep, floor, depth){
    for (let m = 0; ; m++){
      if (m > 0) partialShuffle(perm, c.N, 0, depth, rng);
      let len = Math.min(7, c.N);
      for (let i = 0; i < len; i++) hand[i] = perm[i];
      const size = Math.max(0, len - m);
      // Bottom m cards: pull land count toward ~45% of the final hand (min 2), excess lands
      // go first (fewest colors, tapped first), otherwise the costliest spell goes.
      const ideal = Math.max(2, Math.round(size * 0.45));
      for (let b = 0; b < m && len > 0; b++){
        let lands = 0; for (let i = 0; i < len; i++) if (landish(c, hand[i])) lands++;
        let pick = -1, score = -1e9;
        for (let i = 0; i < len; i++){
          const u = hand[i], isL = landish(c, u);
          let s;
          if (lands > ideal) s = isL ? 100 - POP[c.landMask[u]] * 5 + c.landTapped[u] * 3 + (c.mdfc[u] ? -10 : 0) : -100;
          else s = isL ? -100 : (c.castable[u] ? c.mv[u] : 50);
          if (s > score){ score = s; pick = i; }
        }
        hand[pick] = hand[--len];
      }
      let lands = 0; for (let i = 0; i < len; i++) if (landish(c, hand[i])) lands++;
      const maxL = Math.max(keep.minLands, keep.maxLands - m);
      if ((lands >= keep.minLands && lands <= maxL) || size <= floor || m >= 7) return {size: len, mulls: m};
    }
  }

  /* ---------------------------------------------------------- opening hands */

  function openingHands(deck, opts = {}){
    const game = opts.game || detectGame(deck);
    if (game === 'mtg') return mtgOpening(deck, opts);
    if (game === 'lorcana') return lorcanaOpening(deck, opts);
    return otherOpening(deck, opts);
  }

  function mtgOpening(deck, opts){
    const c = compileMtg(deck), N = c.N;
    const iterations = opts.iterations ?? 20000, rng = seededRng(opts.seed ?? defaultSeed());
    const keep = Object.assign({minLands: 2, maxLands: 5}, opts.keep || {});
    const floor = opts.mulliganFloor ?? 4, onPlay = opts.onPlay ?? true;
    const extraDraws = onPlay ? 1 : 2;  // cards drawn by turn 2
    const depth = Math.min(N, 7 + extraDraws);
    const perm = Int32Array.from(c.slots), hand = new Int32Array(8);
    const landDist = new Float64Array(8), mullTo = {7: 0, 6: 0, 5: 0, '4-': 0};
    const srcMask = new Int32Array(16), srcUsed = new Uint8Array(16);
    let kept7 = 0, landSum = 0, screwN = 0, screwD = 0;
    const samples = [];
    if (!N) return {game: 'mtg', empty: true};
    for (let it = 0; it < iterations; it++){
      partialShuffle(perm, N, 0, depth, rng);
      let l7 = 0; for (let i = 0, n = Math.min(7, N); i < n; i++) if (landish(c, perm[i])) l7++;
      landDist[l7]++; landSum += l7;
      const r = mtgMulligan(c, perm, hand, rng, keep, floor, depth);
      if (r.mulls === 0) kept7++;
      const fs = 7 - r.mulls; mullTo[fs >= 5 ? fs : '4-']++;
      // Color screw: lands in hand plus draws through turn 2, at most two land drops.
      let nSrc = 0;
      for (let i = 0; i < r.size; i++) if (landish(c, hand[i])) srcMask[nSrc++] = c.landMask[hand[i]];
      for (let i = 0; i < extraDraws && 7 + i < N; i++){ const u = perm[7 + i]; if (landish(c, u)) srcMask[nSrc++] = c.landMask[u]; }
      const usable = Math.min(2, nSrc);
      let feasible = 0, ok = 0;
      for (let i = 0; i < r.size; i++){
        const u = hand[i];
        if (c.isLand[u] || !c.castable[u] || c.mv[u] > 2 || c.mv[u] > usable) continue;
        feasible = 1;
        srcUsed.fill(0);
        if (canPay(c, u, srcMask, srcUsed, nSrc, 0)){ ok = 1; break; }
      }
      if (feasible){ screwD++; if (!ok) screwN++; }
      if (samples.length < 5){ const h = []; for (let i = 0; i < r.size; i++) h.push(c.names[hand[i]]); samples.push(h); }
    }
    const P = x => x / iterations;
    return {
      game: 'mtg', iterations, deckSize: N,
      landDist: Array.from(landDist, P),
      keepRate7: P(kept7),
      mulliganTo: {7: P(mullTo[7]), 6: P(mullTo[6]), 5: P(mullTo[5]), '4-': P(mullTo['4-'])},
      avgLands: landSum / iterations,
      colorScrew: screwD ? screwN / screwD : 0,
      sampleHands: samples
    };
  }

  /* ------------------------------------------------------ Lorcana compile */

  function compileLorcana(deck){
    const {uniq, slots, N} = expand(deck);
    const M = uniq.length;
    const c = {uniq, slots, N, M, names: uniq.map(displayName),
      cost: new Int32Array(M), ink: new Uint8Array(M), kind: new Uint8Array(M), lore: new Int32Array(M)};
    uniq.forEach((card, u) => {
      c.cost[u] = Math.max(0, Number(card.co) | 0);
      c.ink[u] = card.ik ? 1 : 0;
      const ty = String(card.ty || '');
      // kind: 1 Character, 2 Location, 0 everything else (Action, Song, Item)
      c.kind[u] = /Character/.test(ty) ? 1 : /Location/.test(ty) ? 2 : 0;
      c.lore[u] = Math.max(0, Number(card.lo) | 0);
    });
    return c;
  }

  // Lorcana mulligan (one shot). Keep 7 when >= minInkable inkables and >= minCheap cards
  // costing <= cheapCost. Otherwise bottom: non-inkables costing > 4, then every card costing
  // 4+ beyond the two cheapest such. Draw that many, shuffle the bottomed cards back in.
  // hand[] gets the kept hand; library continues at perm[7].
  function lorcanaMulligan(c, perm, hand, rng, keep, depth){
    const len = Math.min(7, c.N);
    for (let i = 0; i < len; i++) hand[i] = perm[i];
    let inks = 0, cheap = 0;
    for (let i = 0; i < len; i++){ const u = hand[i]; inks += c.ink[u]; if (c.cost[u] <= keep.cheapCost) cheap++; }
    if (inks >= keep.minInkable && cheap >= keep.minCheap) return {kept: true, bottomed: 0, len};
    const bottom = new Uint8Array(len);
    const high = [];
    for (let i = 0; i < len; i++){
      const u = hand[i];
      if (!c.ink[u] && c.cost[u] > 4) bottom[i] = 1;
      else if (c.cost[u] >= 4) high.push(i);
    }
    high.sort((a, b) => c.cost[hand[a]] - c.cost[hand[b]]);
    for (let k = 2; k < high.length; k++) bottom[high[k]] = 1;
    let k = 0; for (let i = 0; i < len; i++) k += bottom[i];
    if (!k) return {kept: false, bottomed: 0, len};
    // Swap each bottomed card with the next library card, then reshuffle the library.
    let lib = len;
    for (let i = 0; i < len && lib < c.N; i++){
      if (!bottom[i]) continue;
      const t = perm[lib]; perm[lib] = hand[i]; hand[i] = t; lib++;
    }
    for (let i = 0; i < len; i++) perm[i] = hand[i];
    partialShuffle(perm, c.N, len, depth, rng);
    return {kept: false, bottomed: k, len};
  }

  // Can a cost-k card be in hand and paid for on turn k, inking one inkable every turn when
  // possible? order = kept hand then library; the drop itself is never inked.
  function dropOnCurve(c, order, k, onPlay){
    const seen = t => 7 + t - (onPlay ? 1 : 0);
    const lim = Math.min(order.length, seen(k));
    for (let ci = 0; ci < lim; ci++){
      if (c.cost[order[ci]] !== k) continue;
      let inked = 0;
      for (let t = 1; t <= k; t++){
        let inkables = 0;
        for (let i = 0, s = Math.min(order.length, seen(t)); i < s; i++) if (i !== ci && c.ink[order[i]]) inkables++;
        if (inkables > inked) inked++;
      }
      if (inked >= k) return true;
    }
    return false;
  }

  function lorcanaOpening(deck, opts){
    const c = compileLorcana(deck), N = c.N;
    if (!N) return {game: 'lorcana', empty: true};
    const iterations = opts.iterations ?? 20000, rng = seededRng(opts.seed ?? defaultSeed());
    const keep = Object.assign({minInkable: 3, minCheap: 2, cheapCost: 3}, opts.keep || {});
    const onPlay = opts.onPlay ?? true;
    const depth = Math.min(N, 7 + 3);
    const perm = Int32Array.from(c.slots), hand = new Int32Array(7), order = [];
    const inkDist = new Float64Array(8);
    let keptN = 0, inkSum = 0, d1 = 0, d2 = 0, d3 = 0, bottomedSum = 0;
    const samples = [];
    for (let it = 0; it < iterations; it++){
      partialShuffle(perm, N, 0, depth, rng);
      let inks = 0; for (let i = 0, n = Math.min(7, N); i < n; i++) inks += c.ink[perm[i]];
      inkDist[inks]++; inkSum += inks;
      const r = lorcanaMulligan(c, perm, hand, rng, keep, depth);
      if (r.kept) keptN++;
      bottomedSum += r.bottomed;
      order.length = 0;
      for (let i = 0; i < r.len; i++) order.push(hand[i]);
      for (let i = r.len; i < Math.min(N, r.len + 3); i++) order.push(perm[i]);
      if (dropOnCurve(c, order, 1, onPlay)) d1++;
      if (dropOnCurve(c, order, 2, onPlay)) d2++;
      if (dropOnCurve(c, order, 3, onPlay)) d3++;
      if (samples.length < 5) samples.push(Array.from(hand.subarray(0, r.len), u => c.names[u]));
    }
    const P = x => x / iterations;
    return {
      game: 'lorcana', iterations, deckSize: N,
      inkableDist: Array.from(inkDist, P),
      keepRate: P(keptN),
      avgInkable: inkSum / iterations,
      avgBottomed: bottomedSum / iterations,
      pOneDropByT1: P(d1), pTwoDropByT2: P(d2), pThreeDropByT3: P(d3),
      sampleHands: samples
    };
  }

  function otherOpening(deck, opts){
    const {uniq, slots, N} = expand(deck);
    if (!N) return {game: opts.game || 'other', empty: true};
    const handSize = Math.min(N, opts.handSize ?? 7);
    const iterations = opts.iterations ?? 20000, rng = seededRng(opts.seed ?? defaultSeed());
    const types = [], typeOf = new Int32Array(uniq.length);
    uniq.forEach((card, u) => {
      const t = String(card.ty || 'Unknown'); let i = types.indexOf(t);
      if (i < 0){ i = types.length; types.push(t); }
      typeOf[u] = i;
    });
    const T = types.length, dist = new Float64Array(T * (handSize + 1)), cnt = new Int32Array(T);
    const perm = Int32Array.from(slots), samples = [];
    for (let it = 0; it < iterations; it++){
      partialShuffle(perm, N, 0, handSize, rng);
      cnt.fill(0);
      for (let i = 0; i < handSize; i++) cnt[typeOf[perm[i]]]++;
      for (let t = 0; t < T; t++) dist[t * (handSize + 1) + cnt[t]]++;
      if (samples.length < 5) samples.push(Array.from(perm.subarray(0, handSize), u => displayName(uniq[u])));
    }
    const typeDist = {};
    types.forEach((t, ti) => {
      const d = Array.from(dist.subarray(ti * (handSize + 1), (ti + 1) * (handSize + 1)), x => x / iterations);
      typeDist[t] = {dist: d, avg: d.reduce((s, p, k) => s + p * k, 0)};
    });
    return {game: opts.game || 'other', iterations, deckSize: N, handSize, typeDist, sampleHands: samples};
  }

  /* -------------------------------------------------------------- goldfish */

  function goldfish(deck, opts = {}){
    const game = opts.game || detectGame(deck);
    if (game === 'mtg') return mtgGoldfish(deck, opts);
    if (game === 'lorcana') return lorcanaGoldfish(deck, opts);
    return {unsupported: true, game};
  }

  function turnArray(turns, f){ const a = [null]; for (let t = 1; t <= turns; t++) a.push(f(t)); return a; }
  function keyIndexes(c, keyCards){
    return (keyCards || []).map(name => ({name, us: c.uniq.map((card, u) => nameMatches(card, name) ? u : -1).filter(u => u >= 0)}));
  }
  function distStats(firstTurn, games, turns){
    const counts = new Float64Array(turns + 2); // [turns+1] = never
    let sum = 0, won = 0;
    for (let g = 0; g < games; g++){
      const t = firstTurn[g];
      if (t > 0){ counts[t]++; sum += t; won++; } else counts[turns + 1]++;
    }
    const dist = {};
    for (let t = 1; t <= turns; t++) dist[t] = counts[t] / games;
    dist.never = counts[turns + 1] / games;
    let acc = 0, median = null;
    for (let t = 1; t <= turns; t++){ acc += counts[t]; if (acc >= games / 2){ median = t; break; } }
    return {dist, avg: won ? sum / won : null, median, winRate: won / games};
  }
  function castByOut(keys, castFirst, turns, games){
    const out = {};
    keys.forEach((k, ki) => {
      let acc = 0;
      out[k.name] = turnArray(turns, t => { acc += castFirst[ki * (turns + 1) + t]; return acc / games; });
    });
    return out;
  }

  function mtgGoldfish(deck, opts){
    const c = compileMtg(deck), N = c.N;
    if (!N) return {game: 'mtg', empty: true};
    const turns = opts.turns ?? 10, iterations = opts.iterations ?? 5000, onPlay = opts.onPlay ?? true;
    const rng = seededRng(opts.seed ?? defaultSeed());
    const life = opts.life ?? (N >= 99 ? 40 : 20);  // 100-card decks are assumed to be Commander
    const keep = Object.assign({minLands: 2, maxLands: 5}, opts.keep || {});
    const floor = opts.mulliganFloor ?? 4;
    const depth = Math.min(N, 7 + turns);
    const keys = keyIndexes(c, opts.keyCards);
    const keyOf = new Int32Array(c.M).fill(-1);  // first key that a unique card satisfies
    keys.forEach((k, ki) => k.us.forEach(u => { if (keyOf[u] < 0) keyOf[u] = ki; }));
    const keyMulti = keys.map(k => new Set(k.us));

    const perm = Int32Array.from(c.slots), hand = new Int32Array(N + 8);
    const MAXS = 128, srcMask = new Int32Array(MAXS), srcFrom = new Int32Array(MAXS), srcUsed = new Uint8Array(MAXS);
    const avail = new Int32Array(MAXS);
    const keyCast = new Int32Array(keys.length);
    const landHit = new Float64Array(turns + 1), manaSum = new Float64Array(turns + 1), dmgSum = new Float64Array(turns + 1);
    const castFirst = new Float64Array(keys.length * (turns + 1));
    const killTurn = new Int32Array(iterations);

    for (let g = 0; g < iterations; g++){
      partialShuffle(perm, N, 0, depth, rng);
      const r = mtgMulligan(c, perm, hand, rng, keep, floor, depth);
      let hl = r.size, lib = 7, nSrc = 0, ready = 0, pending = 0, dmg = 0, kill = 0;
      keyCast.fill(0);
      for (let t = 1; t <= turns; t++){
        ready += pending; pending = 0;
        if (!(t === 1 && onPlay) && lib < N) hand[hl++] = perm[lib++];
        // Colors the hand wants that the battlefield cannot make yet.
        let have = 0, want = 0, hasTrueLand = 0;
        for (let s = 0; s < nSrc; s++) have |= srcMask[s];
        for (let i = 0; i < hl; i++){ const u = hand[i]; if (c.isLand[u]) hasTrueLand = 1; else want |= c.needMask[u]; }
        const missing = want & ~have;
        // Land drop: MDFC backs only when no real land is in hand.
        let li = -1, ls = -1e9;
        for (let i = 0; i < hl; i++){
          const u = hand[i];
          if (!(c.isLand[u] || (c.mdfc[u] && !hasTrueLand))) continue;
          const m = c.landMask[u];
          const s = POP[m & missing] * 100 + (c.landTapped[u] ? 0 : 20) + POP[m];
          if (s > ls){ ls = s; li = i; }
        }
        if (li >= 0){
          const u = hand[li]; hand[li] = hand[--hl];
          if (nSrc < MAXS){ srcMask[nSrc] = c.landMask[u]; srcFrom[nSrc] = c.landTapped[u] ? t + 1 : t; nSrc++; }
          landHit[t]++;
        }
        let na = 0;
        for (let s = 0; s < nSrc; s++) if (srcFrom[s] <= t) avail[na++] = srcMask[s];
        manaSum[t] += na;
        srcUsed.fill(0, 0, na);
        // Greedy casting: highest mana value first; X spells (X=0) only after everything else.
        for (;;){
          let bi = -1, bs = -1;
          for (let i = 0; i < hl; i++){
            const u = hand[i];
            if (c.isLand[u] || !c.castable[u]) continue;
            const s = c.mv[u] + (c.hasX[u] ? 0 : 1000);
            if (s <= bs) continue;
            if (canPay(c, u, avail, srcUsed, na, 0)){ bs = s; bi = i; }
          }
          if (bi < 0) break;
          const u = hand[bi]; hand[bi] = hand[--hl];
          canPay(c, u, avail, srcUsed, na, 1);
          if (c.isCreature[u]){ if (c.haste[u]) ready += c.power[u]; else pending += c.power[u]; }
          dmg += c.burn[u];
          for (let m = 0; m < c.manaCount[u] && nSrc < MAXS; m++){ srcMask[nSrc] = c.manaMask[u]; srcFrom[nSrc] = t + 1; nSrc++; }
          if (keyOf[u] >= 0) for (let ki = 0; ki < keys.length; ki++) if (!keyCast[ki] && keyMulti[ki].has(u)){ keyCast[ki] = t; castFirst[ki * (turns + 1) + t]++; }
        }
        dmg += ready;  // attack with everything that could attack this turn
        dmgSum[t] += dmg;
        if (!kill && dmg >= life) kill = t;
      }
      killTurn[g] = kill;
    }
    const st = distStats(killTurn, iterations, turns);
    return {
      game: 'mtg', iterations, turns, onPlay, life,
      landDropRate: turnArray(turns, t => landHit[t] / iterations),
      avgMana: turnArray(turns, t => manaSum[t] / iterations),
      castBy: castByOut(keys, castFirst, turns, iterations),
      killTurnDist: st.dist, avgKillTurn: st.avg, medianKillTurn: st.median, killRate: st.winRate,
      avgDamageByTurn: turnArray(turns, t => dmgSum[t] / iterations)
    };
  }

  function lorcanaGoldfish(deck, opts){
    const c = compileLorcana(deck), N = c.N;
    if (!N) return {game: 'lorcana', empty: true};
    const turns = opts.turns ?? 10, iterations = opts.iterations ?? 5000, onPlay = opts.onPlay ?? true;
    const rng = seededRng(opts.seed ?? defaultSeed());
    const goal = opts.lore ?? 20;
    const keep = Object.assign({minInkable: 3, minCheap: 2, cheapCost: 3}, opts.keep || {});
    const depth = Math.min(N, 7 + turns + 7);
    const keys = keyIndexes(c, opts.keyCards), keySets = keys.map(k => new Set(k.us));
    let maxCost = 0; for (let u = 0; u < c.M; u++) if (c.cost[u] > maxCost) maxCost = c.cost[u];
    const perm = Int32Array.from(c.slots), hand = new Int32Array(N + 8);
    const keyCast = new Int32Array(keys.length), dupCount = new Int32Array(c.M);
    const inkSum = new Float64Array(turns + 1), inkHit = new Float64Array(turns + 1), loreSum = new Float64Array(turns + 1);
    const castFirst = new Float64Array(keys.length * (turns + 1));
    const winTurn = new Int32Array(iterations);

    for (let g = 0; g < iterations; g++){
      partialShuffle(perm, N, 0, depth, rng);
      const r = lorcanaMulligan(c, perm, hand, rng, keep, depth);
      let hl = r.len, lib = r.len, ink = 0, lore = 0, quest = 0, questNext = 0, loc = 0, locNext = 0, win = 0;
      keyCast.fill(0);
      for (let t = 1; t <= turns; t++){
        // Start of turn: locations already in play give lore; last turn's characters are dry.
        loc += locNext; locNext = 0; lore += loc;
        quest += questNext; questNext = 0;
        if (!(t === 1 && onPlay) && lib < N) hand[hl++] = perm[lib++];
        // Ink the inkable we are least likely to play soon: can't-afford-this-turn first,
        // then highest cost, then duplicates.
        for (let i = 0; i < hl; i++) dupCount[hand[i]]++;
        let ii = -1, is = -1e9;
        for (let i = 0; i < hl; i++){
          const u = hand[i]; if (!c.ink[u]) continue;
          const s = (c.cost[u] > ink + 1 ? 1000 : 0) + c.cost[u] * 10 + (dupCount[u] > 1 ? 5 : 0);
          if (s > is){ is = s; ii = i; }
        }
        for (let i = 0; i < hl; i++) dupCount[hand[i]] = 0;
        // Inking is optional once the inkwell covers the deck's top cost: skip it when the rest
        // of the hand could already be played with the ink we have.
        if (ii >= 0 && ink >= maxCost){
          let rest = 0; for (let i = 0; i < hl; i++) if (i !== ii) rest += c.cost[hand[i]];
          if (rest <= ink) ii = -1;
        }
        if (ii >= 0){ hand[ii] = hand[--hl]; ink++; inkHit[t]++; }
        lore += quest;  // characters played before this turn quest
        // Spend ink greedily, highest cost first.
        let left = ink;
        for (;;){
          let bi = -1, bc = -1;
          for (let i = 0; i < hl; i++){ const k = c.cost[hand[i]]; if (k <= left && k > bc){ bc = k; bi = i; } }
          if (bi < 0) break;
          const u = hand[bi]; hand[bi] = hand[--hl]; left -= bc;
          if (c.kind[u] === 1) questNext += c.lore[u];
          else if (c.kind[u] === 2) locNext += c.lore[u];
          for (let ki = 0; ki < keys.length; ki++) if (!keyCast[ki] && keySets[ki].has(u)){ keyCast[ki] = t; castFirst[ki * (turns + 1) + t]++; }
        }
        inkSum[t] += ink; loreSum[t] += lore;
        if (!win && lore >= goal) win = t;
      }
      winTurn[g] = win;
    }
    const st = distStats(winTurn, iterations, turns);
    return {
      game: 'lorcana', iterations, turns, onPlay, goal,
      inkByTurn: turnArray(turns, t => inkSum[t] / iterations),
      inkDropRate: turnArray(turns, t => inkHit[t] / iterations),
      loreByTurn: turnArray(turns, t => loreSum[t] / iterations),
      winTurnDist: st.dist, avgWinTurn: st.avg, medianWinTurn: st.median, winRate: st.winRate,
      castBy: castByOut(keys, castFirst, turns, iterations)
    };
  }

  /* --------------------------------------------------------- deck summary */

  const MTG_TYPES = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle'];

  function summarizeDeck(deck, game){
    game = game || detectGame(deck);
    const entries = (deck || []).filter(e => e && e.card && (e.qty | 0) > 0);
    const total = entries.reduce((s, e) => s + (e.qty | 0), 0);
    if (game === 'mtg'){
      const curve = new Array(8).fill(0), types = {}, pips = {W: 0, U: 0, B: 0, R: 0, G: 0};
      MTG_TYPES.forEach(t => { types[t] = 0; });
      let lands = 0, mdfcLands = 0, mvSum = 0, nonland = 0;
      entries.forEach(({card, qty}) => {
        const fType = front(card.ty, ' // ');
        MTG_TYPES.forEach(t => { if (new RegExp('\\b' + t + '\\b').test(fType)) types[t] += qty; });
        if (/\bLand\b/.test(fType)){ lands += qty; return; }
        if (/\bLand\b/.test(back(card.ty, ' // '))) mdfcLands += qty;
        const cost = parseManaCost(card.mc);
        const mv = /\{/.test(front(card.mc, ' // ')) ? cost.mv : (Number(card.co) | 0);
        curve[Math.min(7, mv)] += qty; mvSum += mv * qty; nonland += qty;
        // Pips: a hybrid pip counts half to each of its colors.
        cost.pips.forEach(m => {
          const share = 1 / POP[m];
          for (const k in COLOR_BIT) if (m & COLOR_BIT[k]) pips[k] += share * qty;
        });
      });
      return {game, total, curve, curveLabels: ['0', '1', '2', '3', '4', '5', '6', '7+'], lands, mdfcLands,
        nonlands: nonland, pips, avgManaValue: nonland ? mvSum / nonland : 0, types};
    }
    if (game === 'lorcana'){
      const curve = new Array(8).fill(0), types = {Character: 0, Action: 0, Song: 0, Item: 0, Location: 0}, inkColors = {};
      let inkable = 0, loreSum = 0, chars = 0;
      entries.forEach(({card, qty}) => {
        const k = Math.max(0, Number(card.co) | 0);
        curve[Math.min(8, Math.max(1, k)) - 1] += qty;  // cost 0 (none printed) folds into 1
        if (card.ik) inkable += qty;
        String(card.i || '').split(/[\/,]/).map(s => s.trim()).filter(Boolean).forEach(col => { inkColors[col] = (inkColors[col] || 0) + qty; });
        const ty = String(card.ty || ''), song = /Song/.test(ty) || /Song/.test(card.cl || '');
        if (/Character/.test(ty)){ types.Character += qty; chars += qty; loreSum += (Number(card.lo) || 0) * qty; }
        else if (/Location/.test(ty)) types.Location += qty;
        else if (/Item/.test(ty)) types.Item += qty;
        else if (/Action/.test(ty)) types.Action += qty;
        if (song) types.Song += qty;  // Songs are also counted under Action
      });
      return {game, total, curve, curveLabels: ['1', '2', '3', '4', '5', '6', '7', '8+'], inkable, inkColors, types,
        avgLorePerCharacter: chars ? loreSum / chars : 0};
    }
    const types = {};
    entries.forEach(({card, qty}) => { const t = String(card.ty || 'Unknown'); types[t] = (types[t] || 0) + qty; });
    return {game, total, types};
  }

  /* ---------------------------------------------------------- assumptions */

  const ASSUMPTIONS = {
    general: [
      'Results are Monte Carlo estimates from seeded random shuffles; re-running with the same seed gives the same numbers.',
      'On the play the first turn has no draw; on the draw you draw on turn 1.',
      'There is no opponent: nothing is removed, blocked, countered or discarded.'
    ],
    mtg: [
      'A land is any card with "Land" on its front face type line.',
      'A modal double-faced card with a Land back counts as a land for land counts and keep decisions; in play it is used as a land only when no real land is in hand.',
      'Opening hands keep 2 to 5 lands in 7 cards; after each London mulligan the upper limit drops by one, and a 4-card hand is always kept.',
      'Mulligan bottoms aim for about 45% lands (at least 2): excess lands go first, otherwise the most expensive spell.',
      'Lands make one mana each; colors come from basic land types and "Add {G}"-style text, and "any color" or basic-fetching lands count as every color.',
      'Lands that say they enter tapped come in tapped; "unless" and pay-life lands are assumed untapped.',
      'Hybrid symbols are paid with either color, Phyrexian symbols with life, and X is treated as 0 (X spells are cast only after everything else).',
      'Each turn: draw, play the land that adds a missing color, then cast the highest-mana-value spells you can pay for.',
      'Permanents with "{T}: Add" make mana starting next turn (one mana, or the number of symbols shown, up to 3).',
      'Creatures attack for their printed power from the turn after they are cast; haste creatures attack right away. Static boosts and abilities are ignored.',
      'Burn is counted only for instants and sorceries that say "deals N damage to any target / target player / each opponent"; it all goes face.',
      'The opponent starts at 20 life, or 40 for 99-100 card (Commander) decks; the command zone is not modelled.',
      'Color screw means a kept hand has enough lands for a 1- or 2-mana spell by turn 2 but not the right colors for any of them.'
    ],
    lorcana: [
      'Keep the opening 7 when it has at least 3 inkable cards and at least 2 cards costing 3 or less.',
      'Otherwise mulligan once: bottom non-inkable cards costing more than 4 and any cards costing 4+ beyond the two cheapest, draw that many, and shuffle.',
      'One inkable card goes into the inkwell every turn when possible: one you cannot afford this turn first, then the highest cost, then duplicates.',
      'Once the inkwell covers the deck\'s most expensive card, you stop inking if the rest of your hand is already affordable.',
      'Cards are played greedily, highest cost first, with the ink available. Shift, singing and card abilities are ignored.',
      'Characters quest for their lore from the turn after they are played (Rush only helps challenges, so it does not speed questing).',
      'Locations give their lore at the start of each of your turns after they are played. Actions, Songs and Items give no lore.',
      'The goal is 20 lore and nothing is ever challenged or banished.',
      'On-curve odds ask whether a card of exactly that cost is in hand and you have inked that many cards by that turn.'
    ],
    other: [
      'Only draw math is modelled for this game: card type counts in the opening hand.'
    ]
  };

  const api = {
    version: 1, seededRng, hypergeom, drawOdds, comboOdds, openingHands, goldfish, summarizeDeck,
    detectGame, parseManaCost, ASSUMPTIONS,
    _internal: {compileMtg, compileLorcana, landColors, manaAbility, partialShuffle}
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InkSim = api;
})(typeof self !== 'undefined' ? self : this);
