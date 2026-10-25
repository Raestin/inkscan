'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const manifest = require('./baseline-manifest.json');
const read = name => fs.readFileSync(path.join(root, name));
const placeholderBaseline=require('./placeholder-baseline.json');
for(const [name,sha] of Object.entries(placeholderBaseline.unchangedRuntimeSha256)) {
  assert.equal(crypto.createHash('sha256').update(read(name)).digest('hex'),sha,`Placeholder-only release changed unrelated runtime: ${name}`);
}
for (const [name, sha] of Object.entries(manifest.unchangedFiles)) {
  const b = read(name);
  assert.equal(crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'), sha, `Production catalog/asset changed: ${name}`);
}
const app = read('app.js').toString();
assert.equal(crypto.createHash('sha256').update(app.split('\n').find(line=>line.startsWith('function imgUrl('))).digest('hex'),placeholderBaseline.imgUrlStatementSha256,'Existing valid-card image URLs must be unchanged');
assert(!app.includes('validatedArtworkURL') && !app.includes('LorcanaPlayer'));
assert(!fs.existsSync(path.join(__dirname,'download-public-art.cjs')),'The cancelled external-image downloader must not ship');
const placeholder=read('no-image.svg').toString();
assert(placeholder.includes('viewBox="0 0 734 1024"'));
assert(!/<(?:script|foreignObject|image)\b|\b(?:href|xlink:href)\s*=|on[a-z]+\s*=/i.test(placeholder),'Placeholder must be original self-contained SVG, not external artwork or script');
assert(read('app.css').toString().includes('no-image.svg'));
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
assert(html.includes('safety.js?v=9') && html.includes('app.js?v=9') && html.includes('app.css?v=9'));
assert(html.indexOf('safety.js?v=9') < html.indexOf('app.js?v=9'));
assert(sw.includes("const CACHE = 'inkscan-v9'"));
assert(sw.includes("'no-image.svg'"));
assert(sw.includes('safety.js?v=9'));
assert(html.includes('catalog.js?v=9') && html.indexOf('catalog.js?v=9') < html.indexOf('app.js?v=9'));
assert(sw.includes('catalog.js?v=9') && sw.includes('promo-catalog.json'));
assert.equal(crypto.createHash('sha256').update(read('promo-catalog.json')).digest('hex'),manifest.promoCatalogSha256);
const supplemental=JSON.parse(read('promo-catalog.json')), merged=require('../../catalog.js').merge(catalog,supplemental);
assert.deepEqual(merged.warnings,[]);
assert.deepEqual(supplemental.records.map(x=>x.id).sort(),manifest.supplementalPrintingIds.slice().sort());
assert.equal(merged.catalog.cards.length,catalog.cards.length+manifest.supplementalPrintingIds.length);
assert.equal(Object.keys(quotes.promoFoilQuotes).length,manifest.promoFoilQuoteEntries);
for(const [key,quote] of Object.entries(quotes.promoFoilQuotes)){assert.equal(key,quote.printingId+'|provider:Holofoil');assert.notEqual(require('../../catalog.js').validatedFoilQuote(merged.catalog.cards.find(c=>c.id===quote.printingId),quote,new Date(quote.observedAt).getTime()),null);}
for(const id of manifest.supplementalPrintingIds){const c=merged.catalog.cards.find(x=>x.id===id);assert(c?.supplemental);for(const key of ['p','pf','prf','iv'])assert.equal(c[key],null);}
assert(html.includes('legality.js?v=9') && html.indexOf('legality.js?v=9') < html.indexOf('app.js?v=9'));
assert(sw.includes('legality.js?v=9') && sw.includes('core-rules.json'));
assert.equal(crypto.createHash('sha256').update(read('core-rules.json')).digest('hex'),manifest.coreRulesSha256);
const rules=JSON.parse(read('core-rules.json'));
assert.equal(rules.verifiedAt,manifest.corePolicyAsOf);assert.equal(rules.reviewDue,manifest.corePolicyReviewDue);
assert.deepEqual(rules.eligibleReleasedSetCodes,['9','10','11','12','13','14']);assert.deepEqual(rules.bannedGameplayIdentities,[]);
const coreIndex=require('../../legality.js').createIndex(merged.catalog,rules,Date.parse(manifest.corePolicyAsOf+'T18:00:00Z')), coreCounts={};
assert.equal(coreIndex.info.valid,true);for(const c of merged.catalog.cards){const status=coreIndex.status(c).status;coreCounts[status]=(coreCounts[status]||0)+1;}
assert.deepEqual(coreCounts,manifest.coreEligibilityCounts);
assert.equal(require('../../legality.js').createIndex(merged.catalog,rules,Date.parse(manifest.corePolicyReviewDue+'T00:00:00Z')).status(merged.catalog.cards[0]).status,'unknown');
assert(!app.includes('Legal deck') && !app.includes('Not legal (Infinity only)'));
assert(!/skipWaiting\s*\(|clients\.claim\s*\(/.test(sw));
assert(!/localStorage\.(clear|removeItem)\s*\(/.test(app), 'Do not erase saved legacy state during this release');
for (const name of ['qa-seed.html','tests.cjs','household-schema.proposal.sql','HOUSEHOLD-PROPOSAL.md']) assert(!fs.existsSync(path.join(root,name)), `Test/proposal file must not enter production root: ${name}`);
console.log(`Release verified: ${catalog.cards.length}-printing verified catalog with all original identities retained, ${Object.keys(manifest.unchangedFiles).length} unchanged catalog/assets, unchanged production configuration, v9 assets, no forced worker takeover or legacy deletion.`);
