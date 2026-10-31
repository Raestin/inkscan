'use strict';
// Synthetic footer-text/UI regression coverage only: no camera or production access.
// Service workers are blocked by the shared config; this does not test offline/PWA behavior.
const {test, expect} = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const KEY = 'inkscan.state.v6';
const blockedByContext = new WeakMap();
const errorsByPage = new WeakMap();

function syntheticCatalog() {
  const sets = [
    ['12', 'Synthetic base set 12'], ['14', 'Synthetic base set 14'], ['3', 'Synthetic base set 3'],
    ['P3', 'Synthetic Promo Set 3'], ['PD1', 'Synthetic PD1'], ['DIS', 'Synthetic special set'],
    ['Coconut', 'Synthetic long-code set'], ['P1', 'Synthetic Promo Set 1']
  ].map(([code, name]) => ({code, name, rel: '2026-01-01'}));
  const card = (id, s, c, n, r = 'Common', v = 'Synthetic printing') => ({
    id, n, v, s, sn: sets.find(x => x.code === s).name, c, r, i: 'Amber', t: null,
    p: null, pf: 5, co: 1, ik: 1, ty: 'Character', cl: 'Synthetic', st: 1, wp: 2,
    lo: 1, mv: null, tx: 'Synthetic promo regression fixture only.', fl: '', il: 'QA fixture', iv: null, lc: 1
  });
  const cards = Array.from({length: 36}, (_, i) => card(`synthetic-promo-base-${i}`, '12', String(i + 1), 'Synthetic Needle', 'Common', `Base result ${i + 1}`));
  // Deliberately after the 30-result cap in the source array.
  cards.push(
    card('synthetic-promo-base-49', '12', '49', 'Synthetic Needle', 'Rare', 'Shared gameplay identity'),
    card('synthetic-promo-p3-49', 'P3', '49', 'Synthetic Needle', 'Promo', 'Shared gameplay identity'),
    card('synthetic-promo-dis-3', 'DIS', '3', 'Synthetic Needle', 'Rare', 'Special-set rarity is not Promo'),
    card('synthetic-promo-numeric-77', '12', '77', 'Synthetic Needle', 'Promo', 'Promo rarity in a numeric set'),
    card('synthetic-promo-pd1-7', 'PD1', '7', 'Synthetic PD1 card'),
    card('synthetic-promo-base-14-11', '14', '11', 'Synthetic Above the Clouds', 'Rare'),
    card('synthetic-promo-coconut-17', 'Coconut', '17', 'Synthetic Long Code', 'Rare'),
    card('synthetic-promo-p1-25ja', 'P1', '25ja', 'Synthetic Language Suffix', 'Promo'),
    card('synthetic-promo-base-3-4a', '3', '4a', 'Synthetic Suffix', 'Common', 'Printing a'),
    card('synthetic-promo-base-3-4b', '3', '4b', 'Synthetic Suffix', 'Common', 'Printing b'),
    card('synthetic-promo-dupe-a', 'P3', '88', 'Synthetic Duplicate', 'Promo', 'First exact-reference candidate'),
    card('synthetic-promo-dupe-b', 'P3', '88', 'Synthetic Duplicate', 'Promo', 'Second exact-reference candidate')
  );
  return {asof: '2026-10-24', sets, cards};
}
async function saved(page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY); }
async function waitForApp(page) {
  await expect(page.locator('#loadBanner')).toBeHidden();
  await expect(page.locator('#scanPrintingScope')).toBeVisible();
  await expect(page.locator('#manualUpdate')).toBeVisible();
}
async function search(page, query) {
  await page.locator('#q').fill(query);
  await expect(page.locator('#qres')).toBeVisible();
}
async function resultIds(page) {
  return page.locator('#qres button[data-act="add"]').evaluateAll(nodes => nodes.map(node => node.dataset.id));
}
async function exactSearch(page, query, id) {
  await search(page, query);
  await expect(page.locator('#qres button[data-act="add"]')).toHaveCount(1);
  await expect(page.locator(`#qres button[data-act="add"][data-id="${id}"]`)).toBeVisible();
}
async function resolve(page, text, scope = 'all') {
  return page.evaluate(({text, scope}) => {
    const result = window.__inkscan.resolveNumberLine(text, scope);
    return {status: result.status, id: result.card?.id || null, candidates: result.candidates.map(c => c.id), reference: result.reference, message: result.message};
  }, {text, scope});
}
async function closed(page) {
  await expect(page.locator('#sheet')).toBeHidden();
  await expect.poll(() => page.evaluate(() => history.state?.sheet || 0)).toBe(0);
}
async function shot(page, info, name) {
  const file = info.outputPath(`${name}.png`);
  // Viewport captures keep fixed/sticky controls in their actual on-screen position.
  await page.screenshot({path: file, animations: 'disabled'});
  await info.attach(name, {path: file, contentType: 'image/png'});
}
async function expectNoCloud(page) {
  const audit = await page.evaluate(() => window.__promoFetchAudit || []);
  expect(audit.filter(x => x.audit), 'All requests remain auditable').toEqual([]);
  expect(audit.filter(x => /^\/(?:auth|rest)\/v1(?:\/|$)/.test(x.pathname)), 'No auth or collection request attempted').toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('inkscan.session'))).toBeNull();
  expect(await page.evaluate(() => window.__promoCameraCalls)).toBe(0);
}
async function expectEmpty(page) {
  expect((await saved(page)).inv).toEqual({});
  expect(await page.evaluate(() => window.__inkscan.log)).toEqual([]);
  await expect(page.locator('#tCopies')).toHaveText('0');
}

test.beforeEach(async ({page, context}) => {
  const blocked = [], errors = [];
  blockedByContext.set(context, blocked); errorsByPage.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(() => {
    window.__promoFetchAudit = [];
    window.__promoCameraCalls = 0;
    const nativeFetch = window.fetch;
    window.fetch = function (...args) {
      try {
        const input = args[0];
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
        window.__promoFetchAudit.push({method: String(args[1]?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase(), origin: url.origin, pathname: url.pathname});
      } catch { window.__promoFetchAudit.push({audit: 'Uninspectable fetch'}); }
      return Reflect.apply(nativeFetch, this, args);
    };
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      window.__promoCameraCalls++;
      throw new Error('Synthetic promo tests forbid a camera request');
    };
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4173') return route.continue();
    blocked.push({method: route.request().method(), origin: url.origin, pathname: url.pathname});
    return route.abort('blockedbyclient');
  });
  await context.route('**/cards.json', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(syntheticCatalog())}));
  await context.route('**/promo-catalog.json', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({schemaVersion: 1, game: 'lorcana', verifiedAt: '2026-10-25', records: []})}));
  await page.goto('/qa-seed.html');
  await page.evaluate(() => InkSafety.save(localStorage, InkSafety.load(localStorage)));
  await page.goto('/index.html');
  await waitForApp(page);
  await expectEmpty(page);
});

test.afterEach(async ({page, context}, info) => {
  if (!page.isClosed()) {
    await shot(page, info, 'promo-final-screen');
    const audit = await page.evaluate(() => window.__promoFetchAudit || []);
    await info.attach('promo-fetch-audit.json', {body: JSON.stringify(audit, null, 2), contentType: 'application/json'});
    await expectNoCloud(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  const blocked = blockedByContext.get(context) || [];
  await info.attach('promo-external-blocks.json', {body: JSON.stringify(blocked, null, 2), contentType: 'application/json'});
  expect(blocked.filter(x => /^\/(?:auth|rest)\/v1(?:\/|$)/.test(x.pathname))).toEqual([]);
  expect(errorsByPage.get(page) || [], 'No unexpected browser exception').toEqual([]);
});

test('promo scope filters before the search cap and includes special-set rarities independently of finish', async ({page}, info) => {
  await expect(page.locator('#scanPrintingScope')).toHaveValue('all');
  await search(page, 'Synthetic Needle');
  await expect(page.locator('#qres button[data-act="add"]')).toHaveCount(30);
  expect(await resultIds(page)).not.toContain('synthetic-promo-p3-49');
  await page.locator('#scanFinish').selectOption('rainbow');
  await page.locator('#scanPrintingScope').selectOption('promo');
  await expect(page.locator('#qres button[data-act="add"]')).toHaveCount(3);
  expect((await resultIds(page)).sort()).toEqual(['synthetic-promo-dis-3', 'synthetic-promo-numeric-77', 'synthetic-promo-p3-49']);
  await expect(page.locator('#scanFinish')).toHaveValue('rainbow');
  await expect(page.locator('#qres')).toContainText('Rare');
  await expectEmpty(page);
  await page.locator('#qres').scrollIntoViewIfNeeded();
  await shot(page, info, 'promo-search-not-buried-by-base-printings');
});

test('manual reference search retains PD1, long set codes and complete collector suffixes', async ({page}) => {
  for (const [query, id] of [
    ['P3 49', 'synthetic-promo-p3-49'], ['49/P3', 'synthetic-promo-p3-49'],
    ['PD1 7', 'synthetic-promo-pd1-7'], ['Coconut 17', 'synthetic-promo-coconut-17'],
    ['P1 25ja', 'synthetic-promo-p1-25ja'], ['3 4a', 'synthetic-promo-base-3-4a'], ['3 4b', 'synthetic-promo-base-3-4b']
  ]) await exactSearch(page, query, id);
  await expectEmpty(page);
});

test('footer resolver preserves exact identity and parseLine compatibility without adding a card', async ({page}) => {
  for (const [text, id, set, collector] of [
    ['49/P3 · EN · 12', 'synthetic-promo-p3-49', 'P3', '49'],
    ['7/PD1 · EN · 14', 'synthetic-promo-pd1-7', 'PD1', '7'],
    ['17/Coconut · EN · 1', 'synthetic-promo-coconut-17', 'Coconut', '17'],
    ['25ja/P1 · EN · 1', 'synthetic-promo-p1-25ja', 'P1', '25ja'],
    ['4a/204 · EN · 3', 'synthetic-promo-base-3-4a', '3', '4a']
  ]) {
    const result = await resolve(page, text);
    expect(result.status).toBe('exact'); expect(result.id).toBe(id);
    expect(result.reference.set.toLowerCase()).toBe(set.toLowerCase());
    expect(result.reference.collector.toLowerCase()).toBe(collector.toLowerCase());
    expect(await page.evaluate(t => window.__inkscan.parseLine(t)?.id || null, text)).toBe(id);
  }
  expect((await resolve(page, 'A card name with no printed number')).status).toBe('unrecognized');
  await expectEmpty(page);
});

test('an explicit promo denominator wins; a missing PD1 printing never falls back to base set 14', async ({page}, info) => {
  for (const scope of ['all', 'promo']) {
    const known = await resolve(page, '49/P3 · EN · 12', scope);
    expect(known.status).toBe('exact'); expect(known.id).toBe('synthetic-promo-p3-49');
    const missing = await resolve(page, '11/PD1 · EN · 14', scope);
    expect(missing.status).toBe('missing'); expect(missing.id).toBeNull(); expect(missing.candidates).toEqual([]);
    expect(missing.reference.set.toUpperCase()).toBe('PD1');
  }
  expect(await page.evaluate(() => window.__inkscan.parseLine('11/PD1 · EN · 14'))).toBeNull();
  await exactSearch(page, '14 11', 'synthetic-promo-base-14-11');
  await search(page, 'PD1 11');
  await expect(page.locator('#qres button[data-act="add"]')).toHaveCount(0);
  await expectEmpty(page);
  await page.locator('#qres').scrollIntoViewIfNeeded();
  await shot(page, info, 'missing-promo-does-not-substitute-base');
});

test('duplicate exact identities are ambiguous and explicit candidate selection is required', async ({page}, info) => {
  const result = await resolve(page, '88/P3 · EN · 12', 'promo');
  expect(result.status).toBe('ambiguous'); expect(result.id).toBeNull();
  expect(result.candidates.sort()).toEqual(['synthetic-promo-dupe-a', 'synthetic-promo-dupe-b']);
  expect(await page.evaluate(() => window.__inkscan.parseLine('88/P3 · EN · 12'))).toBeNull();
  await page.locator('#scanPrintingScope').selectOption('promo');
  await search(page, 'P3 88');
  await expect(page.locator('#qres button[data-act="add"]')).toHaveCount(2);
  await expectEmpty(page);
  await page.locator('#qres [data-card="synthetic-promo-dupe-b"]').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Synthetic Duplicate');
  await page.locator('#sheetClose').click();
  await closed(page);
  await expectEmpty(page);
  await page.locator('#scanFinish').selectOption('foil');
  await page.locator('#qres button[data-act="add"][data-id="synthetic-promo-dupe-b"]').click();
  expect((await saved(page)).inv).toEqual({'synthetic-promo-dupe-b': {q: 0, f: 1}});
  expect(await page.evaluate(() => window.__inkscan.log.map(x => x.cardId))).toEqual(['synthetic-promo-dupe-b']);
  await page.locator('#log').scrollIntoViewIfNeeded();
  await shot(page, info, 'ambiguous-reference-explicit-candidate-only');
});

test('promo-only scope blocks a numeric base footer rather than auto-adding its ordinary printing', async ({page}) => {
  const ordinary = await resolve(page, '49/204 · EN · 12', 'all');
  expect(ordinary.status).toBe('exact'); expect(ordinary.id).toBe('synthetic-promo-base-49');
  const blocked = await resolve(page, '49/204 · EN · 12', 'promo');
  expect(blocked.status).toBe('blocked'); expect(blocked.id).toBeNull();
  await page.locator('#scanPrintingScope').selectOption('promo');
  await exactSearch(page, 'P3 49', 'synthetic-promo-p3-49');
  await expectEmpty(page);
});

test('explicit manual Add preserves every selected finish on the exact promo, never its base printing', async ({page}, info) => {
  await page.locator('#scanPrintingScope').selectOption('promo');
  await exactSearch(page, 'P3 49', 'synthetic-promo-p3-49');
  for (const finish of ['normal', 'foil', 'rainbow']) {
    await page.locator('#scanFinish').selectOption(finish);
    await page.locator('#qres button[data-act="add"][data-id="synthetic-promo-p3-49"]').click();
    await expect(page.locator('#log [data-log-finish]').first()).toHaveValue(finish);
  }
  expect((await saved(page)).inv).toEqual({'synthetic-promo-p3-49': {q: 1, f: 1, rf: 1}});
  expect(await page.evaluate(() => window.__inkscan.log.map(x => x.cardId))).toEqual(Array(3).fill('synthetic-promo-p3-49'));
  await expect(page.locator('#tCopies')).toHaveText('3');
  await expectNoCloud(page);
  await page.reload(); await waitForApp(page);
  expect((await saved(page)).inv).toEqual({'synthetic-promo-p3-49': {q: 1, f: 1, rf: 1}});
  await page.locator('[data-tab="coll"]').click();
  await page.locator('#coll [data-card="synthetic-promo-p3-49"]').click();
  await expect(page.locator('#ownBox')).toContainText('Rainbow foil');
  await page.locator('#ownBox').scrollIntoViewIfNeeded();
  await shot(page, info, 'exact-promo-three-separate-finishes');
});

test('repeated printing-scope changes and modal cancellation never create ownership or reset finish', async ({page}, info) => {
  await page.locator('#scanFinish').selectOption('rainbow');
  for (const scope of ['promo', 'all', 'promo', 'all', 'promo']) {
    await page.locator('#scanPrintingScope').selectOption(scope);
    await expect(page.locator('#scanFinish')).toHaveValue('rainbow');
    await exactSearch(page, 'P3 49', 'synthetic-promo-p3-49');
    await expectEmpty(page);
  }
  await page.locator('#qres [data-card="synthetic-promo-p3-49"]').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Synthetic Needle');
  await expect(page.locator('#sheetBody')).toContainText('Synthetic Promo Set 3');
  await page.locator('#sheetClose').click(); await closed(page);
  await page.locator('#q').fill('');
  await expect(page.locator('#qres button[data-act="add"]')).toHaveCount(8);
  await expectEmpty(page);
  await page.locator('#scanPrintingScope').scrollIntoViewIfNeeded();
  await shot(page, info, 'promo-scope-independent-from-rainbow-finish');
});

test('OCR-text review shows persistent actionable warnings and manual handoff never auto-adds', async ({page}, info) => {
  await page.locator('#scanPrintingScope').selectOption('promo');
  await page.locator('#scanFinish').selectOption('rainbow');
  for (const [text, status, query, count, message] of [
    ['11/PD1 · EN · 14', 'missing', 'PD1 11', 0, /not in this catalog/i],
    ['88/P3 · EN · 12', 'ambiguous', 'P3 88', 2, /multiple catalog printings/i],
    ['49/204 · EN · 12', 'blocked', '12 49', 0, /regular-set printing/i]
  ]) {
    expect(await page.evaluate(t => window.__inkscan.reviewNumberLine(t).status, text)).toBe(status);
    await expect(page.locator('#scanResolution')).toBeVisible();
    await expect(page.locator('#scanResolution')).toContainText(message);
    await expect(page.locator('#scanResolution')).toContainText(/nothing was added/i);
    await expect(page.locator('#scanManual')).toBeVisible();
    // A later unreadable frame cannot erase the unresolved printing warning.
    expect(await page.evaluate(() => window.__inkscan.reviewNumberLine('unreadable fixture').status)).toBe('unrecognized');
    await expect(page.locator('#scanResolution')).toContainText(message);
    await page.locator('#scanResolution').scrollIntoViewIfNeeded();
    await shot(page, info, `promo-${status}-manual-review-warning`);
    await page.locator('#scanManual').click();
    await expect(page.locator('#q')).toHaveValue(query);
    await expect(page.locator('#qres button[data-act="add"]')).toHaveCount(count);
    await expect(page.locator('#scanFinish')).toHaveValue('rainbow');
    await expectEmpty(page);
  }
  expect(await page.evaluate(() => window.__inkscan.reviewNumberLine('49/P3 · EN · 12').status)).toBe('exact');
  await expect(page.locator('#scanResolution')).toBeHidden();
  await expect(page.locator('#scanManual')).toBeHidden();
  await expectEmpty(page);
});

async function useActualPublicCatalog(page, context) {
  const raw = await fs.readFile(path.join(__dirname, '../../../cards.json'), 'utf8');
  const supplement = await fs.readFile(path.join(__dirname, '../../../promo-catalog.json'), 'utf8');
  await context.route('**/cards.json', route => route.fulfill({status: 200, contentType: 'application/json', body: raw}));
  await context.route('**/promo-catalog.json', route => route.fulfill({status: 200, contentType: 'application/json', body: supplement}));
  await expectNoCloud(page);
  await page.reload(); await waitForApp(page);
  return JSON.parse(raw);
}
async function exportCsv(page, info, filename) {
  await page.locator('[data-tab="coll"]').click();
  await page.locator('#toolsBtn').click();
  const event = page.waitForEvent('download');
  await page.locator('[data-tool="csv"]').click();
  const download = await event, destination = info.outputPath(filename);
  await download.saveAs(destination);
  const csv = await fs.readFile(destination, 'utf8');
  await info.attach(filename, {path: destination, contentType: 'text/csv'});
  await page.locator('#sheetClose').click(); await closed(page);
  return csv;
}
function csvRows(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (char !== '\r' && char !== '\uFEFF') cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  expect(quoted, 'CSV quotation must terminate').toBe(false);
  return rows;
}

test('actual public catalog resolves the verified supplemental promo without inferring ownership', async ({page, context}, info) => {
  const catalog = await useActualPublicCatalog(page, context);
  const p3 = catalog.cards.find(c => c.s === 'P3' && c.c === '1');
  const special = catalog.cards.find(c => c.s === 'DIS' && c.r !== 'Promo');
  expect(p3).toBeTruthy(); expect(special).toBeTruthy();
  // The Lorcast base file is untouched; the exact promo arrives from a separate provider.
  expect(catalog.cards.some(c => c.s === 'PD1' && c.c === '11')).toBe(false);
  const known = await resolve(page, '1/P3 · EN · 9');
  expect(known.status).toBe('exact'); expect(known.id).toBe(p3.id);
  const supplemental = await resolve(page, '11/PD1 · EN · 14');
  expect(supplemental.status).toBe('exact'); expect(supplemental.id).toBe('tcgplayer_722993');
  const details = await page.evaluate(() => {
    const c = window.__inkscan.resolveNumberLine('11/PD1 · EN · 14').card;
    return {id: c.id, s: c.s, c: c.c, p: c.p, pf: c.pf, prf: c.prf, iv: c.iv, provider: c.supplemental.provider,
      productId: c.supplemental.productId, language: c.supplemental.language, printedSet: c.supplemental.printedSet,
      stamp: c.supplemental.stamp, rawSubtype: c.supplemental.rawSubtype};
  });
  expect(details).toEqual({id: 'tcgplayer_722993', s: 'PD1', c: '11', p: null, pf: null, prf: null, iv: null,
    provider: 'TCGplayer', productId: 722993, language: 'EN', printedSet: '14', stamp: 'Hyperia City', rawSubtype: 'Holofoil'});
  await page.locator('#scanPrintingScope').selectOption('promo');
  await exactSearch(page, `${special.s} ${special.c}`, special.id);
  await exactSearch(page, 'PD1 11', 'tcgplayer_722993');
  await page.locator('#qres [data-card="tcgplayer_722993"]').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Above the Crowd');
  await expect(page.locator('#sheetBody')).toContainText('not a Lorcast ID');
  await expect(page.locator('#sheetBody')).toContainText('TCGplayer');
  await expect(page.locator('#sheetBody')).toContainText('Hyperia');
  await expectEmpty(page);
  await expect(page.locator('#sheetBody .big img')).toHaveCount(0);
  await page.locator('#sheetBody .kv dd').filter({hasText: 'tcgplayer_722993'}).scrollIntoViewIfNeeded();
  await shot(page, info, 'verified-supplemental-promo-zero-owned');
});

test('supplemental promo CSV retains exact provider identity, stamp, provenance and selected finishes on restore', async ({page, context}, info) => {
  await useActualPublicCatalog(page, context);
  await page.locator('#scanPrintingScope').selectOption('promo');
  await exactSearch(page, 'PD1 11', 'tcgplayer_722993');
  for (const finish of ['normal', 'rainbow']) {
    await page.locator('#scanFinish').selectOption(finish);
    await page.locator('#qres button[data-act="add"][data-id="tcgplayer_722993"]').click();
  }
  const expected = {'tcgplayer_722993': {q: 1, f: 0, rf: 1}};
  expect((await saved(page)).inv).toEqual(expected);
  await expect(page.locator('#tValue')).toHaveText('$0 (partial)');
  await expect(page.locator('#tValue')).toHaveAttribute('title', /2 copies unpriced/);
  const csv = await exportCsv(page, info, 'synthetic-owned-supplemental-promo.csv');
  const [header, ...rows] = csvRows(csv);
  expect(rows).toHaveLength(2);
  for (const name of ['Printing ID', 'Provider', 'Printing note', 'Provenance URL']) expect(header).toContain('InkScan v6 ' + name);
  expect(header).not.toContain('InkScan v6 Lorcast ID');
  expect(new Set(header).size).toBe(header.length);
  const column = name => header.indexOf('InkScan v6 ' + name);
  expect(rows.map(row => row[column('Finish')]).sort()).toEqual(['Normal', 'Rainbow Foil']);
  for (const row of rows) {
    expect(row[column('Printing ID')]).toBe('tcgplayer_722993');
    expect(row[column('Provider')]).toContain('TCGplayer');
    expect(row[column('Printing note')]).toContain('Hyperia');
    expect(row[column('Provenance URL')]).toMatch(/^https:\/\//);
    expect(row[column('TCGplayer Product ID')]).toBe('722993');
    expect(row[column('Quantity')]).toBe('1');
    expect(row[column('Market Price')]).toBe('');
    expect(row[column('Total Value')]).toBe('');
  }
  // Change only disposable local ownership, then restore the exported exact identity.
  await page.locator('#coll [data-card="tcgplayer_722993"]').click();
  await page.getByRole('button', {name: 'One more normal', exact: true}).click();
  await page.locator('#sheetClose').click(); await closed(page);
  expect((await saved(page)).inv['tcgplayer_722993'].q).toBe(2);
  await page.locator('#fileIn').setInputFiles({name: 'synthetic-owned-supplemental-promo.csv', mimeType: 'text/csv', buffer: Buffer.from(csv)});
  await expect(page.locator('#sheetTitle')).toHaveText('Review device restore');
  await expect(page.locator('#sheetBody')).toContainText('2 physical cards');
  await page.locator('#confirmRestore').click(); await closed(page);
  expect((await saved(page)).inv).toEqual(expected);
  const restoredCsv = await exportCsv(page, info, 'synthetic-restored-supplemental-promo.csv');
  expect(csvRows(restoredCsv)).toEqual([header, ...rows]);
  await shot(page, info, 'supplemental-promo-restored-exact-provider-identity');
});

test('every promo search result is reachable through Show next 30 and scope changes reset pagination without adding', async ({page, context}, info) => {
  const catalog = syntheticCatalog();
  const template = catalog.cards.find(c => c.id === 'synthetic-promo-p3-49');
  for (let i = 0; i < 65; i++) catalog.cards.push({...template, id: `synthetic-promo-page-${i}`, c: String(200 + i), n: 'Synthetic Pagination Promo', v: `Result ${i + 1}`});
  await context.route('**/cards.json', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(catalog)}));
  await expectNoCloud(page); await page.reload(); await waitForApp(page);
  await page.locator('#scanFinish').selectOption('rainbow');
  await page.locator('#scanPrintingScope').selectOption('promo');
  await expect(page.locator('#qres button[data-act="add"]')).toHaveCount(30);
  await expect(page.locator('#qMore')).toHaveText('Show next 30 printings');
  await page.locator('#qMore').click();
  await expect(page.locator('#qres button[data-act="add"]')).toHaveCount(60);
  await expect(page.locator('#qMore')).toHaveText('Show next 13 printings');
  await page.locator('#qMore').click();
  await expect(page.locator('#qres button[data-act="add"]')).toHaveCount(73);
  await expect(page.locator('#qMore')).toHaveCount(0);
  const allIds = await resultIds(page);
  expect(new Set(allIds).size).toBe(73);
  for (let i = 0; i < 65; i++) expect(allIds).toContain(`synthetic-promo-page-${i}`);
  await expectEmpty(page);
  await page.locator('#scanPrintingScope').selectOption('all');
  await expect(page.locator('#qres')).toBeHidden();
  await page.locator('#scanPrintingScope').selectOption('promo');
  await expect(page.locator('#qres button[data-act="add"]')).toHaveCount(30);
  await expect(page.locator('#scanFinish')).toHaveValue('rainbow');
  await search(page, 'Synthetic Pagination Promo');
  await expect(page.locator('#qres button[data-act="add"]')).toHaveCount(30);
  await expect(page.locator('#qres')).toContainText('Showing 30 of 65 matching printings');
  await page.locator('#qMore').click();
  await expect(page.locator('#qres button[data-act="add"]')).toHaveCount(60);
  await exactSearch(page, 'P3 264', 'synthetic-promo-page-64');
  await expect(page.locator('#qMore')).toHaveCount(0);
  await expectEmpty(page);
  await page.locator('#qres').scrollIntoViewIfNeeded();
  await shot(page, info, 'promo-final-page-printing-reachable-without-add');
});

test('mixed incomplete footer references remain ambiguous and cannot become an automatic base-card match', async ({page}, info) => {
  const text = '43/P3 EN 1/204 EN12';
  for (const scope of ['all', 'promo']) {
    const result = await resolve(page, text, scope);
    expect(result.status).toBe('ambiguous');
    expect(result.id).toBeNull();
    expect(result.reference).toBeNull();
  }
  expect(await page.evaluate(t => window.__inkscan.parseLine(t), text)).toBeNull();
  expect(await page.evaluate(t => window.__inkscan.reviewNumberLine(t).status, text)).toBe('ambiguous');
  await expect(page.locator('#scanResolution')).toContainText('Multiple printing references');
  await page.locator('#scanManual').click();
  await expect(page.locator('#q')).toHaveValue('');
  await expectEmpty(page);
  await page.locator('#scanResolution').scrollIntoViewIfNeeded();
  await shot(page, info, 'mixed-footer-ambiguity-no-automatic-base-add');
});

test('fresh exact promo Holofoil quote values generic foil only; stale or mismatched evidence stays unpriced', async ({page, context}, info) => {
  const supplement = JSON.parse(await fs.readFile(path.join(__dirname, '../../../promo-catalog.json'), 'utf8'));
  const entry = supplement.records.find(record => record.id === 'tcgplayer_722993');
  expect(entry).toBeTruthy();
  const {n, v, s, c, r, language, printedSet, stamp} = entry.printing;
  const built = new Date(Date.now() - 60000).toISOString();
  const quote = {
    printingId: entry.id, tcgplayerProductId: 722993, tcgplayerGroupId: 23234,
    expectedPrinting: {n, v, s, c, r, language, printedSet, stamp},
    rawSubtype: 'Holofoil', inventoryFinish: 'foil', physicalFinish: null,
    displayLabel: 'Holofoil (provider label)', provider: 'TCGplayer via TCGCSV', currency: 'USD',
    availableRawSubtypes: ['Holofoil'], marketPrice: 4.20,
    sourcePriceRow: {productId: 722993, subTypeName: 'Holofoil', marketPrice: 4.20},
    sourceURL: 'https://tcgcsv.com/tcgplayer/71/23234/prices',
    sourceBuildURL: 'https://tcgcsv.com/last-updated.txt', buildAsOf: built
  };
  const routeQuote = async value => {
    const file = {schemaVersion: 1, currency: 'USD', provider: 'TCGplayer via TCGCSV', buildAsOf: value.buildAsOf,
      quotes: {}, promoFoilQuotes: {'tcgplayer_722993|provider:Holofoil': value}};
    await context.route('**/finish-quotes.json', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(file)}));
  };
  await routeQuote(quote);
  await useActualPublicCatalog(page, context);
  await page.locator('#scanPrintingScope').selectOption('promo');
  await exactSearch(page, 'PD1 11', entry.id);
  for (const finish of ['normal', 'foil', 'rainbow']) {
    await page.locator('#scanFinish').selectOption(finish);
    const result = page.locator(`#qres [data-card="${entry.id}"] .m`);
    await expect(result).toContainText(finish === 'foil' ? '$4.20' : '—');
    if (finish !== 'foil') await expect(result).not.toContainText('$4.20');
    await page.locator(`#qres button[data-act="add"][data-id="${entry.id}"]`).click();
  }
  const expected = {[entry.id]: {q: 1, f: 1, rf: 1}};
  expect((await saved(page)).inv).toEqual(expected);
  await expect(page.locator('#tValue')).toHaveAttribute('title', /2 copies unpriced/);
  await page.locator('[data-tab="coll"]').click();
  await page.locator('#cFinish').selectOption('foil');
  await expect(page.locator('#cValue')).toContainText('Estimated value: $4.20 for 1 owned copies');
  await expect(page.locator('#cValue')).not.toContainText('unpriced');
  await page.locator('#cValue').scrollIntoViewIfNeeded();
  await shot(page, info, 'synthetic-exact-promo-foil-quote-not-rainbow');
  for (const finish of ['normal', 'rainbow']) {
    await page.locator('#cFinish').selectOption(finish);
    await expect(page.locator('#cValue')).toContainText('Partial estimate: $0.00 for 1 owned copies');
    await expect(page.locator('#cValue')).toContainText('1 copies unpriced');
  }
  const rejectedQuotes = [
    {...quote, buildAsOf: new Date(Date.now() - 8 * 86400000).toISOString()},
    {...quote, expectedPrinting: {...quote.expectedPrinting, stamp: 'Synthetic incorrect stamp'}}
  ];
  for (const rejected of rejectedQuotes) {
    await routeQuote(rejected);
    await page.locator('[data-tab="scan"]').click();
    await expectNoCloud(page); await page.reload(); await waitForApp(page);
    expect((await saved(page)).inv).toEqual(expected);
    await expect(page.locator('#tValue')).toHaveText('$0 (partial)');
    await expect(page.locator('#tValue')).toHaveAttribute('title', /3 copies unpriced/);
    await page.locator('[data-tab="coll"]').click();
    await page.locator('#cFinish').selectOption('foil');
    await expect(page.locator('#cValue')).toContainText('Partial estimate: $0.00 for 1 owned copies');
    await expect(page.locator('#cValue')).toContainText('1 copies unpriced');
  }
  await page.locator('#cValue').scrollIntoViewIfNeeded();
  await shot(page, info, 'mismatched-promo-quote-rejected-no-price-fallback');
});
