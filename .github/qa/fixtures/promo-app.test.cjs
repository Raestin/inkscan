'use strict';
// Exact-runtime promo identity regressions. No network, camera, credentials or user photo bytes.
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const path=require('node:path');
const runtime=fs.existsSync(path.join(__dirname,'app.js'))?__dirname:path.resolve(__dirname,'../../..');
const S=require(path.join(runtime,'safety.js'));
const C=require(path.join(runtime,'catalog.js'));
const root=path.resolve(__dirname,'../../..');
const actualCatalog=()=>JSON.parse(fs.readFileSync(path.join(root,'cards.json')));
const actualSupplement=()=>JSON.parse(fs.readFileSync(path.join(root,'promo-catalog.json')));
const empty=()=>({inv:{},wish:{},decks:{}});
function storage(seed={}){const values=new Map(Object.entries(seed));return {fail:false,getItem:k=>values.has(k)?values.get(k):null,setItem(k,v){if(this.fail)throw Error('Quota exceeded');values.set(k,v);},values};}
const state=()=>S.load(storage());
const catalog=(n=3)=>({asof:'2026-10-24',sets:[{code:'1',name:'Synthetic set'}],cards:Array.from({length:n},(_,i)=>({id:'card'+i,n:'Synthetic '+i,v:'Test',s:'1',sn:'Synthetic set',c:String(i),i:i%2?'Ruby':'Amber',r:'Common',cl:'Test',tx:'Text',ty:'Character',co:2,ik:1,p:2,pf:5,iv:null}))});
function harness(seed={}){
 const elements=new Map(), events=[], timers=[], network=[], localStorage=storage(seed);
 function el(id){if(!elements.has(id))elements.set(id,{id,value:'',hidden:false,dataset:{},style:{},textContent:'',innerHTML:'',classList:{toggle(){},add(){},remove(){}},addEventListener(type,fn){events.push({id,type,fn});},setAttribute(){},getAttribute(){return 'false';},removeAttribute(){},querySelector(){return el('child');},querySelectorAll(){return[];},getContext(){return{};},appendChild(){},click(){},remove(){},insertAdjacentHTML(){},select(){}});return elements.get(id);}
 const doc={getElementById:el,querySelector:el,querySelectorAll:()=>[],createElement:el,addEventListener(type,fn){events.push({id:'document',type,fn});},body:el('body'),hidden:false};
 const context={InkSafety:S,InkCatalog:C,InkLegality:require(path.join(runtime,'legality.js')),document:doc,localStorage,location:{origin:'https://raestin.github.io',pathname:'/inkscan/',protocol:'http:',href:'https://raestin.github.io/inkscan/'},navigator:{onLine:true},URL,Blob,Response,console,Date,Math,JSON,Map,Set,Promise,Number,Object,Array,String,Error,TypeError,encodeURIComponent,decodeURIComponent,parseInt,parseFloat,isFinite,MutationObserver:class{observe(){}disconnect(){}},IntersectionObserver:class{observe(){}disconnect(){}},history:{pushState(){},back(){}},setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){},setInterval(){throw Error('Unexpected interval');},fetch:async(...args)=>{network.push(args);throw Error('Unexpected network');}};
 context.window=context;context.addEventListener=(type,fn)=>events.push({id:'window',type,fn});context.scrollTo=()=>{};
 let source=fs.readFileSync(path.join(runtime,'app.js'),'utf8');
 source=source.replace('\nboot();','\n// boot suppressed only inside this test harness');
 source=source.replace('window.__inkscan =',`window.testAPI={resolveNumberLine,reviewNumberLine,parseLine,searchPrintings,quickSearch,setScanPrintingScope,setScanFinish,renderQuick,loadPromoCatalog,loadCards,loadFinishQuotes,finishPriceNote,buildCsv,priceOf,ownedNV,renderWish,deckStats,backupPayload,boot,totals,saveInv,saveDecks,saveWish,parseDeckImport,previewCollectionImport,previewRestore,collRows,renderCollCards,renderBrowse,resetBrowse,addQty,logAdd,openCard,cardDetailHTML,sync,guardedWrite,rest,reviewUpdate,renderSaveStatus,
  setState(s){inv=S.clone(s.inv||{});wish=S.clone(s.wish||{});decks=S.clone(s.decks||[]);base=s.base||null;session=Object.hasOwn(s,'session')?s.session:{uid:'synthetic-owner',access:'synthetic',exp:Date.now()+3600000};savedState=savedState||${JSON.stringify(state())};},
  getState(){return {inv,wish,decks,base,session,storageError,localRevision,syncState};},
  setReview(fn){reviewUpdate=fn;},setRest(fn){rest=(m,p,...a)=>String(p).startsWith('rpc/inkscan_household')?Promise.resolve({owner:session.uid,role:null,members:[]}):fn(m,p,...a);},setDownload(fn){download=fn;},setRender(fn){renderAll=fn;},setCatalog(d){indexCards(d);},setSupplement(d){promoSupplement=d;},getCatalog(){return DB;},getWarnings(){return {promoLoadError,promoCatalogWarnings};},setInk(i){collInks.clear();if(i)collInks.add(i);},setChunk(fn){chunked=fn;}};\nwindow.__inkscan =`);
 source=source.replace('inv=S.clone','inv=InkSafety.clone').replace('wish=S.clone','wish=InkSafety.clone').replace('decks=S.clone','decks=InkSafety.clone');
 vm.runInNewContext(source,context);context.testAPI.setCatalog(catalog());
 for(const id of ['cFinish','bFinish'])el(id).value='all';for(const id of ['sortSel','bSort'])el(id).value='set';
 return {api:context.testAPI,context,el,events,timers,network,storage:localStorage};
}
const json=x=>JSON.parse(JSON.stringify(x));
const real=()=>{const h=harness();h.api.setCatalog(actualCatalog());return h;};
const chooseRestore=async(h,text)=>h.el('fileIn').onchange({target:{files:[{text:async()=>text}],value:'synthetic-file'}});
test('real P3 promo denominator is authoritative over trailing regular release number',()=>{
 const h=real(),r=h.api.resolveNumberLine('43/P3 · EN · 12');assert.equal(r.status,'exact');assert.equal(r.card.id,'crd_4a3d97e5bcff49c2883e5764be3fd43b');assert.equal(r.card.n,'Ariel');assert.equal(r.card.s,'P3');assert.equal(h.api.parseLine('43/P3 EN 12').id,r.card.id);assert.deepEqual(json(h.api.getState().inv),{});
});
test('real existing PD1 promo resolves to its own printing, not regular release thirteen',()=>{
 const h=real(),r=h.api.resolveNumberLine('3/PD1 · EN · 13');assert.equal(r.status,'exact');assert.equal(r.card.id,'crd_74f93c661e41447bb38a29b3b68bcb32');assert.equal(r.card.s,'PD1');
});
test('missing photographed promo is not regular Above the Crowd or Nick Wilde',()=>{
 const h=real(),r=h.api.resolveNumberLine('11/PD1 · EN · 14');assert.equal(r.status,'missing');assert.equal(r.card,null);assert.equal(h.api.parseLine('11/PD1 EN 14'),null);h.api.reviewNumberLine('11/PD1 EN 14');assert.match(h.el('scanResolution').textContent,/PD1 #11/);assert.match(h.el('scanResolution').textContent,/Nothing was added/);assert.deepEqual(json(h.api.getState().inv),{});
});
test('all current catalog identities remain explicitly searchable without truncation or cap loss',()=>{
 const h=real(),d=actualCatalog();for(const c of d.cards){const r=h.api.searchPrintings(c.s+' '+c.c,'all');assert(['exact','ambiguous'].includes(r.status),c.s+' '+c.c);assert(r.candidates.some(x=>x.id===c.id),c.id);}
});
test('slash promo references beat a coincidentally known numeric set in manual search',()=>{
 const h=real();for(const [q,id] of [['43/P3','crd_4a3d97e5bcff49c2883e5764be3fd43b'],['3/PD1','crd_74f93c661e41447bb38a29b3b68bcb32']])assert.equal(h.api.searchPrintings(q).card?.id,id);assert.equal(h.api.searchPrintings('11/PD1').status,'missing');
});
test('suffixed collectors and long special set codes retain their complete identities',()=>{
 const h=real(),d=actualCatalog();for(const [s,c] of [['P2','24B'],['P1','25ja'],['P1','25zh'],['3','4a'],['3','4e']]){const expected=d.cards.find(x=>x.s===s&&x.c===c);assert(expected);assert.equal(h.api.searchPrintings(s+' '+c).card.id,expected.id);}
 for(const s of ['Coconut','DIS','D23','CC1','cp']){const expected=d.cards.find(x=>x.s===s);assert.equal(h.api.resolveNumberLine(expected.c+'/'+s+' EN 14').card.id,expected.id);}
 assert.equal(h.api.searchPrintings('P2 24Z').status,'missing');assert.equal(h.api.resolveNumberLine('24Z/P2 EN 7').card,null);
});
test('multiple explicit references or unknown explicit promo never choose a regular fallback',()=>{
 const h=real();assert.equal(h.api.resolveNumberLine('43/P3 EN12 3/PD1 EN13').status,'ambiguous');assert.equal(h.api.resolveNumberLine('11/PD1 EN14 11/204 EN14').status,'ambiguous');assert.equal(h.api.resolveNumberLine('11/PD1 EN14 11/204 EN14').card,null);assert.equal(h.api.resolveNumberLine('TV/PD1 EN14').card,null);assert.equal(h.api.resolveNumberLine('11/PD199 EN14').card,null);
});
test('an incomplete promo footer followed by a regular footer stays ambiguous and non-mutating',()=>{
 const h=real(),r=h.api.reviewNumberLine('43/P3 EN 1/204 EN12');assert.equal(r.status,'ambiguous');assert.equal(r.card,null);assert.equal(h.api.parseLine('43/P3 EN 1/204 EN12'),null);assert.match(h.el('scanResolution').textContent,/Multiple printing/);assert.deepEqual(json(h.api.getState().inv),{});
});
test('show-more reaches all special printings, resets scope pagination and never adds cards',()=>{
 const h=real();h.api.setScanPrintingScope('promo');h.el('q').value='';h.api.renderQuick();const count=()=>[...h.el('qres').innerHTML.matchAll(/data-act="add"/g)].length;assert.equal(count(),30);const event=h.events.find(x=>x.id==='qres'&&x.type==='click');assert(event);const total=h.api.searchPrintings('','promo').candidates.length;for(let i=0;i<Math.ceil(total/30);i++)event.fn({target:{closest:s=>s==='[data-more-printings]'?{}:null}});assert.equal(count(),total);h.api.setScanPrintingScope('all');h.api.setScanPrintingScope('promo');assert.equal(count(),30);assert.deepEqual(json(h.api.getState().inv),{});assert.equal(h.network.length,0);
});
test('duplicate catalog printing reference is ambiguous instead of last-row wins',()=>{
 const h=real(),d=actualCatalog(),c=d.cards.find(x=>x.s==='P3'&&x.c==='43');d.cards.push({...c,id:'synthetic-duplicate-printing'});h.api.setCatalog(d);const r=h.api.resolveNumberLine('43/P3 EN12');assert.equal(r.status,'ambiguous');assert.equal(r.card,null);assert.equal(r.candidates.length,2);assert.equal(h.api.parseLine('43/P3 EN12'),null);
});
test('promo scope filters before limit and includes non-Promo rarities in special sets',()=>{
 const h=real(),d=actualCatalog(),special=d.cards.filter(c=>c.r==='Promo'||!/^[0-9]+$/.test(c.s));assert(special.some(c=>c.r!=='Promo'));const r=h.api.searchPrintings('','promo');assert.equal(r.candidates.length,special.length);assert(h.api.quickSearch('',30,'promo').every(c=>c.r==='Promo'||!/^[0-9]+$/.test(c.s)));for(const c of special.filter(x=>x.r!=='Promo'))assert.equal(h.api.searchPrintings(c.s+' '+c.c,'promo').card.id,c.id);
});
test('promo-only mode refuses an ordinary numeric footer without changing inventory',()=>{
 const h=real();assert.equal(h.api.resolveNumberLine('11/204 EN14','all').card.id,'crd_44606b91eae5430e9ee3290986734dbd');assert.equal(h.api.resolveNumberLine('11/204 EN14','promo').status,'blocked');h.api.setScanPrintingScope('promo');assert.equal(h.api.parseLine('11/204 EN14'),null);h.api.setScanPrintingScope('all');assert.equal(h.api.parseLine('11/204 EN14').s,'14');assert.deepEqual(json(h.api.getState().inv),{});assert.equal(h.network.length,0);
});
test('source-backed supplemental promo stays distinct, attributed and unpriced in every finish',()=>{
 const h=real();h.api.setSupplement(actualSupplement());h.api.setCatalog(actualCatalog());const r=h.api.resolveNumberLine('11/PD1 EN14');assert.equal(r.status,'exact');assert.equal(r.card.id,'tcgplayer_722993');assert.equal(r.card.n,'Above the Crowd');assert.equal(r.card.s,'PD1');assert(r.card.supplemental);for(const f of ['normal','foil','rainbow'])assert.equal(h.api.priceOf(r.card,f),null);assert.equal(r.card.iv,null);const html=h.api.cardDetailHTML(r.card);assert.match(html,/Hyperia City/);assert.match(html,/TCGplayer/);assert.doesNotMatch(html,/cards\.lorcast\.io[^\s"']*tcgplayer_722993/);assert.deepEqual(json(h.api.getState().inv),{});
});
test('future Lorcast identity cannot silently replace an already-owned supplemental printing',()=>{
 const h=real(),d=actualCatalog(),source=d.cards.find(c=>c.s==='14'&&c.c==='95');h.api.setSupplement(actualSupplement());d.cards.push({...source,id:'synthetic-future-lorcast-promo',s:'PD1',sn:'PD1',c:'11',r:'Promo',t:722993});h.api.setState({inv:{tcgplayer_722993:{q:0,f:1}}});h.api.setCatalog(d);const r=h.api.resolveNumberLine('11/PD1 EN14');assert.equal(r.status,'ambiguous');assert.equal(r.candidates.length,2);assert.deepEqual(json(h.api.getState().inv),{tcgplayer_722993:{q:0,f:1}});
});
test('exact supplemental ID, all quantities and provider provenance round-trip through versioned CSV',async()=>{
 const h=real();h.api.setSupplement(actualSupplement());h.api.setCatalog(actualCatalog());h.api.setState({inv:{tcgplayer_722993:{q:1,f:2,rf:3},'unresolved-provider-id':{q:0,f:1}}});const csv=h.api.buildCsv();assert.match(csv,/InkScan v6 Printing ID/);assert.match(csv,/InkScan v6 Provider/);assert.doesNotMatch(csv.split('\r\n')[0],/Lorcast ID/);assert.match(csv,/TCGplayer/);assert.match(csv,/Hyperia City/);assert.match(csv,/https:\/\//);await chooseRestore(h,csv);h.el('confirmRestore').onclick();assert.deepEqual(json(h.api.getState().inv),{tcgplayer_722993:{q:1,f:2,rf:3},'unresolved-provider-id':{q:0,f:1}});
});
test('ambiguous legacy set/number CSV cannot overwrite saved ownership',async()=>{
 const h=real(),d=actualCatalog(),c=d.cards.find(x=>x.s==='P3'&&x.c==='43');d.cards.push({...c,id:'synthetic-duplicate'});h.api.setCatalog(d);h.api.setState({inv:{preserved:{q:2,f:1,rf:4}}});await chooseRestore(h,'Set Code,Card Number,Finish,Quantity\nP3,43,Foil,2');assert.deepEqual(json(h.api.getState().inv),{preserved:{q:2,f:1,rf:4}});assert.match(h.el('toast').textContent,/stopped|invalid|unrecognized/i);
});
test('reindexing refreshed catalog always reapplies the supplemental printing without duplication',()=>{
 const h=real();h.api.setSupplement(actualSupplement());for(let i=0;i<3;i++){const d=actualCatalog();d.asof='2026-10-26';h.api.setCatalog(d);assert.equal(h.api.getCatalog().cards.filter(c=>c.id==='tcgplayer_722993').length,1);assert.equal(h.api.resolveNumberLine('11/PD1 EN14').card.id,'tcgplayer_722993');}assert.equal(h.network.length,0);
});
test('exact promo provider quote values generic foil only; stale, mismatched and failed reload stay unpriced',async()=>{
 const h=real();h.api.setSupplement(actualSupplement());h.api.setCatalog(actualCatalog());const file=JSON.parse(fs.readFileSync(path.join(root,'finish-quotes.json'))),key='tcgplayer_722993|provider:Holofoil';const fresh=()=>{const f=json(file);f.promoFoilQuotes[key].buildAsOf=new Date(Date.now()-1000).toISOString();f.promoFoilQuotes[key].observedAt=new Date().toISOString();return f;};
 async function load(f){h.context.fetch=async url=>{assert.equal(url,'finish-quotes.json');return new Response(JSON.stringify(f));};await h.api.loadFinishQuotes();}
 let card=h.api.getCatalog().cards.find(c=>c.id==='tcgplayer_722993');await load(fresh());assert.equal(h.api.priceOf(card,'foil'),4.2);assert.equal(h.api.priceOf(card,'normal'),null);assert.equal(h.api.priceOf(card,'rainbow'),null);h.api.setState({inv:{tcgplayer_722993:{q:2,f:3,rf:4}}});assert.equal(h.api.totals().val,12.600000000000001);assert.equal(h.api.totals().unpriced,6);assert.match(h.api.cardDetailHTML(card),/Holofoil \(provider label\)/);
 for(const mutate of [q=>q.buildAsOf=new Date(Date.now()-8*86400000).toISOString(),q=>q.tcgplayerProductId=722445,q=>q.expectedPrinting.c='95',q=>q.rawSubtype='Cold Foil',q=>q.inventoryFinish='rainbow']){const f=fresh();mutate(f.promoFoilQuotes[key]);await load(f);assert.equal(h.api.priceOf(card,'foil'),null);assert.equal(h.api.priceOf(card,'normal'),null);assert.equal(h.api.priceOf(card,'rainbow'),null);}
 await load(fresh());h.context.fetch=async()=>{throw Error('Unavailable fixture');};await h.api.loadFinishQuotes();assert.equal(h.api.priceOf(card,'foil'),null);assert.equal(h.api.totals().unpriced,9);
});

test('complete older v6 Lorcast-ID CSV remains readable with exact rainbow quantities',async()=>{
 const h=real(),id='crd_ad5100c1182246a1a864abd42423f715';h.api.setState({inv:{[id]:{q:1,f:2,rf:3}}});let csv=h.api.buildCsv();const rows=csv.split('\r\n').map(line=>line.split(','));
 // Public catalog row chosen here has no commas in exported fields; old v6 had exactly 14 columns.
 const old=rows.map((row,i)=>row.slice(0,14).map(v=>i===0?v.replace('Printing ID','Lorcast ID'):v).join(',')).join('\r\n');await chooseRestore(h,old);h.el('confirmRestore').onclick();assert.deepEqual(json(h.api.getState().inv),{[id]:{q:1,f:2,rf:3}});
});
