'use strict';
// Finite, verified public artwork preflight. This is never a production data client.
// Executing this helper requires the source-use/publishing approval for these six
// exact images; availability of a URL is not by itself a republication license.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const InkCatalog = require('../../catalog.js');
const ART_HOST = 'lorcanaplayer.com';
const MAX_BYTES = 2 * 1024 * 1024;
// Exact six public LorcanaPlayer image URLs and bytes independently inspected.
const APPROVED = Object.freeze([
  {
    "id": "tcgplayer_722990",
    "productId": 722990,
    "url": "https://lorcanaplayer.com/wp-content/uploads/2026/09/9-PD1-EN-14-Nick-Wilde-Inquisitive-Harbormaster-Prerelease-Promo-Lorcana-Player.jpg",
    "filename": "tcgplayer_722990.jpg",
    "sha256": "c745eb3be024d78c1abc03826e3182e618887369ec6a25f0ea421ada28b94cdf",
    "width": 859,
    "height": 1200
  },
  {
    "id": "tcgplayer_722992",
    "productId": 722992,
    "url": "https://lorcanaplayer.com/wp-content/uploads/2026/09/10-PD1-EN-14-Merlin-Ink-Drop-Tinkerer-Prerelease-Promo-Lorcana-Player.jpg",
    "filename": "tcgplayer_722992.jpg",
    "sha256": "04b12a0aec536c298705f5de27002cd67550084189844aa86dd906887065384b",
    "width": 859,
    "height": 1200
  },
  {
    "id": "tcgplayer_722993",
    "productId": 722993,
    "url": "https://lorcanaplayer.com/wp-content/uploads/2026/09/11-PD1-EN-14-Above-the-Crowd-Prerelease-Promo-Lorcana-Player.jpg",
    "filename": "tcgplayer_722993.jpg",
    "sha256": "796a78786027222f3756a3d4315888f108b148da7cce4c80f7088e48920ca959",
    "width": 859,
    "height": 1200
  },
  {
    "id": "tcgplayer_722994",
    "productId": 722994,
    "url": "https://lorcanaplayer.com/wp-content/uploads/2026/09/12-PD1-EN-14-Goofy-Dancing-Superstar-Prerelease-Promo-Lorcana-Player.jpg",
    "filename": "tcgplayer_722994.jpg",
    "sha256": "16e77f4b9288374cbfe19f37beb324eeeaa207a760a4461f215a02ce92dffef6",
    "width": 859,
    "height": 1200
  },
  {
    "id": "tcgplayer_722995",
    "productId": 722995,
    "url": "https://lorcanaplayer.com/wp-content/uploads/2026/09/13-PD1-EN-14-Judy-Hopps-Day-Camp-Instructor-Prerelease-Promo-Lorcana-Player.jpg",
    "filename": "tcgplayer_722995.jpg",
    "sha256": "0ff8417484e094840eebf081f2050d5a6f5c4539e227bdca8875df5ceff69f8a",
    "width": 859,
    "height": 1200
  },
  {
    "id": "tcgplayer_722996",
    "productId": 722996,
    "url": "https://lorcanaplayer.com/wp-content/uploads/2026/09/14-PD1-EN-14-Berlioz-Tiny-Rascal-Prerelease-Promo-Lorcana-Player.jpg",
    "filename": "tcgplayer_722996.jpg",
    "sha256": "bc1a52c99013bd7de17f096f4f25768719721babf873912954ea2d09fa7e374e",
    "width": 859,
    "height": 1200
  }
].map(item => Object.freeze(item)));
const CACHE = path.join(__dirname, 'fixture/public-art');

async function readApprovedImages() {
  const root = path.resolve(__dirname, '../..');
  const base = JSON.parse(await fs.readFile(path.join(root, 'cards.json'), 'utf8'));
  const supplement = JSON.parse(await fs.readFile(path.join(root, 'promo-catalog.json'), 'utf8'));
  const cards = InkCatalog.validateSupplement(supplement, base);
  assert.equal(cards.length, APPROVED.length, 'Expected only the six reviewed supplemental printings');
  assert.deepEqual(cards.map(c => c.id).sort(), APPROVED.map(c => c.id).sort());
  return APPROVED.map(expected => {
    const card = cards.find(c => c.id === expected.id);
    assert.equal(InkCatalog.validatedArtworkURL(card), expected.url, 'Artwork metadata must match the exact reviewed printing and URL');
    return {...expected, name: card.n, version: card.v, set: card.s, collector: card.c};
  });
}
function jpegDimensions(bytes) {
  assert(bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8, 'Expected JPEG magic bytes');
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    assert.equal(bytes[offset++], 0xff, 'Malformed JPEG segment marker');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    assert(offset + 2 <= bytes.length, 'Truncated JPEG segment');
    const length = bytes.readUInt16BE(offset);
    assert(length >= 2 && offset + length <= bytes.length, 'Invalid JPEG segment length');
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      assert(length >= 8, 'Invalid JPEG frame');
      return {width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3)};
    }
    offset += length;
  }
  throw Error('JPEG dimensions unavailable');
}
function inspectImage(bytes, expected) {
  assert(bytes.length >= 10000 && bytes.length <= MAX_BYTES, 'Artwork size is outside the reviewed bounds');
  const dimensions = jpegDimensions(bytes);
  assert.equal(dimensions.width, expected.width, 'Unexpected artwork width');
  assert.equal(dimensions.height, expected.height, 'Unexpected artwork height');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256, expected.sha256, 'Artwork changed from the visually reviewed source; re-review required');
  return {...dimensions, sha256, bytes: bytes.length};
}
function downloadOne(expected) {
  assert(APPROVED.some(item => item.id === expected.id && item.url === expected.url), 'Refusing an unapproved download target');
  return new Promise((resolve, reject) => {
    const request = https.get(expected.url, {
      signal: AbortSignal.timeout(15000),
      headers: {'User-Agent': 'InkScan-exact-public-art-QA/1.0 (+https://github.com/Raestin/inkscan)', Accept: 'image/jpeg', 'Accept-Encoding': 'identity'}
    }, response => {
      // No redirects, cookies, credentials, API routes, alternate hosts or sizes.
      if (response.statusCode !== 200) { response.resume(); reject(Error(`Approved image ${expected.id} returned HTTP ${response.statusCode}; redirects are not followed`)); return; }
      if (String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'image/jpeg') { response.resume(); reject(Error('Approved image did not return image/jpeg')); return; }
      const declared = response.headers['content-length'];
      if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) { response.destroy(); reject(Error('Invalid or excessive artwork Content-Length')); return; }
      const chunks = []; let length = 0;
      response.on('data', chunk => { length += chunk.length; if (length > MAX_BYTES) response.destroy(Error('Artwork exceeded maximum bytes')); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => {
        try { const bytes = Buffer.concat(chunks); resolve({bytes, metadata: {...inspectImage(bytes, expected), status: 200, contentType: 'image/jpeg', effectiveURL: expected.url}}); }
        catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
  });
}
async function main() {
  assert.equal(process.argv.length, 2, 'No URL/path override arguments are supported');
  const expected = await readApprovedImages();
  await fs.mkdir(CACHE, {recursive: true});
  const images = [];
  for (const item of expected) {
    const result = await downloadOne(item);
    const file = path.join(CACHE, item.filename);
    await fs.writeFile(file + '.tmp', result.bytes); await fs.rename(file + '.tmp', file);
    images.push({...item, ...result.metadata});
    console.log(`Verified exact public JPEG ${item.id}: ${result.metadata.width}x${result.metadata.height}, ${result.metadata.bytes} bytes`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const index = {schemaVersion: 1, fetchedAt: new Date().toISOString(), mode: 'direct-six-exact-public-urls-no-redirects', privateUserImagesIncluded: false, images};
  await fs.writeFile(path.join(CACHE, 'index.json'), JSON.stringify(index, null, 2) + '\n');
}
module.exports = {APPROVED, ART_HOST, CACHE, readApprovedImages, jpegDimensions, inspectImage};
if (require.main === module) main().catch(error => {console.error(error.message); process.exitCode = 1;});
