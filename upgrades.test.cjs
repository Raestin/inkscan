// Planned upgrades: the per-deck list of cards to bring in and take out.
const test = require('node:test'), assert = require('node:assert/strict');
const U = require('./upgrades.js');

test('an empty or broken plan is no plan', () => {
  assert.equal(U.clean(null, {}), null);
  assert.equal(U.clean({in: {}, out: {}}, {}), null);
  assert.equal(U.clean({in: {'bolt|': 0}, out: {'squash|': -1}}, {'squash|': 2}), null);
  assert.equal(U.clean([], {}), null);
});

test('cards to take out must be in the deck, and no more than it holds', () => {
  assert.deepEqual(U.clean({in: {'bolt|': 4}, out: {'squash|': 3, 'gone|': 1}}, {'squash|': 2}), {in: {'bolt|': 4}, out: {'squash|': 2}});
});

test('a plan reads the same whatever order its cards were added in', () => {
  const a = U.clean({in: {'b|': 1, 'a|': 2}, out: {}}, {}), b = U.clean({in: {'a|': 2, 'b|': 1}}, {});
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('setting a count adds, changes and removes a planned card', () => {
  let p = U.set(null, 'in', 'bolt|', 4, {});
  assert.deepEqual(p, {in: {'bolt|': 4}, out: {}});
  p = U.set(p, 'out', 'squash|', 2, {'squash|': 2});
  p = U.set(p, 'in', 'bolt|', 2, {'squash|': 2});
  assert.deepEqual(p, {in: {'bolt|': 2}, out: {'squash|': 2}});
  p = U.set(p, 'in', 'bolt|', 0, {'squash|': 2});
  assert.deepEqual(p, {in: {}, out: {'squash|': 2}});
  assert.equal(U.set(p, 'out', 'squash|', 0, {'squash|': 2}), null);
});

test('progress counts the copies in hand, never more than planned', () => {
  const p = {in: {'bolt|': 4, 'rancor|': 2}, out: {'squash|': 2}};
  const g = U.progress(p, nv => ({'bolt|': 6, 'rancor|': 1})[nv] || 0);
  assert.deepEqual(g.rows, [{nv: 'bolt|', q: 4, have: 4}, {nv: 'rancor|', q: 2, have: 1}]);
  assert.equal(g.want, 6); assert.equal(g.have, 5); assert.equal(g.out, 2); assert.equal(g.ready, false);
  assert.equal(U.progress(p, () => 9).ready, true);
  assert.equal(U.progress(null, () => 9).ready, false);
});

test('a plan of removals only is ready straight away', () => {
  assert.equal(U.progress({in: {}, out: {'squash|': 1}}, () => 0).ready, true);
});

test('moving a card in adds it to the deck and takes it off the plan', () => {
  const r = U.move({'forest|': 20}, {in: {'bolt|': 4}, out: {}}, 'in', 'bolt|', 3);
  assert.deepEqual(r.cards, {'forest|': 20, 'bolt|': 3});
  assert.deepEqual(r.plan, {in: {'bolt|': 1}, out: {}});
  assert.equal(r.moved, 3);
});

test('moving a card out removes it from the deck and finishes the plan', () => {
  const r = U.move({'squash|': 2, 'forest|': 20}, {in: {}, out: {'squash|': 2}}, 'out', 'squash|', 2);
  assert.deepEqual(r.cards, {'forest|': 20});
  assert.equal(r.plan, null);
});

test('moving never takes more than was planned, and leaves the original deck alone', () => {
  const cards = {'squash|': 3}, plan = {in: {}, out: {'squash|': 1}};
  const r = U.move(cards, plan, 'out', 'squash|', 5);
  assert.deepEqual(r.cards, {'squash|': 2});
  assert.deepEqual(cards, {'squash|': 3});
  assert.equal(U.move(cards, plan, 'in', 'bolt|', 2).moved, 0);
});
