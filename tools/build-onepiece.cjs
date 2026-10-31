#!/usr/bin/env node
'use strict';
// Builds onepiece-cards.json in InkScan's card shape from optcgapi.com.
// Usage: node tools/build-onepiece.cjs [outputPath]
// Card identity: id = printing image id (OP01-001, OP01-001_p1 for a parallel),
// v = the printed card code, so a parallel shares its deck key with the base card.
const fs = require('node:fs');
const path = require('node:path');

const SOURCES = ['https://optcgapi.com/api/allSetCards/', 'https://optcgapi.com/api/allSTCards/'];
const out = process.argv[2] || path.join(__dirname, '..', 'onepiece-cards.json');

// Trailing parentheticals are printing labels ("(Parallel)", "(Jolly Roger Foil)") or a
// disambiguating code ("(OP01-016)", "(001)"); the card's name is what comes before them.
const PRINTING_LABEL = /^(?:Parallel|Jolly Roger Foil|Full Art|(?:Red |Super |Super Leader |Red Super )?Alternate Art|Reprint|Box Topper|SPR?|Manga|Textured Foil|Pirate Foil|Wanted Poster|Dash Pack|Gold|Silver|TR|Pandaman Art|Gold-Stamped Signature)$/i;
function splitName(raw) {
  let name = String(raw || '').trim(); const labels = [];
  for (let m; (m = /\s*\(([^()]*)\)\s*$/.exec(name));) {
    const label = m[1].trim();
    const code = /^(?:[A-Z]+\d*-)?\d{3,4}$|^[A-Z]{2,3}\d{2}$/.test(label);
    const parts = label.split(/\s*,\s*/);
    // Only known printing labels leave the name; "Mr.1 (Daz.Bonez)" keeps its alias.
    if (!code && !parts.every(part => PRINTING_LABEL.test(part))) break;
    if (!code) labels.unshift(label);
    name = name.slice(0, m.index).trim();
  }
  return {name: name.replace(/\s+/g, ' '), label: labels.join(', ')};
}
const num = value => { const n = Number.parseInt(value, 10); return Number.isFinite(n) ? n : null; };
const price = value => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };
const prefixOf = code => String(code).split('-')[0];
const setOrder = code => {
  const m = /^([A-Z]+)(\d+)$/.exec(code) || [];
  const group = {OP: 0, EB: 1, ST: 2, PRB: 3}[m[1]] ?? 4;
  return group * 1000 + (Number(m[2]) || 0);
};

async function main() {
  const rows = [];
  for (const url of SOURCES) {
    const res = await fetch(url);
    if (!res.ok) throw Error(`${url} returned ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) throw Error(`${url} returned no cards`);
    rows.push(...data);
  }
  const byId = new Map();
  for (const r of rows) {
    const id = String(r.card_image_id || '').trim();
    const code = String(r.card_set_id || '').trim();
    if (!id || !/^[A-Z]+\d*-\d{3}/.test(code)) continue;
    const prev = byId.get(id);
    // A reprint inside a later product keeps the original set's row.
    const home = String(r.set_id || '').replace('-', '') === prefixOf(code);
    if (prev && !home) continue;
    byId.set(id, r);
  }
  const setNames = new Map();
  for (const r of byId.values()) {
    const prefix = prefixOf(r.card_set_id);
    if (String(r.set_id || '').replace('-', '') === prefix && !setNames.has(prefix)) setNames.set(prefix, r.set_name);
  }
  const cards = [];
  for (const [id, r] of byId) {
    const code = r.card_set_id.trim();
    const prefix = prefixOf(code);
    const parallel = /_p\d+$/i.test(id);
    const {name, label} = splitName(r.card_name);
    cards.push({
      id, n: name, v: code, s: prefix, sn: setNames.get(prefix) || r.set_name || prefix,
      c: code.split('-')[1], r: r.rarity || '', pv: label || (parallel ? 'Parallel' : ''),
      i: String(r.card_color || '').trim().split(/\s+/).filter(Boolean).join('/'),
      co: num(r.card_cost), ik: 1, ty: r.card_type || '', cl: String(r.sub_types || '').trim(),
      st: num(r.card_power), wp: num(r.counter_amount), lo: num(r.life),
      at: r.attribute && r.attribute !== 'NULL' ? r.attribute : '', tx: String(r.card_text || '').trim(),
      p: price(r.market_price), pf: null, img: r.card_image || ''
    });
  }
  // Hand-checked cards optcgapi does not have yet (newer promos), from tools/onepiece-extra.json.
  // Added only while optcgapi lacks the code, so the API's own data wins once it catches up.
  const extraPath = path.join(__dirname, 'onepiece-extra.json');
  if (fs.existsSync(extraPath)) {
    const have = new Set(cards.map(c => c.v));
    for (const x of JSON.parse(fs.readFileSync(extraPath, 'utf8'))) if (!have.has(x.v)) { const {src, ...card} = x; cards.push(card); }
  }
  // optcgapi appends the code to some names ("Perona - OP14-111") and truncates a few; the name is
  // what comes before the code, and tools/onepiece-names.json holds hand-checked fixes by card code.
  const namesPath = path.join(__dirname, 'onepiece-names.json');
  const fixes = fs.existsSync(namesPath) ? JSON.parse(fs.readFileSync(namesPath, 'utf8')) : {};
  for (const c of cards) { if (c.n.endsWith(' - ' + c.v)) c.n = c.n.slice(0, -(c.v.length + 3)); if (fixes[c.v]) c.n = fixes[c.v]; }
  const sets = [...new Set(cards.map(c => c.s))].sort((a, b) => setOrder(a) - setOrder(b) || a.localeCompare(b))
    .map(code => ({code, name: setNames.get(code) || code}));
  const order = new Map(sets.map((s, i) => [s.code, i]));
  cards.sort((a, b) => order.get(a.s) - order.get(b.s) || a.c.localeCompare(b.c) || a.id.localeCompare(b.id));
  if (cards.length < 3000) throw Error(`Only ${cards.length} cards; refusing to write a partial catalog`);
  const asof = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(out, JSON.stringify({asof, source: 'optcgapi.com', sets, cards}));
  console.log(`Wrote ${cards.length} One Piece printings in ${sets.length} sets to ${out}`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
