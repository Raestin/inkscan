'use strict';
// Placeholder renderer regressions against this exact runtime. No source art or live network.
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
const root=path.resolve(__dirname,'../../..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const promos=()=>require(path.join(runtime,'catalog.js')).validateSupplement(read('promo-catalog.json'),read('cards.json'));
const json=value=>JSON.parse(JSON.stringify(value));
test('all six exact missing promos use accessible local placeholders without a manufactured image URL',()=>{
 const h=harness(),cards=promos();assert.equal(cards.length,6);
 for(const c of cards){
  assert.equal(h.api.imgUrl(c,'small'),'');assert.equal(h.api.imgUrl(c,'normal'),'');
  for(const html of [h.api.artHTML(c),h.api.thumbHTML(c),h.api.detailArtHTML(c)]){
   assert.match(html,/class="art-placeholder art-placeholder--(?:grid|thumb|detail)"/);assert.match(html,/data-art-placeholder/);assert.match(html,/role="img"/);assert.match(html,/aria-label="No image available for/);assert(html.includes(c.n));assert(html.includes(c.s+' #'+c.c));
   assert.match(html,/No image available<\/span>/);assert.doesNotMatch(html,/<img\b/);assert.doesNotMatch(html,/data-art-placeholder hidden/);assert.doesNotMatch(html,/cards\.lorcast\.io|lorcanaplayer\.com|tcgplayer-cdn/);
  }
 }
});
test('ordinary missing artwork uses the same placeholder while a genuine image remains primary and separately marked',()=>{
 const h=harness(),c=catalog().cards[0];
 for(const html of [h.api.artHTML(c),h.api.thumbHTML(c),h.api.detailArtHTML(c)]){assert.match(html,/No image available/);assert.doesNotMatch(html,/<img\b/);}
 c.iv='fixture';
 for(const html of [h.api.artHTML(c),h.api.thumbHTML(c),h.api.detailArtHTML(c)]){assert.match(html,/<img data-card-art /);assert.match(html,/data-art-placeholder hidden/);assert.doesNotMatch(html,/<img[^>]*no-image\.svg/);assert.match(html,/cards\.lorcast\.io\/card\/digital\//);}
 assert.match(h.api.detailArtHTML(c),/data-fallback-src=/);assert.doesNotMatch(h.api.thumbHTML(c),/data-fallback-src=/);
});
function errorImage(fallback){
 const state={visible:false,removed:false,requests:0};let current='https://example.invalid/normal';
 const img={dataset:fallback?{fallbackSrc:fallback}:{},get src(){return current;},set src(value){current=value;state.requests++;},removeAttribute(name){if(name==='data-fallback-src')delete this.dataset.fallbackSrc;},nextElementSibling:{removeAttribute(name){if(name==='hidden')state.visible=true;}},remove(){state.removed=true;}};
 return {state,img};
}
test('error handler reveals the sibling HTML placeholder and consumes at most one normal-to-small retry',()=>{
 const h=harness(),failure=new Function(h.api.IMAGE_ERROR);
 let result=errorImage();failure.call(result.img);assert.deepEqual(result.state,{visible:true,removed:true,requests:0});
 result=errorImage('https://example.invalid/small');failure.call(result.img);assert.equal(result.state.requests,1);assert.equal(result.state.removed,false);assert.equal(result.img.dataset.fallbackSrc,undefined);failure.call(result.img);assert.deepEqual(result.state,{visible:true,removed:true,requests:1});failure.call(result.img);assert.equal(result.state.requests,1);
 result=errorImage('https://example.invalid/normal');failure.call(result.img);assert.deepEqual(result.state,{visible:true,removed:true,requests:0});
});
test('names versions and image attributes are escaped without hiding identity behind the decorative asset',()=>{
 const h=harness(),c={...catalog().cards[0],n:'Synthetic <name>',v:'"quoted" & version',s:'P<3',c:'2"3'};
 for(const html of [h.api.artHTML(c),h.api.thumbHTML(c),h.api.detailArtHTML(c)]){assert.match(html,/&lt;name&gt;/);assert.match(html,/&quot;/);assert.match(html,/&amp;/);assert.doesNotMatch(html,/<name>/);assert.match(html,/No image available/);}
 c.iv='v" onload="unsafe()';const html=h.api.detailArtHTML(c);assert.doesNotMatch(html,/ onload="unsafe/);assert.match(html,/&quot;/);
});
test('placeholder asset is original same-origin decorative SVG without scripts text or external references',()=>{
 const svg=fs.readFileSync(path.join(runtime,'no-image.svg'),'utf8'),css=fs.readFileSync(path.join(runtime,'app.css'),'utf8');
 assert.match(svg,/width="734" height="1024"/);assert.match(svg,/viewBox="0 0 734 1024"/);
 assert.doesNotMatch(svg,/<(?:script|image|foreignObject|iframe|text)\b|\bon\w+\s*=|\b(?:href|src)\s*=/i);
 assert.doesNotMatch(svg,/url\((?!#)/);assert.match(css,/background-image:url\("no-image\.svg"\)/);
 assert.match(css,/\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/);
});
test('placeholder rendering leaves inventory decks wishlist storage and cloud state unchanged',()=>{
 const h=harness(),cards=promos();h.api.setState({inv:{[cards[0].id]:{q:2,f:3,rf:4}},decks:[{id:'synthetic',name:'Keep',cards:{'synthetic|':2}}],wish:{[cards[0].id]:1}});
 const before=json(h.api.getState()),stored=[...h.storage.values];for(const c of cards){h.api.artHTML(c);h.api.thumbHTML(c);h.api.detailArtHTML(c);}
 assert.deepEqual(json(h.api.getState()),before);assert.deepEqual([...h.storage.values],stored);assert.equal(h.network.length,0);
});
