'use strict';
// Same-origin placeholder QA. No public artwork downloads, camera or cloud access.
// Only HTTP/decode/valid-image cases replace the single IMG URL constant in the
// served, sanitized test script. The image payload is an explicitly synthetic SVG,
// not a real card or the placeholder; renderer/error-handler code stays unchanged.
// Service workers are blocked by shared configuration: this is not offline QA.
const {test, expect} = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const ORIGIN = 'http://127.0.0.1:4173';
const KEY = 'inkscan.state.v6';
const PROMO = 'tcgplayer_722993';
const MISSING = 'crd_synthetic_placeholder_missing';
const ART = 'crd_synthetic_placeholder_art';
const states = new WeakMap();
let catalog, supplement;
const syntheticArt = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="168" viewBox="0 0 120 168"><rect width="120" height="168" fill="#165c7a"/><circle cx="60" cy="70" r="30" fill="#edc976"/><text x="60" y="128" text-anchor="middle" font-size="12" fill="white">QA ONLY</text></svg>';

test.beforeAll(async () => {
  catalog = JSON.parse(await fs.readFile(path.join(__dirname, '../../../cards.json'), 'utf8'));
  supplement = JSON.parse(await fs.readFile(path.join(__dirname, '../../../promo-catalog.json'), 'utf8'));
  // Public catalog identities remain exact; absent-image metadata deliberately
  // avoids attempting unrelated public image URLs in these synthetic UI checks.
  catalog.cards = catalog.cards.map(card => ({...card, iv: null}));
  const make = (id, c, n, iv) => ({id, n, v: 'Synthetic placeholder QA', s: '12', sn: 'Wilds Unknown', c, r: 'Common', i: 'Amber', t: null, p: null, pf: null, co: 1, ik: 1, ty: 'Character', cl: 'Synthetic', st: 1, wp: 2, lo: 1, mv: null, tx: 'Synthetic image-boundary test, not a real card.', fl: '', il: 'QA', iv, lc: 0});
  catalog.cards.push(make(MISSING, '901', 'Synthetic Missing Art', null), make(ART, '902', 'Synthetic Valid Art', 'qa'));
});

test.beforeEach(async ({page, context}) => {
  await page.clock.setFixedTime(new Date('2026-10-25T12:00:00Z'));
  const state = {adapter: false, failure: null, placeholderFailure: false, imageRequests: [], external: [], errors: [], placeholderRequests: 0};
  states.set(context, state);
  page.on('pageerror', error => state.errors.push(error.message));
  await context.addInitScript(() => {
    window.__placeholderFetchAudit = []; window.__placeholderCameraCalls = 0;
    const original = window.fetch;
    window.fetch = function (...args) {
      const input = args[0], url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      window.__placeholderFetchAudit.push({origin: url.origin, path: url.pathname});
      return Reflect.apply(original, this, args);
    };
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { window.__placeholderCameraCalls++; throw Error('No camera permitted in placeholder QA'); };
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== ORIGIN) { state.external.push(url.href); return route.abort('blockedbyclient'); }
    if (url.pathname === '/no-image.svg') {
      state.placeholderRequests++;
      if (state.placeholderFailure) return route.fulfill({status: 404, contentType: 'text/plain', body: 'Synthetic missing placeholder asset'});
    }
    if (url.pathname.startsWith('/qa-card-art/')) {
      state.imageRequests.push(url.pathname);
      expect(state.adapter).toBe(true);
      expect(request.resourceType()).toBe('image');
      if (state.failure === 'http') return route.fulfill({status: 404, contentType: 'text/plain', body: 'Synthetic missing card image'});
      if (state.failure === 'decode') return route.fulfill({status: 200, contentType: 'image/svg+xml', body: 'Synthetic invalid image bytes'});
      return route.fulfill({status: 200, contentType: 'image/svg+xml', body: syntheticArt});
    }
    if (url.pathname === '/app.js' && state.adapter) {
      const response = await route.fetch(); let body = await response.text();
      const exact = "const IMG = 'https://cards.lorcast.io/card/digital/';";
      expect(body.split(exact)).toHaveLength(2);
      body = body.replace(exact, `const IMG = '${ORIGIN}/qa-card-art/';`);
      return route.fulfill({response, body});
    }
    return route.continue();
  });
  await context.route('**/cards.json', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(catalog)}));
  await context.route('**/promo-catalog.json', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(supplement)}));
});

async function boot(page, context, options = {}) {
  Object.assign(states.get(context), options);
  await page.goto('/qa-seed.html');
  await page.evaluate(() => InkSafety.save(localStorage, InkSafety.load(localStorage)));
  await page.goto('/index.html');
  await expect(page.locator('#loadBanner')).toBeHidden();
  await expect(page.locator('#manualUpdate')).toBeVisible();
  await expect(page.locator('#tCopies')).toHaveText('0');
}
async function shot(page, info, name) {
  const file = info.outputPath(name + '.png');
  await page.screenshot({path: file, animations: 'disabled'});
  await info.attach(name, {path: file, contentType: 'image/png'});
}
async function owned(page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key)).inv, KEY); }
async function search(page, reference, id) {
  await page.locator('#q').fill(reference);
  await expect(page.locator('#qres button[data-act="add"]')).toHaveCount(1);
  const row = page.locator(`#qres [data-card="${id}"]`);
  await expect(row).toBeVisible(); return row;
}
async function placeholder(node, name) {
  await expect(node).toBeVisible();
  await expect(node).toHaveAttribute('role', 'img');
  await expect(node).toHaveAttribute('aria-label', new RegExp(`No image available.*${name}`));
  expect(await node.evaluate(el => getComputedStyle(el).backgroundImage)).toContain('/no-image.svg');
}
async function decodePlaceholder(page) {
  expect(await page.evaluate(async () => {const image = new Image(); image.src = 'no-image.svg'; await image.decode(); return {width: image.naturalWidth, height: image.naturalHeight, source: new URL(image.currentSrc).origin};})).toEqual({width: 734, height: 1024, source: ORIGIN});
}
async function closeSheet(page) {
  await page.locator('#sheetClose').click(); await expect(page.locator('#sheet')).toBeHidden();
  await expect.poll(() => page.evaluate(() => history.state?.sheet || 0)).toBe(0);
}

test.afterEach(async ({page, context}, info) => {
  const state = states.get(context);
  if (!page.isClosed() && page.url().startsWith(ORIGIN + '/index.html')) {
    await shot(page, info, 'placeholder-final-screen');
    const audit = await page.evaluate(() => window.__placeholderFetchAudit || []);
    expect(audit.filter(x => x.origin !== ORIGIN || /^\/(auth|rest)\/v1(?:\/|$)/.test(x.path))).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('inkscan.session'))).toBeNull();
    expect(await page.evaluate(() => window.__placeholderCameraCalls)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await info.attach('placeholder-fetch-audit.json', {body: JSON.stringify(audit, null, 2), contentType: 'application/json'});
  }
  if (state) {
    expect(state.errors).toEqual([]); expect(state.external).toEqual([]);
    await info.attach('placeholder-image-boundary.json', {body: JSON.stringify(state, null, 2), contentType: 'application/json'});
  }
});

test('six exact missing promos show the original local placeholder in search and detail without adding cards', async ({page, context}, info) => {
  await boot(page, context); await decodePlaceholder(page);
  for (const entry of supplement.records) {
    const row = await search(page, `${entry.printing.s} ${entry.printing.c}`, entry.id);
    await placeholder(row.locator('.art-placeholder'), entry.printing.n);
    await expect(row.locator('[data-card-art]')).toHaveCount(0);
  }
  const row = await search(page, 'PD1 11', PROMO); await shot(page, info, 'missing-promo-search-thumbnail');
  await row.click();
  await placeholder(page.locator('#sheetBody .big .art-placeholder'), 'Above the Crowd');
  await expect(page.locator('#sheetBody .big')).toContainText('No image available');
  await expect(page.locator('#sheetBody .big')).toContainText('PD1 #11');
  await expect(page.locator('#sheetBody .big [data-card-art]')).toHaveCount(0);
  await shot(page, info, 'missing-promo-detail-original-placeholder');
  await closeSheet(page); expect(await owned(page)).toEqual({});
});

test('synthetic ownership retains exact promo identity across log collection grid list and Browse placeholders', async ({page, context}, info) => {
  await boot(page, context); await search(page, 'PD1 11', PROMO);
  await page.locator('#scanFinish').selectOption('foil');
  await page.locator(`#qres button[data-id="${PROMO}"]`).click();
  expect(await owned(page)).toEqual({[PROMO]: {q: 0, f: 1}});
  await placeholder(page.locator(`#log [data-card="${PROMO}"] .art-placeholder`), 'Above the Crowd');
  await shot(page, info, 'placeholder-synthetic-scan-log');
  await page.locator('[data-tab="coll"]').click();
  await placeholder(page.locator(`#coll [data-card="${PROMO}"] .art-placeholder`), 'Above the Crowd');
  await expect(page.locator('#coll')).toContainText('No image available');
  await shot(page, info, 'placeholder-synthetic-collection-grid');
  await page.locator('[data-lay="list"]').click();
  await placeholder(page.locator(`#coll [data-card="${PROMO}"] .art-placeholder`), 'Above the Crowd');
  await shot(page, info, 'placeholder-synthetic-collection-list');
  await page.locator('[data-tab="browse"]').click(); await page.locator('#bSet').selectOption('PD1');
  await page.locator(`#bGrid [data-card="${PROMO}"]`).scrollIntoViewIfNeeded();
  for (const entry of supplement.records) await expect(page.locator(`#bGrid [data-card="${entry.id}"] .art-placeholder`)).toBeVisible();
  await shot(page, info, 'placeholder-six-missing-promos-browse');
  expect(await owned(page)).toEqual({[PROMO]: {q: 0, f: 1}});
});

test('ordinary missing artwork uses the same self-hosted decorative asset and readable exact identity', async ({page, context}, info) => {
  await boot(page, context); await decodePlaceholder(page);
  const row = await search(page, '12 901', MISSING);
  await placeholder(row.locator('.art-placeholder'), 'Synthetic Missing Art'); await row.click();
  await placeholder(page.locator('#sheetBody .big .art-placeholder'), 'Synthetic Missing Art');
  await expect(page.locator('#sheetBody .big')).toContainText('12 #901');
  await expect(page.locator('#sheetBody .big')).toContainText('No image available');
  await shot(page, info, 'ordinary-missing-art-placeholder');
  expect(await owned(page)).toEqual({}); expect(states.get(context).imageRequests).toEqual([]);
});

test('a valid synthetic image stays visible instead of the placeholder in thumbnail detail and grid', async ({page, context}, info) => {
  await boot(page, context, {adapter: true});
  const row = await search(page, '12 902', ART);
  async function decoded(image) {
    await expect(image).toBeVisible();
    expect(await image.evaluate(async img => {await img.decode(); return [img.naturalWidth, img.naturalHeight];})).toEqual([120, 168]);
  }
  await decoded(row.locator('[data-card-art]')); await expect(row.locator('.art-placeholder')).toBeHidden();
  await row.click(); await decoded(page.locator('#sheetBody .big [data-card-art]')); await expect(page.locator('#sheetBody .big .art-placeholder')).toBeHidden();
  await shot(page, info, 'synthetic-valid-image-not-a-real-card'); await closeSheet(page);
  await page.locator('[data-tab="browse"]').click(); await page.locator('#bq').fill('Synthetic Valid Art');
  await decoded(page.locator(`#bGrid [data-card="${ART}"] [data-card-art]`));
  await expect(page.locator(`#bGrid [data-card="${ART}"] .art-placeholder`)).toBeHidden();
  expect(await owned(page)).toEqual({});
});

for (const failure of ['http', 'decode']) test(`${failure} image failure shows the themed placeholder and consumes at most one normal-to-small retry`, async ({page, context}, info) => {
  await boot(page, context, {adapter: true, failure}); await decodePlaceholder(page);
  const row = await search(page, '12 902', ART);
  await expect(row.locator('[data-card-art]')).toHaveCount(0); await placeholder(row.locator('.art-placeholder'), 'Synthetic Valid Art');
  await row.click();
  await expect(page.locator('#sheetBody .big [data-card-art]')).toHaveCount(0);
  await placeholder(page.locator('#sheetBody .big .art-placeholder'), 'Synthetic Valid Art');
  await expect(page.locator('#sheetBody .big')).toContainText('No image available');
  await page.waitForTimeout(500); // Bounded retry-loop observation, not a readiness substitute.
  expect(states.get(context).imageRequests).toEqual([`/qa-card-art/small/${ART}.avif`, `/qa-card-art/normal/${ART}.avif`, `/qa-card-art/small/${ART}.avif`]);
  await shot(page, info, `${failure}-failure-placeholder-no-loop`); expect(await owned(page)).toEqual({});
});

test('a missing decorative SVG still leaves readable HTML and accessible card identity without retries', async ({page, context}, info) => {
  await boot(page, context, {placeholderFailure: true});
  const row = await search(page, 'PD1 11', PROMO); await row.click();
  await placeholder(page.locator('#sheetBody .big .art-placeholder'), 'Above the Crowd');
  await expect(page.locator('#sheetBody .big')).toContainText('No image available');
  await expect(page.locator('#sheetBody .big')).toContainText('Above the Crowd');
  await expect(page.locator('#sheetBody .big')).toContainText('PD1 #11');
  await expect.poll(() => states.get(context).placeholderRequests).toBeGreaterThan(0);
  const count = states.get(context).placeholderRequests;
  await page.waitForTimeout(500);
  expect(states.get(context).placeholderRequests).toBe(count);
  expect(count).toBeGreaterThan(0);
  await expect(page.locator('#sheetBody .big [data-card-art]')).toHaveCount(0);
  await shot(page, info, 'placeholder-asset-missing-readable-html'); expect(await owned(page)).toEqual({});
});
