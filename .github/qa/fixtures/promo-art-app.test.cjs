'use strict';
// Public-card artwork regressions against this exact runtime. No user photos or live network.
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
 source=source.replace('window.__inkscan =',`window.testAPI={IMAGE_ERROR,imgUrl,artHTML,thumbHTML,detailArtHTML,loadPromoCatalog,quickSearch,loadCards,loadFinishQuotes,finishPriceNote,buildCsv,priceOf,ownedNV,renderWish,deckStats,backupPayload,boot,totals,saveInv,saveDecks,saveWish,parseDeckImport,previewCollectionImport,previewRestore,collRows,renderCollCards,renderBrowse,resetBrowse,addQty,logAdd,openCard,cardDetailHTML,sync,guardedWrite,rest,reviewUpdate,renderSaveStatus,
  setState(s){inv=S.clone(s.inv||{});wish=S.clone(s.wish||{});decks=S.clone(s.decks||[]);base=s.base||null;session=Object.hasOwn(s,'session')?s.session:{uid:'synthetic-owner',access:'synthetic',exp:Date.now()+3600000};savedState=savedState||${JSON.stringify(state())};},
  getState(){return {inv,wish,decks,base,session,storageError,localRevision,syncState};},
  setReview(fn){reviewUpdate=fn;},setRest(fn){rest=fn;},setDownload(fn){download=fn;},setRender(fn){renderAll=fn;},setCatalog(d){indexCards(d);},setInk(i){collInks.clear();if(i)collInks.add(i);},setChunk(fn){chunked=fn;}};\nwindow.__inkscan =`);
 source=source.replace('inv=S.clone','inv=InkSafety.clone').replace('wish=S.clone','wish=InkSafety.clone').replace('decks=S.clone','decks=InkSafety.clone');
 vm.runInNewContext(source,context);context.testAPI.setCatalog(catalog());
 for(const id of ['cFinish','bFinish'])el(id).value='all';for(const id of ['sortSel','bSort'])el(id).value='set';
 return {api:context.testAPI,context,el,events,timers,network,storage:localStorage};
}
const json=x=>JSON.parse(JSON.stringify(x));
const root=path.resolve(__dirname,'../../..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const copied=value=>JSON.parse(JSON.stringify(value));
function artSupplement(){
 const supplement=read('promo-catalog.json');
 assert.equal(supplement.records.length,6,'All six approved promo records must be staged');
 for(const entry of supplement.records)assert(entry.artwork,'Each shipped promo must carry its actual approved artwork mapping');
 return supplement;
}
async function loadArt(h,supplement=artSupplement()){
 h.context.fetch=async url=>{assert.equal(url,'promo-catalog.json','Only the same-origin public catalog fixture may be requested');return new Response(JSON.stringify(supplement));};
 await h.api.loadPromoCatalog();h.api.setCatalog(read('cards.json'));
 return supplement.records.map(entry=>{const card=h.api.quickSearch(entry.printing.s+' '+entry.printing.c).find(c=>c.id===entry.id);assert(card);return card;});
}
test('all six exact supplemental images render in grids, thumbnails and details with no referrer',async()=>{
 const h=harness(),cards=await loadArt(h);assert.equal(cards.length,6);
 for(const c of cards){
  const url=c.supplemental.artwork.url;assert.equal(h.api.imgUrl(c,'small'),url);assert.equal(h.api.imgUrl(c,'normal'),url);
  for(const html of [h.api.artHTML(c),h.api.thumbHTML(c),h.api.detailArtHTML(c)]){
   assert(html.includes(`src="${url}"`));assert.match(html,/referrerpolicy="no-referrer"/);assert.match(html,/data-art-placeholder hidden/);assert.doesNotMatch(html,/data-fallback-src=/);assert.doesNotMatch(html,/cards\.lorcast\.io/);
  }
  const detail=h.api.cardDetailHTML(c);assert.match(detail,/Artwork source/);assert.match(detail,/no base-card image substitution/);assert.equal(c.iv,null);assert.equal(c.p,null);assert.equal(c.pf,null);assert.equal(c.prf,null);
 }
});
test('missing artwork and untrusted provider namespace never manufacture a Lorcast URL',async()=>{
 const h=harness(),supplement=artSupplement();supplement.records.forEach(entry=>delete entry.artwork);const cards=await loadArt(h,supplement);
 for(const c of cards){assert.equal(h.api.imgUrl(c,'normal'),'');assert.doesNotMatch(h.api.detailArtHTML(c),/<img\b/);assert.match(h.api.detailArtHTML(c),/Artwork unavailable/);assert.doesNotMatch(h.api.detailArtHTML(c),/data-art-placeholder hidden/);}
 assert.equal(h.api.imgUrl({id:'tcgplayer_722993',iv:'malformed'},'normal'),'');assert.equal(h.api.imgUrl(null,'small'),'');
});
test('changed identity, product and non-approved artwork URLs fail closed without a base image',async()=>{
 const h=harness(),[original]=await loadArt(h);
 for(const mutate of [c=>c.c='999',c=>c.supplemental.artwork.productId++,c=>c.supplemental.artwork.url='https://unapproved.example/card.jpg',c=>c.supplemental.artwork.url=c.supplemental.artwork.url.replace(/\.jpg$/,'.png'),c=>c.supplemental.artwork.url+='?redirect=other',c=>c.supplemental.artwork.url='javascript:alert(1)']){
  const card=copied(original);mutate(card);assert.equal(h.api.imgUrl(card,'normal'),'');assert.doesNotMatch(h.api.detailArtHTML(card),/<img\b/);
 }
});
function errorImage(fallback){
 const state={visible:false,removed:false,requests:0};let current='https://example.invalid/normal';
 const img={dataset:fallback?{fallbackSrc:fallback}:{},get src(){return current;},set src(value){current=value;state.requests++;},removeAttribute(name){if(name==='data-fallback-src')delete this.dataset.fallbackSrc;},nextElementSibling:{removeAttribute(name){if(name==='hidden')state.visible=true;}},remove(){state.removed=true;}};
 return {state,img};
}
test('failure removes a promo image immediately; normal fallback is consumed once then stops',()=>{
 const h=harness(),failure=new Function(h.api.IMAGE_ERROR);
 let result=errorImage();failure.call(result.img);assert.deepEqual(result.state,{visible:true,removed:true,requests:0});
 result=errorImage('https://example.invalid/small');failure.call(result.img);assert.equal(result.state.requests,1);assert.equal(result.state.removed,false);assert.equal(result.img.dataset.fallbackSrc,undefined);failure.call(result.img);assert.deepEqual(result.state,{visible:true,removed:true,requests:1});failure.call(result.img);assert.equal(result.state.requests,1);
 result=errorImage('https://example.invalid/normal');failure.call(result.img);assert.deepEqual(result.state,{visible:true,removed:true,requests:0});
});
test('normal art attributes remain escaped and the normal-to-small fallback is retained',()=>{
 const h=harness(),card={...catalog().cards[0],id:'crd_synthetic',n:'Synthetic <name>',v:'"quoted" & version',iv:'v" onload="unsafe()'};
 const detail=h.api.detailArtHTML(card);assert.match(detail,/data-fallback-src=/);assert.match(detail,/&quot;/);assert.match(detail,/&lt;name&gt;/);assert.match(detail,/&amp;/);assert.doesNotMatch(detail,/ onload="unsafe/);assert.doesNotMatch(detail,/<name>/);assert.match(detail,/cards\.lorcast\.io\/card\/digital\/normal/);assert.match(detail,/cards\.lorcast\.io\/card\/digital\/small/);
});
test('artwork renderers do not modify collection, decks, wishlist, durable storage or cloud state',async()=>{
 const h=harness(),cards=await loadArt(h);h.api.setState({inv:{[cards[0].id]:{q:2,f:3,rf:4}},decks:[{id:'synthetic',name:'Preserve',cards:{'synthetic|':2}}],wish:{[cards[0].id]:1}});
 const before=json(h.api.getState()),stored=[...h.storage.values];for(const card of cards){h.api.artHTML(card);h.api.thumbHTML(card);h.api.detailArtHTML(card);h.api.cardDetailHTML(card);}
 assert.deepEqual(json(h.api.getState()),before);assert.deepEqual([...h.storage.values],stored);assert.equal(h.network.length,0);
});
