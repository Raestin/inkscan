'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const manifest = require('./baseline-manifest.json');
const read = name => fs.readFileSync(path.join(root, name));
for (const [name, sha] of Object.entries(manifest.unchangedFiles)) {
  const b = read(name);
  assert.equal(crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'), sha, `Production catalog/asset changed: ${name}`);
}
const app = read('app.js').toString();
for (const [name, sha] of Object.entries(manifest.configurationStatementSha256)) {
  const statement = app.match(new RegExp(`const ${name} = '[^']*';`))?.[0];
  assert(statement, `Missing configuration statement: ${name}`);
  assert.equal(crypto.createHash('sha256').update(statement).digest('hex'), sha, `Existing production configuration must remain exact: ${name}`);
}
assert(!app.includes('QA_DISABLED_NO_CREDENTIAL'));
assert(!app.includes('https://example.invalid'));
assert(app.includes("location.origin!=='https://raestin.github.io'"));
assert(app.includes("location.pathname.startsWith('/inkscan/')"));
const catalog = JSON.parse(read('cards.json'));
assert.equal(catalog.cards.length, manifest.catalogPrintings);
assert.equal(crypto.createHash('sha256').update(read('cards.json')).digest('hex'),manifest.catalogSha256);
const original=require('./catalog-baseline-identities.json'), byId=new Map(catalog.cards.map(c=>[c.id,c]));
assert.equal(byId.size,catalog.cards.length,'Duplicate catalog identity');
assert.equal(original.length,manifest.originalCatalogPrintings);
for(const prior of original){const now=byId.get(prior.id);assert(now,`Original printing disappeared: ${prior.id}`);for(const key of ['n','v','s','c'])assert.equal(now[key],prior[key],`Printing identity changed: ${prior.id} ${key}`);}
assert.equal(crypto.createHash('sha256').update(read('finish-quotes.json')).digest('hex'),manifest.finishQuotesSha256);
const quotes=JSON.parse(read('finish-quotes.json'));
assert.equal(Object.keys(quotes.quotes).length,manifest.finishQuoteEntries);
assert.equal(quotes.productMappings.length,manifest.verifiedProductMappings);
for(const mapping of quotes.productMappings){const card=byId.get(mapping.printingId);assert(card);for(const [key,value] of Object.entries(mapping.expectedIdentity))assert.equal(card[key],value);assert(card.t==null||card.t===mapping.tcgplayerProductId);assert(Number.isSafeInteger(mapping.tcgplayerProductId)&&mapping.tcgplayerProductId>0);}
const safety=require('../../safety.js');
for(const [key,quote] of Object.entries(quotes.quotes)){assert.equal(key,quote.printingId+'|rainbow');assert.notEqual(safety.validatedRainbowQuote(byId.get(quote.printingId),quote,new Date(quote.observedAt).getTime()),null);}

assert(catalog.cards.every(c => !String(c.id).startsWith('synthetic-')));
const html = read('index.html').toString(), sw = read('sw.js').toString();
assert(html.includes('safety.js?v=7') && html.includes('app.js?v=7') && html.includes('app.css?v=7'));
assert(html.indexOf('safety.js?v=7') < html.indexOf('app.js?v=7'));
assert(sw.includes("const CACHE = 'inkscan-v7'"));
assert(sw.includes('safety.js?v=7'));
assert(!/skipWaiting\s*\(|clients\.claim\s*\(/.test(sw));
assert(!/localStorage\.(clear|removeItem)\s*\(/.test(app), 'Do not erase saved legacy state during this release');
for (const name of ['qa-seed.html','tests.cjs','household-schema.proposal.sql','HOUSEHOLD-PROPOSAL.md']) assert(!fs.existsSync(path.join(root,name)), `Test/proposal file must not enter production root: ${name}`);
console.log(`Release verified: ${catalog.cards.length}-printing verified catalog with all original identities retained, ${Object.keys(manifest.unchangedFiles).length} unchanged catalog/assets, unchanged production configuration, v7 assets, no forced worker takeover or legacy deletion.`);
