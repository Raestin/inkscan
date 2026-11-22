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
test('a small card in a pale stand on a dark table is found, not the table', () => {
  const w = 240, h = 320, l = new Uint8Array(w * h).fill(45);                      // dark wood everywhere
  for (let y = 100; y < 300; y++) for (let x = 40; x < 230; x++) l[y * w + x] = 225;   // the pale stand
  const card = {x: 75, y: 135, w: 66, h: 92};
  for (let y = card.y; y < card.y + card.h; y++) for (let x = card.x; x < card.x + card.w; x++){
    const b = 3, rim = x < card.x + b || x >= card.x + card.w - b || y < card.y + b || y >= card.y + card.h - b;
    l[y * w + x] = rim ? 25 : 140;
  }
  const r = S.findCard(l, w, h);
  assert.ok(r); assert.equal(r.sideways, false);
  assert.ok(near(r.x, 75 / 240) && near(r.y, 135 / 320) && near(r.w, 66 / 240) && near(r.h, 92 / 320));
});
test('a picture that is dark all over has no card', () => {
  assert.equal(S.findCard(new Uint8Array(160 * 213).fill(40), 160, 213), null);
});
test('zoomFor: fills the picture, limited by the farthest edge, the camera range and small changes', () => {
  assert.equal(S.zoomFor({x: 0.36, y: 0.4, w: 0.28, h: 0.2}, 1, 1, 8), 3.1);       // centred small card: 0.44 / 0.14
  assert.equal(S.zoomFor({x: 0.15, y: 0.4, w: 0.28, h: 0.2}, 1, 1, 8), 1.3);       // off to one side: little room
  assert.equal(S.zoomFor({x: 0.36, y: 0.4, w: 0.28, h: 0.2}, 1, 1, 2), 2);         // camera stops at 2x
  assert.equal(S.zoomFor({x: 0.07, y: 0.1, w: 0.86, h: 0.8}, 3, 1, 8), 3);         // already fills it
});
test('a card-shaped corner of dark table is not a card', () => {
  const w = 240, h = 320, l = new Uint8Array(w * h).fill(225);
  for (let y = 0; y < 105; y++) for (let x = 165; x < 240; x++) l[y * w + x] = 45;
  assert.equal(S.findCard(l, w, h), null);
});
test('change looks only at the card when told where it is', () => {
  const w = 240, h = 320, rect = {x: 0.3, y: 0.4, w: 0.28, h: 0.29};
  // Two different cards in the same place: each is dark where the other is light.
  const scene = flip => { const l = new Uint8Array(w * h).fill(200); for (let y = 128; y < 221; y++) for (let x = 72; x < 139; x++) l[y * w + x] = (y < 175) === flip ? 50 : 170; return l; };
  const one = scene(true), other = scene(false);
  assert.ok(S.change(one, other) < 18, 'a small card barely moves the whole-picture average');
  assert.ok(S.change(one, other, w, rect) > 60, 'but its own place changes a lot');
  assert.equal(S.change(one, one, w, rect), 0);
  assert.equal(S.change(one, new Uint8Array(10)), 255);
});
test('a card-shaped shadow, dark all through, is not a card', () => {
  const w = 240, h = 320, l = new Uint8Array(w * h).fill(225);
  for (let y = 100; y < 226; y++) for (let x = 80; x < 170; x++) l[y * w + x] = 50;
  assert.equal(S.findCard(l, w, h), null);
});
test('the camera brightening the whole picture is not a change', () => {
  const card = frame(160, 213, {x: 6, y: 50, w: 113, h: 158}), brighter = card.map(v => Math.min(255, v + 20));
  assert.ok(S.change(card, brighter, 160, {x: 0.04, y: 0.23, w: 0.7, h: 0.74}) < 2);
});
