'use strict';
// Decode the six real, hash-pinned public JPEGs captured by the separate preflight.
// The app browser makes NO external network calls: exact image URLs are fulfilled
// with those downloaded bytes. This is not live-origin/CORS or offline coverage.
const {test, expect} = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const {APPROVED, CACHE, readApprovedImages, inspectImage} = require('../download-public-art.cjs');
const KEY = 'inkscan.state.v6';
const stateByContext = new WeakMap();
let catalogRaw, supplementRaw, cacheIndex, images;

async function shot(page, info, name) {
  const destination = info.outputPath(name + '.png');
  await page.screenshot({path: destination, animations: 'disabled'});
  await info.attach(name, {path: destination, contentType: 'image/png'});
}
async function waitForApp(page) {
  await expect(page.locator('#loadBanner')).toBeHidden();
  await expect(page.locator('#manualUpdate')).toBeVisible();
}
async function search(page, id) {
  const entry = JSON.parse(supplementRaw).records.find(record => record.id === id);
  await page.locator('#q').fill(`${entry.printing.s} ${entry.printing.c}`);
  await expect(page.locator('#qres button[data-act="add"]')).toHaveCount(1);
  await expect(page.locator(`#qres button[data-id="${id}"]`)).toBeVisible();
}
async function assertDecoded(locator, expected) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  await expect(locator).toHaveAttribute('src', expected.url);
  await expect(locator).toHaveAttribute('referrerpolicy', 'no-referrer');
  const decoded = await locator.evaluate(async image => {
    await image.decode();
    return {complete: image.complete, width: image.naturalWidth, height: image.naturalHeight, source: image.currentSrc};
  });
  expect(decoded).toEqual({complete: true, width: expected.width, height: expected.height, source: expected.url});
}
async function closeSheet(page) {
  await page.locator('#sheetClose').click();
  await expect(page.locator('#sheet')).toBeHidden();
  await expect.poll(() => page.evaluate(() => history.state?.sheet || 0)).toBe(0);
}
async function owned(page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key)).inv, KEY); }

test.beforeAll(async () => {
  catalogRaw = await fs.readFile(path.join(__dirname, '../../../cards.json'), 'utf8');
  supplementRaw = await fs.readFile(path.join(__dirname, '../../../promo-catalog.json'), 'utf8');
  const approved = await readApprovedImages();
  cacheIndex = JSON.parse(await fs.readFile(path.join(CACHE, 'index.json'), 'utf8'));
  expect(cacheIndex.privateUserImagesIncluded).toBe(false);
  expect(cacheIndex.images).toHaveLength(6);
  images = new Map();
  for (const item of approved) {
    const metadata = cacheIndex.images.find(image => image.id === item.id);
    expect(metadata.url).toBe(item.url);
    expect(metadata.sha256).toBe(item.sha256);
    const bytes = await fs.readFile(path.join(CACHE, item.filename));
    const inspected = inspectImage(bytes, item);
    expect(metadata.width).toBe(inspected.width); expect(metadata.height).toBe(inspected.height);
    expect(metadata.bytes).toBe(inspected.bytes);
    images.set(item.url, bytes);
  }
});

test.beforeEach(async ({page, context}) => {
  await page.clock.setFixedTime(new Date('2026-10-25T12:00:00Z'));
  const state = {requests: [], rejected: [], errors: [], failure: null};
  stateByContext.set(context, state);
  page.on('pageerror', error => state.errors.push(error.message));
  await context.addInitScript(() => {
    window.__artFetchAudit = []; window.__artCameraCalls = 0;
    const original = window.fetch;
    window.fetch = function (...args) {
      try {
        const input = args[0], url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
        window.__artFetchAudit.push({method: String(args[1]?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase(), origin: url.origin, pathname: url.pathname});
      } catch { window.__artFetchAudit.push({error: 'Uninspectable fetch'}); }
      return Reflect.apply(original, this, args);
    };
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { window.__artCameraCalls++; throw Error('Physical camera forbidden in artwork QA'); };
  });
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:4173') return route.continue();
    state.requests.push({url: url.href, method: request.method(), type: request.resourceType()});
    if (images.has(url.href) && request.method() === 'GET' && request.resourceType() === 'image') {
      if (state.failure === 'http') return route.fulfill({status: 404, contentType: 'text/plain', body: 'Synthetic public-art failure'});
      if (state.failure === 'decode') return route.fulfill({status: 200, contentType: 'image/jpeg', body: Buffer.from('Synthetic invalid JPEG for failure handling')});
      return route.fulfill({status: 200, contentType: 'image/jpeg', body: images.get(url.href)});
    }
    state.rejected.push({url: url.href, method: request.method(), type: request.resourceType()});
    return route.abort('blockedbyclient');
  });
  await context.route('**/cards.json', route => route.fulfill({status: 200, contentType: 'application/json', body: catalogRaw}));
  await context.route('**/promo-catalog.json', route => route.fulfill({status: 200, contentType: 'application/json', body: supplementRaw}));
  await page.goto('/qa-seed.html');
  await page.evaluate(() => InkSafety.save(localStorage, InkSafety.load(localStorage)));
  await page.goto('/index.html'); await waitForApp(page);
  await expect(page.locator('#tCopies')).toHaveText('0');
});

test.afterEach(async ({page, context}, info) => {
  const state = stateByContext.get(context);
  if (!page.isClosed()) {
    await shot(page, info, 'promo-art-final-screen');
    const audit = await page.evaluate(() => window.__artFetchAudit || []);
    expect(audit.filter(item => item.error)).toEqual([]);
    expect(audit.filter(item => /^\/(?:auth|rest)\/v1(?:\/|$)/.test(item.pathname))).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('inkscan.session'))).toBeNull();
    expect(await page.evaluate(() => window.__artCameraCalls)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await info.attach('art-fetch-audit.json', {body: JSON.stringify(audit, null, 2), contentType: 'application/json'});
  }
  if (state) {
    expect(state.errors).toEqual([]);
    expect(state.requests.filter(request => /^\/(?:auth|rest)\/v1(?:\/|$)/.test(new URL(request.url).pathname))).toEqual([]);
    await info.attach('art-browser-requests.json', {body: JSON.stringify(state, null, 2), contentType: 'application/json'});
  }
  if (cacheIndex) await info.attach('exact-public-art-preflight.json', {body: JSON.stringify(cacheIndex, null, 2), contentType: 'application/json'});
});

test('all six exact stamped promos decode real public bytes in manual search and card detail without adding ownership', async ({page, context}, info) => {
  test.setTimeout(45000);
  for (const item of APPROVED) {
    await search(page, item.id);
    const row = page.locator(`#qres [data-card="${item.id}"]`);
    await assertDecoded(row.locator('.thumb img'), item);
    await expect(row.locator('[data-art-placeholder]')).toBeHidden();
    await row.click();
    await assertDecoded(page.locator('#sheetBody .big img'), item);
    await expect(page.locator('#sheetBody .big img')).not.toHaveAttribute('data-fallback-src', /.+/);
    await expect(page.locator('#sheetBody .big [data-art-placeholder]')).toBeHidden();
    await shot(page, info, `exact-stamped-detail-${item.id}`);
    await closeSheet(page);
  }
  expect(await owned(page)).toEqual({});
  expect([...new Set(stateByContext.get(context).requests.map(request => request.url))].sort()).toEqual(APPROVED.map(item => item.url).sort());
});

test('explicit synthetic Add renders the exact promo in the scan log and collection, never regular-base artwork', async ({page, context}, info) => {
  const item = APPROVED.find(image => image.id === 'tcgplayer_722993');
  await search(page, item.id);
  await page.locator('#scanFinish').selectOption('foil');
  await page.locator(`#qres button[data-id="${item.id}"]`).click();
  expect(await owned(page)).toEqual({[item.id]: {q: 0, f: 1}});
  await assertDecoded(page.locator(`#log [data-card="${item.id}"] .thumb img`), item);
  await shot(page, info, 'exact-promo-scan-log-thumbnail');
  await page.locator('[data-tab="coll"]').click();
  await assertDecoded(page.locator(`#coll [data-card="${item.id}"] .art img`), item);
  await shot(page, info, 'exact-promo-owned-collection-art');
  await page.locator('[data-lay="list"]').click();
  await assertDecoded(page.locator(`#coll [data-card="${item.id}"] .thumb img`), item);
  expect(stateByContext.get(context).requests.every(request => request.url === item.url)).toBe(true);
});

test('Browse renders and decodes all six exact public promo images under their own printing IDs', async ({page}, info) => {
  await page.locator('[data-tab="browse"]').click();
  await page.locator('#bSet').selectOption('PD1');
  for (const item of APPROVED) await assertDecoded(page.locator(`#bGrid [data-card="${item.id}"] .art img`), item);
  await page.locator('#bGrid [data-card="tcgplayer_722993"]').scrollIntoViewIfNeeded();
  await shot(page, info, 'six-exact-promo-browse-art');
  expect(await owned(page)).toEqual({});
});

for (const failure of ['http', 'decode']) test(`failed ${failure} artwork shows a clear placeholder without base fallback or repeated image retries`, async ({page, context}, info) => {
  const item = APPROVED.find(image => image.id === 'tcgplayer_722993');
  const state = stateByContext.get(context); state.failure = failure;
  await search(page, item.id);
  const row = page.locator(`#qres [data-card="${item.id}"]`);
  await row.scrollIntoViewIfNeeded();
  await expect(row.locator('.thumb img')).toHaveCount(0);
  await expect(row.locator('[data-art-placeholder]')).toBeVisible();
  await expect(row.locator('[data-art-placeholder]')).toContainText(/No art|Artwork unavailable/i);
  await row.click();
  await expect(page.locator('#sheetBody .big img')).toHaveCount(0);
  await expect(page.locator('#sheetBody .big [data-art-placeholder]')).toBeVisible();
  await expect(page.locator('#sheetBody .big [data-art-placeholder]')).toContainText(/Artwork unavailable/i);
  // Bounded observation specifically checks error-handler retry loops, not an app-ready delay.
  await page.waitForTimeout(500);
  expect(state.requests).toHaveLength(2); // One thumbnail and one detail request, both exact.
  expect(state.requests.every(request => request.url === item.url)).toBe(true);
  expect(state.rejected).toEqual([]);
  expect(await owned(page)).toEqual({});
  await shot(page, info, `exact-promo-${failure}-failure-placeholder-no-fallback`);
});
