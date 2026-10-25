'use strict';
// Synthetic localhost UI QA only. Run through the paired Playwright config.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const KEY = 'inkscan.state.v5';
const blockedByContext = new WeakMap();
const errorsByPage = new WeakMap();

async function fetchAttempts(page) {
  return page.evaluate(() => window.__inkscanQAFetchAttempts || []);
}
async function expectNoCloudFetchAttempts(page) {
  const attempts = await fetchAttempts(page);
  expect(attempts.filter(attempt => attempt.audit), 'Fetch audit must inspect every attempted app request').toEqual([]);
  expect(attempts.filter(attempt => /^\/(?:auth|rest)\/v1(?:\/|$)/.test(attempt.pathname)),
    'The app must fail closed before attempting any auth or collection API fetch').toEqual([]);
}

async function saved(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
}
async function waitForApp(page) {
  await expect(page.locator('#loadBanner')).toBeHidden();
  await expect(page.locator('#manualUpdate')).toBeVisible();
}
async function seed(page) {
  await page.goto('/qa-seed.html');
  await page.locator('#seed').click();
  await page.waitForURL('**/index.html');
  await waitForApp(page);
  await expect(page.locator('#tCopies')).toHaveText('9');
}
async function tab(page, name) {
  await page.locator(`[data-tab="${name}"]`).click();
  await expect(page.locator(`[data-tab="${name}"]`)).toHaveAttribute('aria-current', 'page');
}
async function closed(page) {
  await expect(page.locator('#sheet')).toBeHidden();
  // closeSheet calls history.back asynchronously. Wait before opening another sheet.
  await expect.poll(() => page.evaluate(() => history.state?.sheet || 0)).toBe(0);
}
async function shot(page, info, label) {
  const file = info.outputPath(`${label}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  await info.attach(label, { path: file, contentType: 'image/png' });
}
async function summary(page, selector, value, copies, unpriced) {
  const el = page.locator(selector);
  await expect(el).toContainText(`$${value.toFixed(2)} for ${copies} owned copies across all matching results.`);
  await expect(el).toContainText(`${unpriced} copies unpriced.`);
  await expect(el).toContainText('TCGplayer market prices via Lorcast; catalog as of');
  await expect(el).toContainText(unpriced ? 'Partial estimate:' : 'Estimated value:');
}
async function importDeck(page, text = '4 Synthetic card 0 - QA edition') {
  await tab(page, 'decks');
  await page.locator('#importDeckBtn').click();
  await page.locator('#impName').fill('Synthetic browser QA deck');
  await page.locator('#impText').fill(text);
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
async function previewPurchase(page) {
  await page.locator('#purchasePrint0').selectOption('synthetic-card-0');
  await page.locator('#purchaseFinish0').selectOption('normal');
  await page.locator('#previewPurchase').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Confirm collection additions');
}
async function openCard(page, id = 'synthetic-card-0') {
  await tab(page, 'coll');
  await page.locator(`#coll [data-card="${id}"]`).click();
  await expect(page.locator('#ownBox')).toBeVisible();
}

// Routing is installed at context scope before any page loads. Service workers
// MUST remain blocked in config: Playwright routing cannot intercept SW-owned
// traffic. This suite deliberately makes no offline/PWA lifecycle claim.
test.beforeEach(async ({ context, page }) => {
  const blocked = [];
  blockedByContext.set(context, blocked);
  const errors = [];
  errorsByPage.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  // A CSP rejection can happen before routing sees a request. Audit calls to
  // fetch as well as intercepted traffic, without recording headers or bodies.
  // Each navigation gets a new per-document audit; checks below occur in the
  // same document as the startup/events/edit/manual action under examination.
  await context.addInitScript(() => {
    const nativeFetch = window.fetch;
    const attempts = [];
    window.__inkscanQAFetchAttempts = attempts;
    window.fetch = function (...args) {
      try {
        const input = args[0];
        const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
        const url = new URL(target, location.href);
        const method = args[1]?.method || (input instanceof Request ? input.method : 'GET');
        attempts.push({ method: String(method).toUpperCase(), origin: url.origin, pathname: url.pathname });
      } catch {
        // Auditing must not change native fetch's errors or return value.
        attempts.push({ audit: 'URL or method could not be inspected' });
      }
      return Reflect.apply(nativeFetch, this, args);
    };
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4173') return route.continue();
    blocked.push({ method: route.request().method(), origin: url.origin, pathname: url.pathname });
    return route.abort('blockedbyclient');
  });
  await seed(page);
});

test.afterEach(async ({ context, page }, info) => {
  if (!page.isClosed()) {
    await shot(page, info, 'final-screen');
    await info.attach('fetch-attempt-audit.json', {
      body: JSON.stringify(await fetchAttempts(page), null, 2), contentType: 'application/json'
    });
  }
  await info.attach('blocked-external-requests.json', {
    body: JSON.stringify(blockedByContext.get(context) || [], null, 2), contentType: 'application/json'
  });
  await info.attach('page-errors.json', {
    body: JSON.stringify(errorsByPage.get(page) || [], null, 2), contentType: 'application/json'
  });
  expect(errorsByPage.get(page) || [], 'Unexpected browser page errors').toEqual([]);
});

test('collection totals, known/unpriced normal and foil filters, grid/list and layout', async ({ page }, info) => {
  await expect(page.locator('#tUnique')).toHaveText('3');
  await expect(page.locator('#tCopies')).toHaveText('9');
  await expect(page.locator('#tValue')).toHaveText('$29 (partial)');
  await expect(page.locator('#tValue')).toHaveAttribute('title', /4 copies unpriced/);
  await expect(page.locator('#saveStatus')).toContainText('1 collection printing(s) are missing');
  await tab(page, 'coll');
  await summary(page, '#cValue', 29, 6, 1);
  await expect(page.locator('#coll [data-card]')).toHaveCount(2);
  await shot(page, info, 'collection-all');
  await page.locator('#cFinish').selectOption('normal');
  await summary(page, '#cValue', 4, 3, 1);
  await expect(page.locator('#coll [data-card="synthetic-card-0"] .badge')).toHaveText('2');
  await page.locator('#cFinish').selectOption('foil');
  await summary(page, '#cValue', 25, 3, 0);
  await expect(page.locator('#coll [data-card="synthetic-card-0"] .badge')).toHaveText('1');
  await page.locator('[data-lay="list"]').click();
  await expect(page.locator('#coll')).toHaveClass('list');
  await expect(page.locator('#coll')).toContainText('Foil ×2');
  await shot(page, info, 'collection-foil-list');
  await page.locator('#cf').fill('Synthetic card 0');
  await summary(page, '#cValue', 5, 1, 0);
  await page.locator('#cReset').click();
  await summary(page, '#cValue', 29, 6, 1);
  await page.locator('#collInks [data-ink="Ruby"]').click();
  await summary(page, '#cValue', 20, 3, 1);
  await page.locator('#cReset').click();
  await page.locator('[data-lay="grid"]').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('browse sums every matching item before chunking and filters use selected finish', async ({ page }, info) => {
  // Explicit synthetic extra ownership beyond the initial 48 rendered cards.
  await page.evaluate(key => {
    const state = JSON.parse(localStorage.getItem(key));
    state.inv['synthetic-card-119'] = { q: 7, f: 0 };
    localStorage.setItem(key, JSON.stringify(state));
  }, KEY);
  await page.reload();
  await waitForApp(page);
  await tab(page, 'browse');
  await expect(page.locator('#bCount')).toHaveText('120 cards');
  expect(await page.locator('#bGrid [data-card]').count()).toBeLessThan(120);
  await summary(page, '#bValue', 43, 13, 1);
  await shot(page, info, 'browse-before-pagination');
  for (let i = 0; i < 3 && await page.locator('#bGrid [data-card]').count() < 120; i++) {
    await page.locator('#bSentinel').scrollIntoViewIfNeeded();
    await expect.poll(() => page.locator('#bGrid [data-card]').count()).toBeGreaterThan(48 * (i + 1));
  }
  await expect(page.locator('#bGrid [data-card]')).toHaveCount(120);
  await summary(page, '#bValue', 43, 13, 1);
  await page.locator('#bq').fill('Synthetic card 119');
  await expect(page.locator('#bCount')).toHaveText('1 cards');
  await summary(page, '#bValue', 14, 7, 0);
  await page.locator('#bReset').click();
  await page.locator('#bSet').selectOption('QA');
  await expect(page.locator('#bCount')).toHaveText('120 cards');
  await page.locator('#bInks [data-ink="Amber"]').click();
  await expect(page.locator('#bCount')).toHaveText('60 cards');
  await summary(page, '#bValue', 9, 3, 0);
  await page.locator('#bReset').click();
  await page.locator('#bRar').selectOption('Rare');
  await expect(page.locator('#bCount')).toHaveText('60 cards');
  await summary(page, '#bValue', 34, 10, 1);
  await page.locator('#bReset').click();
  await page.locator('#bType').selectOption('Character');
  await page.locator('#bCost').selectOption('7');
  await expect(page.locator('#bCount')).toHaveText('15 cards');
  await page.locator('#bReset').click();
  await page.locator('#bFinish').selectOption('normal');
  await page.locator('#bOwn').selectOption('own');
  await expect(page.locator('#bCount')).toHaveText('3 cards');
  await summary(page, '#bValue', 18, 10, 1);
  await expect(page.locator('#bGrid [data-card="synthetic-card-1"] .cap')).toContainText('— normal');
  await page.locator('#bFinish').selectOption('foil');
  await expect(page.locator('#bCount')).toHaveText('2 cards');
  await summary(page, '#bValue', 25, 3, 0);
  await page.locator('#bSort').selectOption('price');
  await expect(page.locator('#bGrid [data-card]').first()).toHaveAttribute('data-card', 'synthetic-card-1');
  await expect(page.locator('#bGrid [data-card="synthetic-card-1"] .cap')).toContainText('$10.00 foil');
  await page.locator('#bOwn').selectOption('miss');
  await expect(page.locator('#bCount')).toContainText('118 cards');
  await summary(page, '#bValue', 0, 0, 0);
  await page.locator('#bReset').click();
  await expect(page.locator('#bCount')).toHaveText('120 cards');
  await summary(page, '#bValue', 43, 13, 1);
});

test('deck-only import leaves ownership unchanged; all cancellation routes preserve counts', async ({ page }, info) => {
  const original = (await saved(page)).inv;
  await importDeck(page);
  expect((await saved(page)).inv).toEqual(original);
  await page.locator('#importDone').click();
  await closed(page);
  await expect(page.locator('#deckName')).toHaveValue('Synthetic browser QA deck');
  for (const dismissal of ['cancel', 'escape', 'backdrop', 'close', 'back']) {
    await openPurchase(page);
    // A printing and finish must be explicitly selected, never guessed.
    await expect(page.locator('#purchasePrint0')).toHaveValue('');
    await expect(page.locator('#purchaseFinish0')).toHaveValue('');
    await page.locator('#previewPurchase').click();
    await expect(page.locator('#purchaseError')).toContainText('Choose a printing and finish');
    await previewPurchase(page);
    await expect(page.locator('#sheetBody')).toContainText('(normal): 2 + 4 = 6');
    if (dismissal === 'cancel') await page.locator('#cancelPurchase').click();
    if (dismissal === 'escape') await page.keyboard.press('Escape');
    if (dismissal === 'backdrop') await page.locator('#scrim').click({ position: { x: 5, y: 5 } });
    if (dismissal === 'close') await page.locator('#sheetClose').click();
    if (dismissal === 'back') await page.goBack();
    await closed(page);
    if (dismissal === 'back') {
      await page.goForward();
      await expect(page.locator('#sheet')).toBeHidden();
      expect((await saved(page)).inv).toEqual(original);
      await page.goBack();
      await closed(page);
    }
    expect((await saved(page)).inv).toEqual(original);
    await expect(page.locator('#deckEdit')).toBeVisible();
  }
  await shot(page, info, 'deck-only-after-cancellations');
});

test('confirmed additive purchase is 2 + 4 = 6; double click applies once and fresh repeat is allowed', async ({ page }, info) => {
  await importDeck(page);
  await openPurchase(page, true);
  await previewPurchase(page);
  await expect(page.locator('#sheetBody')).toContainText('(normal): 2 + 4 = 6');
  await shot(page, info, 'purchase-2-plus-4-preview');
  await page.locator('#confirmPurchase').dblclick();
  await closed(page);
  let state = await saved(page);
  expect(state.inv['synthetic-card-0']).toEqual({ q: 6, f: 1 });
  expect(Object.keys(state.imports)).toHaveLength(1);
  expect(state.recovery.at(-1).inv['synthetic-card-0']).toEqual({ q: 2, f: 1 });
  await openPurchase(page);
  await previewPurchase(page);
  await expect(page.locator('#sheetBody')).toContainText('(normal): 6 + 4 = 10');
  await page.locator('#confirmPurchase').click();
  await closed(page);
  state = await saved(page);
  expect(state.inv['synthetic-card-0']).toEqual({ q: 10, f: 1 });
  expect(Object.keys(state.imports)).toHaveLength(2);
  await page.reload();
  await waitForApp(page);
  expect((await saved(page)).inv['synthetic-card-0']).toEqual({ q: 10, f: 1 });
  await expect(page.locator('#tCopies')).toHaveText('17');
});

test('unresolved imported lines remain local and require explicit skip, never guessed', async ({ page }, info) => {
  const raw = '3 Unknown synthetic card - No matching printing';
  await importDeck(page, `4 Synthetic card 0 - QA edition\n${raw}\nUnparsed synthetic note`);
  let state = await saved(page);
  expect(state.decks[0].unresolved).toEqual([raw, 'Unparsed synthetic note']);
  expect(state.decks[0].importLines[1]).toMatchObject({ raw, qty: 3, nv: null });
  expect(state.inv['synthetic-card-0']).toEqual({ q: 2, f: 1 });
  await openPurchase(page, true);
  await expect(page.locator('#purchasePrint1 option')).toHaveCount(2);
  await page.locator('#purchasePrint0').selectOption('synthetic-card-0');
  await page.locator('#purchaseFinish0').selectOption('normal');
  await page.locator('#previewPurchase').click();
  await expect(page.locator('#purchaseError')).toContainText('explicitly keep each line unresolved');
  await page.locator('#purchasePrint1').selectOption('__skip');
  await page.locator('#previewPurchase').click();
  await expect(page.locator('#sheetBody')).toContainText('This adds 4 new physical cards.');
  await shot(page, info, 'unknown-import-explicit-skip');
  await page.locator('#cancelPurchase').click();
  await closed(page);
  state = await saved(page);
  expect(state.inv['synthetic-card-0']).toEqual({ q: 2, f: 1 });
  expect(state.decks[0].unresolved).toEqual([raw, 'Unparsed synthetic note']);
});

test('backup and reload preserve unknown printing, exact normal/foil quantities, and local edits', async ({ page }, info) => {
  await openCard(page, 'synthetic-card-1');
  // A missing normal price must not prevent adding a real normal copy.
  await page.getByRole('button', { name: 'One more normal', exact: true }).click();
  await page.locator('#sheetClose').click();
  await closed(page);
  await expect(page.locator('#tCopies')).toHaveText('10');
  await page.reload();
  await waitForApp(page);
  expect((await saved(page)).inv['synthetic-card-1']).toEqual({ q: 2, f: 2 });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#safetyBackup').click();
  const download = await downloadPromise;
  const path = info.outputPath('synthetic-backup.json');
  await download.saveAs(path);
  const backup = JSON.parse(await fs.readFile(path, 'utf8'));
  expect(backup.inv['synthetic-unknown-printing']).toEqual({ q: 3, f: 0 });
  expect(backup.inv['synthetic-card-1']).toEqual({ q: 2, f: 2 });
  expect(backup).not.toHaveProperty('session');
  expect(backup.base).toBeNull();
  await info.attach('synthetic-backup.json', { path, contentType: 'application/json' });
});

test('manual Update exposes pending status and development sign-in fails before any cloud request', async ({ page, context }, info) => {
  const original = await saved(page);
  await expectNoCloudFetchAttempts(page);
  await page.locator('#manualUpdate').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Cloud update');
  await expect(page.locator('#syncBox')).toContainText('Manual cloud updates only.');
  await expect(page.locator('#syncBox')).toContainText('Last confirmed update: not yet.');
  await expect(page.locator('#syncBox')).toContainText('Signing in does not sync your collection.');
  await page.locator('[data-sync="in"]').click();
  await expect(page.locator('#sbMsg')).toContainText('Enter your email and a password');
  await page.locator('#sbEmail').fill('synthetic-qa@example.invalid');
  await page.locator('#sbPass').fill('synthetic-test-only-not-a-real-password');
  await page.locator('[data-sync="in"]').click();
  await expect(page.locator('#sbMsg')).toHaveText('Cloud access is disabled in this isolated development preview.');
  await expectNoCloudFetchAttempts(page);
  await page.locator('[data-sync="up"]').click();
  await expect(page.locator('#sbMsg')).toHaveText('Cloud access is disabled in this isolated development preview.');
  expect(await saved(page)).toEqual(original);
  await expectNoCloudFetchAttempts(page);
  expect((blockedByContext.get(context) || []).filter(x => /example\.invalid|supabase/.test(x.origin))).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('inkscan.session'))).toBeNull();
  await shot(page, info, 'manual-update-disabled-development-origin');
});

test('synthetic signed-in state never auto-syncs and explicit Update still fails closed', async ({ page, context }, info) => {
  const original = await saved(page);
  await page.evaluate(() => localStorage.setItem('inkscan.session', JSON.stringify({
    access: 'synthetic-invalid-token', refresh: 'synthetic-invalid-refresh',
    exp: Date.now() + 3600000, uid: 'synthetic-local-user', email: 'synthetic-qa@example.invalid'
  })));
  await page.reload();
  await waitForApp(page);
  await expectNoCloudFetchAttempts(page);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expectNoCloudFetchAttempts(page);
  await openCard(page);
  await page.getByRole('button', { name: 'One more normal', exact: true }).click();
  await page.locator('#sheetClose').click();
  await closed(page);
  await expectNoCloudFetchAttempts(page);
  await page.locator('#manualUpdate').click();
  await expect(page.locator('#syncBox')).toContainText('Your collection stays local until you confirm an Update.');
  await expect(page.locator('#syncBox [role="alert"]')).toHaveCount(0);
  await expectNoCloudFetchAttempts(page);
  await page.locator('[data-sync="now"]').click();
  await expect(page.locator('#syncBox [role="alert"]')).toContainText('Cloud access is disabled in this isolated development preview.');
  await expect(page.locator('#syncBox')).toContainText('Last confirmed update: not yet.');
  expect((await saved(page)).base).toEqual(original.base);
  expect((await saved(page)).inv['synthetic-card-0']).toEqual({ q: 3, f: 1 });
  await expectNoCloudFetchAttempts(page);
  expect((blockedByContext.get(context) || []).filter(x => /example\.invalid|supabase/.test(x.origin))).toEqual([]);
  await shot(page, info, 'manual-update-synthetic-session-fails-closed');
});

test('JSON restore cancel and quota failure preserve durable and in-memory collections', async ({ page }, info) => {
  const original = await saved(page);
  const replacement = { app: 'inkscan', v: 5, inv: { 'synthetic-card-0': { q: 9, f: 0 } }, decks: [], wish: {}, imports: {} };
  const file = { name: 'synthetic-restore.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replacement)) };
  await page.locator('#fileIn').setInputFiles(file);
  await expect(page.locator('#sheetTitle')).toHaveText('Review device restore');
  await expect(page.locator('#sheetBody')).toContainText('9 physical cards');
  await page.locator('#cancelRestore').click();
  await closed(page);
  expect(await saved(page)).toEqual(original);
  await page.locator('#fileIn').setInputFiles(file);
  await page.evaluate(key => {
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      return originalSet.call(this, name, value);
    };
  }, KEY);
  await page.locator('#confirmRestore').click();
  await expect(page.locator('#restoreError')).toContainText('Restore was not applied.');
  expect(await saved(page)).toEqual(original);
  expect(await page.evaluate(() => window.__inkscan.inv)).toEqual(original.inv);
  await shot(page, info, 'restore-quota-failure-preserves-data');
  await page.reload();
  await waitForApp(page);
  expect(await saved(page)).toEqual(original);
});

test('another synthetic tab save is detected and not overwritten by the stale tab', async ({ page, context }, info) => {
  const other = await context.newPage();
  await other.goto('/index.html');
  await waitForApp(other);
  await openCard(other);
  await other.getByRole('button', { name: 'One more normal', exact: true }).click();
  await other.getByRole('button', { name: 'One more normal', exact: true }).click();
  await expect(page.locator('#saveStatus')).toContainText('Another tab saved changes.');
  await openCard(page);
  await page.getByRole('button', { name: 'One more normal', exact: true }).click();
  await expect(page.locator('#saveStatus')).toContainText('Not saved on this device.');
  const visibleWarning = page.locator('#sheetSaveStatus');
  await expect(visibleWarning).toBeVisible();
  await expect(visibleWarning).toContainText('Not saved on this device.');
  await expect(visibleWarning).toContainText('Another tab saved different data.');
  const warningBounds = await visibleWarning.boundingBox();
  expect(warningBounds.y).toBeGreaterThanOrEqual(0);
  expect(warningBounds.y + warningBounds.height).toBeLessThanOrEqual(page.viewportSize().height);

  expect((await saved(page)).inv['synthetic-card-0']).toEqual({ q: 4, f: 1 });
  expect(await page.evaluate(() => window.__inkscan.inv['synthetic-card-0'])).toEqual({ q: 3, f: 1 });
  await shot(page, info, 'stale-tab-does-not-overwrite');
  await other.close();
});


test('preserved real public catalog boots signed out without creating ownership or cloud requests', async ({ page, context }, info) => {
  const path = require('node:path');
  const raw = await fs.readFile(path.join(__dirname, '../../../cards.json'), 'utf8');
  const catalog = JSON.parse(raw);
  expect(catalog.cards).toHaveLength(3469);
  await context.route('**/cards.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: raw }));
  // This is a disposable seeded test context, never an owner's browser storage.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await waitForApp(page);
  await expect(page.locator('#tCopies')).toHaveText('0');
  await expect(page.locator('#tUnique')).toHaveText('0');
  await expectNoCloudFetchAttempts(page);
  await tab(page, 'browse');
  await expect(page.locator('#bCount')).toHaveText('3,469 cards');
  await expect(page.locator('#bGrid [data-card]').first()).toBeVisible();
  await expectNoCloudFetchAttempts(page);
  expect(await page.evaluate(() => localStorage.getItem('inkscan.state.v5'))).toBeNull();
  await shot(page, info, 'preserved-public-catalog-zero-owned');
});
