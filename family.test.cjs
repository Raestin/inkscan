// node --test family.test.cjs
const test = require('node:test'), assert = require('node:assert');
const F = require('./family.js');
const O = 'owner', A = 'a', B = 'b';

test('the family owner has whatever nobody else holds', () => {
  const h = F.index([{c: 'x', p: A, q: 1, f: 0, r: 0}, {c: 'x', p: B, q: 0, f: 1, r: 0}]);
  assert.deepStrictEqual(F.split({q: 3, f: 1, rf: 0}, h.x, O), {[A]: {q: 1, f: 0, rf: 0}, [B]: {q: 0, f: 1, rf: 0}, [O]: {q: 2, f: 0, rf: 0}});
  assert.deepStrictEqual(F.split({q: 2, f: 0, rf: 0}, undefined, O), {[O]: {q: 2, f: 0, rf: 0}});
});
test('nobody can hold more copies than exist', () => {
  const h = F.index([{c: 'x', p: A, q: 5, f: 0, r: 0}, {c: 'x', p: B, q: 2, f: 0, r: 0}]);
  assert.deepStrictEqual(F.split({q: 3, f: 0, rf: 0}, h.x, O), {[A]: {q: 3, f: 0, rf: 0}});
});
test('unsent changes apply on top and never go below zero', () => {
  const h = F.applyDeltas(F.index([{c: 'x', p: A, q: 1, f: 0, r: 0}]), [{c: 'x', p: A, q: -2}, {c: 'y', p: B, r: 1}, {c: 'y', p: O, q: 4}], O);
  assert.deepStrictEqual(h, {x: {}, y: {[B]: {q: 0, f: 0, rf: 1}}});
});
test('a removed copy comes off the person acting, then the family owner, then whoever has most', () => {
  assert.strictEqual(F.removalFrom({[A]: {q: 1}, [O]: {q: 1}}, 'q', A, O), A);
  assert.strictEqual(F.removalFrom({[B]: {q: 1}, [O]: {q: 1}}, 'q', A, O), O);
  assert.strictEqual(F.removalFrom({[B]: {q: 2}, c: {q: 3}}, 'q', A, O), 'c');
});
test('a deck move takes the giver\'s copies, normal finish first, across printings', () => {
  const shares = {p1: {[O]: {q: 1, f: 1, rf: 0}, [A]: {q: 2, f: 0, rf: 0}}, p2: {[O]: {q: 1, f: 0, rf: 0}}};
  const items = F.deckItems({'card|': 4, 'gone|': 2}, O, B, nv => nv === 'card|' ? ['p1', 'p2'] : [], id => shares[id] || {});
  assert.deepStrictEqual(items, [{c: 'p1', from: O, to: B, q: 1, f: 1, r: 0}, {c: 'p2', from: O, to: B, q: 1, f: 0, r: 0}]);
});
test('people: family owner first, names fall back to the email', () => {
  const p = F.people([{id: A, email: 'landen@x.com'}, {id: O, email: 'b@x.com', name: 'Brian Chapman'}], O);
  assert.deepStrictEqual(p.map(x => [x.id, x.name, x.slot, x.initials, x.owner]), [[O, 'Brian Chapman', 0, 'BC', true], [A, 'Landen', 1, 'L', false]]);
});
