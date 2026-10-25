'use strict';
// Exact-runtime dated Core eligibility integration. Synthetic state; no live network or user data.
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
 const context={InkSafety:S,InkCatalog:C,InkLegality:{createIndex:(c,r)=>require(path.join(runtime,'legality.js')).createIndex(c,r,Date.parse('2026-10-25T18:00:00Z'))},document:doc,localStorage,location:{origin:'https://raestin.github.io',pathname:'/inkscan/',protocol:'http:',href:'https://raestin.github.io/inkscan/'},navigator:{onLine:true},URL,Blob,Response,console,Date,Math,JSON,Map,Set,Promise,Number,Object,Array,String,Error,TypeError,encodeURIComponent,decodeURIComponent,parseInt,parseFloat,isFinite,MutationObserver:class{observe(){}disconnect(){}},IntersectionObserver:class{observe(){}disconnect(){}},history:{pushState(){},back(){}},setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){},setInterval(){throw Error('Unexpected interval');},fetch:async(...args)=>{network.push(args);throw Error('Unexpected network');}};
 context.window=context;context.addEventListener=(type,fn)=>events.push({id:'window',type,fn});context.scrollTo=()=>{};
 let source=fs.readFileSync(path.join(runtime,'app.js'),'utf8');
 source=source.replace('\nboot();','\n// boot suppressed only inside this test harness');
 source=source.replace('window.__inkscan =',`window.testAPI={loadCoreRules,legalityOf,legalityMatches,currentLegalityIndex,renderDeckAdd,resolveNumberLine,reviewNumberLine,parseLine,searchPrintings,quickSearch,setScanPrintingScope,setScanFinish,renderQuick,loadPromoCatalog,loadCards,loadFinishQuotes,finishPriceNote,buildCsv,priceOf,ownedNV,renderWish,deckStats,backupPayload,boot,totals,saveInv,saveDecks,saveWish,parseDeckImport,previewCollectionImport,previewRestore,collRows,renderCollCards,renderBrowse,resetBrowse,addQty,logAdd,openCard,cardDetailHTML,sync,guardedWrite,rest,reviewUpdate,renderSaveStatus,
  setState(s){inv=S.clone(s.inv||{});wish=S.clone(s.wish||{});decks=S.clone(s.decks||[]);base=s.base||null;session=Object.hasOwn(s,'session')?s.session:{uid:'synthetic-owner',access:'synthetic',exp:Date.now()+3600000};savedState=savedState||${JSON.stringify(state())};},
  getState(){return {inv,wish,decks,base,session,storageError,localRevision,syncState};},
  setRules(r){coreRules=r;coreRulesLoadError=null;legalityIndex=null;},setReview(fn){reviewUpdate=fn;},setRest(fn){rest=fn;},setDownload(fn){download=fn;},setRender(fn){renderAll=fn;},setCatalog(d){indexCards(d);},setSupplement(d){promoSupplement=d;},getCatalog(){return DB;},getWarnings(){return {promoLoadError,promoCatalogWarnings};},setInk(i){collInks.clear();if(i)collInks.add(i);},setChunk(fn){chunked=fn;}};\nwindow.__inkscan =`);
 source=source.replace('inv=S.clone','inv=InkSafety.clone').replace('wish=S.clone','wish=InkSafety.clone').replace('decks=S.clone','decks=InkSafety.clone');
 vm.runInNewContext(source,context);context.testAPI.setCatalog(catalog());
 for(const id of ['cFinish','bFinish'])el(id).value='all';for(const id of ['sortSel','bSort'])el(id).value='set';
 return {api:context.testAPI,context,el,events,timers,network,storage:localStorage};
}
const json=x=>JSON.parse(JSON.stringify(x));
const real=()=>{const h=harness();h.api.setCatalog(actualCatalog());return h;};
const chooseRestore=async(h,text)=>h.el('fileIn').onchange({target:{files:[{text:async()=>text}],value:'synthetic-file'}});
const rules=()=>JSON.parse(fs.readFileSync(path.join(root,'core-rules.json')));
const ready=()=>{const h=real();h.api.setRules(rules());h.api.setSupplement(actualSupplement());h.api.setCatalog(actualCatalog());return h;};
const printing=(h,id)=>h.api.getCatalog().cards.find(c=>c.id===id);
test('actual-app reprints, current Hyperia and exact supplemental promo use dated policy instead of lc',()=>{
 const h=ready();for(const id of ['crd_cc8e7afe0f344c32b64446caf7b31456','crd_2a6cd27f6ba44515827ed800f377cdbd','crd_ad5100c1182246a1a864abd42423f715','tcgplayer_722993'])assert.equal(h.api.legalityOf(printing(h,id)).status,'legal',id);
 const different=printing(h,'crd_fcb0a2f9a4044b86bba8e0ff3ade2988');assert.equal(h.api.legalityOf(different).status,'not_legal');assert.equal(different.lc,1);
 const html=h.api.cardDetailHTML(printing(h,'tcgplayer_722993'));assert.match(html,/Standard legal/);assert.match(html,/2026-10-25/);assert.doesNotMatch(html,/Infinity only/);assert.deepEqual(json(h.api.getState().inv),{});
});
test('collection eligibility filter and reset change only visible rows, not inventory or decks',()=>{
 const h=ready(),legal='crd_cc8e7afe0f344c32b64446caf7b31456',retired='crd_fcb0a2f9a4044b86bba8e0ff3ade2988';h.api.setState({inv:{[legal]:{q:2,f:1,rf:1},[retired]:{q:3,f:0}},decks:[{id:'synthetic-deck',name:'Unchanged',cards:{'example|version':2}}]});
 const before=json(h.api.getState());h.el('cLegality').value='legal';assert.deepEqual(json(h.api.collRows().map(x=>x.c.id)),[legal]);h.el('cLegality').value='not_legal';assert.deepEqual(json(h.api.collRows().map(x=>x.c.id)),[retired]);h.el('cLegality').value='unknown';assert.equal(h.api.collRows().length,0);h.el('cReset').onclick();assert.equal(h.el('cLegality').value,'all');assert.equal(h.api.collRows().length,2);assert.deepEqual(json(h.api.getState()),before);assert.equal(h.network.length,0);
});
test('missing, stale and malformed rules fail closed and refresh replaces the policy cache',async()=>{
 const h=ready(),c=printing(h,'tcgplayer_722993');h.api.setRules(null);assert.equal(h.api.legalityOf(c).status,'unknown');assert.equal(h.api.legalityMatches(c,'legal'),false);
 h.api.setRules({...rules(),reviewDue:'2026-10-24'});assert.equal(h.api.legalityOf(c).status,'unknown');h.api.setRules({schemaVersion:999});assert.equal(h.api.legalityOf(c).status,'unknown');
 h.context.fetch=async url=>{assert.equal(url,'core-rules.json');return new Response(JSON.stringify(rules()));};await h.api.loadCoreRules();assert.equal(h.api.legalityOf(c).status,'legal');
 h.context.fetch=async()=>{throw Error('offline');};await h.api.loadCoreRules();assert.equal(h.api.legalityOf(c).status,'unknown');assert.deepEqual(json(h.api.getState().inv),{});
});
test('browse eligibility filter excludes unknown without any implicit card save',()=>{
 const h=ready(),d=actualCatalog();const source=d.cards.find(c=>c.s==='14'&&c.c==='95');d.cards.push({...source,id:'synthetic-future-printing',s:'15',c:'1',n:'Unverified Future Card',lc:1});h.api.setCatalog(d);const c=printing(h,'synthetic-future-printing');assert.equal(h.api.legalityOf(c).status,'unknown');
 h.el('bLegality').value='unknown';h.api.setChunk((el,more,list)=>{el.ids=list.map(c=>c.id);});h.api.renderBrowse();assert.deepEqual(json(h.el('bGrid').ids),['synthetic-future-printing']);h.api.resetBrowse();assert.equal(h.el('bLegality').value,'all');
 assert.deepEqual(json(h.api.getState().inv),{});assert.equal(h.network.length,0);
});

test('legacy deck-key collisions do not conflate exact-printing eligibility or ownership in Collection and Browse',()=>{
 const h=ready(),cards=h.api.getCatalog().cards,legal=cards.find(c=>c.n==='Pocahontas'&&c.v==='Peacekeeper'&&c.s==='11'),special=cards.find(c=>c.n==='Pocahontas'&&c.v==='"Peacekeeper"'&&c.s==='Coconut');assert(legal&&special);assert.equal(legal.nv,special.nv,'Regression requires existing lossy deck-key collision');h.api.setState({inv:{[special.id]:{q:1,f:0}}});const before=json(h.api.getState());
 assert.equal(h.api.legalityOf(legal).status,'legal');assert.equal(h.api.legalityOf(special).status,'not_legal');h.el('cLegality').value='legal';assert.equal(h.api.collRows().length,0);h.el('cLegality').value='not_legal';assert.deepEqual(json(h.api.collRows().map(x=>x.c.id)),[special.id]);
 h.el('bLegality').value='legal';h.el('bq').value='Pocahontas Peacekeeper';h.api.setChunk((el,more,list)=>{el.ids=list.map(c=>c.id);});h.api.renderBrowse();assert(h.el('bGrid').ids.includes(legal.id));assert(!h.el('bGrid').ids.includes(special.id));assert.deepEqual(json(h.api.getState()),before);const html=fs.readFileSync(path.join(runtime,'index.html'),'utf8');assert(!html.includes('id="dLegality"'),'unsafe deck picker filter deliberately deferred');
});
