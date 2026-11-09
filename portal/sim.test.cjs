// Run: node --test portal/sim.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('./sim.js');

/* ---------- card builders in the app's compact format ---------- */
const BASIC_COLOR = {Plains: 'White', Island: 'Blue', Swamp: 'Black', Mountain: 'Red', Forest: 'Green'};
const basic = n => ({n, co: 0, mc: '', ty: 'Basic Land — ' + n, tx: '', st: null, wp: null, i: BASIC_COLOR[n]});
const land = (n, ty, tx, i) => ({n, co: 0, mc: '', ty, tx, st: null, wp: null, i});
const spell = (n, mc, co, ty, tx, i, st = null, wp = null) => ({n, mc, co, ty, tx, st, wp, i});

// Mono-red burn: 20 Mountains, hasty one-drops, burn.
function burnDeck(){
  return [
    {qty: 20, card: basic('Mountain')},
    {qty: 4, card: spell('Goblin Guide', '{R}', 1, 'Creature — Goblin Scout', 'Haste\nWhenever Goblin Guide attacks, defending player reveals the top card of their library. If it\'s a land card, that player puts it into their hand.', 'Red', 2, 2)},
    {qty: 4, card: spell('Monastery Swiftspear', '{R}', 1, 'Creature — Human Monk', 'Haste\nProwess', 'Red', 1, 2)},
    {qty: 4, card: spell('Eidolon of the Great Revel', '{R}{R}', 2, 'Enchantment Creature — Spirit', 'Whenever a player casts a spell with mana value 3 or less, Eidolon of the Great Revel deals 2 damage to that player.', 'Red', 2, 2)},
    {qty: 4, card: spell('Lightning Bolt', '{R}', 1, 'Instant', 'Lightning Bolt deals 3 damage to any target.', 'Red')},
    {qty: 4, card: spell('Chain Lightning', '{R}', 1, 'Sorcery', 'Chain Lightning deals 3 damage to any target. Then that player or that permanent\'s controller may pay {R}{R}. If the player does, they may copy this spell and may choose a new target for that copy.', 'Red')},
    {qty: 4, card: spell('Lava Spike', '{R}', 1, 'Sorcery — Arcane', 'Lava Spike deals 3 damage to target player or planeswalker.', 'Red')},
    {qty: 4, card: spell('Rift Bolt', '{2}{R}', 3, 'Sorcery', 'Rift Bolt deals 3 damage to any target.\nSuspend 1—{R}', 'Red')},
    {qty: 4, card: spell('Skewer the Critics', '{2}{R}', 3, 'Sorcery', 'Skewer the Critics deals 3 damage to any target.\nSpectacle {R}', 'Red')},
    {qty: 4, card: spell('Lightning Strike', '{1}{R}', 2, 'Instant', 'Lightning Strike deals 3 damage to any target.', 'Red')},
    {qty: 4, card: spell('Light Up the Stage', '{2}{R}', 3, 'Sorcery', 'Spectacle {R}\nExile the top two cards of your library. Until the end of your next turn, you may play those cards.', 'Red')}
  ];
}

// Selesnya midrange: 24 lands (basics, duals, an "any color" land), 36 spells.
function gwDeck(){
  return [
    {qty: 9, card: basic('Forest')},
    {qty: 7, card: basic('Plains')},
    {qty: 4, card: land('Temple Garden', 'Land — Forest Plains', '({T}: Add {G} or {W}.)\nAs Temple Garden enters, you may pay 2 life. If you don\'t, it enters tapped.', 'Green/White')},
    {qty: 4, card: land('Brushland', 'Land', '{T}: Add {C}.\n{T}: Add {G} or {W}. Brushland deals 1 damage to you.', 'Green/White')},
    {qty: 4, card: spell('Llanowar Elves', '{G}', 1, 'Creature — Elf Druid', '{T}: Add {G}.', 'Green', 1, 1)},
    {qty: 4, card: spell('Thalia, Guardian of Thraben', '{1}{W}', 2, 'Legendary Creature — Human Soldier', 'First strike\nNoncreature spells cost {1} more to cast.', 'White', 2, 1)},
    {qty: 4, card: spell('Tarmogoyf', '{1}{G}', 2, 'Creature — Lhurgoyf', 'Tarmogoyf\'s power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1.', 'Green', null, null)},
    {qty: 4, card: spell('Swords to Plowshares', '{W}', 1, 'Instant', 'Exile target creature. Its controller gains life equal to its power.', 'White')},
    {qty: 4, card: spell('Brimaz, King of Oreskos', '{1}{W}{W}', 3, 'Legendary Creature — Cat Soldier', 'Vigilance\nWhenever Brimaz attacks, create a 1/1 white Cat Soldier creature token with vigilance that\'s attacking.', 'White', 3, 4)},
    {qty: 4, card: spell('Knight of Autumn', '{1}{G}{W}', 3, 'Creature — Dryad Knight', 'When Knight of Autumn enters, choose one —\n• Put two +1/+1 counters on Knight of Autumn.', 'Green/White', 2, 1)},
    {qty: 4, card: spell('Oath of Nissa', '{G}', 1, 'Legendary Enchantment', 'When Oath of Nissa enters, look at the top three cards of your library.', 'Green')},
    {qty: 4, card: spell('Elspeth, Sun\'s Champion', '{4}{W}{W}', 6, 'Legendary Planeswalker — Elspeth', '+1: Create three 1/1 white Soldier creature tokens.', 'White')},
    {qty: 2, card: spell('Glorybringer', '{3}{R}{R}', 5, 'Creature — Dragon', 'Flying, haste', 'Red', 4, 4)},
    {qty: 2, card: spell('Emeria\'s Call // Emeria, Shattered Skyclave', '{4}{W}{W}{W} // ', 7, 'Sorcery // Land', 'Create two 4/4 white Angel Warrior creature tokens with flying.\n//\nAs Emeria, Shattered Skyclave enters, you may pay 3 life. If you don\'t, it enters tapped.\n{T}: Add {W}.', 'White')}
  ];
}

// Lorcana: 15 real inkable Amber characters from The First Chapter, cost 1-4, lore 1-2, x4 each.
function lorcanaDeck(){
  const ch = (n, v, co, lo, st, wp, tx = '') => ({n, v, co, ik: 1, ty: 'Character', cl: 'Storyborn', lo, st, wp, tx, i: 'Amber'});
  return [
    ch('Ariel', 'On Human Legs', 4, 2, 3, 4), ch('Ariel', 'Spectacular Singer', 3, 1, 2, 3, 'Singer 5'),
    ch('Cinderella', 'Gentle and Kind', 4, 2, 2, 5), ch('HeiHei', 'Boat Snack', 1, 1, 1, 2),
    ch('LeFou', 'Bumbler', 2, 2, 1, 2), ch('Maximus', 'Relentless Pursuer', 3, 1, 3, 3),
    ch('Mickey Mouse', 'True Friend', 3, 2, 3, 3), ch('Minnie Mouse', 'Beloved Princess', 2, 1, 2, 3),
    ch('Mr. Smee', 'Loyal First Mate', 3, 1, 2, 5), ch('Pumbaa', 'Friendly Warthog', 4, 1, 3, 5),
    ch('Rapunzel', 'Gifted with Healing', 4, 2, 1, 5), ch('Sebastian', 'Court Composer', 2, 1, 2, 2, 'Singer 4'),
    ch('Simba', 'Protective Cub', 2, 1, 2, 3, 'Bodyguard'), ch('Stitch', 'New Dog', 1, 1, 2, 2),
    ch('Timon', 'Grub Rustler', 1, 1, 1, 2)
  ].map(card => ({card, qty: 4}));
}

const sizeOf = d => d.reduce((s, e) => s + e.qty, 0);
const ms = f => { const t = process.hrtime.bigint(); const r = f(); return [r, Number(process.hrtime.bigint() - t) / 1e6]; };

/* ---------- exact math ---------- */

test('hypergeom matches known values', () => {
  assert.ok(Math.abs(S.hypergeom({deckSize: 60, copies: 4, draws: 7}) - 0.3995) < 5e-4);
  assert.ok(Math.abs(S.hypergeom({deckSize: 99, copies: 1, draws: 7}) - 7 / 99) < 1e-12);
  assert.strictEqual(S.hypergeom({deckSize: 60, copies: 0, draws: 7}), 0);
  assert.strictEqual(S.hypergeom({deckSize: 60, copies: 4, draws: 60, atLeast: 4}), 1);
  // no overflow on large decks
  const p = S.hypergeom({deckSize: 100, copies: 35, draws: 40, atLeast: 10});
  assert.ok(p > 0 && p < 1);
});

test('drawOdds is monotonic and counts cards correctly', () => {
  const play = S.drawOdds({deckSize: 60, copies: 4, handSize: 7, onPlay: true, turns: 10});
  const draw = S.drawOdds({deckSize: 60, copies: 4, handSize: 7, onPlay: false, turns: 10});
  assert.strictEqual(play.length, 10);
  assert.deepStrictEqual([play[0].cards, play[9].cards], [7, 16]);
  assert.deepStrictEqual([draw[0].cards, draw[9].cards], [8, 17]);
  for (let i = 1; i < 10; i++){
    assert.ok(play[i].p >= play[i - 1].p);
    assert.ok(draw[i].p >= draw[i - 1].p);
    assert.ok(draw[i].p >= play[i].p);
  }
});

test('comboOdds agrees with exact math for a single group and is monotonic', () => {
  const deck = [{key: 'Thassa|', qty: 4}, {key: 'Consult|', qty: 4}, {key: 'filler', qty: 52}];
  const one = S.comboOdds(deck, [{label: 'Thassa', keys: ['Thassa|'], need: 1}], {turns: 5, seed: 7});
  assert.ok(Math.abs(one[0].p - 0.3995) < 0.015);
  const both = S.comboOdds(deck, [{label: 'A', keys: ['Thassa|'], need: 1}, {label: 'B', keys: ['Consult|'], need: 1}], {turns: 10, seed: 7});
  for (let i = 1; i < both.length; i++) assert.ok(both[i].p >= both[i - 1].p);
  assert.ok(both[9].p < one[4].p + 0.2 && both[9].p > 0.4);
});

/* ---------- determinism ---------- */

test('seededRng and every simulator are deterministic for a seed', () => {
  const a = S.seededRng(42), b = S.seededRng(42);
  for (let i = 0; i < 100; i++) assert.strictEqual(a(), b());
  const o = {iterations: 2000, seed: 99};
  assert.deepStrictEqual(S.openingHands(gwDeck(), {...o, game: 'mtg'}), S.openingHands(gwDeck(), {...o, game: 'mtg'}));
  assert.deepStrictEqual(S.openingHands(lorcanaDeck(), {...o, game: 'lorcana'}), S.openingHands(lorcanaDeck(), {...o, game: 'lorcana'}));
  assert.deepStrictEqual(S.goldfish(burnDeck(), {...o, game: 'mtg', keyCards: ['Goblin Guide']}),
    S.goldfish(burnDeck(), {...o, game: 'mtg', keyCards: ['Goblin Guide']}));
  assert.deepStrictEqual(S.goldfish(lorcanaDeck(), {...o, game: 'lorcana'}), S.goldfish(lorcanaDeck(), {...o, game: 'lorcana'}));
  assert.notDeepStrictEqual(S.goldfish(burnDeck(), {iterations: 500, seed: 1, game: 'mtg'}).avgDamageByTurn,
    S.goldfish(burnDeck(), {iterations: 500, seed: 2, game: 'mtg'}).avgDamageByTurn);
});

/* ---------- MTG ---------- */

test('MTG 24-land deck: keep rate and average lands', () => {
  const d = gwDeck();
  assert.strictEqual(sizeOf(d), 60);
  const r = S.openingHands(d, {game: 'mtg', iterations: 20000, seed: 1});
  // 24 true lands + 2 MDFCs counted as lands = 26 land-ish cards
  assert.ok(r.keepRate7 > 0.80 && r.keepRate7 < 0.95, 'keepRate7 ' + r.keepRate7);
  assert.ok(Math.abs(r.avgLands - 7 * 26 / 60) < 0.05, 'avgLands ' + r.avgLands);
  assert.ok(Math.abs(r.landDist.reduce((s, p) => s + p, 0) - 1) < 1e-9);
  const m = r.mulliganTo; assert.ok(Math.abs(m[7] + m[6] + m[5] + m['4-'] - 1) < 1e-9);
  assert.ok(Math.abs(m[7] - r.keepRate7) < 1e-12);
  assert.strictEqual(r.sampleHands.length, 5);
  assert.ok(r.colorScrew >= 0 && r.colorScrew < 0.2, 'colorScrew ' + r.colorScrew);
  JSON.stringify(r);
});

test('MTG pure 24-land / 36-spell deck has avgLands ~2.8', () => {
  const d = [{qty: 24, card: basic('Mountain')}].concat(burnDeck().slice(1, 10));
  assert.strictEqual(sizeOf(d), 60);
  const r = S.openingHands(d, {game: 'mtg', iterations: 20000, seed: 3});
  assert.ok(Math.abs(r.avgLands - 2.8) < 0.04, 'avgLands ' + r.avgLands);
  assert.ok(r.keepRate7 > 0.80 && r.keepRate7 < 0.95, 'keepRate7 ' + r.keepRate7);
  assert.strictEqual(r.colorScrew, 0);  // mono-red can't be color screwed
  // landDist matches the exact hypergeometric distribution
  const exact2 = S.hypergeom({deckSize: 60, copies: 24, draws: 7, atLeast: 2}) - S.hypergeom({deckSize: 60, copies: 24, draws: 7, atLeast: 3});
  assert.ok(Math.abs(r.landDist[2] - exact2) < 0.012);
});

test('MTG color screw detects off-color spells', () => {
  const d = [{qty: 24, card: basic('Forest')}, {qty: 36, card: spell('Counterspell', '{U}{U}', 2, 'Instant', 'Counter target spell.', 'Blue')}];
  const r = S.openingHands(d, {game: 'mtg', iterations: 3000, seed: 4});
  assert.ok(r.colorScrew > 0.99);
});

test('mono-red burn goldfishes a kill on turn 4 to 8', () => {
  const r = S.goldfish(burnDeck(), {game: 'mtg', turns: 10, iterations: 5000, seed: 11, keyCards: ['Lightning Bolt', 'Goblin Guide']});
  assert.ok(r.avgKillTurn >= 4 && r.avgKillTurn <= 8, 'avgKillTurn ' + r.avgKillTurn);
  assert.ok(r.medianKillTurn >= 4 && r.medianKillTurn <= 8);
  assert.strictEqual(r.landDropRate.length, 11); assert.strictEqual(r.landDropRate[0], null);
  assert.ok(r.landDropRate[1] > 0.95);
  for (let t = 2; t <= 10; t++){
    assert.ok(r.avgDamageByTurn[t] >= r.avgDamageByTurn[t - 1]);
    assert.ok(r.castBy['Lightning Bolt'][t] >= r.castBy['Lightning Bolt'][t - 1]);
  }
  const total = Object.values(r.killTurnDist).reduce((s, p) => s + p, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.ok(r.avgMana[3] > 2 && r.avgMana[3] <= 3);
  JSON.stringify(r);
});

test('MTG goldfish uses mana dorks and Commander life', () => {
  const r = S.goldfish(gwDeck(), {game: 'mtg', iterations: 2000, seed: 5, keyCards: ['Elspeth, Sun\'s Champion']});
  assert.ok(r.avgMana[4] > r.landDropRate.slice(1, 5).reduce((s, p) => s + p, 0) - 0.5);  // elves add mana
  assert.ok(r.castBy['Elspeth, Sun\'s Champion'][10] > 0.2);
  const big = [{qty: 40, card: basic('Mountain')}].concat(burnDeck().slice(1).map(e => ({...e, qty: 6})));
  assert.strictEqual(sizeOf(big), 100);
  assert.strictEqual(S.goldfish(big, {game: 'mtg', iterations: 300, seed: 5}).life, 40);
  assert.strictEqual(S.goldfish(big, {game: 'mtg', iterations: 300, seed: 5, life: 30}).life, 30);
});

test('parseManaCost handles hybrid, phyrexian, X and DFC costs', () => {
  assert.deepStrictEqual(S.parseManaCost('{2}{G}{G}'), {generic: 2, pips: [16, 16], hasX: false, mv: 4});
  assert.deepStrictEqual(S.parseManaCost('{X}{R}'), {generic: 0, pips: [8], hasX: true, mv: 1});
  assert.deepStrictEqual(S.parseManaCost('{W/U}'), {generic: 0, pips: [3], hasX: false, mv: 1});
  assert.deepStrictEqual(S.parseManaCost('{G/P}'), {generic: 1, pips: [], hasX: false, mv: 1});
  assert.deepStrictEqual(S.parseManaCost('{1}{U} // {3}'), {generic: 1, pips: [2], hasX: false, mv: 2});
});

/* ---------- Lorcana ---------- */

test('Lorcana opening hands', () => {
  const r = S.openingHands(lorcanaDeck(), {game: 'lorcana', iterations: 20000, seed: 8});
  assert.strictEqual(r.avgInkable, 7);
  assert.strictEqual(r.inkableDist[7], 1);
  assert.ok(r.keepRate > 0.9 && r.keepRate <= 1);
  assert.ok(r.pOneDropByT1 > 0.72 && r.pOneDropByT1 < 0.88, 'p1 ' + r.pOneDropByT1);
  assert.ok(r.pTwoDropByT2 > 0.7, 'p2 ' + r.pTwoDropByT2);
  assert.ok(r.pThreeDropByT3 > 0.7, 'p3 ' + r.pThreeDropByT3);
  assert.strictEqual(r.sampleHands[0].length, 7);
});

test('Lorcana goldfish reaches 20 lore around turns 6-10', () => {
  const r = S.goldfish(lorcanaDeck(), {game: 'lorcana', turns: 12, iterations: 5000, seed: 9, keyCards: ['Mickey Mouse - True Friend']});
  assert.ok(r.avgWinTurn >= 6 && r.avgWinTurn <= 10, 'avgWinTurn ' + r.avgWinTurn);
  assert.ok(r.medianWinTurn >= 6 && r.medianWinTurn <= 10);
  assert.ok(r.inkDropRate[1] === 1 && r.inkByTurn[4] === 4);
  for (let t = 2; t <= 12; t++) assert.ok(r.loreByTurn[t] >= r.loreByTurn[t - 1]);
  assert.ok(r.castBy['Mickey Mouse - True Friend'][12] > 0.5);
});

test('Lorcana locations and non-inkables', () => {
  const d = lorcanaDeck().slice(0, 13);
  d.push({qty: 4, card: {n: 'Belle\'s House', v: 'Maurice\'s Workshop', co: 1, ik: 1, ty: 'Location', lo: 0, tx: ''}});
  d.push({qty: 4, card: {n: 'Be Our Guest', v: '', co: 2, ik: 0, ty: 'Action', cl: 'Song', lo: null, tx: 'Look at the top 4 cards of your deck.'}});
  const r = S.openingHands(d, {game: 'lorcana', iterations: 4000, seed: 2});
  assert.ok(r.avgInkable < 7 && r.avgInkable > 6);
  const s = S.summarizeDeck(d, 'lorcana');
  assert.strictEqual(s.types.Song, 4); assert.strictEqual(s.types.Location, 4); assert.strictEqual(s.inkable, 56);
});

/* ---------- summaries, other games ---------- */

test('summarizeDeck MTG and Lorcana', () => {
  const m = S.summarizeDeck(gwDeck(), 'mtg');
  assert.strictEqual(m.total, 60); assert.strictEqual(m.lands, 24); assert.strictEqual(m.mdfcLands, 2);
  assert.strictEqual(m.curve.reduce((s, x) => s + x, 0), 36);
  assert.strictEqual(m.types.Creature, 22); assert.strictEqual(m.types.Planeswalker, 4);
  assert.ok(m.pips.W > m.pips.G);
  const l = S.summarizeDeck(lorcanaDeck(), 'lorcana');
  assert.strictEqual(l.inkable, 60); assert.deepStrictEqual(l.inkColors, {Amber: 60});
  assert.strictEqual(l.types.Character, 60);
  assert.ok(Math.abs(l.avgLorePerCharacter - 20 / 15) < 1e-9);
  assert.deepStrictEqual(l.curve.slice(0, 4), [12, 16, 16, 16]);
  assert.strictEqual(S.detectGame(gwDeck()), 'mtg');
  assert.strictEqual(S.detectGame(lorcanaDeck()), 'lorcana');
});

test('other games get type distribution only', () => {
  const d = [{qty: 40, card: {n: 'Pikachu', ty: 'Pokémon'}}, {qty: 20, card: {n: 'Lightning Energy', ty: 'Energy'}}];
  const r = S.openingHands(d, {game: 'pokemon', iterations: 5000, seed: 3});
  assert.ok(Math.abs(r.typeDist['Energy'].avg - 7 / 3) < 0.05);
  assert.deepStrictEqual(S.goldfish(d, {game: 'pokemon'}), {unsupported: true, game: 'pokemon'});
  assert.ok(Array.isArray(S.ASSUMPTIONS.mtg) && Array.isArray(S.ASSUMPTIONS.lorcana));
});

/* ---------- performance budget (loose: the target is ~1.5 s) ---------- */

test('loads in a worker-like global with no window or module', () => {
  const vm = require('node:vm'), fs = require('node:fs');
  const ctx = {self: {}}; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(require.resolve('./sim.js'), 'utf8'), ctx);
  assert.strictEqual(typeof ctx.self.InkSim.goldfish, 'function');
});

test('performance budget', () => {
  const [, tOpen] = ms(() => S.openingHands(gwDeck(), {game: 'mtg', iterations: 20000, seed: 1}));
  const [, tGold] = ms(() => S.goldfish(gwDeck(), {game: 'mtg', turns: 10, iterations: 5000, seed: 1, keyCards: ['Tarmogoyf']}));
  const [, tLOpen] = ms(() => S.openingHands(lorcanaDeck(), {game: 'lorcana', iterations: 20000, seed: 1}));
  const [, tLGold] = ms(() => S.goldfish(lorcanaDeck(), {game: 'lorcana', turns: 10, iterations: 5000, seed: 1}));
  console.log(`# timings ms: mtg open ${tOpen.toFixed(0)}, mtg goldfish ${tGold.toFixed(0)}, lorcana open ${tLOpen.toFixed(0)}, lorcana goldfish ${tLGold.toFixed(0)}`);
  for (const t of [tOpen, tGold, tLOpen, tLGold]) assert.ok(t < 4000, 'took ' + t + ' ms');
});
