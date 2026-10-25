'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const manifest = require('./production-root-manifest.json');
for (const [name, expected] of Object.entries(manifest.files)) {
  const b = fs.readFileSync(path.join(root, name));
  const actual = crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
  assert.equal(actual, expected, `Production root changed: ${name}. This QA PR must not modify it.`);
}
const app = fs.readFileSync(path.join(__dirname, 'fixture/app.js'), 'utf8');
assert(app.includes("const SB_URL = 'https://example.invalid';"));
assert(app.includes("const SB_KEY = 'QA_DISABLED_NO_CREDENTIAL';"));
assert(app.includes('function ensureCloudOrigin()'));
assert(!/https:\/\/[^'"\s]+\.supabase\.co/.test(app), 'Fixture must not contain a production Supabase URL');
assert(!/eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(app), 'Fixture must not contain a JWT');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture/cards.json'), 'utf8'));
assert.equal(db.cards.length, 120);
assert(db.cards.every(c => /^synthetic-card-\d+$/.test(c.id) && c.iv === null));
assert(db.sets.every(s => s.code === 'QA'));
console.log(`Isolation passed: ${Object.keys(manifest.files).length} production root files unchanged; 120 synthetic cards; disabled cloud credentials.`);
