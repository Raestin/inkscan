'use strict';
// Synthetic storage/REST against this exact runtime; no capability or remote-row normalization.
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const path=require('node:path');
const runtime=fs.existsSync(path.join(__dirname,'app.js'))?__dirname:path.resolve(__dirname,'../../..');
const S=require(path.join(runtime,'safety.js'));
const empty=()=>({inv:{},wish:{},decks:{}});
function storage(seed={}){const values=new Map(Object.entries(seed));return {fail:false,getItem:k=>values.has(k)?values.get(k):null,setItem(k,v){if(this.fail)throw Error('Quota exceeded');values.set(k,v);},values};}
const state=()=>S.load(storage());
const catalog=(n=3)=>({asof:'2026-10-24',sets:[{code:'1',name:'Synthetic set'}],cards:Array.from({length:n},(_,i)=>({id:'card'+i,n:'Synthetic '+i,v:'Test',s:'1',sn:'Synthetic set',c:String(i),i:i%2?'Ruby':'Amber',r:'Common',cl:'Test',tx:'Text',ty:'Character',co:2,ik:1,p:2,pf:5,iv:null}))});
function harness(seed={}){
 const elements=new Map(), events=[], timers=[], network=[], localStorage=storage(seed);
 function el(id){if(!elements.has(id))elements.set(id,{id,value:'',hidden:false,dataset:{},style:{},textContent:'',innerHTML:'',classList:{toggle(){},add(){},remove(){}},addEventListener(type,fn){events.push({id,type,fn});},setAttribute(){},getAttribute(){return 'false';},removeAttribute(){},querySelector(){return el('child');},querySelectorAll(){return[];},getContext(){return{};},appendChild(){},click(){},remove(){},insertAdjacentHTML(){},select(){}});return elements.get(id);}
 const doc={getElementById:el,querySelector:el,querySelectorAll:()=>[],createElement:el,addEventListener(type,fn){events.push({id:'document',type,fn});},body:el('body'),hidden:false};
 const context={InkSafety:S,InkCatalog:require(path.join(runtime,'catalog.js')),InkLegality:require(path.join(runtime,'legality.js')),document:doc,localStorage,location:{origin:'https://raestin.github.io',pathname:'/inkscan/',protocol:'http:',href:'https://raestin.github.io/inkscan/'},navigator:{onLine:true},URL,Blob,Response,console,Date,Math,JSON,Map,Set,Promise,Number,Object,Array,String,Error,TypeError,encodeURIComponent,decodeURIComponent,parseInt,parseFloat,isFinite,MutationObserver:class{observe(){}disconnect(){}},IntersectionObserver:class{observe(){}disconnect(){}},history:{pushState(){},back(){}},setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){},setInterval(){throw Error('Unexpected interval');},fetch:async(...args)=>{network.push(args);throw Error('Unexpected network');}};
 context.window=context;context.addEventListener=(type,fn)=>events.push({id:'window',type,fn});context.scrollTo=()=>{};
 let source=fs.readFileSync(path.join(runtime,'app.js'),'utf8');
 source=source.replace('\nboot();','\n// boot suppressed only inside this test harness');
 source=source.replace('window.__inkscan =',`window.testAPI={loadCards,loadFinishQuotes,finishPriceNote,buildCsv,priceOf,ownedNV,renderWish,deckStats,backupPayload,boot,totals,saveInv,saveDecks,saveWish,parseDeckImport,previewCollectionImport,previewRestore,collRows,renderCollCards,renderBrowse,resetBrowse,addQty,logAdd,openCard,cardDetailHTML,sync,guardedWrite,rest,reviewUpdate,renderSaveStatus,
  setState(s){inv=S.clone(s.inv||{});wish=S.clone(s.wish||{});decks=S.clone(s.decks||[]);base=s.base||null;session=Object.hasOwn(s,'session')?s.session:{uid:'synthetic-owner',access:'synthetic',exp:Date.now()+3600000};savedState=savedState||${JSON.stringify(state())};},
  getState(){return {inv,wish,decks,base,session,storageError,localRevision,syncState};},
  setReview(fn){reviewUpdate=fn;},setRest(fn){rest=(m,p,...a)=>String(p).startsWith('rpc/inkscan_household')?Promise.resolve({owner:session.uid,role:null,members:[]}):fn(m,p,...a);},setDownload(fn){download=fn;},setRender(fn){renderAll=fn;},setCatalog(d){indexCards(d);},setInk(i){collInks.clear();if(i)collInks.add(i);},setChunk(fn){chunked=fn;}};\nwindow.__inkscan =`);
 source=source.replace('inv=S.clone','inv=InkSafety.clone').replace('wish=S.clone','wish=InkSafety.clone').replace('decks=S.clone','decks=InkSafety.clone');
 vm.runInNewContext(source,context);context.testAPI.setCatalog(catalog());
 for(const id of ['cFinish','bFinish'])el(id).value='all';for(const id of ['sortSel','bSort'])el(id).value='set';
 return {api:context.testAPI,context,el,events,timers,network,storage:localStorage};
}
const json=x=>JSON.parse(JSON.stringify(x));
const missingColumn=()=>Object.assign(Error('column collection.rainbow_foil does not exist'),{code:'42703'});
for(const [label,config] of Object.entries({
 'current quantity':{inv:{card0:{q:2,f:1,rf:4}}},
 'baseline-only removal':{inv:{},base:{uid:'synthetic-owner',inv:{card0:{q:2,f:1,rf:4}},wish:{},decks:{}}}
}))test(`missing rainbow schema blocks ${label} before any cloud writes`,async()=>{
 const h=harness();h.api.setState(config);const calls=[];h.api.setRest(async(method,path)=>{calls.push({method,path});if(path.includes('select=rainbow_foil'))throw missingColumn();return[];});h.api.setReview(async()=>true);await h.api.sync(true);
 assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');assert.match(h.api.getState().syncState.err,/does not support rainbow/);assert.equal(h.api.getState().syncState.last,null);
});
test('missing rainbow schema permits explicit q/f-only compatibility without extra column',async()=>{
 const h=harness();h.api.setState({inv:{card0:{q:2,f:1}}});const writes=[];
 h.api.setRest(async(method,path,row)=>{if(path.includes('select=rainbow_foil'))throw missingColumn();if(method==='GET')return[];writes.push(row);return[row];});h.api.setReview(async()=>true);await h.api.sync(true);
 assert.equal(h.api.getState().syncState.err,null);assert.equal(writes.length,1);assert.equal(Object.hasOwn(writes[0],'rainbow_foil'),false);assert.equal(writes[0].q,2);assert.equal(writes[0].f,1);
});
test('unknown rainbow-only cloud printing pulls without loss and persists baseline',async()=>{
 const h=harness();h.api.setState({});let writes=0;
 h.api.setRest(async(method,path)=>{if(method!=='GET')writes++;return path.includes('select=rainbow_foil')?[]:path.startsWith('collection')?[{card_id:'unknown-rf',q:0,f:0,rainbow_foil:4,updated_at:'timestamp'}]:[];});h.api.setReview(async()=>true);await h.api.sync(true);
 assert.equal(writes,0);assert.equal(h.api.getState().syncState.err,null);assert.deepEqual(json(h.api.getState().inv),{'unknown-rf':{q:0,f:0,rf:4}});assert.equal(S.load(h.storage).base.inv['unknown-rf'].rf,4);
});
test('rainbow PATCH compares prior count and preserves edits made while Update is in flight',async()=>{
 const h=harness();h.api.setState({inv:{card0:{q:2,f:1,rf:4}},base:{uid:'synthetic-owner',inv:{card0:{q:2,f:1,rf:3}},wish:{},decks:{}}});const writes=[];
 h.api.setRest(async(method,path,row)=>{if(path.includes('select=rainbow_foil'))return[];if(method==='GET')return path.startsWith('collection')?[{card_id:'card0',q:2,f:1,rainbow_foil:3,updated_at:'timestamp'}]:[];writes.push({method,path,row});h.api.addQty('card0','rainbow',1);return[row];});h.api.setReview(async()=>true);await h.api.sync(true);
 const st=h.api.getState();assert.equal(st.syncState.err,null);assert.equal(writes.length,1);assert.equal(writes[0].method,'PATCH');assert.match(writes[0].path,/rainbow_foil=eq.3/);assert.match(writes[0].path,/updated_at=eq.timestamp/);assert.equal(writes[0].row.rainbow_foil,4);assert.equal(st.inv.card0.rf,5);assert.equal(st.base.inv.card0.rf,4);assert.equal(S.pending(S.maps(st),st.base).inv,1);
});
test('supported rainbow schema rejects missing and invalid remote quantities without writes',async()=>{
 for(const row of [{q:1,f:0},{q:1,f:0,rainbow_foil:null},{q:1,f:0,rainbow_foil:-1},{q:1,f:0,rainbow_foil:'1'}]){
  const h=harness();h.api.setState({});let writes=0;h.api.setRest(async(method,path)=>{if(method!=='GET')writes++;if(path.includes('select=rainbow_foil'))return[];return path.startsWith('collection')?[{card_id:'bad',...row}]:[];});h.api.setReview(async()=>true);await h.api.sync(true);assert.equal(writes,0);assert.match(h.api.getState().syncState.err,/rainbow quantities are missing or invalid/);
 }
});
test('unrelated capability errors cannot silently downgrade cloud representation',async()=>{
 for(const err of [Error('Network failed'),Object.assign(Error('permission denied'),{code:'42501'}),Object.assign(Error('column unrelated does not exist'),{code:'42703'})]){
  const h=harness();h.api.setState({inv:{card0:{q:1,f:0}}});let calls=0;h.api.setRest(async()=>{calls++;throw err;});await h.api.sync(true);assert.equal(calls,1);assert.equal(h.api.getState().syncState.err,err.message);
 }
});
test('post-commit legacy race freezes saving and backup preserves both committed snapshots',()=>{
 const h=harness();h.api.setState({inv:{card0:{q:1,f:0}}});const original=h.storage.setItem.bind(h.storage);let race=true;
 h.storage.setItem=function(key,value){original(key,value);if(key===S.KEY&&race){race=false;original(S.LEGACY_KEY,JSON.stringify({v:5,inv:{card0:{q:99,f:0}},wish:{},decks:[]}));}};
 h.api.previewCollectionImport({cards:{'synthetic0|test':4}});h.el('purchasePrint0').value='card0';h.el('purchaseFinish0').value='rainbow';h.el('previewPurchase').onclick();h.el('confirmPurchase').onclick();
 assert.match(h.api.getState().storageError,/could not be confirmed/);assert.equal(h.api.getState().inv.card0.rf,undefined);const backup=h.api.backupPayload();assert.equal(backup.app,S.BACKUP_APP);assert.equal(JSON.parse(backup.recoveryRaw[S.KEY]).inv.card0.rf,4);assert.equal(JSON.parse(backup.recoveryRaw[S.LEGACY_KEY]).inv.card0.q,99);assert.equal(backup.inv.card0.q,1);
});
test('rainbow quantities participate in ownership and all-match filtered value without price fallback',()=>{
 const h=harness();h.api.setState({inv:{card0:{q:2,f:3,rf:4},unknown:{q:0,f:0,rf:2}}});assert.equal(h.api.totals().copies,11);assert.equal(h.api.totals().unpriced,6);assert.equal(h.api.ownedNV('synthetic0|test'),9);h.el('cFinish').value='rainbow';const rows=h.api.collRows();assert.equal(rows.length,1);assert.equal(rows[0].rf,4);assert.equal(rows[0].q,0);assert.equal(rows[0].f,0);assert.equal(rows[0].unpriced,4);h.el('bFinish').value='rainbow';h.api.setChunk(()=>{});h.api.renderBrowse();assert.match(h.el('bValue').textContent,/4 owned copies/);assert.match(h.el('bValue').textContent,/4 copies unpriced/);
});
const chooseRestore=async(h,text)=>h.el('fileIn').onchange({target:{files:[{text:async()=>text}],value:'synthetic-file'}});
test('v6 CSV round-trips unknown rainbow IDs and legacy CSV preserves every existing rainbow count',async()=>{
 const h=harness();h.api.setState({inv:{card0:{q:2,f:3,rf:4},unknown:{q:0,f:0,rf:2}}});const csv=h.api.buildCsv();assert.match(csv,/InkScan v6 Quantity/);assert.match(csv,/Rainbow Foil,2,,,,,unknown/);assert.doesNotMatch(csv.split('\r\n')[0],/(^|,)Quantity(,|$)/);await chooseRestore(h,csv);assert.match(h.el('sheetBody').innerHTML,/6 rainbow foil copies/);h.el('confirmRestore').onclick();assert.equal(h.api.getState().inv.unknown.rf,2);await chooseRestore(h,'Lorcast ID,Finish,Quantity\ncard1,Normal,2');assert.match(h.el('sheetBody').innerHTML,/rainbow foil quantities are preserved/);h.el('confirmRestore').onclick();assert.equal(h.api.getState().inv.card0.rf,4);assert.equal(h.api.getState().inv.unknown.rf,2);
});
function quoteFixture(card,changes={}){return {printingId:card.id,name:card.n,version:card.v,setCode:card.s,collectorNumber:card.c,tcgplayerProductId:card.t,finish:'rainbow',rawSubtype:'Holofoil',currency:'USD',marketPrice:7,buildAsOf:new Date().toISOString(),...changes};}
async function loadOverlay(h,quotes,productMappings=[]){h.context.fetch=async(url)=>{assert.equal(url,'finish-quotes.json');return new Response(JSON.stringify({schemaVersion:1,currency:'USD',provider:'TCGplayer via TCGCSV',buildAsOf:new Date().toISOString(),quotes,productMappings}),{status:200});};await h.api.loadFinishQuotes();}
test('exact rainbow quote remains separate from ambiguous generic foil and survives catalog reindex',async()=>{
 const h=harness(),d=catalog();d.cards[0].t=678237;const q=quoteFixture(d.cards[0]);await loadOverlay(h,{'card0|rainbow':q});h.api.setCatalog(d);assert.equal(h.api.priceOf(d.cards[0],'rainbow'),7);assert.equal(h.api.priceOf(d.cards[0],true),null);assert.equal(h.api.priceOf(d.cards[0],false),2);h.api.setState({inv:{card0:{q:1,f:2,rf:3}}});assert.equal(h.api.totals().val,23);assert.equal(h.api.totals().unpriced,2);const refreshed=catalog();refreshed.cards[0].t=678237;refreshed.cards[0].pf=99;h.api.setCatalog(refreshed);assert.equal(h.api.priceOf(refreshed.cards[0],'rainbow'),7);assert.equal(h.api.priceOf(refreshed.cards[0],true),null);assert.match(h.api.finishPriceNote(),/TCGplayer via TCGCSV/);assert.match(h.api.finishPriceNote(),/separate from the Lorcast/);
});
test('stale, wrong-identity and unavailable finish data are unknown, never generic foil fallback',async()=>{
 for(const changes of [{buildAsOf:new Date(Date.now()-8*86400000).toISOString()},{tcgplayerProductId:999},{rawSubtype:'Cold Foil'},{name:'Other card'}]){
  const h=harness(),d=catalog();d.cards[0].t=678237;await loadOverlay(h,{'card0|rainbow':quoteFixture(d.cards[0],changes)});h.api.setCatalog(d);assert.equal(h.api.priceOf(d.cards[0],'rainbow'),null);assert.equal(h.api.priceOf(d.cards[0],true),null);
 }
 const h=harness(),d=catalog();d.cards[0].t=678237;await loadOverlay(h,{'card0|rainbow':quoteFixture(d.cards[0])});h.api.setCatalog(d);h.context.fetch=async()=>{throw Error('Synthetic unavailable');};await h.api.loadFinishQuotes();assert.equal(h.api.priceOf(d.cards[0],'rainbow'),null);assert.match(h.api.finishPriceNote(),/unavailable/);
});
test('verified product overlay requires full identity and never overwrites conflicting provider ID',async()=>{
 const h=harness(),d=catalog();d.cards[0].t=null;const mapping={printingId:'card0',expectedIdentity:{n:d.cards[0].n,v:d.cards[0].v,s:d.cards[0].s,c:d.cards[0].c,r:d.cards[0].r},tcgplayerProductId:678237,expectedCurrentTcgplayerId:null,sourceURL:'https://example.invalid/source'};
 await loadOverlay(h,{},[mapping]);h.api.setCatalog(d);assert.equal(d.cards[0].t,678237);assert.equal(h.api.priceOf(d.cards[0],true),null);assert.equal(h.api.priceOf(d.cards[0],'rainbow'),null);
 const refreshed=catalog();refreshed.cards[0].t=null;h.api.setCatalog(refreshed);assert.equal(refreshed.cards[0].t,678237);
 const conflict=catalog();conflict.cards[0].t=12345;h.api.setCatalog(conflict);assert.equal(conflict.cards[0].t,12345);
 const wrong=catalog();wrong.cards[0].t=null;wrong.cards[0].r='Rare';h.api.setCatalog(wrong);assert.equal(wrong.cards[0].t,null);
});
test('wishlist and deck missing-cost summaries retain unpriced coverage',()=>{
 const h=harness(),d=catalog();d.cards[0].p=null;d.cards[0].pf=null;h.api.setCatalog(d);h.api.setState({wish:{card0:3},decks:[{id:'d',name:'Synthetic',cards:{'synthetic0|test':4}}]});h.api.renderWish();assert.match(h.el('wishSum').innerHTML,/partial/);assert.match(h.el('wishSum').innerHTML,/3 copies unpriced/);const st=h.api.deckStats(h.api.getState().decks[0]);assert.equal(st.missingUnpriced,4);assert.equal(st.missCost,0);
});

test('new bundled catalog supersedes older cached catalog without clearing cache or inventory',async()=>{
 const h=harness(),older={...catalog(2),asof:'2026-10-20'},newer={...catalog(3),asof:'2026-10-25'};h.api.setState({inv:{unknown:{q:0,f:0,rf:2}}});let deletes=0;
 h.context.caches={open:async()=>({match:async name=>{assert.equal(name,'cards-live.json');return new Response(JSON.stringify(older));}}),delete:async()=>{deletes++;}};h.context.fetch=async url=>{assert.equal(url,'cards.json');return new Response(JSON.stringify(newer));};
 assert.equal((await h.api.loadCards()).cards.length,3);assert.equal(deletes,0);assert.equal(h.api.getState().inv.unknown.rf,2);
});
test('newer live catalog survives older bundle and cached data remains available on network failure',async()=>{
 const h=harness(),newer={...catalog(4),asof:'2026-10-26'},older={...catalog(3),asof:'2026-10-25'};
 h.context.caches={open:async()=>({match:async()=>new Response(JSON.stringify(newer))})};h.context.fetch=async()=>new Response(JSON.stringify(older));assert.equal((await h.api.loadCards()).cards.length,4);
 h.context.fetch=async()=>{throw Error('Synthetic offline');};assert.equal((await h.api.loadCards()).cards.length,4);
 h.context.caches={open:async()=>({match:async()=>new Response(JSON.stringify({...newer,asof:'invalid'}))})};await assert.rejects(h.api.loadCards(),/No valid card catalog/);
});

test('known non-Wilds multi-finish printing stays unpriced generically when provider ID disappears',()=>{
 const h=harness(),d=catalog();d.cards[0].id='crd_977a785a450a4621b0dcff4404592877';d.cards[0].t=null;d.cards[0].pf=100;h.api.setCatalog(d);assert.equal(h.api.priceOf(d.cards[0],true),null);assert.equal(h.api.priceOf(d.cards[0],'rainbow'),null);assert.equal(h.api.priceOf(d.cards[0],false),2);
});
