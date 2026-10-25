'use strict';
// Generate the localhost QA copy from THIS release's runtime files, never from a prior app snapshot.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const fixture = path.join(__dirname, 'fixture');
const manifest = require('./baseline-manifest.json');
fs.mkdirSync(fixture, { recursive: true });
const runtime = [...Object.keys(manifest.unchangedFiles), 'app.js', 'app.css', 'index.html', 'sw.js', 'safety.js'];
for (const name of runtime) fs.copyFileSync(path.join(root,name), path.join(fixture,name));
const actual = fs.readFileSync(path.join(root,'app.js'),'utf8');
let sanitized = actual;
for (const [name, value] of Object.entries({SB_URL:'https://example.invalid',SB_KEY:'QA_DISABLED_NO_CREDENTIAL'})) {
  const pattern = new RegExp(`const ${name} = '[^']*';`, 'g');
  assert.equal([...sanitized.matchAll(pattern)].length,1);
  sanitized = sanitized.replace(pattern,`const ${name} = '${value}';`);
}
const normalize = text => text.replace(/const SB_(URL|KEY) = '[^']*';/g,'const SB_$1 = [CONFIG];');
assert.equal(normalize(sanitized),normalize(actual));
fs.writeFileSync(path.join(fixture,'app.js'),sanitized);
for (const name of ['cards.json','qa-seed.html','tests.cjs','household-contract.test.cjs','household-contract-model.cjs']) fs.copyFileSync(path.join(__dirname,'fixtures',name),path.join(fixture,name));
assert.equal(JSON.parse(fs.readFileSync(path.join(fixture,'cards.json'))).cards.length,120);
console.log('Generated isolated fixture from current production candidate; only cloud constants and catalog substituted. No production collection or session loaded.');
