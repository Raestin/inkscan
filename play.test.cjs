// Run: node --test play.test.cjs
// The game tracker's rules (play.js), without a screen.
const test = require('node:test'), assert = require('node:assert/strict');
const P = require('./play.js');

test('a Magic game starts at 20, a Commander game at 40 with commander damage from each opponent', () => {
  const a = P.newGame('mtg', {});
  assert.deepEqual(a.players.map(p => p.main), [20, 20]);
  assert.equal(a.players[0].trackers.length, 0);
  const c = P.newGame('mtg', {players: 4, commander: true});
  assert.deepEqual(c.players.map(p => p.main), [40, 40, 40, 40]);
  assert.deepEqual(c.players[0].trackers.map(t => t.from), [1, 2, 3]);
});

test('quick taps join into one history line and one Undo', () => {
  const s = P.newGame('mtg', {});
  for (let i = 0; i < 7; i++) P.change(s, 1, 'main', -1, 1000 + i * 100);
  assert.equal(s.players[1].main, 13);
  assert.equal(s.log.length, 1);
  assert.deepEqual(P.historyLines(s).map(l => [l.text, l.delta]), [['Opponent: Life 20 → 13', '−7']]);
  P.change(s, 1, 'main', -2, 9000);
  assert.equal(s.log.length, 2, 'a later tap is its own line');
  P.undo(s); assert.equal(s.players[1].main, 13);
  P.undo(s); assert.equal(s.players[1].main, 20);
  assert.equal(P.undo(s), null);
});

test('taps that cancel out leave no history line', () => {
  const s = P.newGame('mtg', {});
  P.change(s, 0, 'main', 1, 1000); P.change(s, 0, 'main', -1, 1100);
  assert.equal(s.log.length, 0);
});

test('commander damage also comes off life, puts a player out at 21, and undoes both', () => {
  const s = P.newGame('mtg', {players: 3, commander: true}), t = s.players[0].trackers[0];
  for (let i = 0; i < 21; i++) P.change(s, 0, t.id, 1, 1000);
  assert.equal(t.n, 21); assert.equal(s.players[0].main, 19);
  assert.equal(P.status(s, 0).kind, 'out');
  P.undo(s);
  assert.equal(t.n, 0); assert.equal(s.players[0].main, 40); assert.equal(P.status(s, 0), null);
});

test('poison puts a Magic player out at ten; life at zero does too', () => {
  const s = P.newGame('mtg', {});
  const t = P.addTracker(s, 0, {...P.cfg('mtg').counters[0], kind: 'counter'});
  P.change(s, 0, t.id, 10, 1); assert.match(P.status(s, 0).label, /poison/);
  P.change(s, 1, 'main', -20, 1); assert.equal(P.status(s, 1).kind, 'out');
});

test('Lorcana counts lore up from 0, never below, and 20 wins', () => {
  const s = P.newGame('lorcana', {});
  assert.equal(P.change(s, 0, 'main', -1, 1), false);
  P.change(s, 0, 'main', 20, 2);
  assert.equal(P.status(s, 0).kind, 'win'); assert.equal(P.status(s, 1), null);
});

test('Pokémon counts prizes down from 6 and wins at none; damage moves in tens', () => {
  const s = P.newGame('pokemon', {});
  assert.equal(s.players[0].main, 6);
  assert.equal(P.change(s, 0, 'main', 1, 1), false, 'never more prizes than the game started with');
  const t = P.addTracker(s, 0, {name: 'Active', kind: 'token', step: 10});
  P.change(s, 0, t.id, 3, 2); assert.equal(t.n, 30);
  P.change(s, 0, 'main', -6, 9000); assert.equal(P.status(s, 0).kind, 'win');
});

test('One Piece starts with DON!! on the board, capped at ten, and flags no life left', () => {
  const s = P.newGame('onepiece', {start: 4});
  const don = s.players[0].trackers[0];
  assert.equal(don.name, 'DON!!');
  P.change(s, 0, don.id, 14, 1); assert.equal(don.n, 10);
  P.change(s, 0, 'main', -9, 2); assert.equal(s.players[0].main, 0);
  assert.equal(P.status(s, 0).label, 'No life left');
});

test('tokens: adding the same one twice keeps one; removing and Undo bring it back in place', () => {
  const s = P.newGame('mtg', {});
  const a = P.addTracker(s, 0, {name: 'Treasure', n: 1}), b = P.addTracker(s, 0, {name: 'treasure', n: 1});
  assert.equal(a, b);
  P.addTracker(s, 0, {name: 'Food', n: 1});
  P.removeTracker(s, 0, a.id);
  assert.deepEqual(s.players[0].trackers.map(t => t.name), ['Food']);
  P.undo(s);
  assert.deepEqual(s.players[0].trackers.map(t => t.name), ['Treasure', 'Food']);
});

test('the monarch moves: taking it takes it from the other player, and Undo gives it back', () => {
  const s = P.newGame('mtg', {}), m = P.cfg('mtg').flags[0];
  P.addTracker(s, 0, {...m, kind: 'flag'});
  P.addTracker(s, 1, {...m, kind: 'flag'});
  assert.equal(s.players[0].trackers.length, 0); assert.equal(s.players[1].trackers.length, 1);
  P.undo(s);
  assert.equal(s.players[0].trackers.length, 1); assert.equal(s.players[1].trackers.length, 0);
});

test('next turn goes round the table, counts rounds, skips players who are out, and can be undone', () => {
  const s = P.newGame('mtg', {players: 3});
  P.change(s, 1, 'main', -20, 1);
  P.nextTurn(s); assert.deepEqual([s.turn, s.active], [1, 2], 'player 2 is out, so it passes to player 3');
  P.nextTurn(s); assert.deepEqual([s.turn, s.active], [2, 0]);
  P.undo(s); assert.deepEqual([s.turn, s.active], [1, 2]);
});
