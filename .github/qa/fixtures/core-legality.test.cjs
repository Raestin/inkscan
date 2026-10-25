'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../../..');
const runtime=fs.existsSync(path.join(__dirname,'legality.js'))?__dirname:root;
const L=require(path.join(runtime,'legality.js')),C=require(path.join(runtime,'catalog.js'));
const clone=value=>JSON.parse(JSON.stringify(value));
const rules=()=>JSON.parse(fs.readFileSync(path.join(root,'core-rules.json')));
const NOW=Date.parse('2026-10-25T18:00:00Z');
const card=(id,n='Sample',v='',s='14',c='1',extra={})=>({id,n,v,s,c,r:'Rare',lc:0,...extra});
const index=(cards,r=rules(),now=NOW)=>L.createIndex({cards},r,now);
function frozen(value){if(value&&typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value);}return value;}

test('all official-source fixtures resolve by full identity and eligible printing anchor, not provider lc',()=>{
  const catalog=C.merge(JSON.parse(fs.readFileSync(path.join(root,'cards.json'))),JSON.parse(fs.readFileSync(path.join(root,'promo-catalog.json')))).catalog;
  const idx=L.createIndex(catalog,rules(),NOW),byId=new Map(catalog.cards.map(c=>[c.id,c]));
  // Source-backed cases: research core-legality-source-backed-fixtures.json;
  // official sources remain in the shipping core-rules.json provenance.
  const cases=[
    ['crd_cc8e7afe0f344c32b64446caf7b31456','legal','reprinted-identity','11'],
    ['crd_5423fd35369b41ebbfff99eeb1928fc4','legal','current-set-identity','11'],
    ['crd_2a6cd27f6ba44515827ed800f377cdbd','legal','reprinted-identity','9'],
    ['crd_fcb0a2f9a4044b86bba8e0ff3ade2988','not_legal','rotated-identity',null],
    ['crd_e0ddeb51820a4e46840686240e076a57','not_legal','rotated-identity',null],
    ['crd_5359fd5a9e4f43568d3419a2cd737640','not_legal','rotated-identity',null],
    ['crd_ad5100c1182246a1a864abd42423f715','legal','current-set-identity','14'],
    ['crd_3515b2c02dd04daa83e5f77d46738b97','not_legal','rotated-identity',null],
    ['crd_c76ace4ba1a9432983d8a400072a04d2','not_legal','special-format-only',null],
    ['tcgplayer_722993','legal','reprinted-identity','14']
  ];
  for(const [id,status,reason,set]of cases){assert(byId.has(id),id);const result=idx.status(byId.get(id));assert.equal(result.status,status,id);assert.equal(result.reason,reason,id);assert.equal(result.anchor?.setCode??null,set,id);assert.equal(result.verifiedAt,'2026-10-25');assert.match(result.source,/Tournament-Rules/);}
  const future=card('future','Hypothetical New Card','New Version','15'),unknown=card('unknown','Unknown Promo','','NEWPROMO');
  for(const c of [future,unknown])assert.equal(index([c]).status(c).status,'unknown');
});
test('finite released sets 9–14 are eligible; future/unknown sets never inherit an anchor',()=>{
  const rows=['9','10','11','12','13','14','15','99','NEWPROMO'].map(s=>card('set'+s,'Same','Version',s));
  const idx=index(rows);
  for(const c of rows){assert.equal(idx.status(c).status,['9','10','11','12','13','14'].includes(c.s)?'legal':'unknown',c.s);}
});
test('rotated printing and known promo inherit exact reprint while wrong version remains rotated',()=>{
  const rows=[card('old','Belle','Inventive Engineer','1'),card('new','Belle','Inventive Engineer','9'),card('wrong','Belle','Apprentice Inventor','2'),card('promo','Belle','Apprentice Inventor','P3')];
  const idx=index(rows);assert.equal(idx.status(rows[0]).reason,'reprinted-identity');assert.equal(idx.status(rows[0]).anchor.id,'new');
  assert.equal(idx.status(rows[2]).reason,'rotated-identity');assert.equal(idx.status(rows[3]).reason,'rotated-identity');
});
test('identity normalizer permits only NFC, whitespace/case and typographic apostrophe equivalence',()=>{
  const rows=[card('anchor','Café’s  Song','The   Best','14'),card('old'," CAFE\u0301'S\t SONG ",' the best ','1')];
  assert.equal(index(rows).status(rows[1]).status,'legal');
  for(const [n,v]of [["Cafe's Song",'The Best'],['Café’s Song!','The Best'],['Café’s Song','Best'],['Café’s Song','"The Best"'],['Café’s Song','']]){
    const c=card('different',n,v,'1');assert.equal(index([rows[0],c]).status(c).status,'not_legal',JSON.stringify([n,v]));
  }
});
test('identity tuple encoding does not conflate names or versions containing delimiters',()=>{
  const a=card('a','A|B','C','14'),b=card('b','A','B|C','1');assert.equal(index([a,b]).status(b).status,'not_legal');
});
test('Core bans beat every current/old/promo reprint; Infinity reference ban is not a Core ban',()=>{
  const rows=[card('a','Sample','Version','14'),card('b','sample','version','1'),card('p','Sample','Version','P1')],r=rules();r.bannedGameplayIdentities=[{name:' SAMPLE ',version:'Version'}];
  for(const c of rows){const result=index(rows,r).status(c);assert.equal(result.status,'not_legal');assert.equal(result.reason,'banned');assert.equal(result.anchor,null);}
  const h=card('h','Hiram Flaversham','Toymaker','14');assert.equal(index([h]).status(h).status,'legal');
});
test('format-only Coconut and Q3 are excluded even with an exact eligible anchor',()=>{
  const rows=[card('a','Sample','','14'),card('b','Sample','','Coconut'),card('c','Sample','','Q3')];const idx=index(rows);
  for(const c of rows.slice(1))assert.equal(idx.status(c).reason,'special-format-only');
});
test('known promo with no exact regular-set gameplay identity is unknown',()=>{
  const p=card('p','Unresolved Promo','','PD1');assert.equal(index([p]).status(p).reason,'unresolved-identity');
});
function supplementalPair(){
  const a=card('crd_anchor','Above the Crowd','','14','95');
  const p=card('tcgplayer_722993',a.n,a.v,'PD1','11',{r:'Promo',t:722993,supplemental:{schemaVersion:1,game:'lorcana',provider:'TCGplayer',productId:722993,language:'EN',printedSet:'14',stamp:'Hyperia City',gameplaySource:{id:a.id,expectedIdentity:{n:a.n,v:a.v,s:a.s,c:a.c,r:a.r}}}});
  return [a,p];
}
test('supplemental printing requires exact verified current base source; never anchors itself',()=>{
  const [a,p]=supplementalPair();assert.equal(index([a,p]).status(p).status,'legal');
  assert.equal(index([p]).status(p).reason,'unverified-supplement');
  for(const key of ['n','v','s','c','r']){const bad=clone(p);bad.supplemental.gameplaySource.expectedIdentity[key]='wrong';assert.equal(index([a,bad]).status(bad).reason,'unverified-supplement',key);}
  for(const [key,value]of [['provider','Lorcast'],['productId',722994],['language','FR'],['printedSet','13']]){const bad=clone(p);bad.supplemental[key]=value;assert.equal(index([a,bad]).status(bad).reason,'unverified-supplement',key);}
  const bad=clone(p);delete bad.supplemental;assert.equal(index([a,bad]).status(bad).reason,'unverified-supplement');
});
test('missing, malformed and invalid policy always produce unknown rather than false illegality',()=>{
  const c=card('a');
  for(const r of [null,undefined,{},[],{...rules(),schemaVersion:2},{...rules(),format:'infinity'}]){const idx=L.createIndex({cards:[c]},r,NOW);assert.equal(idx.info.valid,false);assert.equal(idx.status(c).status,'unknown');}
  for(const change of [r=>r.verifiedAt='bad',r=>r.verifiedAt='2026-02-30',r=>r.reviewDue='2027-12-31',r=>r.primarySourceURL='javascript:alert(1)',r=>r.sources[0].url='javascript:alert(1)',r=>r.eligibleReleasedSetCodes.push('9'),r=>r.rotatedSetCodes.push('9'),r=>r.knownPromoSetCodes.push('14'),r=>r.bannedGameplayIdentities=[{name:'Missing version'}],r=>r.eligibleReleasedSetCodes.push('15')]){
    const r=rules();change(r);assert.equal(index([c],r).status(c).reason,'rules-invalid');
  }
});
test('future, expired and unreleased policies fail closed with explicit maintenance reason',()=>{
  const c=card('a'),r=rules(),before=Date.parse('2026-10-24T23:59:59Z'),due=Date.parse('2026-11-24T00:00:00Z');
  assert.equal(index([c],r,before).status(c).reason,'rules-future');
  assert.equal(index([c],r,due-1).status(c).status,'legal');
  assert.equal(index([c],r,due).status(c).reason,'rules-expired');
  const future=rules();future.newestVerifiedRelease.legalFrom='2026-12-01';assert.equal(index([c],future).status(c).reason,'rules-invalid');
  assert.match(index([c]).info.maintenanceNote,/not an official rules expiration/);
});
test('default clock expires status and info together while tab remains open',()=>{
  let now=NOW;class Clock extends Date{static now(){return now;}}
  const context={URL,Date:Clock};vm.runInNewContext(fs.readFileSync(path.join(runtime,'legality.js'),'utf8'),context);
  const c=card('a'),idx=context.InkLegality.createIndex({cards:[c]},rules());assert.equal(idx.status(c).status,'legal');assert.equal(idx.info.valid,true);
  now=Date.parse('2026-11-24T00:00:00Z');assert.equal(idx.status(c).reason,'rules-expired');assert.equal(idx.info.valid,false);assert.equal(idx.info.reason,'rules-expired');
});
test('invalid/duplicate catalog IDs and altered/unindexed cards cannot borrow legal status',()=>{
  const c=card('a');assert.equal(index([c,clone(c)]).status(c).reason,'catalog-invalid');
  assert.equal(L.createIndex(null,rules(),NOW).status(c).status,'unknown');
  assert.equal(index([c]).status({...c,id:'other'}).reason,'unresolved-printing');
  assert.equal(index([c]).status({...c,v:'Other'}).reason,'unresolved-printing');
});
test('inputs, raw lc, prices, quantities and policy remain untouched; returned metadata is isolated',()=>{
  const c=frozen(card('a','Test','','14','1',{lc:0,p:4,q:2,f:3,rf:1})),r=frozen(rules()),catalog=frozen({cards:[c],inv:{a:{q:2,f:3,rf:1}}});
  const before=JSON.stringify({catalog,r}),idx=L.createIndex(catalog,r,NOW),result=idx.status(c);assert.equal(result.status,'legal');
  result.anchor.name='Changed';idx.info.sources[0].url='Changed';assert.equal(idx.status(c).anchor.name,'Test');assert.equal(JSON.stringify({catalog,r}),before);
});
