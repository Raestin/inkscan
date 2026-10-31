'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
// Runs beside the generated fixture safety.js, or directly against the actual root runtime.
const S=require(fs.existsSync(path.join(__dirname,'safety.js'))?'./safety.js':'../../../safety.js');
// Pinned v5 restore reader from released 6ef439a: only its dependencies are injected.
// This is deliberately bundled so the old-marker rejection assertion cannot silently disappear in CI.
const clone=S.clone,validate=S.validate;
function legacyRestoreSnapshot(backup){
  if(!backup || backup.app!=='inkscan' || !Object.hasOwn(backup,'inv') || !Object.hasOwn(backup,'wish') || !Object.hasOwn(backup,'decks'))
    throw Error('A complete InkScan backup must contain collection, decks and wishlist. Nothing was replaced.');
  const restored=clone(validate({inv:backup.inv,decks:backup.decks,wish:backup.wish}));
  if(Object.hasOwn(backup,'imports')){
    if(!backup.imports || typeof backup.imports!=='object' || Array.isArray(backup.imports))throw Error('Backup import receipts are invalid. Nothing was replaced.');
    restored.imports=clone(backup.imports);
  }
  return restored;
}
const state=()=>({v:5,inv:{},wish:{},decks:[],base:null,last:null,imports:{},recovery:[],revision:0});
function storage(seed={}){const values=new Map(Object.entries(seed));return {fail:false,values,getItem:k=>values.has(k)?values.get(k):null,setItem(k,v){if(this.fail)throw Error('Quota exceeded');values.set(k,v);}};}
const maps=inv=>S.maps({inv,wish:{},decks:[]});

test('v6 migration retains original v5 bytes, metadata, unknown IDs and generic foil identity',()=>{
 const original={...state(),inv:{unknown:{q:2,f:8}},decks:[{id:'d',name:'Retain',cards:{'unknown|':3},unresolved:['source']}],base:{uid:'u',inv:{unknown:{q:1,f:8}},decks:{},wish:{}},imports:{receipt:{items:[]}},recovery:[{inv:{old:{q:1,f:0}}}]};
 const raw=JSON.stringify(original),st=storage({[S.LEGACY_KEY]:raw,'inkscan.inv':'{"legacy":{"q":9,"f":0}}'});
 const migrated=S.load(st);assert.equal(migrated.v,6);assert.equal(st.getItem(S.KEY),null);assert.deepEqual(migrated.inv,original.inv);assert.deepEqual(migrated.decks,original.decks);assert.deepEqual(migrated.base,original.base);assert.deepEqual(migrated.imports,original.imports);assert.deepEqual(migrated.recovery,original.recovery);
 migrated.inv.unknown.rf=1;S.save(st,migrated,null);assert.equal(st.getItem(S.LEGACY_KEY),raw);assert.equal(st.getItem('inkscan.inv'),'{'+'"legacy":{"q":9,"f":0}}');assert.equal(S.load(st).inv.unknown.rf,1);assert.equal(S.load(st).legacyCheckpoint[S.LEGACY_KEY],raw);
});
test('all legacy keys are fenced before first v6 save and subsequent saves',()=>{
 for(const key of S.LEGACY_KEYS){
  const st=storage({[S.LEGACY_KEY]:JSON.stringify(state())}),loaded=S.load(st);st.setItem(key,'changed by old client');assert.throws(()=>S.save(st,loaded,null),/older InkScan/);assert.equal(st.getItem(S.KEY),null);
  const st2=storage(),current=S.load(st2);S.save(st2,current,null);const before=st2.getItem(S.KEY);st2.setItem(key,'old edit');assert.throws(()=>S.checkLegacy(st2,current),/older InkScan/);assert.throws(()=>S.save(st2,{...current,revision:1},before),/older InkScan/);assert.equal(st2.getItem(S.KEY),before);assert.deepEqual(S.load(st2).inv,{});
 }
});
test('legacy checkpoint survives reload and cannot be silently recaptured or imported',()=>{
 const st=storage({[S.LEGACY_KEY]:JSON.stringify(state())}),m=S.load(st);S.save(st,m,null);const raw=st.getItem(S.KEY),loaded=S.load(st);st.setItem(S.LEGACY_KEY,JSON.stringify({...state(),inv:{new:{q:1,f:0}}}));assert.throws(()=>S.save(st,{v:6,inv:{},wish:{},decks:[]},raw),/older InkScan/);assert.throws(()=>S.checkLegacy(st,loaded),/older InkScan/);
 const backup={app:S.BACKUP_APP,...loaded,legacyCheckpoint:{evil:'replace'},base:{uid:'foreign'}};const restored=S.restoreSnapshot(backup);assert.equal(Object.hasOwn(restored,'legacyCheckpoint'),false);assert.equal(Object.hasOwn(restored,'base'),false);
});
test('malformed/future envelopes and missing checkpoints fail without legacy fallback',()=>{
 for(const value of ['null','false','{bad',JSON.stringify({...state(),v:7}),JSON.stringify({...state(),v:6})])assert.throws(()=>S.load(storage({[S.KEY]:value,[S.LEGACY_KEY]:JSON.stringify(state())})));
 for(const value of ['null','false',JSON.stringify({...state(),v:99}),JSON.stringify({...state(),inv:{bad:{rf:-1}}})])assert.throws(()=>S.load(storage({[S.LEGACY_KEY]:value})));
});
test('failed v6 quota save retains original v5 data and previous v6 atomic snapshot',()=>{
 const raw=JSON.stringify({...state(),inv:{card:{q:2,f:1}}}),st=storage({[S.LEGACY_KEY]:raw}),m=S.load(st);st.fail=true;assert.throws(()=>S.save(st,m,null),/Quota/);assert.equal(st.getItem(S.KEY),null);assert.equal(st.getItem(S.LEGACY_KEY),raw);st.fail=false;S.save(st,m,null);const before=st.getItem(S.KEY);st.fail=true;m.inv.card.rf=4;assert.throws(()=>S.save(st,m,before),/Quota/);assert.equal(st.getItem(S.KEY),before);assert.equal(st.getItem(S.LEGACY_KEY),raw);
});
test('canonical maps retain rf-only rows but preserve q/f-only shape',()=>{
 assert.deepEqual(maps({a:{q:2,f:1}}).inv,{a:{q:2,f:1}});assert.deepEqual(maps({a:{q:0,f:0,rf:4},b:{q:2,f:1,rf:0},c:{q:0,f:0,rf:0}}).inv,{a:{q:0,f:0,rf:4},b:{q:2,f:1}});
 assert.deepEqual(S.baseline({inv:{a:{q:0,f:0,rf:2},legacy:'2|8'},wish:{},decks:{}}).inv,{a:{q:0,f:0,rf:2},legacy:{q:2,f:8}});
});
test('rainbow quantities validate strictly across state and canonical maps',()=>{
 for(const rf of [-1,1.1,'1',null,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>S.validate({...state(),inv:{a:{q:0,f:0,rf}}}),/quantity/);assert.throws(()=>maps({a:{q:0,f:0,rf}}),/quantity/);
 }
 assert.throws(()=>S.collectionAddition({a:{q:0,f:0,rf:Number.MAX_SAFE_INTEGER}},[{cardId:'a',finish:'rainbow',qty:1}],'r',{}),/too large/);
});
test('rainbow addition is additive, preserves every other finish and is receipt-idempotent',()=>{
 const inv={a:{q:2,f:3,rf:2}},items=[{cardId:'a',finish:'rainbow',qty:4}],p=S.collectionAddition(inv,items,'first',{});assert.deepEqual(p.inv.a,{q:2,f:3,rf:6});assert.equal(inv.a.rf,2);assert.throws(()=>S.collectionAddition(p.inv,items,'first',p.receipts),/already applied/);assert.equal(S.collectionAddition(p.inv,items,'second',p.receipts).inv.a.rf,10);assert.equal(p.changes[0].before,2);assert.equal(p.changes[0].after,6);
 for(const finish of ['holofoil','cold-foil','',null])assert.throws(()=>S.collectionAddition({},[{cardId:'a',finish,qty:1}],'bad',{}));
 for(const cardId of ['__proto__','constructor','prototype'])assert.throws(()=>S.collectionAddition({},[{cardId,finish:'rainbow',qty:1}],'bad',{}));
});
test('rainbow three-way planning retains remote pulls and detects same-printing conflicts',()=>{
 const base=maps({a:{q:2,f:1,rf:1}}),local=S.clone(base),remote=maps({a:{q:2,f:1,rf:4}});let p=S.plan(local,remote,base);assert.equal(p.writes.length,0);assert.equal(p.pulls[0].value.rf,4);assert.equal(S.applyPulls(local,local,p.pulls).inv.a.rf,4);
 local.inv.a.rf=2;p=S.plan(local,remote,base);assert.equal(p.conflicts.length,0);assert.equal(p.merged.inv.a.rf,5);assert.equal(local.inv.a.rf,2);assert.equal(remote.inv.a.rf,4);assert.equal(S.pending(local,base).inv,1);
});
test('rainbow in-flight local edits are retained pending rather than overwritten by pull',()=>{
 const captured=maps({a:{q:1,f:0,rf:1}}),current=maps({a:{q:1,f:0,rf:2}});const result=S.applyPulls(current,captured,[{section:'inv',id:'a',value:{q:1,f:0,rf:5}}]);assert.equal(result.inv.a.rf,2);
});
test('valuation treats rainbow independently and never borrows ordinary foil price',()=>{
 const row={c:{p:1,pf:2,prf:null},q:2,f:3,rf:4};assert.deepEqual(S.valuation([row]),{value:8,copies:9,unpriced:4,partial:true});assert.deepEqual(S.valuation([row],'rainbow'),{value:0,copies:4,unpriced:4,partial:true});row.c.prf=7;assert.equal(S.valuation([row],'rainbow').value,28);assert.equal(S.valuation([row],'foil').value,6);assert.equal(S.valuation([row],'normal').value,2);delete row.c.prf;assert.equal(S.valuation([row],'rainbow').unpriced,4);
 for(const price of [NaN,Infinity,-1,'7']){row.c.prf=price;assert.equal(S.valuation([row],'rainbow').unpriced,4);}row.c.prf=0;assert.equal(S.valuation([row],'rainbow').unpriced,0);assert.throws(()=>S.valuation([row],'Holofoil'),/Unknown finish/);
});
test('new backup marker prevents old-runtime restore while v6 restores all finishes',()=>{
 const backup={app:S.BACKUP_APP,...state(),v:6,inv:{unknown:{q:2,f:3,rf:4}}},restored=S.restoreSnapshot(backup,{old:{q:1,f:2,rf:9}});assert.deepEqual(restored.inv,backup.inv);assert.equal(restored.restoreKind,'v6');assert.equal(restored.preservedRainbowCopies,0);assert.equal(backup.app,'inkscan-v6-backup');
 assert.throws(()=>legacyRestoreSnapshot(backup),/complete/);assert.deepEqual(legacyRestoreSnapshot({app:'inkscan',...state()}).inv,{});
 assert.throws(()=>S.restoreSnapshot({...backup,v:7}),/version/);assert.throws(()=>S.restoreSnapshot({...backup,app:'inkscan'}),/versioned/);
});
test('legacy backup restores q/f while preserving current rainbow quantities and rf-only IDs',()=>{
 const legacy={app:'inkscan',...state(),inv:{a:{q:7,f:1},old:{q:2,f:0}}},current={a:{q:2,f:3,rf:4},rainbowOnly:{q:0,f:0,rf:2}},restored=S.restoreSnapshot(legacy,current);assert.deepEqual(restored.inv,{a:{q:7,f:1,rf:4},old:{q:2,f:0},rainbowOnly:{q:0,f:0,rf:2}});assert.equal(restored.preservedRainbowCopies,6);assert.equal(restored.restoreKind,'legacy');assert.equal(current.a.q,2);assert.equal(legacy.inv.a.rf,undefined);
});
test('legacy CSV preservation helper retains unknown rf-only rows without mutating either input',()=>{
 const csv={a:{q:4,f:0}},current={a:{q:1,f:2,rf:3},unknown:{q:0,f:0,rf:8}},merged=S.preserveRainbow(csv,current);assert.deepEqual(merged,{a:{q:4,f:0,rf:3},unknown:{q:0,f:0,rf:8}});assert.deepEqual(csv,{a:{q:4,f:0}});assert.equal(current.a.q,1);
});

const quoteCard=()=>({id:'crd_verified',n:'Verified',v:'Rainbow',s:'12',c:'49',t:678237,pf:999});
const quote=()=>({printingId:'crd_verified',name:'Verified',version:'Rainbow',setCode:'12',collectorNumber:'49',tcgplayerProductId:678237,finish:'rainbow',rawSubtype:'Holofoil',currency:'USD',marketPrice:4.66,buildAsOf:'2026-10-24T20:05:44+00:00'});
const quoteNow=Date.parse('2026-10-25T15:00:00Z');
test('rainbow quote validates exact printing, subtype, currency, amount and build date',()=>{
 assert.equal(S.validatedRainbowQuote(quoteCard(),quote(),quoteNow),4.66);assert.equal(S.validatedRainbowQuote(quoteCard(),{...quote(),marketPrice:0},quoteNow),0);
 for(const [field,value] of Object.entries({printingId:'different',name:'Other',version:'Other',setCode:'P3',collectorNumber:'239',tcgplayerProductId:999,finish:'foil',rawSubtype:'Cold Foil',currency:'EUR'}))assert.equal(S.validatedRainbowQuote(quoteCard(),{...quote(),[field]:value},quoteNow),null,field);
 for(const card of [null,{}, {...quoteCard(),id:'other'}, {...quoteCard(),t:'678237'}, {...quoteCard(),t:null}, {...quoteCard(),n:undefined}, {...quoteCard(),s:undefined}, {...quoteCard(),c:''}])assert.equal(S.validatedRainbowQuote(card,quote(),quoteNow),null);
});
test('rainbow quote never falls back to generic foil or accepts malformed prices',()=>{
 for(const price of [null,undefined,'4.66',NaN,Infinity,-1])assert.equal(S.validatedRainbowQuote(quoteCard(),{...quote(),marketPrice:price},quoteNow),null);
 assert.equal(S.validatedRainbowQuote(quoteCard(),null,quoteNow),null);assert.equal(S.validatedRainbowQuote(quoteCard(),{},quoteNow),null);assert.equal(S.validatedRainbowQuote(quoteCard(),quote(),NaN),null);
});
test('rainbow quotes expire after seven days and reject materially future or malformed dates',()=>{
 const base=quote(),built=Date.parse(base.buildAsOf),day=86400000;
 assert.equal(S.validatedRainbowQuote(quoteCard(),base,built+7*day),4.66);assert.equal(S.validatedRainbowQuote(quoteCard(),base,built+7*day+1),null);
 assert.equal(S.validatedRainbowQuote(quoteCard(),base,built-day),4.66);assert.equal(S.validatedRainbowQuote(quoteCard(),base,built-day-1),null);
 for(const buildAsOf of ['not-a-date','2026-02-30T20:05:44Z','2026-13-01T20:05:44Z','2026-10-24','2026-10-24T25:05:44Z','2026-10-24T20:61:44Z',null,0])assert.equal(S.validatedRainbowQuote(quoteCard(),{...base,buildAsOf},quoteNow),null,String(buildAsOf));
});

const mappingCard=()=>({id:'crd_exact',n:'Verified',v:'Version',s:'D23',c:'7',r:'Promo',t:null});
const productMapping=()=>({printingId:'crd_exact',expectedIdentity:{n:'Verified',v:'Version',s:'D23',c:'7',r:'Promo'},tcgplayerProductId:559564,expectedCurrentTcgplayerId:null});
test('product mapping repairs only an exact identity with null or already-equal product ID',()=>{
 const c=mappingCard(),m=productMapping();assert.equal(S.validatedProductMapping(c,m),559564);assert.equal(c.t,null);assert.equal(S.validatedProductMapping({...c,t:undefined},m),559564);assert.equal(S.validatedProductMapping({...c,t:559564},m),559564);assert.equal(S.validatedProductMapping({...c,t:559564},{...m,expectedCurrentTcgplayerId:559564}),559564);
 assert.equal(S.validatedProductMapping({...c,t:111},m),null);assert.equal(S.validatedProductMapping({...c,t:'559564'},m),null);assert.equal(S.validatedProductMapping({...c,t:0},m),null);
});
test('product mapping rejects every mismatched identity, malformed target and missing contract',()=>{
 const c=mappingCard(),m=productMapping();
 for(const field of ['n','v','s','c','r']){
  assert.equal(S.validatedProductMapping({...c,[field]:'different'},m),null,field);
  const identity={...m.expectedIdentity};delete identity[field];assert.equal(S.validatedProductMapping(c,{...m,expectedIdentity:identity}),null,field+' missing');
 }
 for(const target of [0,-1,1.2,'559564',null,undefined,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.equal(S.validatedProductMapping(c,{...m,tcgplayerProductId:target}),null);
 for(const bad of [null,undefined,{},[],{...m,printingId:'other'},{...m,expectedIdentity:null},{...m,expectedCurrentTcgplayerId:111}])assert.equal(S.validatedProductMapping(c,bad),null);
 const missing={...m};delete missing.expectedCurrentTcgplayerId;assert.equal(S.validatedProductMapping(c,missing),null);assert.equal(S.validatedProductMapping(null,m),null);
});
