#!/usr/bin/env node
'use strict';
// Builds pokemon-cards.json in InkScan's card shape.
// Usage: node tools/build-pokemon.cjs [outputPath]
// Cards: the open PokemonTCG/pokemon-tcg-data set files (what the pokemontcg.io API serves).
// Prices and store links: TCGplayer's catalog via tcgcsv.com (category 3 = Pokémon), matched by set and number.
// Images are not stored: images.pokemontcg.io/<set id>/<number>.png is derived from the card id.
const fs = require('node:fs');
const path = require('node:path');

const DATA = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master';
const TCGCSV = 'https://tcgcsv.com/tcgplayer/3';
// tcgcsv's usage guidelines ask every script to identify itself.
const UA = {headers: {'User-Agent': 'InkScan-catalog-builder/1.0 (+https://github.com/Raestin/inkscan)'}};
const out = process.argv[2] || path.join(__dirname, '..', 'pokemon-cards.json');

// Standard is every card with these regulation marks (G rotated out April 2026). Update at each rotation.
const STANDARD_MARKS = new Set(['H', 'I', 'J']);
// Set codes as decklists (Pokémon TCG Live, Limitless) write them, where the data's own code differs.
// The Classic Collection shares "30C" with 30th Celebration and overlapping numbers, so it gets its own.
const CODE_FIX = {svp: 'SVP', me55c: '30CC'};
const codeOf = s => CODE_FIX[s.id] || s.ptcgoCode || s.id.toUpperCase();
const ENERGY = {Grass: 'G', Fire: 'R', Water: 'W', Lightning: 'L', Psychic: 'P', Fighting: 'F', Darkness: 'D', Metal: 'M', Dragon: 'N', Fairy: 'Y', Colorless: 'C'};
const flat = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const num = v => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const price = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function json(url, opts) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, opts);
    if (res.ok) return res.json();
    if (i >= 2) throw Error(`${url} returned ${res.status}`);
    await sleep(1500);
  }
}

// Attack and ability text in one readable block: "{R}{P} Phantom Dive 200: Put 6 damage counters..."
function cardText(c) {
  const lines = [];
  for (const a of c.abilities || []) lines.push(`${a.type || 'Ability'}: ${a.name}. ${a.text || ''}`.trim());
  for (const a of c.attacks || []) {
    const cost = (a.cost || []).map(e => `{${ENERGY[e] || '?'}}`).join('') || '{0}';
    lines.push(`${cost} ${a.name}${a.damage ? ' ' + a.damage : ''}${a.text ? ': ' + a.text : ''}`);
  }
  // Trainer and Energy rules; for Pokémon only the rules that are not the stock ex/Tera/Mega reminder text.
  for (const r of c.rules || []) if (c.supertype !== 'Pokémon' || !/^(Pokémon ex rule|Tera:|Mega Evolution ex rule|Pokémon V rule|VSTAR rule|VMAX rule|Radiant Pokémon rule|ACE SPEC rule)/i.test(r)) lines.push(r);
  return lines.join('\n');
}
// What separates different cards that share a name: a Pokémon's attacks and abilities. Reprints share it.
function signature(c) {
  if (c.supertype !== 'Pokémon') return '';
  return [...(c.abilities || []).map(a => a.name), ...(c.attacks || []).map(a => a.name)].join(' / ');
}

async function tcgplayer(sets) {
  const groups = (await json(`${TCGCSV}/groups`, UA)).results || [];
  const bySet = new Map();
  for (const s of sets) {
    const want = flat(s.name);
    // "SV06: Twilight Masquerade" holds "Twilight Masquerade"; prefer the closest name when several do.
    const hits = groups.filter(g => { const n = flat(g.name.replace(/^[A-Z0-9]+:\s*/, '')); return n === want || flat(g.name).endsWith(want); });
    if (hits.length) bySet.set(s.id, hits.sort((a, b) => a.name.length - b.name.length)[0]);
  }
  const cards = new Map();
  for (const [setId, g] of bySet) {
    const [prods, prices] = await Promise.all([json(`${TCGCSV}/${g.groupId}/products`, UA), json(`${TCGCSV}/${g.groupId}/prices`, UA)]);
    const pr = new Map();
    for (const p of prices.results || []) (pr.get(p.productId) || pr.set(p.productId, {}).get(p.productId))[p.subTypeName] = p.marketPrice;
    const list = [];
    for (const p of prods.results || []) {
      const number = (p.extendedData || []).find(e => e.name === 'Number')?.value;
      if (number) list.push({id: p.productId, n: flat(p.name.replace(/\s*-\s*[A-Z0-9]*\d+\/\d+.*$/i, '')), num: flat(String(number).split('/')[0]).replace(/^0+(?=\d)/, ''), pr: pr.get(p.productId) || {}});
    }
    cards.set(setId, list);
    await sleep(100);
  }
  return cards;
}

async function main() {
  const sets = (await json(`${DATA}/sets/en.json`)).sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.id.localeCompare(b.id));
  if (sets.length < 150) throw Error(`Only ${sets.length} sets; refusing to write`);
  const products = await tcgplayer(sets);
  const cards = []; let priced = 0;
  for (const s of sets) {
    const code = codeOf(s);
    const list = await json(`${DATA}/cards/en/${s.id}.json`);
    const prods = products.get(s.id) || [];
    for (const c of list) {
      const n = flat(String(c.number)).replace(/^0+(?=\d)/, '');
      const same = prods.filter(p => p.num === n);
      const prod = same.length > 1 ? (same.find(p => p.n === flat(c.name)) || same[0]) : same[0];
      const pr = prod?.pr || {};
      const p = price(pr.Normal ?? pr.Holofoil ?? pr['1st Edition Holofoil'] ?? pr.Unlimited), pf = price(pr['Reverse Holofoil'] ?? (pr.Normal != null ? pr.Holofoil : null));
      if (p != null || pf != null) priced++;
      const weak = (c.weaknesses || []).map(w => `${w.type} ${w.value}`).join(', ');
      const resist = (c.resistances || []).map(w => `${w.type} ${w.value}`).join(', ');
      cards.push({
        id: c.id, n: c.name, v: signature(c), s: code, sn: s.name, c: String(c.number), r: c.rarity || '', pv: '',
        i: (c.types || (c.supertype === 'Pokémon' ? ['Colorless'] : [])).join('/'), co: c.convertedRetreatCost ?? null, ik: 1,
        ty: c.supertype === 'Pokémon' ? 'Pokémon' : c.supertype, cl: (c.subtypes || []).join(' · '),
        st: num(c.hp), wk: weak || null, rs: resist || null, ef: c.evolvesFrom || null, rg: c.regulationMark || null,
        lg: STANDARD_MARKS.has(c.regulationMark) || (c.supertype === 'Energy' && (c.subtypes || []).includes('Basic')) ? 1 : 0, tx: cardText(c), p, pf, ...(prod ? {t: prod.id} : {})
      });
    }
    await sleep(50);
  }
  // An older printing is Standard legal when an identical card (same name and text) has a legal reprint.
  const legalText = new Set(cards.filter(c => c.lg).map(c => flat(c.n) + '|' + flat(c.tx)));
  for (const c of cards) if (!c.lg && legalText.has(flat(c.n) + '|' + flat(c.tx))) c.lg = 1;
  if (cards.length < 15000) throw Error(`Only ${cards.length} cards; refusing to write a partial catalog`);
  const asof = new Date().toISOString().slice(0, 10);
  // Newest sets first in the set list, so the set filter opens on what people are playing.
  const setList = sets.map(s => ({code: codeOf(s), name: s.name})).filter((s, i, a) => a.findIndex(x => x.code === s.code) === i);
  setList.reverse();
  fs.writeFileSync(out, JSON.stringify({asof, source: 'pokemon-tcg-data + TCGplayer via tcgcsv.com', sets: setList, cards}));
  console.log(`Wrote ${cards.length} Pokémon printings in ${setList.length} sets (${priced} priced) to ${out}`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
