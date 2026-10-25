'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const modulePath=fs.existsSync(path.join(__dirname,'catalog.js'))?path.join(__dirname,'catalog.js'):path.resolve(__dirname,'../../../catalog.js');
const InkCatalog=require(modulePath);
const clone=value=>JSON.parse(JSON.stringify(value));
const SOURCE='crd_verified_gameplay';
const PROMO='tcgplayer_722993';
const base=()=>({asof:'2026-10-25',sets:[{code:'14',name:'Hyperia City',rel:'2026-10-16'},{code:'PD1',name:'PD1',rel:'2026-07-28'}],cards:[{
  id:SOURCE,n:'Above the Crowd',v:'',s:'14',sn:'Hyperia City',c:'95',r:'Rare',i:'Emerald',t:722445,
  p:0.36,pf:2.98,prf:999,co:5,ik:1,ty:'Action/Song',cl:'',st:null,wp:null,lo:null,mv:null,
  tx:'Synthetic verified gameplay text.',fl:'Base flavor must not leak.',il:'Base artist must not leak.',iv:'base-art-version',lc:0,
  imageURL:'https://example.com/base-art.png',unrelated:{nested:true}
}]});
const supplement=()=>({schemaVersion:1,game:'lorcana',verifiedAt:'2026-10-25',records:[{
  id:PROMO,provider:'TCGplayer',productId:722993,
  printing:{n:'Above the Crowd',v:'',s:'PD1',sn:'PD1',c:'11',r:'Promo',language:'EN',printedSet:'14',stamp:'Hyperia City'},
  gameplaySource:{id:SOURCE,expectedIdentity:{n:'Above the Crowd',v:'',s:'14',c:'95',r:'Rare'}},
  evidence:[{url:'https://www.tcgplayer.com/product/722993',supports:['printing','product','gameplay','finish'],note:'Synthetic test evidence; raw Holofoil is not a finish classification.'}],
  rawSubtype:'Holofoil'
}]});
function frozen(value){if(value&&typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value);}return value;}
function rejected(changer,expected=/./){
  const b=base(),s=supplement();changer(s,b);
  assert.throws(()=>InkCatalog.validateSupplement(s,b),expected);
  const result=InkCatalog.merge(b,s);
  assert.deepEqual(result.catalog,b);
  assert.equal(result.warnings.length,1);
  assert.match(result.warnings[0],/^Supplemental catalog not applied:/);
}

test('UMD exports same isolated API in browser and Node',()=>{
  const context={URL};vm.runInNewContext(fs.readFileSync(modulePath,'utf8'),context);
  assert.deepEqual(Object.keys(context.InkCatalog),['validateSupplement','merge','validatedFoilQuote']);
  assert.equal(typeof context.InkCatalog.merge,'function');assert(Object.isFrozen(InkCatalog));
});
test('exact supplemental printing has transparent provider ID and independent print identity',()=>{
  const result=InkCatalog.merge(base(),supplement());assert.deepEqual(result.warnings,[]);
  const c=result.catalog.cards.find(c=>c.id===PROMO);
  assert.equal(result.catalog.cards.length,2);
  assert.deepEqual([c.id,c.n,c.v,c.s,c.sn,c.c,c.r,c.t],[PROMO,'Above the Crowd','','PD1','PD1','11','Promo',722993]);
  assert.deepEqual([c.supplemental.language,c.supplemental.printedSet,c.supplemental.stamp,c.supplemental.rawSubtype],['EN','14','Hyperia City','Holofoil']);
  assert.equal(c.lc,0);assert.equal(c.supplemental.gameplaySource.id,SOURCE);
});
test('no base price, artwork, artist, flavor or arbitrary fields leak to promo',()=>{
  const c=InkCatalog.merge(base(),supplement()).catalog.cards.at(-1);
  for(const key of ['p','pf','prf','iv'])assert.equal(c[key],null,key);
  for(const key of ['fl','il'])assert.equal(c[key],'',key);
  for(const key of ['imageURL','unrelated'])assert(!Object.hasOwn(c,key),key);
  for(const key of ['i','co','ik','ty','cl','st','wp','lo','mv','tx','lc'])assert.deepEqual(c[key],base().cards[0][key]);
  assert(!Object.hasOwn(c,'finish'));assert(!Object.hasOwn(c,'rainbow'));
});
test('merge is deeply nonmutating and preserves every existing base record and ID',()=>{
  const b=frozen(base()),s=frozen(supplement()),bBefore=JSON.stringify(b),sBefore=JSON.stringify(s);
  const result=InkCatalog.merge(b,s);
  assert.equal(JSON.stringify(b),bBefore);assert.equal(JSON.stringify(s),sBefore);
  assert.deepEqual(result.catalog.cards[0],b.cards[0]);
  result.catalog.cards[0].unrelated.nested=false;result.catalog.cards[1].supplemental.evidence[0].supports.push('other');
  assert.equal(b.cards[0].unrelated.nested,true);assert.equal(s.records[0].evidence[0].supports.length,4);
});
test('repeat merge is idempotent even after harmless app-derived index fields',()=>{
  const first=InkCatalog.merge(base(),supplement()).catalog;
  first.cards.at(-1).nv='above the crowd|';first.cards.at(-1).inks=['Emerald'];first.cards.at(-1).num=11;
  const again=InkCatalog.merge(first,supplement());
  assert.deepEqual(again.catalog,first);assert.deepEqual(again.warnings,[]);
});
test('cached/bundled/refreshed catalogs each regain supplement with current exact-source gameplay',()=>{
  for(const cost of [5,6,7]){
    const fresh=base();fresh.cards[0].co=cost;fresh.cards[0].p=cost*100;fresh.cards[0].iv='changed-art';
    const result=InkCatalog.merge(fresh,supplement());
    assert.equal(result.catalog.cards.at(-1).co,cost);assert.equal(result.catalog.cards.at(-1).p,null);assert.equal(result.catalog.cards.at(-1).iv,null);
  }
});
test('missing or changed exact gameplay source rejects overlay rather than guessing',()=>{
  rejected((s,b)=>{b.cards=[];},/source is unavailable/);
  for(const key of ['n','v','s','c','r'])rejected((s,b)=>{b.cards[0][key]='changed';},/source is unavailable/);
  rejected(s=>{s.records[0].printing.n='Different card';},/source is unavailable/);
  rejected(s=>{s.records[0].printing.printedSet='13';},/source is unavailable/);
});
test('source inherited gameplay values must have bounded finite exact types',()=>{
  for(const bad of [-1,1.5,101,Infinity,'5',undefined])rejected((s,b)=>{b.cards[0].co=bad;},/invalid co/);
  for(const key of ['ik','lc'])rejected((s,b)=>{b.cards[0][key]=true;},/invalid/);
  rejected((s,b)=>{b.cards[0].tx='x'.repeat(20001);},/invalid tx/);
});
test('invalid top-level version, game, date, array and extra fields are rejected',()=>{
  for(const [key,value] of [['schemaVersion',2],['schemaVersion','1'],['game','magic'],['verifiedAt','2026-02-30'],['verifiedAt','bad'],['records',{}],['records',null]])rejected(s=>{s[key]=value;});
  rejected(s=>{s.records=Array(501).fill(s.records[0]);});
  rejected(s=>{s.imageURL='https://example.com/image';});
});
test('provider namespace and numeric product identity cannot collide or coerce',()=>{
  for(const [key,value] of [['id','crd_fake'],['id','tcgplayer_722445'],['provider','Lorcast'],['productId','722993'],['productId',0],['productId',-1],['productId',1.5],['productId',2147483648],['productId',Infinity]])rejected(s=>{s.records[0][key]=value;},/provider\/product/);
});
test('full printing identity is required, bounded, and English promo only',()=>{
  for(const [key,value] of [['n',''],['v',null],['s','PD1<script>'],['c',11],['sn',''],['r','Rare'],['language','FR'],['printedSet',14],['stamp',''],['n','x'.repeat(201)]])rejected(s=>{s.records[0].printing[key]=value;},/printing identity/);
  rejected(s=>{delete s.records[0].printing.stamp;},/missing/);
});
test('prices and art supplied in any unsupported schema field are rejected',()=>{
  for(const key of ['p','pf','prf','iv','imageURL']){
    rejected(s=>{s.records[0][key]=123;},/unsupported/);
    rejected(s=>{s.records[0].printing[key]=null;},/unsupported/);
  }
});
test('HTTPS provenance is inert metadata and must cover exact identity/product/gameplay',()=>{
  for(const url of ['http://example.com','javascript:alert(1)','data:image/png,x','https://user:password@example.com','https://example.com/ bad',''])rejected(s=>{s.records[0].evidence[0].url=url;},/HTTPS/);
  for(const supports of [[],['product'],['printing','product','gameplay','bogus'],['printing','printing']])rejected(s=>{s.records[0].evidence[0].supports=supports;},/evidence|provenance/);
  rejected(s=>{s.records[0].evidence=[];});
  rejected(s=>{s.records[0].evidence[0].imageURL='https://example.com';},/unsupported/);
  const s=supplement();s.records[0].rawSubtype=null;assert.equal(InkCatalog.validateSupplement(s,base())[0].supplemental.rawSubtype,null);
});
test('duplicate supplemental IDs reject entire batch without partial addition',()=>{
  rejected(s=>{s.records.push(clone(s.records[0]));},/duplicate ID/);
});
test('existing provider namespace or tampered managed record is never overwritten',()=>{
  rejected((s,b)=>{b.cards.push({...b.cards[0],id:PROMO});},/collides/);
  const once=InkCatalog.merge(base(),supplement()).catalog;once.cards.at(-1).c='12';
  const before=clone(once),result=InkCatalog.merge(once,supplement());
  assert.deepEqual(result.catalog,before);assert.match(result.warnings[0],/collides/);
});
test('future Lorcast same-printing ID and provider ID both survive with ambiguity warning',()=>{
  const b=base(),future={...b.cards[0],id:'crd_future_promo',s:'PD1',sn:'PD1',c:'11',r:'Promo'};b.cards.push(future);
  const result=InkCatalog.merge(b,supplement());
  assert.deepEqual(result.catalog.cards.find(c=>c.id===future.id),future);
  assert(result.catalog.cards.some(c=>c.id===PROMO));assert.equal(result.catalog.cards.length,3);
  assert.equal(result.warnings.length,1);assert.match(result.warnings[0],/Ambiguous printing PD1 #11/);assert.match(result.warnings[0],/no automatic alias/);
});
test('new set entry carries no invented release date; existing set labels remain intact',()=>{
  const b=base();b.sets=b.sets.filter(s=>s.code!=='PD1');
  assert.deepEqual(InkCatalog.merge(b,supplement()).catalog.sets.at(-1),{code:'PD1',name:'PD1',rel:null});
  b.sets.push({code:'PD1',name:'Provider label',rel:'2026-01-01'});
  const result=InkCatalog.merge(b,supplement());assert.equal(result.catalog.sets.at(-1).name,'Provider label');assert.match(result.warnings[0],/original label was retained/);
});
test('absent or empty supplement preserves independent base copy; invalid base fails closed',()=>{
  for(const value of [null,undefined]){const b=base(),result=InkCatalog.merge(b,value);assert.deepEqual(result.catalog,b);assert.notEqual(result.catalog,b);assert.deepEqual(result.warnings,[]);}
  const s=supplement();s.records=[];assert.deepEqual(InkCatalog.merge(base(),s).catalog,base());
  assert.throws(()=>InkCatalog.merge(null,supplement()),/base catalog/);
  const b=base();b.cards.push(clone(b.cards[0]));assert.throws(()=>InkCatalog.merge(b,supplement()),/duplicate ID/);
});

const quoteTime=Date.parse('2026-10-25T17:00:00Z');
const promoCard=()=>InkCatalog.merge(base(),supplement()).catalog.cards.at(-1);
const foilQuote=()=>({
  printingId:PROMO,tcgplayerProductId:722993,tcgplayerGroupId:23234,
  expectedPrinting:{n:'Above the Crowd',v:'',s:'PD1',c:'11',r:'Promo',language:'EN',printedSet:'14',stamp:'Hyperia City'},
  rawSubtype:'Holofoil',physicalFinish:null,displayLabel:'Holofoil (provider label)',currency:'USD',marketPrice:4.2,
  sourceURL:'https://tcgcsv.com/tcgplayer/71/23234/prices',sourceBuildURL:'https://tcgcsv.com/last-updated.txt',buildAsOf:'2026-10-24T20:05:44+00:00',
  availableRawSubtypes:['Holofoil'],sourcePriceRow:{productId:722993,subTypeName:'Holofoil',marketPrice:4.2},
  provider:'TCGplayer via TCGCSV',inventoryFinish:'foil'
});
test('exact promo Holofoil provider quote prices generic foil only without modifying card or quote',()=>{
  const c=frozen(promoCard()),q=frozen(foilQuote()),cb=JSON.stringify(c),qb=JSON.stringify(q);
  assert.equal(InkCatalog.validatedFoilQuote(c,q,quoteTime),4.2);
  assert.equal(JSON.stringify(c),cb);assert.equal(JSON.stringify(q),qb);
  assert.equal(c.p,null);assert.equal(c.pf,null);assert.equal(c.prf,null);
  const zero=foilQuote();zero.marketPrice=zero.sourcePriceRow.marketPrice=0;
  assert.equal(InkCatalog.validatedFoilQuote(c,zero,quoteTime),0);
});
test('promo quote binds every exact printing field and both product/provider identities',()=>{
  for(const key of ['n','v','s','c','r','language','printedSet','stamp']){
    const q=foilQuote();q.expectedPrinting[key]='wrong';assert.equal(InkCatalog.validatedFoilQuote(promoCard(),q,quoteTime),null,key);
  }
  for(const key of ['printingId','tcgplayerProductId','provider']){
    const q=foilQuote();q[key]='wrong';assert.equal(InkCatalog.validatedFoilQuote(promoCard(),q,quoteTime),null,key);
  }
  for(const key of ['id','t','n','v','s','c','r']){
    const c=promoCard();c[key]='wrong';assert.equal(InkCatalog.validatedFoilQuote(c,foilQuote(),quoteTime),null,key);
  }
  for(const [key,value] of [['provider','Lorcast'],['productId',722445],['language','FR'],['stamp','Other'],['printedSet','13'],['rawSubtype','Cold Foil'],['schemaVersion',2],['game','magic']]){
    const c=promoCard();c.supplemental[key]=value;assert.equal(InkCatalog.validatedFoilQuote(c,foilQuote(),quoteTime),null,key);
  }
});
test('ordinary base cards, missing quotes and normal/rainbow routes never inherit promo price',()=>{
  const c=promoCard();c.p=123;c.pf=456;c.prf=789;
  assert.equal(InkCatalog.validatedFoilQuote(base().cards[0],foilQuote(),quoteTime),null);
  for(const q of [null,undefined,{},[]])assert.equal(InkCatalog.validatedFoilQuote(c,q,quoteTime),null);
  for(const finish of ['normal','rainbow',undefined]){
    const q=foilQuote();q.inventoryFinish=finish;assert.equal(InkCatalog.validatedFoilQuote(c,q,quoteTime),null);
  }
  for(const physicalFinish of ['foil','cold','rainbow',undefined]){
    const q=foilQuote();q.physicalFinish=physicalFinish;assert.equal(InkCatalog.validatedFoilQuote(c,q,quoteTime),null);
  }
});
test('raw provider subtype, single-row evidence and source row price must agree exactly',()=>{
  for(const [key,value] of [['rawSubtype','Cold Foil'],['displayLabel','Rainbow foil'],['availableRawSubtypes',['Holofoil','Cold Foil']],['availableRawSubtypes',[]],['currency','EUR']]){
    const q=foilQuote();q[key]=value;assert.equal(InkCatalog.validatedFoilQuote(promoCard(),q,quoteTime),null,key);
  }
  for(const [key,value] of [['productId',722445],['subTypeName','Normal'],['marketPrice',9.99]]){
    const q=foilQuote();q.sourcePriceRow[key]=value;assert.equal(InkCatalog.validatedFoilQuote(promoCard(),q,quoteTime),null,key);
  }
  for(const amount of [null,undefined,'4.2',NaN,Infinity,-1]){
    const q=foilQuote();q.marketPrice=q.sourcePriceRow.marketPrice=amount;assert.equal(InkCatalog.validatedFoilQuote(promoCard(),q,quoteTime),null);
  }
});
test('quote source is the exact HTTPS Lorcana group feed and verified build source',()=>{
  for(const url of ['http://tcgcsv.com/tcgplayer/71/23234/prices','https://evil.example/tcgplayer/71/23234/prices','https://tcgcsv.com/tcgplayer/1/23234/prices','https://tcgcsv.com/tcgplayer/71/23235/prices','https://tcgcsv.com/tcgplayer/71/23234/prices?x=1']){
    const q=foilQuote();q.sourceURL=url;assert.equal(InkCatalog.validatedFoilQuote(promoCard(),q,quoteTime),null,url);
  }
  const q=foilQuote();q.sourceBuildURL='https://example.com/build';assert.equal(InkCatalog.validatedFoilQuote(promoCard(),q,quoteTime),null);
  for(const group of ['23234',0,-1,1.5,Infinity]){const q=foilQuote();q.tcgplayerGroupId=group;assert.equal(InkCatalog.validatedFoilQuote(promoCard(),q,quoteTime),null);}
});
test('quotes expire dynamically at seven days, reject every future instant and malformed dates',()=>{
  const c=promoCard(),q=foilQuote(),built=Date.parse(q.buildAsOf),day=86400000;
  assert.equal(InkCatalog.validatedFoilQuote(c,q,built),4.2);
  assert.equal(InkCatalog.validatedFoilQuote(c,q,built+7*day),4.2);
  assert.equal(InkCatalog.validatedFoilQuote(c,q,built+7*day+1),null);
  assert.equal(InkCatalog.validatedFoilQuote(c,q,built-1),null);
  for(const date of ['2026-02-30T00:00:00Z','2026-13-01T00:00:00Z','2026-10-24T24:00:00Z','2026-10-24T12:60:00Z','2026-10-24T12:00:60Z','2026-10-24','2026-10-24T12:00:00','bad',null]){
    const bad=foilQuote();bad.buildAsOf=date;assert.equal(InkCatalog.validatedFoilQuote(c,bad,quoteTime),null,String(date));
  }
  for(const now of [NaN,Infinity,'2026-10-25',null])assert.equal(InkCatalog.validatedFoilQuote(c,q,now),null);
});
