const test = require('node:test'), assert = require('node:assert');
const S = require('./stand.js');

// A pale frame with a black-bordered card drawn on it; the card's face is mid-grey with a pale text box.
function frame(w, h, card, extra){
  const l = new Uint8Array(w * h).fill(215);
  if (card){
    const b = Math.max(1, Math.round(Math.min(card.w, card.h) * 0.045));
    for (let y = card.y; y < card.y + card.h; y++) for (let x = card.x; x < card.x + card.w; x++){
      const edge = x < card.x + b || x >= card.x + card.w - b || y < card.y + b || y >= card.y + card.h - b;
      l[y * w + x] = edge ? 20 : (y > card.y + card.h * 0.6 ? 230 : 120);
    }
  }
  extra?.(l);
  return l;
}
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

test('finds an upright card', () => {
  const r = S.findCard(frame(160, 213, {x: 6, y: 50, w: 113, h: 158}), 160, 213);
  assert.ok(r); assert.equal(r.sideways, false);
  assert.ok(near(r.x, 6 / 160) && near(r.y, 50 / 213) && near(r.w, 113 / 160) && near(r.h, 158 / 213));
});
test('finds a card lying sideways', () => {
  const r = S.findCard(frame(213, 160, {x: 45, y: 30, w: 158, h: 113}), 213, 160);
  assert.ok(r); assert.equal(r.sideways, true);
  assert.ok(near(r.w, 158 / 213) && near(r.h, 113 / 160));
});
test('an empty stand has no card', () => {
  assert.equal(S.findCard(frame(160, 213, null), 160, 213), null);
});
test('a dark shape that is not card-shaped is turned down', () => {
  assert.equal(S.findCard(frame(160, 213, {x: 10, y: 60, w: 140, h: 60}), 160, 213), null);
});
test('a shadow in the corner does not move the card', () => {
  const r = S.findCard(frame(160, 213, {x: 6, y: 50, w: 113, h: 158}, l => { for (let y = 0; y < 14; y++) for (let x = 130; x < 160; x++) l[y * 160 + x] = 40; }), 160, 213);
  assert.ok(r); assert.ok(near(r.y, 50 / 213) && near(r.w, 113 / 160));
});
test('turns: the remembered one first, and only the two that fit how the card lies', () => {
  assert.deepEqual(S.turns(false, 0), [0, 180]);
  assert.deepEqual(S.turns(false, 180), [180, 0]);
  assert.deepEqual(S.turns(true, 270), [270, 90]);
  assert.deepEqual(S.turns(true, 0), [90, 270]);
});
test('card names come out of what the reader returns', () => {
  assert.equal(S.cleanTitle('{ Woja, Jaws of the Conclave 28k'), 'Woja, Jaws of the Conclave');
  assert.equal(S.cleanTitle('SS ____—— —\nKlauth, Unrivaled Ancient = 5 \\&@®'), 'Klauth, Unrivaled Ancient');
  assert.equal(S.cleanTitle('[Champions of the Perfect 3 ®)]'), 'Champions of the Perfect');
  assert.equal(S.cleanTitle('| Devoted Druid 8 |'), 'Devoted Druid');
  assert.equal(S.cleanTitle('ne i oi fit ——e\n( Copper Carapace a1 )'), 'Copper Carapace');
  assert.equal(S.cleanTitle("Urza's Saga"), "Urza's Saga");
  assert.equal(S.cleanTitle('( Copper Carapace ic'), 'Copper Carapace');
  assert.equal(S.cleanTitle('Pos CT ba ai a EE ed le ——\n(i Copper Carapace Bi'), 'Copper Carapace');
  assert.equal(S.cleanTitle('| Fall of the Thran 5 @'), 'Fall of the Thran');
});
test('too little text is no name', () => {
  assert.equal(S.cleanTitle(''), '');
  assert.equal(S.cleanTitle('| = 3 @\n. ,'), '');
  assert.equal(S.cleanTitle('a b'), '');
});
test('change: the same frame is 0, a card taken out is large', () => {
  const card = frame(160, 213, {x: 6, y: 50, w: 113, h: 158}), empty = frame(160, 213, null);
  assert.equal(S.change(card, card), 0);
  assert.ok(S.change(card, empty) > 18);
});
