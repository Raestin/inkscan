const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const S=require('./safety.js');
const empty=()=>({inv:{},wish:{},decks:{}});
function storage(seed={}){const values=new Map(Object.entries(seed));return {fail:false,getItem:k=>values.has(k)?values.get(k):null,setItem(k,v){if(this.fail)throw Error('Quota exceeded');values.set(k,v);},values};}
const state=()=>S.load(storage());
const catalog=(n=3)=>({asof:new Date().toISOString().slice(0,10),sets:[{code:'1',name:'Synthetic set'}],cards:Array.from({length:n},(_,i)=>({id:'card'+i,n:'Synthetic '+i,v:'Test',s:'1',sn:'Synthetic set',c:String(i),i:i%2?'Ruby':'Amber',r:'Common',cl:'Test',tx:'Text',ty:'Character',co:2,ik:1,p:2,pf:5,iv:null}))});
function harness(seed={}){
 const elements=new Map(), events=[], timers=[], network=[], localStorage=storage(seed);
 function el(id){if(!elements.has(id))elements.set(id,{id,value:'',hidden:false,dataset:{},style:{},textContent:'',innerHTML:'',classList:{toggle(){},add(){},remove(){}},addEventListener(type,fn){events.push({id,type,fn});},setAttribute(){},getAttribute(){return 'false';},removeAttribute(){},querySelector(){return el('child');},querySelectorAll(){return[];},getContext(){return{};},appendChild(){},click(){},remove(){},insertAdjacentHTML(){},select(){}});return elements.get(id);}
 const doc={getElementById:el,querySelector:el,querySelectorAll:()=>[],createElement:el,addEventListener(type,fn){events.push({id:'document',type,fn});},body:el('body'),hidden:false};
 const context={InkSafety:S,InkCatalog:require('./catalog.js'),InkLegality:require('./legality.js'),InkGames:require('./games.js'),document:doc,localStorage,location:{origin:'https://raestin.github.io',pathname:'/inkscan/',protocol:'http:',href:'https://raestin.github.io/inkscan/'},navigator:{onLine:true},URL,Blob,Response,console,Date,Math,JSON,Map,Set,Promise,Number,Object,Array,String,Error,TypeError,encodeURIComponent,decodeURIComponent,parseInt,parseFloat,isFinite,MutationObserver:class{observe(){}disconnect(){}},IntersectionObserver:class{observe(){}disconnect(){}},history:{pushState(){},back(){}},setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){},setInterval(){throw Error('Unexpected interval');},fetch:async(...args)=>{network.push(args);throw Error('Unexpected network');}};
 context.window=context;context.addEventListener=(type,fn)=>events.push({id:'window',type,fn});context.scrollTo=()=>{};
 let source=fs.readFileSync(__dirname+'/app.js','utf8');
 source=source.replace('\nboot();','\n// boot suppressed only inside this test harness');
 source=source.replace('window.__inkscan =',`window.testAPI={boot,totals,saveInv,saveDecks,saveWish,parseDeckImport,previewCollectionImport,previewRestore,collRows,renderCollCards,renderBrowse,resetBrowse,addQty,logAdd,openCard,cardDetailHTML,sync,guardedWrite,rest,reviewUpdate,renderSaveStatus,deckAdd,deckStats,searchPrintings,persistState,
  setState(s){inv=S.clone(s.inv||{});wish=S.clone(s.wish||{});decks=S.clone(s.decks||[]);base=s.base||null;session=Object.hasOwn(s,'session')?s.session:{uid:'synthetic-owner',access:'synthetic',exp:Date.now()+3600000};savedState=savedState||${JSON.stringify(state())};},
  getState(){return {inv,wish,decks,base,session,storageError,localRevision,syncState};},
  setReview(fn){reviewUpdate=fn;},setRest(fn){rest=async(...args)=>{if(args[0]==='GET'&&args[1].includes('select=rainbow_foil'))return [];const value=await fn(...args);return args[0]==='GET'&&args[1].startsWith('collection')&&Array.isArray(value)?value.map(row=>({rainbow_foil:0,...row})):value;};},setDownload(fn){download=fn;},setRender(fn){renderAll=fn;},setCatalog(d){indexCards(d);},setInk(i){collInks.clear();if(i)collInks.add(i);},setChunk(fn){chunked=fn;}};\nwindow.__inkscan =`);
 source=source.replace('inv=S.clone','inv=InkSafety.clone').replace('wish=S.clone','wish=InkSafety.clone').replace('decks=S.clone','decks=InkSafety.clone');
 vm.runInNewContext(source,context);context.testAPI.setCatalog(catalog());
 for(const id of ['cFinish','bFinish'])el(id).value='all';for(const id of ['sortSel','bSort'])el(id).value='set';
 return {api:context.testAPI,context,el,events,timers,network,storage:localStorage};
}
const json=x=>JSON.parse(JSON.stringify(x));
test('legacy migration retains unknown printings and foil quantities without modifying legacy keys',()=>{const st=storage({'inkscan.inv':JSON.stringify({unknown:{q:2,f:3}})});const loaded=S.load(st);S.save(st,loaded);assert.deepEqual(loaded.inv,{unknown:{q:2,f:3}});assert.equal(st.values.get('inkscan.inv'),'{"unknown":{"q":2,"f":3}}');});
test('atomic save failure leaves previous durable snapshot intact',()=>{const st=storage();const original=state();original.inv={a:{q:2,f:0}};S.save(st,original);st.fail=true;assert.throws(()=>S.save(st,{...original,inv:{a:{q:99,f:0}}}));assert.equal(S.load(st).inv.a.q,2);});
test('corrupt existing state is a recovery error, never empty fallback',()=>{assert.throws(()=>S.load(storage({[S.KEY]:'{bad'})));assert.throws(()=>S.load(storage({'inkscan.inv':'{bad'})));});
test('unknown IDs remain included in overall owned counts',()=>{const h=harness();h.api.setState({inv:{unknown:{q:2,f:3}}});assert.equal(h.api.totals().copies,5);assert.equal(h.api.totals().u,1);});
test('collection/deck/wishlist save failure visibly persists and never triggers cloud calls',()=>{const h=harness();h.api.setState({inv:{a:{q:1,f:0}},decks:[{id:'d',name:'Synthetic',cards:{x:1}}],wish:{a:1}});h.storage.fail=true;h.api.saveInv();h.api.saveDecks();h.api.saveWish();assert.match(h.el('saveStatus').textContent,/could not be confirmed/);assert.equal(h.network.length,0);});
test('edits, online and focus cannot automatically sync',()=>{const h=harness();h.api.setState({});h.api.addQty('card0',false,1);for(const e of h.events.filter(e=>['online','visibilitychange'].includes(e.type)))e.fn();assert.equal(h.network.length,0);assert.equal(h.timers.filter(t=>t.ms===2500||t.ms===180000).length,0);assert.doesNotMatch(fs.readFileSync(__dirname+'/app.js','utf8'),/sync\(false\)|scheduleSync|setInterval\(/);});
test('three-way same-item conflicts preserve both sides and abort',()=>{const local=empty(),remote=empty(),base=empty();base.inv.a={q:1,f:0};local.inv.a={q:2,f:0};remote.inv.a={q:3,f:0};const plan=S.plan(local,remote,base);assert.equal(plan.conflicts.length,1);assert.equal(local.inv.a.q,2);assert.equal(remote.inv.a.q,3);});
test('deletion versus concurrent edit conflicts, not silent deletion',()=>{const local=empty(),remote=empty(),base=empty();base.decks.d={name:'Synthetic',cards:{x:1}};remote.decks.d={name:'Synthetic',cards:{x:2}};assert.equal(S.plan(local,remote,base).conflicts.length,1);});
test('same-value acknowledgement after failed receipt is safe to retry',()=>{const local=empty(),remote=empty();local.inv.a={q:2,f:1};remote.inv.a={q:2,f:1};const p=S.plan(local,remote,empty());assert.equal(p.conflicts.length,0);assert.equal(p.writes.length,0);});
test('pull application preserves edits made during asynchronous update',()=>{const captured=empty(),current=empty();captured.inv.a={q:1,f:0};current.inv.a={q:2,f:0};const actual=S.applyPulls(current,captured,[{section:'inv',id:'a',value:{q:8,f:0}}]);assert.equal(actual.inv.a.q,2);});
test('manual update cancellation makes zero writes and retains collection',async()=>{const h=harness();h.api.setState({inv:{card0:{q:2,f:1}}});const calls=[];h.api.setRest(async(method,path)=>{calls.push({method,path});return[];});h.api.setReview(async()=>false);await h.api.sync(true);assert.equal(calls.filter(c=>c.method!=='GET').length,0);assert.equal(h.api.getState().inv.card0.q,2);assert.equal(h.api.getState().syncState.last,null);});
test('update conflict aborts before any writes',async()=>{const h=harness();h.api.setState({inv:{card0:{q:2,f:0}},base:{uid:'synthetic-owner',inv:{card0:{q:1,f:0}},wish:{},decks:{}}});const calls=[];h.api.setDownload(()=>{});h.api.setRest(async(method,path)=>{calls.push(method);return path.startsWith('collection')?[{card_id:'card0',q:3,f:0}]:[];});await h.api.sync(true);assert.equal(calls.filter(m=>m!=='GET').length,0);assert.match(h.api.getState().syncState.err,/changed both/);assert.equal(h.api.getState().inv.card0.q,2);});
test('server failure preserves local changes, no false success, retry remains pending',async()=>{const h=harness();h.api.setState({inv:{card0:{q:2,f:1}}});h.api.setReview(async()=>true);h.api.setRest(async(method)=>{if(method==='GET')return[];throw Error('Synthetic offline failure');});await h.api.sync(true);const st=h.api.getState();assert.equal(st.inv.card0.q,2);assert.equal(st.syncState.last,null);assert.match(st.syncState.err,/Synthetic offline/);assert.equal(S.pending(S.maps(st),st.base||empty()).inv,1);});
test('conditional PATCH returning no row is treated as concurrent edit',async()=>{const h=harness();let path;h.api.setState({});h.api.setRest(async(m,p)=>{path=p;return[];});await assert.rejects(h.api.guardedWrite({section:'inv',id:'card0',value:{q:2,f:0}},{updated_at:'2026-10-01T00:00:00Z',q:1,f:0}),/changed during/);assert.match(path,/updated_at=eq/);assert.match(path,/q=eq.1/);assert.match(path,/user_id=eq.synthetic-owner/);});
test('new rows use INSERT, never upsert overwrite',async()=>{const h=harness();let call;h.api.setState({});h.api.setRest(async(...args)=>{call=args;return[{card_id:'card0'}];});await h.api.guardedWrite({section:'inv',id:'card0',value:{q:1,f:0}},null);assert.equal(call[0],'POST');assert.doesNotMatch(call[1],/on_conflict/);assert.doesNotMatch(JSON.stringify(call[3]),/merge-duplicates/);});
test('manual Update disabled in development before network',async()=>{const h=harness();h.context.location.origin='http://localhost:8000';h.api.setState({inv:{card0:{q:1,f:0}}});await h.api.sync(true);assert.match(h.api.getState().syncState.err,/disabled in this isolated/);assert.equal(h.network.length,0);});
test('optional import adds every copy, preserves foil and protects confirmation double-submit',()=>{const old={card0:{q:2,f:1}}, items=[{cardId:'card0',finish:'normal',qty:4}];const r=S.collectionAddition(old,items,'receipt1',{});assert.deepEqual(r.inv.card0,{q:6,f:1});assert.equal(old.card0.q,2);assert.throws(()=>S.collectionAddition(r.inv,items,'receipt1',r.receipts),/already applied/);const repeat=S.collectionAddition(r.inv,items,'receipt2',r.receipts);assert.equal(repeat.inv.card0.q,10);});
test('import never guesses printing or finish; malformed/ambiguous lines retained',()=>{const h=harness();const data=catalog();data.cards[1].n='Synthetic 0';data.cards[1].v='Other';h.api.setCatalog(data);const parsed=h.api.parseDeckImport('4 Synthetic 0\n2 Unknown Name - Lost\nnot a line');assert.equal(Object.keys(parsed.cards).length,0);assert.equal(parsed.unresolved.length,3);assert.deepEqual(json(h.api.getState().inv),{});assert.throws(()=>S.collectionAddition({},[{cardId:'card0',finish:'',qty:4}],'x',{}));});
test('deck import keeps listed quantities above four without silently truncating',()=>{const h=harness();const parsed=h.api.parseDeckImport('6 Synthetic 0 - Test');assert.equal(parsed.cards['synthetic0|test'],6);assert.equal(parsed.lines[0].qty,6);assert.deepEqual(json(h.api.getState().inv),{});});
test('valuation uses independent normal/foil prices and quantities, no fallback',()=>{const rows=[{c:{p:2,pf:10},q:3,f:2}];assert.deepEqual(S.valuation(rows),{value:26,copies:5,unpriced:0,partial:false});assert.equal(S.valuation(rows,'normal').value,6);assert.equal(S.valuation(rows,'foil').value,20);assert.equal(S.valuation([{c:{p:2,pf:null},q:1,f:4}]).unpriced,4);});
test('missing, invalid and negative prices are partial; explicit zero is a valid price',()=>{const r=S.valuation([{c:{p:0,pf:NaN},q:1,f:2},{c:{p:-1,pf:'5'},q:3,f:4}]);assert.deepEqual(r,{value:0,copies:10,unpriced:9,partial:true});assert.deepEqual(S.valuation([]),{value:0,copies:0,unpriced:0,partial:false});});
test('collection summary reuses exact search and ink rows, resets and finish filter',()=>{const h=harness();h.api.setState({inv:{card0:{q:2,f:1},card1:{q:1,f:2}}});h.el('cf').value='Synthetic 0';h.api.renderCollCards();assert.match(h.el('cValue').textContent,/\$9.00 for 3 owned copies/);h.el('cFinish').value='foil';h.api.renderCollCards();assert.match(h.el('cValue').textContent,/\$5.00 for 1 owned copies/);h.el('cf').value='no match';h.api.renderCollCards();assert.match(h.el('cValue').textContent,/\$0.00 for 0 owned copies/);h.el('cReset').onclick();assert.match(h.el('cValue').textContent,/\$21.00 for 6 owned copies/);});
test('browse summary includes every filtered match before pagination',()=>{const h=harness();const d=catalog(120);h.api.setCatalog(d);const inv=Object.fromEntries(d.cards.map(c=>[c.id,{q:2,f:1}]));h.api.setState({inv});let rendered;h.api.setChunk((a,b,list)=>{rendered=list.slice(0,40);});h.api.renderBrowse();assert.equal(rendered.length,40);assert.match(h.el('bValue').textContent,/\$1,080.00 for 360 owned copies/);h.el('bSet').value='absent';h.api.renderBrowse();assert.match(h.el('bValue').textContent,/0 owned copies/);h.api.resetBrowse();h.api.renderBrowse();assert.match(h.el('bValue').textContent,/360 owned copies/);h.el('bFinish').value='foil';h.api.renderBrowse();assert.match(h.el('bValue').textContent,/\$600.00 for 120 owned copies/);});
test('successful explicit update saves acknowledged baseline and confirmed timestamp',async()=>{const h=harness();h.api.setState({inv:{card0:{q:2,f:1}}});h.api.setReview(async()=>true);h.api.setRest(async(method,path,row)=>method==='GET'?[]:[row]);await h.api.sync(true);const st=h.api.getState();assert.equal(st.syncState.err,null);assert.ok(st.syncState.last);assert.equal(S.pending(S.maps(st),st.base).total,0);assert.match(st.syncState.receipt,/1 item\(s\) sent/);assert.equal(S.load(h.storage).inv.card0.q,2);});
test('partially accepted update retains only unacknowledged changes for retry',async()=>{const h=harness();h.api.setState({inv:{card0:{q:2,f:0},card1:{q:3,f:0}}});h.api.setReview(async()=>true);let writes=0;h.api.setRest(async(method,path,row)=>{if(method==='GET')return[];if(++writes===2)throw Error('Synthetic network interruption');return[row];});await h.api.sync(true);const st=h.api.getState();assert.equal(st.syncState.last,null);assert.match(st.syncState.err,/1 item\(s\) already accepted/);assert.equal(S.pending(S.maps(st),st.base).inv,1);assert.equal(st.inv.card1.q,3);assert.equal(S.load(h.storage).base.inv.card0.q,2);});
test('read failure never mutates inventory or remembered baseline',async()=>{const h=harness();const baseline={uid:'synthetic-owner',inv:{card0:{q:1,f:0}},wish:{},decks:{}};h.api.setState({inv:{card0:{q:2,f:0}},base:baseline});h.api.setRest(async()=>{throw Error('Synthetic read failed');});await h.api.sync(true);assert.deepEqual(json(h.api.getState().base),baseline);assert.equal(h.api.getState().inv.card0.q,2);});
test('local edits while upload is in flight remain pending after acknowledgement',async()=>{const h=harness();h.api.setState({inv:{card0:{q:2,f:0}}});h.api.setReview(async()=>true);h.api.setRest(async(method,path,row)=>{if(method==='GET')return[];h.api.addQty('card0',false,1);return[row];});await h.api.sync(true);const st=h.api.getState();assert.equal(st.inv.card0.q,3);assert.equal(st.base.inv.card0.q,2);assert.equal(S.pending(S.maps(st),st.base).inv,1);});
test('local edit during preview aborts before writing outdated reviewed data',async()=>{const h=harness();h.api.setState({inv:{card0:{q:2,f:0}}});let writes=0;h.api.setReview(async()=>{h.api.addQty('card0',false,1);return true;});h.api.setRest(async(method)=>{if(method!=='GET')writes++;return[];});await h.api.sync(true);assert.equal(writes,0);assert.match(h.api.getState().syncState.err,/changed during review/);assert.equal(h.api.getState().inv.card0.q,3);});
test('read pagination includes equal-timestamp items past the first 1000',async()=>{const h=harness();h.api.setState({});const rows=Array.from({length:1001},(_,i)=>({card_id:'synthetic'+i,q:1,f:0,updated_at:'2026-10-24T00:00:00Z'}));let pulls=0;const paths=[];h.api.setReview(async p=>{pulls=p.pulls.length;return false;});h.api.setRest(async(method,path)=>{paths.push(path);const offset=Number(path.match(/offset=(\d+)/)[1]);return path.startsWith('collection')?rows.slice(offset,offset+1000):[];});await h.api.sync(true);assert.equal(pulls,1001);assert.ok(paths.some(p=>p.includes('offset=1000')));});
test('different account baseline aborts without accessing cloud',async()=>{const h=harness();h.api.setState({base:{uid:'another-synthetic-owner',...empty()}});let reads=0;h.api.setRest(async()=>{reads++;return[];});await h.api.sync(true);assert.equal(reads,0);assert.match(h.api.getState().syncState.err,/different account/);});
test('storage can recover from quota failure but never overwrites a changed other-tab snapshot',()=>{const st=storage();const initial=state();S.save(st,initial,null);const expected=st.getItem(S.KEY);st.fail=true;assert.throws(()=>S.save(st,initial,expected));st.fail=false;S.save(st,{...initial,revision:1},expected);assert.throws(()=>S.save(st,{...initial,revision:2},expected),/Another tab/);assert.equal(S.load(st).revision,1);});
test('REST 201 representation is read back for acknowledged INSERT',async()=>{const h=harness();h.api.setState({});h.context.fetch=async()=>new Response(JSON.stringify([{card_id:'synthetic',q:1,f:0}]),{status:201,headers:{'Content-Type':'application/json'}});const result=await h.api.rest('POST','collection',{q:1,f:0},{Prefer:'return=representation'});assert.equal(result.length,1);});
test('malformed restored snapshot is rejected before replacing collection',()=>{assert.throws(()=>S.validate({inv:[],wish:{},decks:[]}));assert.throws(()=>S.validate({inv:{a:{q:-1,f:0}},wish:{},decks:[]}));});
test('browse ownership and rarity filters control the same value result set',()=>{const h=harness();const data=catalog();data.cards[1].r='Rare';h.api.setCatalog(data);h.api.setState({inv:{card0:{q:2,f:0},card1:{q:1,f:2}}});h.api.setChunk(()=>{});h.el('bRar').value='Rare';h.el('bOwn').value='own';h.api.renderBrowse();assert.match(h.el('bValue').textContent,/\$12.00 for 3 owned copies/);h.el('bOwn').value='miss';h.api.renderBrowse();assert.match(h.el('bValue').textContent,/0 owned copies/);});

// Regression coverage for independent safety review (synthetic storage/network only).
function restoreHarness(){
 const initial={...state(),inv:{card0:{q:9,f:1}},decks:[{id:'d-old',name:'Keep until confirmed',cards:{'synthetic0|test':4}}],wish:{card1:2},imports:{oldReceipt:{at:'synthetic',items:[]}},base:{uid:'synthetic-owner',inv:{card0:{q:8,f:1}},wish:{},decks:{}}};
 const h=harness({[S.KEY]:JSON.stringify(initial)});h.api.setState(initial);return {h,initial};
}
async function chooseRestore(h,value){await h.el('fileIn').onchange({target:{value:'synthetic-file',files:[{text:async()=>typeof value==='string'?value:JSON.stringify(value)}]}});}
const restoreFile=()=>({app:S.BACKUP_APP,...state(),inv:{unknownPrinting:{q:3,f:2}},decks:[{id:'d-new',name:'Restored',cards:{},unresolved:['unrecognized source']}],wish:{card2:1},imports:{restoredReceipt:{at:'synthetic',items:[]}},base:{uid:'must-not-be-imported',inv:{},wish:{},decks:{}}});
test('incomplete and malformed backup files cannot clear live or durable data',async()=>{
 for(const backup of [{app:'inkscan'},{app:'inkscan',inv:{},decks:[]},{app:'inkscan',inv:null,decks:[],wish:{}},{app:'inkscan',inv:{bad:7},decks:[],wish:{}}]){
  const {h,initial}=restoreHarness(),raw=h.storage.getItem(S.KEY);await chooseRestore(h,backup);
  assert.deepEqual(json(h.api.getState().inv),initial.inv);assert.equal(h.storage.getItem(S.KEY),raw);assert.match(h.el('toast').textContent,/invalid|complete|missing/i);assert.equal(h.network.length,0);
 }
});
test('complete backup opens a non-mutating preview and cancel keeps existing state',async()=>{
 const {h,initial}=restoreHarness(),raw=h.storage.getItem(S.KEY);await chooseRestore(h,restoreFile());
 assert.match(h.el('sheetTitle').textContent,/Review device restore/);assert.match(h.el('sheetBody').innerHTML,/5 physical cards/);assert.match(h.el('sheetBody').innerHTML,/1 unknown printing/);
 assert.deepEqual(json(h.api.getState().inv),initial.inv);assert.equal(h.storage.getItem(S.KEY),raw);h.el('cancelRestore').onclick();assert.equal(h.storage.getItem(S.KEY),raw);
});
test('confirmed backup restore atomically retains recovery and local cloud baseline, once',async()=>{
 const {h,initial}=restoreHarness();const backup=restoreFile();await chooseRestore(h,backup);const confirm=h.el('confirmRestore').onclick;confirm();const raw=h.storage.getItem(S.KEY);confirm();
 const stored=S.load(h.storage);assert.equal(h.storage.getItem(S.KEY),raw);assert.deepEqual(stored.inv,backup.inv);assert.deepEqual(stored.decks,backup.decks);assert.deepEqual(stored.wish,backup.wish);assert.deepEqual(stored.imports,backup.imports);assert.deepEqual(stored.base,initial.base);
 assert.deepEqual(stored.recovery.at(-1).inv,initial.inv);assert.deepEqual(stored.recovery.at(-1).decks,initial.decks);assert.deepEqual(stored.recovery.at(-1).wish,initial.wish);assert.deepEqual(stored.recovery.at(-1).imports,initial.imports);assert.equal(stored.revision,1);assert.equal(h.network.length,0);
});
test('restore quota failure changes neither memory nor saved snapshot and retry is atomic',async()=>{
 const {h,initial}=restoreHarness(),raw=h.storage.getItem(S.KEY);await chooseRestore(h,restoreFile());h.storage.fail=true;h.el('confirmRestore').onclick();assert.equal(h.storage.getItem(S.KEY),raw);assert.deepEqual(json(h.api.getState().inv),initial.inv);assert.match(h.el('restoreError').textContent,/could not be confirmed/);
 h.storage.fail=false;h.el('confirmRestore').onclick();assert.equal(S.load(h.storage).inv.unknownPrinting.q,3);assert.equal(S.load(h.storage).recovery.length,1);
});
test('restore cannot overwrite another tab or local edits after preview',async()=>{
 const {h,initial}=restoreHarness();await chooseRestore(h,restoreFile());const other={...initial,revision:99,inv:{card1:{q:7,f:0}}};h.storage.setItem(S.KEY,JSON.stringify(other));h.el('confirmRestore').onclick();assert.deepEqual(S.load(h.storage).inv,other.inv);assert.deepEqual(json(h.api.getState().inv),initial.inv);assert.match(h.el('restoreError').textContent,/Another tab/);
 const second=restoreHarness().h;await chooseRestore(second,restoreFile());second.api.addQty('card0',false,1);second.el('confirmRestore').onclick();assert.equal(second.api.getState().inv.card0.q,10);assert.match(second.el('restoreError').textContent,/changed during review/);
});
test('legacy complete backup retains receipt metadata and still requires confirmation',async()=>{
 const {h,initial}=restoreHarness();await chooseRestore(h,{app:'inkscan',inv:{},decks:[],wish:{}});assert.equal(h.api.getState().inv.card0.q,9);h.el('confirmRestore').onclick();assert.deepEqual(S.load(h.storage).inv,{});assert.deepEqual(S.load(h.storage).imports,initial.imports);
});
test('CSV partial, unknown-ID and invalid-finish restores reject without clearing data',async()=>{
 for(const csv of ['Lorcast ID,Set Code,Card Number,Finish,Quantity\ncard0,1,0,Normal,1\nunknown,1,0,Normal,2','Lorcast ID,Finish,Quantity\ncard0,Unknown,2','Lorcast ID,Finish,Quantity\ncard0,Normal,1.5','Lorcast ID,Quantity\ncard0,2','Lorcast ID,Finish,Quantity']){
  const {h,initial}=restoreHarness(),raw=h.storage.getItem(S.KEY);await chooseRestore(h,csv);assert.equal(h.storage.getItem(S.KEY),raw);assert.deepEqual(json(h.api.getState().inv),initial.inv);assert.match(h.el('toast').textContent,/Nothing was replaced/);
 }
});
test('valid CSV restore is reviewed atomically and keeps decks and wishlist',async()=>{
 const {h,initial}=restoreHarness();await chooseRestore(h,'Lorcast ID,Finish,Quantity\ncard0,Normal,2\ncard0,Foil,3');assert.equal(h.api.getState().inv.card0.q,9);h.el('confirmRestore').onclick();const saved=S.load(h.storage);assert.deepEqual(saved.inv,{card0:{q:2,f:3}});assert.deepEqual(saved.decks,initial.decks);assert.deepEqual(saved.wish,initial.wish);assert.deepEqual(saved.recovery.at(-1).inv,initial.inv);
});
test('present null, false or scalar v5 state is corruption, never empty legacy fallback',()=>{
 for(const value of ['null','false','0','"bad"'])assert.throws(()=>S.load(storage({[S.KEY]:value})));
 assert.throws(()=>S.validate({inv:{bad:'not an inventory row'},decks:[],wish:{}}));
});
test('purchase accepts explicitly selected normal or foil even when its price is missing',()=>{
 for(const finish of ['normal','foil']){
  const h=harness();h.api.setState({inv:{card0:{q:2,f:1}}});const data=catalog();data.cards[0][finish==='normal'?'p':'pf']=null;h.api.setCatalog(data);
  h.api.previewCollectionImport({cards:{'synthetic0|test':4}});h.el('purchasePrint0').value='card0';h.el('purchaseFinish0').value=finish;h.el('previewPurchase').onclick();assert.match(h.el('sheetTitle').textContent,/Confirm collection additions/);
  const confirm=h.el('confirmPurchase').onclick;confirm();confirm();assert.deepEqual(json(h.api.getState().inv.card0),finish==='normal'?{q:6,f:1}:{q:2,f:5});
 }
});
test('scanner honors chosen finish and manual controls stay enabled without a market price',()=>{
 for(const foil of [false,true]){
  const h=harness();h.api.setState({});const data=catalog();data.cards[0][foil?'pf':'p']=null;h.api.setCatalog(data);const card=data.cards[0];h.api.logAdd(card,foil);
  assert.deepEqual(json(h.api.getState().inv.card0),foil?{q:0,f:1}:{q:1,f:0});assert.doesNotMatch(h.el('log').innerHTML,/disabled/);assert.doesNotMatch(h.api.cardDetailHTML(card),/aria-label="One more (?:normal|foil)"[^>]*disabled/);
 }
 const h=harness();h.api.setState({});h.el('q').value='Synthetic 0';h.el('foilBtn').onclick();assert.match(h.el('qres').innerHTML,/\$5\.00/);h.el('foilBtn').onclick();assert.match(h.el('qres').innerHTML,/\$2\.00/);
});
test('purchase uses current edited deck quantities while preserving unresolved original source',()=>{
 const h=harness();h.api.setState({});const parsed=h.api.parseDeckImport('4 Synthetic 0 - Test\n2 Unknown - Source\nunparsed original');
 const deck={cards:{'synthetic0|test':1,'synthetic1|test':2},importLines:parsed.lines,unresolved:parsed.unresolved};const original=JSON.stringify(deck);h.api.previewCollectionImport(deck);
 assert.match(h.el('sheetBody').innerHTML,/1 new copies: 1 Synthetic 0/);assert.match(h.el('sheetBody').innerHTML,/2 new copies: 2 Synthetic 1/);assert.doesNotMatch(h.el('sheetBody').innerHTML,/4 new copies/);assert.match(h.el('sheetBody').innerHTML,/2 new copies: 2 Unknown/);assert.equal(JSON.stringify(deck),original);
 h.el('purchasePrint0').value='card0';h.el('purchaseFinish0').value='normal';h.el('purchasePrint1').value='card1';h.el('purchaseFinish1').value='foil';h.el('purchasePrint2').value='__skip';h.el('previewPurchase').onclick();h.el('confirmPurchase').onclick();assert.deepEqual(json(h.api.getState().inv),{card0:{q:1,f:0},card1:{q:0,f:2}});
});
test('collection grid badges use the selected finish quantities',()=>{
 const h=harness();h.api.setState({inv:{card0:{q:2,f:3}}});h.el('cFinish').value='normal';h.api.renderCollCards();assert.match(h.el('coll').innerHTML,/<span class="badge">2<\/span>/);assert.doesNotMatch(h.el('coll').innerHTML,/>5<\/span>/);
 h.el('cFinish').value='foil';h.api.renderCollCards();assert.match(h.el('coll').innerHTML,/<span class="badge foil">3<\/span>/);
});
test('browse finish-specific tile prices, badges, sorting and missing cost agree with summaries',()=>{
 const h=harness();const data=catalog();data.cards[0].p=2;data.cards[0].pf=10;data.cards[1].p=20;data.cards[1].pf=3;data.cards[2].p=1;data.cards[2].pf=null;h.api.setCatalog(data);h.api.setState({inv:{card0:{q:2,f:1}}});let list,html;
 h.api.setChunk((a,b,items,render)=>{list=items;html=items.map(render).join('');});h.el('bFinish').value='foil';h.el('bSort').value='price';h.api.renderBrowse();assert.deepEqual(list.map(c=>c.id),['card0','card1','card2']);assert.match(html,/\$10\.00 foil/);assert.match(html,/<span class="badge foil">1<\/span>/);assert.match(html,/— foil/);assert.match(h.el('bValue').textContent,/\$10.00 for 1 owned copies/);
 h.el('bOwn').value='miss';h.api.renderBrowse();assert.match(h.el('bCount').textContent,/\$3.00 priced portion; 1 unpriced/);assert.doesNotMatch(html,/<span class="badge/);
 h.el('bFinish').value='normal';h.el('bOwn').value='';h.api.renderBrowse();assert.deepEqual(list.map(c=>c.id),['card1','card0','card2']);assert.match(html,/<span class="badge">2<\/span>/);assert.match(html,/\$2\.00 normal/);
});
test('manual normal and foil additions retain the selected finish when that price is absent',()=>{
 for(const field of ['q','f']){
  const h=harness();h.api.setState({});const data=catalog();data.cards[0][field==='q'?'p':'pf']=null;h.api.setCatalog(data);h.api.openCard('card0');assert.doesNotMatch(h.el('sheetBody').innerHTML,/aria-label="One more (?:normal|foil)"[^>]*disabled/);
  const handler=h.events.find(e=>e.id==='sheetBody'&&e.type==='click').fn;handler({target:{closest:selector=>selector==='[data-own]'?{dataset:{own:field,d:'1'}}:null}});assert.deepEqual(json(h.api.getState().inv.card0),field==='q'?{q:1,f:0}:{q:0,f:1});
 }
});
test('purchase preview rejects a concurrent cloud pull even without an edit revision change',async()=>{
 const initial={...state(),inv:{card0:{q:1,f:0},card1:{q:1,f:0}},base:{uid:'synthetic-owner',inv:{card0:{q:1,f:0}},decks:{},wish:{}}};
 const h=harness({[S.KEY]:JSON.stringify(initial)});h.api.setState(initial);h.api.setReview(async()=>true);let release,started;const startedPromise=new Promise(r=>started=r),gate=new Promise(r=>release=r);
 h.api.setRest(async(method,path,row)=>{if(method==='GET')return path.startsWith('collection')?[{card_id:'card0',q:2,f:0}]:[];started();await gate;return[row];});const running=h.api.sync(true);await startedPromise;
 h.api.previewCollectionImport({cards:{'synthetic0|test':4}});h.el('purchasePrint0').value='card0';h.el('purchaseFinish0').value='normal';h.el('previewPurchase').onclick();const revision=h.api.getState().localRevision;
 release();await running;assert.equal(h.api.getState().inv.card0.q,2);assert.equal(h.api.getState().localRevision,revision);h.el('confirmPurchase').onclick();assert.equal(h.api.getState().inv.card0.q,2);assert.match(h.el('purchaseError').textContent,/changed during review/);
});
test('updated app and safety scripts have matching versioned service-worker shell entries',()=>{
 const html=fs.readFileSync(__dirname+'/index.html','utf8'),sw=fs.readFileSync(__dirname+'/sw.js','utf8');
 for(const name of ['app','safety']){assert.match(html,new RegExp(name+'\\.js\\?v=17'));assert.ok(sw.includes(name+'.js?v=17'));}
 assert.match(sw,/const CACHE = 'inkscan-v17'/);assert.doesNotMatch(sw,/skipWaiting\s*\(|clients\.claim\s*\(/);
});

// Browser-discovered regression: null baseline + signed-out session must not match.
test('signed-out fresh state renders pending status and manual Update without a null baseline crash',()=>{
 const h=harness();h.api.setState({inv:{card0:{q:2,f:1}},session:null,base:null});
 assert.doesNotThrow(()=>h.api.renderSaveStatus());
 assert.equal(h.el('manualUpdate').textContent,'Update (1 pending)');
 assert.doesNotThrow(()=>h.el('manualUpdate').onclick());
 assert.match(h.el('sheetBody').innerHTML,/Signing in does not sync/);
 assert.equal(h.network.length,0);
});
test('fresh signed-out boot completes with synthetic catalog and no cloud request',async()=>{
 const initial={...state(),inv:{card0:{q:2,f:1}}};
 const h=harness({[S.KEY]:JSON.stringify(initial)});
 h.context.Tesseract={createWorker:async()=>({setParameters:async()=>{}})};
 h.context.fetch=async url=>{h.network.push(url);assert.ok(['cards.json','core-rules.json','finish-quotes.json','promo-catalog.json'].includes(url));return new Response(JSON.stringify(url==='cards.json'?catalog():{entries:{},productMappings:[],ambiguousFoilPrintings:[]}));};
 await h.api.boot();
 assert.equal(h.el('loadBanner').hidden,true);
 assert.equal(h.el('tCopies').textContent,'3');
 assert.equal(h.el('manualUpdate').textContent,'Update (1 pending)');
 assert.deepEqual([...h.network].sort(),['cards.json','core-rules.json','finish-quotes.json','promo-catalog.json']);
});

test('save failure stays visible inside an open sheet across card rerenders and clears only after a durable save',()=>{
 const h=harness();h.api.setState({inv:{card0:{q:2,f:1}},session:null});h.api.openCard('card0');
 assert.equal(h.el('sheetSaveStatus').hidden,true);
 h.storage.fail=true;h.api.addQty('card0',false,1);
 assert.equal(h.el('sheetSaveStatus').hidden,false);assert.match(h.el('sheetSaveStatus').textContent,/could not be confirmed/);
 h.api.openCard('card0');assert.equal(h.el('sheetSaveStatus').hidden,false);assert.match(h.el('sheetSaveStatus').textContent,/Quota exceeded/);
 h.storage.fail=false;h.api.saveInv();assert.equal(h.el('sheetSaveStatus').hidden,true);assert.equal(h.el('sheetSaveStatus').textContent,'');
 assert.equal(h.network.length,0);
});

// Multi-game foundation: this Lorcana build must stay inside its own game's cloud rows.
test('cloud reads are scoped to Lorcana rows',async()=>{const h=harness();h.api.setState({inv:{card0:{q:1,f:0}}});const gets=[];h.api.setReview(async()=>false);h.api.setRest(async(method,path)=>{if(method==='GET')gets.push(path);return[];});await h.api.sync(true);const reads=gets.filter(p=>/^(collection|wishlist|decks)\?/.test(p)&&!p.includes('limit=0'));assert.equal(reads.length,3);for(const p of reads)assert.match(p,/&game=eq\.lorcana&/);});
test('new cloud rows are tagged Lorcana in every section',async()=>{const h=harness();h.api.setState({});const rows=[];h.api.setRest(async(m,p,row)=>{rows.push(row);return[row];});await h.api.guardedWrite({section:'inv',id:'card0',value:{q:1,f:0}},null);await h.api.guardedWrite({section:'wish',id:'card1',value:2},null);await h.api.guardedWrite({section:'decks',id:'d1',value:{name:'Deck',cards:{}}},null);assert.deepEqual(rows.map(r=>r.game),['lorcana','lorcana','lorcana']);});
test('conditional updates only match Lorcana rows',async()=>{const h=harness();h.api.setState({});let path;h.api.setRest(async(m,p,row)=>{path=p;return[row];});await h.api.guardedWrite({section:'inv',id:'card0',value:{q:2,f:0}},{updated_at:'2026-10-01T00:00:00Z',q:1,f:0});assert.match(path,/game=eq\.lorcana/);});

// ---- Multi-game: One Piece and MTG run in their own storage and rules ----
const G=require('./games.js');
const opCatalog=()=>({asof:new Date().toISOString().slice(0,10),sets:[{code:'OP01',name:'Romance Dawn'}],cards:[
 {id:'OP01-001',n:'Roronoa Zoro',v:'OP01-001',s:'OP01',sn:'Romance Dawn',c:'001',r:'L',pv:'',i:'Red',co:null,ik:1,ty:'Leader',cl:'Straw Hat Crew',st:5000,wp:null,lo:5,tx:'',p:2,pf:null,img:''},
 {id:'OP01-001_p1',n:'Roronoa Zoro',v:'OP01-001',s:'OP01',sn:'Romance Dawn',c:'001',r:'L',pv:'Parallel',i:'Red',co:null,ik:1,ty:'Leader',cl:'Straw Hat Crew',st:5000,wp:null,lo:5,tx:'',p:500,pf:null,img:''},
 {id:'OP01-016',n:'Nami',v:'OP01-016',s:'OP01',sn:'Romance Dawn',c:'016',r:'R',pv:'',i:'Red',co:1,ik:1,ty:'Character',cl:'Straw Hat Crew',st:2000,wp:1000,lo:null,tx:'',p:4,pf:null,img:''},
 {id:'OP01-060',n:'Donquixote Doflamingo',v:'OP01-060',s:'OP01',sn:'Romance Dawn',c:'060',r:'L',pv:'',i:'Blue',co:5,ik:1,ty:'Character',cl:'Seven Warlords',st:6000,wp:null,lo:null,tx:'',p:1,pf:null,img:''}]});
const opHarness=(seed={})=>{const h=harness({'inkscan.game':JSON.stringify('onepiece'),...seed});h.api.setCatalog(opCatalog());return h;};
test('the registry defaults to Lorcana and ignores unknown game ids',()=>{const st=storage({'inkscan.game':JSON.stringify('nope')});assert.equal(G.currentId(st),'lorcana');assert.equal(G.currentId(storage()),'lorcana');assert.equal(G.currentId(storage({'inkscan.game':'"mtg"'})),'mtg');});
test('Lorcana keeps its original storage key; other games save under their own prefix',()=>{
 const lor=harness();lor.api.setState({inv:{card0:{q:1,f:0}}});assert.ok(lor.api.persistState());assert.ok(lor.storage.values.has(S.KEY));assert.ok(![...lor.storage.values.keys()].some(k=>k.startsWith('inkscan.onepiece:')));
 const op=opHarness();op.api.setState({inv:{'OP01-016':{q:2,f:0}}});assert.ok(op.api.persistState());assert.ok(op.storage.values.has('inkscan.onepiece:'+S.KEY));assert.ok(!op.storage.values.has(S.KEY));});
test('One Piece card codes land on the regular printing and still list parallels',()=>{const op=opHarness();
 assert.equal(op.api.searchPrintings('OP01-016').card.id,'OP01-016');
 assert.equal(op.api.searchPrintings('op01 - 016').status,'exact');
 const zoro=op.api.searchPrintings('OP01-001');assert.equal(zoro.status,'exact');assert.equal(zoro.card.id,'OP01-001');assert.equal(zoro.candidates.length,2);
 assert.equal(op.api.searchPrintings('OP09-999').status,'missing');});
test('One Piece deck rules: one Leader, four copies, and off-color cards flagged',()=>{const op=opHarness();const d={id:'d',name:'Zoro',cards:{},updated:0};op.api.setState({decks:[d]});
 const deck=op.api.getState().decks[0];
 assert.equal(op.api.deckAdd(deck,'op|op01001',1),true);
 assert.match(String(op.api.deckAdd(deck,'op|op01001',1)),/exactly one Leader/);
 for(let i=0;i<4;i++)assert.equal(op.api.deckAdd(deck,'op|op01016',1),true);
 assert.match(String(op.api.deckAdd(deck,'op|op01016',1)),/at most 4/);
 assert.equal(op.api.deckAdd(deck,'op|op01060',1),true);
 const st=op.api.deckStats(deck);assert.equal(st.leaders,1);assert.equal(st.main,5);assert.equal(st.offColor,1);});
test('One Piece decklists import by card code in either common format',()=>{const op=opHarness();const r=op.api.parseDeckImport('1xOP01-001\n4xOP01-016\n2 Doflamingo - OP01-060\n3xOP99-001');
 assert.deepEqual(json(r.cards),{'op|op01001':1,'op|op01016':4,'op|op01060':2});assert.deepEqual(json(r.unresolved),['3xOP99-001']);});
test('MTG decks are singleton except basic lands, and lines import by name',()=>{
 const h=harness({'inkscan.game':JSON.stringify('mtg')});
 h.api.setCatalog({asof:'2026-10-30',sets:[{code:'cmm',name:'Commander Masters'}],cards:[
  {id:'sf_1',n:'Sol Ring',v:'',s:'cmm',sn:'Commander Masters',c:'410',r:'uncommon',pv:'',i:'Colorless',co:1,ik:1,ty:'Artifact',tx:'',p:1,pf:2},
  {id:'sf_2',n:'Forest',v:'',s:'cmm',sn:'Commander Masters',c:'450',r:'common',pv:'',i:'Colorless',co:0,ik:1,ty:'Basic Land — Forest',tx:'',p:0.1,pf:null}]});
 const d={id:'d',name:'EDH',cards:{},updated:0};h.api.setState({decks:[d]});const deck=h.api.getState().decks[0];
 assert.equal(h.api.deckAdd(deck,'solring|',1),true);assert.match(String(h.api.deckAdd(deck,'solring|',1)),/singleton/);
 for(let i=0;i<10;i++)assert.equal(h.api.deckAdd(deck,'forest|',1),true);
 const r=h.api.parseDeckImport('1 Sol Ring (CMM) 410\n30 Forest\n1 Unknown Card');assert.deepEqual(json(r.cards),{'solring|':1,'forest|':30});assert.deepEqual(json(r.unresolved),['1 Unknown Card']);});
test('MTG and One Piece sync stays inside its own game rows',async()=>{const op=opHarness();op.api.setState({});const rows=[];op.api.setRest(async(m,p,row)=>{rows.push({p,row});return[row];});
 await op.api.guardedWrite({section:'inv',id:'OP01-016',value:{q:1,f:0}},null);assert.equal(rows[0].row.game,'onepiece');});
