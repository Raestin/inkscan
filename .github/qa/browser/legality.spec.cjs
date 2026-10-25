'use strict';
// Finite Core Constructed card-pool checks, not tournament/deck certification.
// All ownership is synthetic localhost state; no camera, authentication, or live database.
const {test, expect} = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const KEY = 'inkscan.state.v6';
const SNAPSHOT_TIME = '2026-10-25T12:00:00Z';
const errorsByPage = new WeakMap(), blockedByContext = new WeakMap(), initialByPage = new WeakMap();
const normalize = value => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const nv = card => normalize(card.n) + '|' + normalize(card.v);

function fixture() {
  const sets = ['1', '8', '9', '10', '11', '12', '13', '14', '15', 'PD1'].map(code => ({
    code, name: code === 'PD1' ? 'PD1' : `Synthetic set ${code}`, rel: code === '15' ? '2027-01-01' : '2026-01-01'
  }));
  const card = (id, s, c, n, v, lc) => ({id, n, v, s, sn: sets.find(x => x.code === s).name, c,
    r: 'Rare', i: 'Amber', t: null, p: null, pf: null, co: 1, ik: 1, ty: 'Character', cl: 'Synthetic',
    st: 1, wp: 2, lo: 1, mv: null, tx: 'Synthetic legality fixture only.', fl: '', il: 'QA fixture', iv: null, lc});
  const cards = [
    card('synthetic-legal-old-reprint', '1', '1', 'Synthetic Reprint Hero', 'Steady Friend', 0),
    card('synthetic-legal-current-reprint', '9', '1', 'Synthetic Reprint Hero', 'Steady Friend', 1),
    card('synthetic-legal-wrong-version', '1', '2', 'Synthetic Reprint Hero', 'Different Adventure', 1),
    card('synthetic-legal-rotated', '8', '3', 'Synthetic Retired Hero', 'Classic', 1),
    card('synthetic-legal-hyperia', '14', '95', 'Above the Crowd', '', 0),
    card('synthetic-legal-future', '15', '1', 'Synthetic Future Hero', 'Unverified', 1)
  ];
  for (let i = 0; i < 12; i++) cards.push(card(`synthetic-legal-filler-${i}`, '9', String(101 + i), `Synthetic Legal Filler ${i}`, 'Core', 0));
  const source = cards.find(c => c.id === 'synthetic-legal-hyperia');
  const supplement = {schemaVersion: 1, game: 'lorcana', verifiedAt: '2026-10-25', records: [{
    id: 'tcgplayer_722993', provider: 'TCGplayer', productId: 722993,
    printing: {n: source.n, v: source.v, s: 'PD1', sn: 'PD1', c: '11', r: 'Promo', language: 'EN', printedSet: '14', stamp: 'Hyperia City'},
    gameplaySource: {id: source.id, expectedIdentity: {n: source.n, v: source.v, s: source.s, c: source.c, r: source.r}},
    evidence: [{url: 'https://example.test/synthetic-legality-printing', supports: ['printing', 'product', 'gameplay', 'finish']}],
    rawSubtype: 'Holofoil'
  }]};
  const inv = Object.fromEntries(cards.filter(c => c.id !== 'synthetic-legal-current-reprint').map(c => [c.id, {q: 1, f: 0}]));
  inv['synthetic-legal-old-reprint'] = {q: 1, f: 1, rf: 1};
  inv.tcgplayer_722993 = {q: 1, f: 0};
  const deckCards = Object.fromEntries(cards.filter(c => c.id.startsWith('synthetic-legal-filler-') || ['synthetic-legal-wrong-version', 'synthetic-legal-rotated', 'synthetic-legal-future'].includes(c.id)).map(c => [nv(c), 4]));
  const decks = [{id: 'synthetic-legality-deck', name: 'Synthetic 60-card mixed-status deck', cards: deckCards, updated: 1792886400000}];
  return {catalog: {asof: '2026-10-24', sets, cards}, supplement, inv, decks};
}
async function rawState(page) { return page.evaluate(key => localStorage.getItem(key), KEY); }
async function waitForApp(page) {
  await expect(page.locator('#loadBanner')).toBeHidden();
  await expect(page.locator('#manualUpdate')).toBeVisible();
}
async function tab(page, name) {
  await page.locator(`[data-tab="${name}"]`).click();
  await expect(page.locator(`[data-tab="${name}"]`)).toHaveAttribute('aria-current', 'page');
}
async function ids(page, selector) { return page.locator(selector).evaluateAll(nodes => nodes.map(node => node.dataset.card).sort()); }
async function exactIds(page, selector, expected) {
  await expect(page.locator(selector)).toHaveCount(expected.length);
  expect(await ids(page, selector)).toEqual([...expected].sort());
}
async function shot(page, info, name) {
  const file = info.outputPath(name + '.png');
  await page.screenshot({path: file, animations: 'disabled'});
  await info.attach(name, {path: file, contentType: 'image/png'});
}
async function noExternalMutation(page) {
  const audit = await page.evaluate(() => window.__legalityAudit || []);
  expect(audit.filter(item => item.error)).toEqual([]);
  expect(audit.filter(item => /^\/(?:auth|rest)\/v1(?:\/|$)/.test(item.pathname))).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('inkscan.session'))).toBeNull();
  expect(await page.evaluate(() => window.__legalityCameraCalls)).toBe(0);
}
async function closeSheet(page) {
  await page.locator('#sheetClose').click();
  await expect(page.locator('#sheet')).toBeHidden();
  await expect.poll(() => page.evaluate(() => history.state?.sheet || 0)).toBe(0);
}
const fillerIds = Array.from({length: 12}, (_, i) => `synthetic-legal-filler-${i}`);
const legalOwnedIds = ['synthetic-legal-old-reprint', 'synthetic-legal-hyperia', 'tcgplayer_722993', ...fillerIds];
const legalBrowseIds = [...legalOwnedIds, 'synthetic-legal-current-reprint'];
const notLegalIds = ['synthetic-legal-wrong-version', 'synthetic-legal-rotated'];
const unknownIds = ['synthetic-legal-future'];

// setFixedTime changes Date only, leaving debounce, UI, and OCR-loader timers running.
test.beforeEach(async ({page, context}) => {
  await page.clock.setFixedTime(new Date(SNAPSHOT_TIME));
  const errors = [], blocked = [];
  errorsByPage.set(page, errors); blockedByContext.set(context, blocked);
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(() => {
    window.__legalityAudit = []; window.__legalityCameraCalls = 0;
    const original = window.fetch;
    window.fetch = function (...args) {
      try {
        const input = args[0], url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
        window.__legalityAudit.push({method: String(args[1]?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase(), origin: url.origin, pathname: url.pathname});
      } catch { window.__legalityAudit.push({error: 'Uninspectable fetch'}); }
      return Reflect.apply(original, this, args);
    };
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { window.__legalityCameraCalls++; throw Error('Camera forbidden in synthetic legality tests'); };
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4173') return route.continue();
    blocked.push({method: route.request().method(), origin: url.origin, pathname: url.pathname});
    return route.abort('blockedbyclient');
  });
  const data = fixture(), rules = await fs.readFile(path.join(__dirname, '../../../core-rules.json'), 'utf8');
  await context.route('**/cards.json', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data.catalog)}));
  await context.route('**/promo-catalog.json', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data.supplement)}));
  await context.route('**/core-rules.json', route => route.fulfill({status: 200, contentType: 'application/json', body: rules}));
  await context.route('**/finish-quotes.json', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({schemaVersion: 1, provider: 'TCGplayer via TCGCSV', currency: 'USD', quotes: {}, promoFoilQuotes: {}})}));
  await page.goto('/qa-seed.html');
  await page.evaluate(({inv, decks}) => {
    const state = InkSafety.load(localStorage); state.inv = inv; state.decks = decks;
    InkSafety.save(localStorage, state);
  }, {inv: data.inv, decks: data.decks});
  initialByPage.set(page, await rawState(page));
  await page.goto('/index.html'); await waitForApp(page);
  await expect(page.locator('#tCopies')).toHaveText('20');
});

test.afterEach(async ({page, context}, info) => {
  if (!page.isClosed()) {
    await shot(page, info, 'legality-final-screen');
    await noExternalMutation(page);
    expect(await rawState(page), 'Read-only legality filters never rewrite inventory/decks').toBe(initialByPage.get(page));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await info.attach('legality-fetch-audit.json', {body: JSON.stringify(await page.evaluate(() => window.__legalityAudit || []), null, 2), contentType: 'application/json'});
  }
  const blocked = blockedByContext.get(context) || [];
  expect(blocked.filter(item => /^\/(?:auth|rest)\/v1(?:\/|$)/.test(item.pathname))).toEqual([]);
  await info.attach('legality-external-blocks.json', {body: JSON.stringify(blocked, null, 2), contentType: 'application/json'});
  expect(errorsByPage.get(page) || []).toEqual([]);
});

test('Collection defaults to All and current-card-pool filter includes exact old reprints and excludes wrong versions', async ({page}, info) => {
  await tab(page, 'coll');
  await expect(page.locator('#cLegality')).toHaveValue('all');
  await exactIds(page, '#coll [data-card]', [...legalOwnedIds, ...notLegalIds, ...unknownIds]);
  await page.locator('#cLegality').selectOption('legal');
  await exactIds(page, '#coll [data-card]', legalOwnedIds);
  await expect(page.locator('#cLegalityInfo')).toContainText(/Core Constructed.*Standard|Standard.*Core Constructed/i);
  await expect(page.locator('#cLegalityInfo')).toContainText('2026-10-25');
  await page.locator('#cf').fill('Synthetic Reprint Hero');
  await exactIds(page, '#coll [data-card]', ['synthetic-legal-old-reprint']);
  await page.locator('#cLegality').selectOption('not_legal');
  await exactIds(page, '#coll [data-card]', ['synthetic-legal-wrong-version']);
  await page.locator('#cReset').click();
  await expect(page.locator('#cLegality')).toHaveValue('all');
  await exactIds(page, '#coll [data-card]', [...legalOwnedIds, ...notLegalIds, ...unknownIds]);
  await page.locator('#cLegality').selectOption('legal');
  await page.locator('#cFinish').selectOption('rainbow');
  await exactIds(page, '#coll [data-card]', ['synthetic-legal-old-reprint']);
  await page.locator('#cLegality').scrollIntoViewIfNeeded();
  await shot(page, info, 'core-filter-old-printing-reprint-legal');
});

test('Browse classifies Hyperia and verified PD1 by current identity despite stale source lc flags', async ({page}, info) => {
  await tab(page, 'browse');
  await expect(page.locator('#bLegality')).toHaveValue('all');
  await exactIds(page, '#bGrid [data-card]', [...legalBrowseIds, ...notLegalIds, ...unknownIds]);
  await page.locator('#bLegality').selectOption('legal');
  await exactIds(page, '#bGrid [data-card]', legalBrowseIds);
  await expect(page.locator('#bGrid [data-card="synthetic-legal-hyperia"]')).toBeVisible();
  await expect(page.locator('#bGrid [data-card="tcgplayer_722993"]')).toBeVisible();
  await page.locator('#bGrid [data-card="tcgplayer_722993"]').click();
  await expect(page.locator('#sheetBody')).not.toContainText('Infinity only');
  await expect(page.locator('#sheetBody [data-legality-status]')).toHaveAttribute('data-legality-status', 'legal');
  await expect(page.locator('#sheetBody')).toContainText(/Core Constructed|Standard/);
  await closeSheet(page);
  await page.locator('#bLegality').selectOption('not_legal');
  await exactIds(page, '#bGrid [data-card]', notLegalIds);
  await page.locator('#bLegality').selectOption('unknown');
  await exactIds(page, '#bGrid [data-card]', unknownIds);
  await page.locator('#bReset').click();
  await expect(page.locator('#bLegality')).toHaveValue('all');
  await exactIds(page, '#bGrid [data-card]', [...legalBrowseIds, ...notLegalIds, ...unknownIds]);
  await page.locator('#bLegality').scrollIntoViewIfNeeded();
  await shot(page, info, 'core-filter-all-restored-including-future-unknown');
});

test('future sets stay Unknown rather than inheriting a current-set or stale lc=true claim', async ({page}, info) => {
  await tab(page, 'coll');
  await page.locator('#cLegality').selectOption('unknown');
  await exactIds(page, '#coll [data-card]', unknownIds);
  await page.locator('#coll [data-card="synthetic-legal-future"]').click();
  await expect(page.locator('#sheetBody [data-legality-status]')).toHaveAttribute('data-legality-status', 'unknown');
  await expect(page.locator('#sheetBody')).toContainText(/Unknown/i);
  await expect(page.locator('#sheetBody')).not.toContainText('Infinity only');
  await shot(page, info, 'future-set-cardpool-unknown-not-invented');
  await closeSheet(page);
  await page.locator('#cLegality').selectOption('legal');
  await expect(page.locator('#coll [data-card="synthetic-legal-future"]')).toHaveCount(0);
});

test('quoted Coconut identity stays distinct from the legal Winterspell printing despite a legacy deck-key collision', async ({page, context}, info) => {
  const data = fixture(), template = data.catalog.cards[0];
  const base = {...template, id: 'synthetic-legal-peacekeeper', n: 'Pocahontas', v: 'Peacekeeper', s: '11', sn: 'Synthetic Winterspell', c: '22', r: 'Legendary', lc: 1};
  const coconut = {...template, id: 'synthetic-legal-coconut', n: 'Pocahontas', v: '"Peacekeeper"', s: 'Coconut', sn: 'Format Coconut', c: '2', r: 'Promo', lc: 1};
  expect(nv(base), 'The existing deck key would collapse these distinct identities').toBe(nv(coconut));
  data.catalog.sets.push({code: 'Coconut', name: 'Format Coconut', rel: '2026-01-01'});
  data.catalog.cards.push(base, coconut);
  await context.route('**/cards.json', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data.catalog)}));
  await noExternalMutation(page);
  // Extend only this test's disposable seed before reopening the app; never a live collection.
  await page.goto('/qa-seed.html');
  await page.evaluate(() => {
    const state = InkSafety.load(localStorage);
    state.inv['synthetic-legal-peacekeeper'] = {q: 1, f: 0};
    state.inv['synthetic-legal-coconut'] = {q: 1, f: 0};
    InkSafety.save(localStorage, state);
  });
  initialByPage.set(page, await rawState(page));
  await page.goto('/index.html'); await waitForApp(page);
  await tab(page, 'coll');
  await page.locator('#cf').fill('Pocahontas');
  await exactIds(page, '#coll [data-card]', [base.id, coconut.id]);
  await page.locator('#cLegality').selectOption('legal');
  await exactIds(page, '#coll [data-card]', [base.id]);
  await page.locator('#cLegality').selectOption('not_legal');
  await exactIds(page, '#coll [data-card]', [coconut.id]);
  await page.locator(`#coll [data-card="${coconut.id}"]`).click();
  await expect(page.locator('#sheetBody [data-legality-status]')).toHaveAttribute('data-legality-status', 'not_legal');
  await closeSheet(page);
  await tab(page, 'browse');
  await page.locator('#bq').fill('Pocahontas');
  await page.locator('#bLegality').selectOption('legal');
  await exactIds(page, '#bGrid [data-card]', [base.id]);
  await page.locator('#bLegality').selectOption('not_legal');
  await exactIds(page, '#bGrid [data-card]', [coconut.id]);
  const state = JSON.parse(await rawState(page));
  expect(state.inv[base.id]).toEqual({q: 1, f: 0});
  expect(state.inv[coconut.id]).toEqual({q: 1, f: 0});
  expect(state.decks).toEqual(data.decks);
  await page.locator('#bLegality').scrollIntoViewIfNeeded();
  await shot(page, info, 'coconut-exact-printing-not-relabelled-as-standard');
});

test('60 cards and one ink never produce a false complete-deck legality badge', async ({page}, info) => {
  await tab(page, 'decks');
  await expect(page.locator('#deckList')).toContainText('60/60 cards');
  await expect(page.locator('#deckList .chip')).toHaveText('Size / ink check only');
  await page.locator('[data-deck="synthetic-legality-deck"]').click();
  const badges = await page.locator('#deckStats .chip').allTextContents();
  expect(badges.some(text => /^(?:Ready|Legal deck)$/i.test(text.trim()))).toBe(false);
  await expect(page.locator('#deckStats')).toContainText(/size|structure|card.pool|minimum/i);
  await expect(page.locator('#deckLegalityCaveat')).toBeVisible();
  await expect(page.locator('#deckLegalityCaveat')).toContainText('not full deck legality');
  await expect(page.locator('#deckLegalityCaveat')).toContainText('do not validate a whole deck');
  await expect(page.locator('#dLegality')).toHaveCount(0);
  await page.locator('[data-dsub="add"]').click();
  await expect(page.locator('#dLegality')).toHaveCount(0);
  await expect(page.locator('#dRes [data-card]')).toHaveCount(17);
  await page.locator('#deckStats').scrollIntoViewIfNeeded();
  await shot(page, info, 'structural-deck-badge-not-complete-legality');
});

test('missing card-pool rules fail to Unknown without hiding or rewriting collection data', async ({page, context}, info) => {
  await context.route('**/core-rules.json', route => route.fulfill({status: 404, contentType: 'application/json', body: '{}'}));
  await noExternalMutation(page); await page.reload(); await waitForApp(page);
  await tab(page, 'coll');
  await page.locator('#cLegality').selectOption('legal');
  await expect(page.locator('#coll [data-card]')).toHaveCount(0);
  await page.locator('#cLegality').selectOption('unknown');
  await exactIds(page, '#coll [data-card]', [...legalOwnedIds, ...notLegalIds, ...unknownIds]);
  await expect(page.locator('#cLegalityInfo')).toContainText(/unavailable|missing|unknown/i);
  await page.locator('#cReset').click();
  await exactIds(page, '#coll [data-card]', [...legalOwnedIds, ...notLegalIds, ...unknownIds]);
  await page.locator('#cLegalityInfo').scrollIntoViewIfNeeded();
  await shot(page, info, 'missing-core-rules-safe-unknown');
});

test('expired finite rules turn every card Unknown and never expand eligibility to future sets', async ({page}, info) => {
  await tab(page, 'browse');
  await page.locator('#bLegality').selectOption('legal');
  await exactIds(page, '#bGrid [data-card]', legalBrowseIds);
  await page.clock.setFixedTime(new Date('2026-12-01T12:00:00Z'));
  // Eligibility must expire in an already-open tab, not only on the next boot.
  await page.locator('#bLegality').selectOption('all');
  await page.locator('#bLegality').selectOption('legal');
  await expect(page.locator('#bGrid [data-card]')).toHaveCount(0);
  await page.locator('#bLegality').selectOption('unknown');
  await exactIds(page, '#bGrid [data-card]', [...legalBrowseIds, ...notLegalIds, ...unknownIds]);
  await expect(page.locator('#bLegalityInfo')).toContainText(/expired|review|unknown/i);
  await page.locator('#bLegalityInfo').scrollIntoViewIfNeeded();
  await shot(page, info, 'expired-core-rules-all-unknown');
});
