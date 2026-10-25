'use strict';
// Synthetic localhost-only regression coverage for the distinct rainbow finish.
// These tests never authenticate, contact production, or exercise real cameras.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const KEY = 'inkscan.state.v6';
const LEGACY_KEY = 'inkscan.state.v5';
const blockedByContext = new WeakMap();
const errorsByPage = new WeakMap();
const legacyByPage = new WeakMap();

const initialInv = () => ({
  'synthetic-card-0': { q: 2, f: 1, rf: 2 },
  'synthetic-card-1': { q: 1, f: 2, rf: 1 },
  'synthetic-unknown-printing': { q: 0, f: 0, rf: 3 }
});
async function saved(page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY); }
async function waitForApp(page) {
  await expect(page.locator('#loadBanner')).toBeHidden();
  await expect(page.locator('#manualUpdate')).toBeVisible();
}
async function tab(page, name) {
  await page.locator(`[data-tab="${name}"]`).click();
  await expect(page.locator(`[data-tab="${name}"]`)).toHaveAttribute('aria-current', 'page');
}
async function closed(page) {
  await expect(page.locator('#sheet')).toBeHidden();
  await expect.poll(() => page.evaluate(() => history.state?.sheet || 0)).toBe(0);
}
async function shot(page, info, name) {
  const file = info.outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  await info.attach(name, { path: file, contentType: 'image/png' });
}
async function assertNoCloud(page, context) {
  const attempts = await page.evaluate(() => window.__inkscanRainbowFetchAudit || []);
  expect(attempts.filter(x => x.audit), 'Every fetch URL must be auditable').toEqual([]);
  expect(attempts.filter(x => /^\/(?:auth|rest)\/v1(?:\/|$)/.test(x.pathname)), 'No auth or collection fetch may be attempted').toEqual([]);
  expect((blockedByContext.get(context) || []).filter(x => /^\/(?:auth|rest)\/v1(?:\/|$)/.test(x.pathname))).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('inkscan.session'))).toBeNull();
}
async function summary(page, selector, dollars, copies, unpriced) {
  const el = page.locator(selector);
  await expect(el).toContainText(`$${dollars.toFixed(2)} for ${copies} owned copies across all matching results.`);
  await expect(el).toContainText(`${unpriced} copies unpriced.`);
  await expect(el).toContainText(unpriced ? 'Partial estimate:' : 'Estimated value:');
}
async function openCard(page, id = 'synthetic-card-0') {
  await tab(page, 'coll');
  await page.locator(`#coll [data-card="${id}"]`).click();
  await expect(page.locator('#ownBox')).toBeVisible();
}
async function importDeck(page) {
  await tab(page, 'decks');
  await page.locator('#importDeckBtn').click();
  await page.locator('#impName').fill('Synthetic rainbow purchase');
  await page.locator('#impText').fill('4 Synthetic card 0 - QA edition');
  await page.locator('#impGo').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Deck imported');
}
async function openPurchase(page, fromImport = false) {
  if (fromImport) await page.locator('#importToCollection').click();
  else {
    await page.locator('#deckMoreBtn').click();
    await page.locator('[data-dm="newcards"]').click();
  }
  await expect(page.locator('#sheetTitle')).toHaveText('Add new physical cards');
}
async function previewRainbow(page) {
  await page.locator('#purchasePrint0').selectOption('synthetic-card-0');
  await page.locator('#purchaseFinish0').selectOption('rainbow');
  await page.locator('#previewPurchase').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Confirm collection additions');
}
async function chooseFile(page, name, contents, mimeType = 'application/json') {
  await page.locator('#fileIn').setInputFiles({ name, mimeType, buffer: Buffer.from(typeof contents === 'string' ? contents : JSON.stringify(contents)) });
}
async function downloadText(page, info, action, filename) {
  const event = page.waitForEvent('download');
  await action();
  const download = await event;
  const destination = info.outputPath(filename);
  await download.saveAs(destination);
  const text = await fs.readFile(destination, 'utf8');
  await info.attach(filename, { path: destination, contentType: filename.endsWith('.json') ? 'application/json' : 'text/csv' });
  return text;
}
async function replaceInventory(page, inv) {
  await page.evaluate(({ key, inv }) => {
    const state = JSON.parse(localStorage.getItem(key));
    state.inv = inv;
    // Disposable synthetic fixture only. Reload so app's in-memory state agrees.
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: KEY, inv });
  await page.reload();
  await waitForApp(page);
}

// Service workers remain blocked by the paired config. Routing cannot intercept
// service-worker-owned requests; no offline/PWA lifecycle coverage is claimed.
test.beforeEach(async ({ context, page }) => {
  const blocked = [], errors = [];
  blockedByContext.set(context, blocked);
  errorsByPage.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(() => {
    const nativeFetch = window.fetch;
    const attempts = [];
    window.__inkscanRainbowFetchAudit = attempts;
    window.fetch = function (...args) {
      try {
        const input = args[0];
        const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
        const url = new URL(target, location.href);
        attempts.push({ method: String(args[1]?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase(), origin: url.origin, pathname: url.pathname });
      } catch { attempts.push({ audit: 'Fetch URL or method not inspectable' }); }
      return Reflect.apply(nativeFetch, this, args);
    };
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4173') return route.continue();
    blocked.push({ method: route.request().method(), origin: url.origin, pathname: url.pathname });
    return route.abort('blockedbyclient');
  });
  // A real v5-shaped snapshot is left byte-exact so migration fencing is tested,
  // then rf is introduced only in the disposable v6 fixture.
  await page.goto('/qa-seed.html');
  const legacy = await page.evaluate(({ key, inv }) => {
    const old = { v: 5, inv: { 'synthetic-card-0': { q: 2, f: 1 }, 'synthetic-card-1': { q: 1, f: 2 } }, decks: [], wish: {}, base: null, last: null, imports: {}, recovery: [], revision: 0 };
    const raw = JSON.stringify(old);
    localStorage.setItem(key, raw);
    const migrated = InkSafety.load(localStorage);
    migrated.inv = inv;
    InkSafety.save(localStorage, migrated);
    return raw;
  }, { key: LEGACY_KEY, inv: initialInv() });
  legacyByPage.set(page, legacy);
  await page.goto('/index.html');
  await waitForApp(page);
  await expect(page.locator('#tCopies')).toHaveText('12');
  expect(await page.evaluate(key => localStorage.getItem(key), LEGACY_KEY)).toBe(legacy);
});

test.afterEach(async ({ context, page }, info) => {
  if (!page.isClosed()) {
    await shot(page, info, 'rainbow-final-screen');
    await info.attach('rainbow-fetch-audit.json', { body: JSON.stringify(await page.evaluate(() => window.__inkscanRainbowFetchAudit || []), null, 2), contentType: 'application/json' });
    await assertNoCloud(page, context);
  }
  await info.attach('rainbow-external-blocks.json', { body: JSON.stringify(blockedByContext.get(context) || [], null, 2), contentType: 'application/json' });
  await info.attach('rainbow-page-errors.json', { body: JSON.stringify(errorsByPage.get(page) || [], null, 2), contentType: 'application/json' });
  expect(errorsByPage.get(page) || [], 'No unexpected browser exceptions').toEqual([]);
});

test('rainbow quantities stay separate, unknown prices remain partial, and filters use the selected finish', async ({ page }, info) => {
  await expect(page.locator('#tUnique')).toHaveText('3');
  await expect(page.locator('#tValue')).toHaveText('$29 (partial)');
  await expect(page.locator('#tValue')).toHaveAttribute('title', /7 copies unpriced/);
  await tab(page, 'coll');
  await summary(page, '#cValue', 29, 9, 4);
  await page.locator('#cFinish').selectOption('rainbow');
  await summary(page, '#cValue', 0, 3, 3);
  await expect(page.locator('#coll [data-card]')).toHaveCount(2);
  await expect(page.locator('#coll [data-card="synthetic-card-0"] .badge')).toHaveText('2');
  await page.locator('[data-lay="list"]').click();
  await expect(page.locator('#coll')).toContainText('Rainbow foil');
  await shot(page, info, 'rainbow-filter-unpriced');
  await page.locator('#coll [data-card="synthetic-card-0"]').click();
  await page.getByRole('button', { name: 'One more rainbow foil', exact: true }).click();
  expect((await saved(page)).inv['synthetic-card-0']).toEqual({ q: 2, f: 1, rf: 3 });
  await page.locator('#sheetClose').click();
  await closed(page);
  await expect(page.locator('#tCopies')).toHaveText('13');
  await page.reload();
  await waitForApp(page);
  expect((await saved(page)).inv['synthetic-card-0']).toEqual({ q: 2, f: 1, rf: 3 });
  expect(await page.evaluate(key => localStorage.getItem(key), LEGACY_KEY)).toBe(legacyByPage.get(page));
  await tab(page, 'browse');
  await page.locator('#bFinish').selectOption('rainbow');
  await page.locator('#bOwn').selectOption('own');
  await expect(page.locator('#bCount')).toHaveText('2 cards');
  await summary(page, '#bValue', 0, 4, 4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('rainbow purchase cancellation changes nothing; 2 plus 4 is 6 once, with intentional repeat distinct', async ({ page }, info) => {
  const original = (await saved(page)).inv;
  await importDeck(page);
  expect((await saved(page)).inv).toEqual(original);
  await openPurchase(page, true);
  await expect(page.locator('#purchaseFinish0')).toHaveValue('');
  await previewRainbow(page);
  await expect(page.locator('#sheetBody')).toContainText('2 + 4 = 6');
  await expect(page.locator('#sheetBody')).toContainText(/rainbow/i);
  await page.locator('#cancelPurchase').click();
  await closed(page);
  expect((await saved(page)).inv).toEqual(original);
  await openPurchase(page);
  await previewRainbow(page);
  await shot(page, info, 'rainbow-2-plus-4-confirmation');
  await page.locator('#confirmPurchase').dblclick();
  await closed(page);
  let state = await saved(page);
  expect(state.inv['synthetic-card-0']).toEqual({ q: 2, f: 1, rf: 6 });
  expect(Object.keys(state.imports)).toHaveLength(1);
  expect(state.recovery.at(-1).inv['synthetic-card-0']).toEqual(original['synthetic-card-0']);
  await openPurchase(page);
  await previewRainbow(page);
  await expect(page.locator('#sheetBody')).toContainText('6 + 4 = 10');
  await page.locator('#confirmPurchase').click();
  await closed(page);
  state = await saved(page);
  expect(state.inv['synthetic-card-0']).toEqual({ q: 2, f: 1, rf: 10 });
  expect(Object.keys(state.imports)).toHaveLength(2);
  expect(state.inv['synthetic-card-1']).toEqual(original['synthetic-card-1']);
  expect(state.inv['synthetic-unknown-printing']).toEqual(original['synthetic-unknown-printing']);
  await expect(page.locator('#tCopies')).toHaveText('20');
});

test('versioned backup roundtrip retains every finish and unknown ID while old readers reject its marker', async ({ page }, info) => {
  const original = (await saved(page)).inv;
  const text = await downloadText(page, info, () => page.locator('#safetyBackup').click(), 'synthetic-rainbow-backup.json');
  const backup = JSON.parse(text);
  expect(backup.app).toBe('inkscan-v6-backup');
  expect(backup.app).not.toBe('inkscan'); // Released v5 restore requires this exact old marker.
  expect(backup.v).toBe(6);
  expect(backup.inv).toEqual(original);
  expect(backup).not.toHaveProperty('session');
  await openCard(page);
  await page.getByRole('button', { name: 'One more rainbow foil', exact: true }).click();
  await page.locator('#sheetClose').click();
  await closed(page);
  expect((await saved(page)).inv['synthetic-card-0'].rf).toBe(3);
  await chooseFile(page, 'synthetic-rainbow-backup.json', backup);
  await expect(page.locator('#sheetTitle')).toHaveText('Review device restore');
  await expect(page.locator('#sheetBody')).toContainText('12 physical cards');
  await page.locator('#confirmRestore').click();
  await closed(page);
  expect((await saved(page)).inv).toEqual(original);
  await page.reload();
  await waitForApp(page);
  expect((await saved(page)).inv).toEqual(original);
  expect(await page.evaluate(key => localStorage.getItem(key), LEGACY_KEY)).toBe(legacyByPage.get(page));
});

test('legacy JSON restore keeps current rainbow quantities, including absent and unknown printings', async ({ page }, info) => {
  const legacy = { app: 'inkscan', v: 5, inv: { 'synthetic-card-0': { q: 9, f: 0 } }, decks: [], wish: {}, imports: {} };
  await chooseFile(page, 'synthetic-legacy-backup.json', legacy);
  await expect(page.locator('#sheetTitle')).toHaveText('Review device restore');
  await expect(page.locator('#sheetBody')).toContainText(/rainbow.*preserv/i);
  await expect(page.locator('#sheetBody')).toContainText('15 physical cards');
  await shot(page, info, 'legacy-restore-preserves-rainbow');
  await page.locator('#confirmRestore').click();
  await closed(page);
  const inv = (await saved(page)).inv;
  expect(inv['synthetic-card-0']).toEqual({ q: 9, f: 0, rf: 2 });
  expect(inv['synthetic-card-1']).toMatchObject({ rf: 1 });
  expect((inv['synthetic-card-1'].q || 0) + (inv['synthetic-card-1'].f || 0)).toBe(0);
  expect(inv['synthetic-unknown-printing']).toMatchObject({ rf: 3 });
  await expect(page.locator('#tCopies')).toHaveText('15');
});

test('legacy CSV restore keeps rainbow quantities and saved decks instead of treating missing rf as deletion', async ({ page }) => {
  await importDeck(page);
  await page.locator('#importDone').click();
  await closed(page);
  const originalDecks = (await saved(page)).decks;
  const csv = 'Lorcast ID,Finish,Quantity\nsynthetic-card-0,Normal,4\nsynthetic-card-0,Foil,2';
  await chooseFile(page, 'synthetic-legacy.csv', csv, 'text/csv');
  await expect(page.locator('#sheetTitle')).toHaveText('Review device restore');
  await expect(page.locator('#sheetBody')).toContainText(/rainbow.*preserv/i);
  await page.locator('#confirmRestore').click();
  await closed(page);
  const state = await saved(page);
  expect(state.inv['synthetic-card-0']).toEqual({ q: 4, f: 2, rf: 2 });
  expect(state.inv['synthetic-card-1']).toMatchObject({ rf: 1 });
  expect(state.inv['synthetic-unknown-printing']).toMatchObject({ rf: 3 });
  expect(state.decks).toEqual(originalDecks);
  await expect(page.locator('#tCopies')).toHaveText('12');
});

test('versioned CSV uses old-reader-safe headers and roundtrips all finishes including unknown printings', async ({ page }, info) => {
  const inv = initialInv();
  await replaceInventory(page, inv);
  await tab(page, 'coll');
  await page.locator('#toolsBtn').click();
  const csv = await downloadText(page, info, () => page.locator('[data-tool="csv"]').click(), 'synthetic-rainbow.csv');
  const header = csv.replace(/^\uFEFF/, '').split(/\r?\n/)[0].split(',');
  expect(header).toContain('InkScan v6 Lorcast ID');
  expect(header).toContain('InkScan v6 Finish');
  expect(header).toContain('InkScan v6 Quantity');
  expect(header).not.toContain('Finish');
  expect(header).not.toContain('Quantity');
  expect(header).not.toContain('Lorcast ID');
  expect(csv).toContain('Rainbow Foil');
  expect(csv).toContain('synthetic-unknown-printing');
  await page.locator('#sheetClose').click();
  await closed(page);
  await replaceInventory(page, { 'synthetic-card-0': { q: 8, f: 0, rf: 9 } });
  await chooseFile(page, 'synthetic-rainbow.csv', csv, 'text/csv');
  await expect(page.locator('#sheetTitle')).toHaveText('Review device restore');
  await page.locator('#confirmRestore').click();
  await closed(page);
  expect((await saved(page)).inv).toEqual(inv);
  await expect(page.locator('#tCopies')).toHaveText('12');
});

test('legacy-tab writes are fenced and a visible warning prevents silently overwriting either envelope', async ({ page, context }, info) => {
  const originalRaw = await page.evaluate(key => localStorage.getItem(key), KEY);
  const other = await context.newPage();
  await other.goto('/qa-seed.html');
  const changedLegacy = await other.evaluate(key => {
    const value = JSON.parse(localStorage.getItem(key));
    value.inv['synthetic-card-0'].q = 77;
    const raw = JSON.stringify(value);
    localStorage.setItem(key, raw);
    return raw;
  }, LEGACY_KEY);
  await expect(page.locator('#saveStatus')).toContainText(/legacy|older|v5/i);
  await openCard(page);
  await page.getByRole('button', { name: 'One more rainbow foil', exact: true }).click();
  await expect(page.locator('#sheetSaveStatus')).toBeVisible();
  await expect(page.locator('#sheetSaveStatus')).toContainText(/legacy|older|v5/i);
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(originalRaw);
  expect(await page.evaluate(key => localStorage.getItem(key), LEGACY_KEY)).toBe(changedLegacy);
  await shot(page, info, 'legacy-edit-fenced-with-rainbow-visible');
  const bounds = await page.locator('#sheetSaveStatus').boundingBox();
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize().height);
  await other.close();
});

test('scanner/search finish selection and session conversion are explicit, reversible and do not open a camera', async ({ page }, info) => {
  await page.evaluate(() => {
    window.__rainbowCameraCalls = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      window.__rainbowCameraCalls++;
      throw new Error('Synthetic test forbids a physical camera request');
    };
  });
  await tab(page, 'scan');
  await page.locator('#scanFinish').selectOption('rainbow');
  await page.locator('#q').fill('Synthetic card 0');
  await page.locator('#qres [data-act="add"][data-id="synthetic-card-0"]').click();
  expect((await saved(page)).inv['synthetic-card-0']).toEqual({ q: 2, f: 1, rf: 3 });
  await expect(page.locator('#log [data-log-finish]')).toHaveValue('rainbow');
  await page.locator('#log [data-log-finish]').selectOption('foil');
  expect((await saved(page)).inv['synthetic-card-0']).toEqual({ q: 2, f: 2, rf: 2 });
  await page.locator('#log').getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await saved(page)).inv['synthetic-card-0']).toEqual(initialInv()['synthetic-card-0']);
  expect(await page.evaluate(() => window.__rainbowCameraCalls)).toBe(0);
  await expect(page.locator('#tCopies')).toHaveText('12');
  await shot(page, info, 'explicit-rainbow-scan-finish');
});

test('Epic, Enchanted, Iconic and Promo filters preserve their exact printing IDs and do not infer ownership', async ({ page, context }, info) => {
  const catalog = JSON.parse(await fs.readFile(path.join(__dirname, '../fixtures/cards.json'), 'utf8'));
  const rarities = ['Epic', 'Enchanted', 'Iconic', 'Promo'];
  const inv = {};
  rarities.forEach((rarity, i) => {
    const card = catalog.cards[i + 4];
    card.r = rarity;
    card.n = 'Synthetic same gameplay identity';
    card.v = 'Distinct printing QA';
    card.p = null;
    card.pf = 5;
    inv[card.id] = { q: 0, f: 1 };
  });
  await context.route('**/cards.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(catalog) }));
  await replaceInventory(page, inv);
  await tab(page, 'browse');
  await page.locator('#bOwn').selectOption('own');
  await page.locator('#bFinish').selectOption('foil');
  for (let i = 0; i < rarities.length; i++) {
    const id = catalog.cards[i + 4].id;
    await page.locator('#bRar').selectOption(rarities[i]);
    await expect(page.locator('#bCount')).toHaveText('1 cards');
    await expect(page.locator('#bGrid [data-card]')).toHaveCount(1);
    await expect(page.locator('#bGrid [data-card]')).toHaveAttribute('data-card', id);
    await page.locator(`#bGrid [data-card="${id}"]`).click();
    await page.getByRole('button', { name: 'One more foil', exact: true }).click();
    await page.locator('#sheetClose').click();
    await closed(page);
    expect((await saved(page)).inv[id]).toEqual({ q: 0, f: 2 });
  }
  expect(Object.keys((await saved(page)).inv).sort()).toEqual(Object.keys(inv).sort());
  await expect(page.locator('#tCopies')).toHaveText('8');
  await shot(page, info, 'rarity-filter-exact-printing');
});


test('removing normal and generic foil copies does not delete a rainbow-only printing', async ({ page }, info) => {
  await openCard(page);
  await page.getByRole('button', { name: 'One fewer normal', exact: true }).click();
  await page.getByRole('button', { name: 'One fewer normal', exact: true }).click();
  await page.getByRole('button', { name: 'One fewer foil', exact: true }).click();
  expect((await saved(page)).inv['synthetic-card-0']).toEqual({ q: 0, f: 0, rf: 2 });
  await page.locator('#sheetClose').click();
  await closed(page);
  await expect(page.locator('#coll [data-card="synthetic-card-0"]')).toBeVisible();
  await expect(page.locator('#tCopies')).toHaveText('9');
  await page.reload();
  await waitForApp(page);
  expect((await saved(page)).inv['synthetic-card-0']).toEqual({ q: 0, f: 0, rf: 2 });
  await shot(page, info, 'rainbow-only-printing-retained');
});
