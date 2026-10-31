'use strict';
// MTG Commander rules: commander choice, partner pairs, color identity, Commander ban list, import and sync shape.
// Synthetic cards and state only; no live network or user data.
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const path=require('node:path');
const runtime=fs.existsSync(path.join(__dirname,'app.js'))?__dirname:path.resolve(__dirname,'../../..');
const S=require(path.join(runtime,'safety.js'));
const Games=require(path.join(runtime,'games.js'));
const MTG=Games.GAMES.mtg;
function storage(seed={}){const values=new Map(Object.entries(seed));return {fail:false,getItem:k=>values.has(k)?values.get(k):null,setItem(k,v){if(this.fail)throw Error('Quota exceeded');values.set(k,v);},removeItem:k=>values.delete(k),values};}
const card=(id,n,ty,tx,i,lg='legal')=>({id:'sf_'+id,n,v:'',s:'tst',sn:'Synthetic set',c:id,r:'rare',pv:'',i,co:3,ik:1,ty,cl:'',tx,p:1,pf:2,pe:null,img:'',imgN:'',fn:['nonfoil'],lg});
const CARDS=[
 card('1','Atraxa, Praetors\' Voice','Legendary Creature — Phyrexian Angel Horror','Flying, vigilance',  'White/Blue/Black/Green'),
 card('2','Thrasios, Triton Hero','Legendary Creature — Merfolk Wizard','{4}: Scry 1.\nPartner (You can have two commanders if both have partner.)','Blue/Green'),
 card('3','Tymna the Weaver','Legendary Creature — Human Cleric','Lifelink\nPartner (You can have two commanders if both have partner.)','White/Black'),
 card('4','Sol Ring','Artifact','{T}: Add {C}{C}.','Colorless'),
 card('5','Lightning Bolt','Instant','Lightning Bolt deals 3 damage to any target.','Red'),
 card('6','Mana Crypt','Artifact','{T}: Add {C}{C}.','Colorless','banned'),
 card('7','Forest','Basic Land — Forest','({T}: Add {G}.)','Colorless'),
 card('8','Llanowar Elves','Creature — Elf Druid','{T}: Add {G}.','Green',''),
 card('9','Wilson, Refined Grizzly','Legendary Creature — Bear Warrior','Choose a Background (You can have a Background as a second commander.)','Green'),
 card('10','Candlekeep Sage','Legendary Enchantment — Background','Commander creatures you own have "When this creature enters, draw two cards."','Blue'),
 card('11','Grist, the Hunger Tide','Legendary Planeswalker — Grist','Grist, the Hunger Tide can be your commander.','Black/Green'),
 card('12','Shahrazad','Sorcery','Players play a Magic subgame.','White','not_legal')
];
const NV=n=>Games.norm(n)+'|';
function harness(game='mtg'){
 const elements=new Map(), events=[], network=[], localStorage=storage({'inkscan.game':JSON.stringify(game)});
 function el(id){if(!elements.has(id))elements.set(id,{id,value:'',hidden:false,checked:false,dataset:{},style:{},textContent:'',innerHTML:'',classList:{toggle(){},add(){},remove(){}},addEventListener(type,fn){events.push({id,type,fn});},setAttribute(){},getAttribute(){return 'false';},removeAttribute(){},querySelector(){return el('child');},querySelectorAll(){return[];},getContext(){return{};},appendChild(){},click(){},remove(){},insertAdjacentHTML(){},select(){}});return elements.get(id);}
 const doc={getElementById:el,querySelector:el,querySelectorAll:()=>[],createElement:el,addEventListener(type,fn){events.push({id:'document',type,fn});},body:el('body'),hidden:false,activeElement:null};
 const context={InkSafety:S,InkCatalog:require(path.join(runtime,'catalog.js')),InkLegality:require(path.join(runtime,'legality.js')),InkGames:Games,document:doc,localStorage,location:{origin:'https://raestin.github.io',pathname:'/inkscan/',protocol:'http:',href:'https://raestin.github.io/inkscan/'},navigator:{onLine:false},URL,Blob,Response,console,Date,Math,JSON,Map,Set,Promise,Number,Object,Array,String,Error,TypeError,encodeURIComponent,decodeURIComponent,parseInt,parseFloat,isFinite,MutationObserver:class{observe(){}disconnect(){}},IntersectionObserver:class{observe(){}disconnect(){}},history:{pushState(){},back(){}},setTimeout(fn){return 1;},clearTimeout(){},setInterval(){throw Error('Unexpected interval');},fetch:async(...args)=>{network.push(args);throw Error('Unexpected network');}};
 context.window=context;context.self=context;context.addEventListener=(type,fn)=>events.push({id:'window',type,fn});context.scrollTo=()=>{};
 let source=fs.readFileSync(path.join(runtime,'app.js'),'utf8');
 source=source.replace('\nboot();','\n// boot suppressed only inside this test harness');
 source=source.replace('window.__inkscan =',`window.testAPI={legalityMatches,legalIn,deckRules,toggleFavorite,deckItemHTML,renderDeckGuide,remoteMaps,saveDecks,cheapest,previewDeckFile,getInv(){return inv;},ownedReceipt,deckRows,renderDecks,deckInkSel,parseDeckFile,importDeckFile,setScryfall(fn){scryfall=fn;},setOnline(v){navigator.onLine=v;},deckStats,deckAdd,toggleCommander,commanderCheck,parseDeckImport,deckRowHTML,guardedWrite,
  setState(s){inv=InkSafety.clone(s.inv||{});wish=InkSafety.clone(s.wish||{});decks=InkSafety.clone(s.decks||[]);base=null;savedState=savedState||InkSafety.load(localStorage);session={uid:'synthetic-owner',access:'synthetic',exp:Date.now()+3600000};},
  getDecks(){return decks;},setRest(fn){rest=fn;},setCatalog(d){indexCards(d);},saveDecks(){}};\nwindow.__inkscan =`);
 vm.runInNewContext(source,context);
 context.testAPI.setCatalog({asof:'2026-10-30',sets:[{code:'tst',name:'Synthetic set'}],cards:JSON.parse(JSON.stringify(CARDS))});
 el('dFav').checked=false; el('dFavFirst').checked=false; for(const [id,v] of Object.entries({dFormat:'all',dStatus:'all',dBracket:'all',dOwn:'all',dSort:'recent'})) el(id).value=v;
 return {api:context.testAPI,network,el,storage:localStorage};
}
const deck=(names,commanders=[])=>({id:'d1',name:'Synthetic',cards:Object.fromEntries(names.map(n=>[NV(n),1])),commanders:commanders.map(NV),updated:1});

test('commander eligibility follows the front face and "can be your commander" text',()=>{
 assert.equal(MTG.canCommand(CARDS[0]),true);
 assert.equal(MTG.canCommand(CARDS[3]),false);
 assert.equal(MTG.canCommand(CARDS[10]),true);
 assert.equal(MTG.canCommand({ty:'Creature — Elf // Legendary Creature — Elf',tx:''}),false);
});
test('partner pairs: plain partner, named partner, Background, Friends forever, Doctor and same-kind Partner variants',()=>{
 const L=(n,tx,ty='Legendary Creature — X')=>({n,ty,tx});
 assert.equal(MTG.pairProblem(CARDS[1],CARDS[2]),'');
 assert.equal(MTG.pairProblem(CARDS[8],CARDS[9]),'');
 assert.equal(MTG.pairProblem(CARDS[9],CARDS[8]),'');
 assert.match(MTG.pairProblem(CARDS[0],CARDS[2]),/can't be commanders together/);
 assert.equal(MTG.pairProblem(L('Pir, Imaginative Rascal','Partner with Toothy, Imaginary Friend (When...)'),L('Toothy, Imaginary Friend','Partner with Pir, Imaginative Rascal (When...)')),'');
 assert.match(MTG.pairProblem(L('Pir, Imaginative Rascal','Partner with Toothy, Imaginary Friend (When...)'),CARDS[2]),/named partner/);
 assert.equal(MTG.pairProblem(L('Will','Friends forever (x)'),L('Mike','Friends forever (x)')),'');
 assert.equal(MTG.pairProblem(L('Clara',"Doctor's companion (x)"),L('The Doctor','x','Legendary Creature — Time Lord Doctor')),'');
 assert.equal(MTG.pairProblem(L('Cloud','Partner—Character select (x)'),L('Tifa','Partner—Character select (x)')),'');
 assert.match(MTG.pairProblem(L('Cloud','Partner—Character select (x)'),CARDS[2]),/can't be commanders together/);
});
test('deck without a commander says so and never claims to pass',()=>{
 const h=harness();const st=h.api.deckStats(deck(['Atraxa, Praetors\' Voice','Sol Ring']));
 assert.equal(st.cmd.problem,'No commander yet');assert.equal(st.offColor,0);
});
test('color identity comes from the commander; colorless cards always fit; off-identity counted',()=>{
 const h=harness();const st=h.api.deckStats(deck(['Atraxa, Praetors\' Voice','Sol Ring','Lightning Bolt','Forest'],['Atraxa, Praetors\' Voice']));
 assert.equal(st.cmd.problem,'');assert.deepEqual([...st.cmd.identity],['White','Blue','Black','Green']);assert.equal(st.offColor,1);
 assert.deepEqual([...st.inks],['White','Blue','Black','Green']);
});
test('partner identity is the union of both commanders',()=>{
 const h=harness();const st=h.api.deckStats(deck(['Thrasios, Triton Hero','Tymna the Weaver','Lightning Bolt'],['Thrasios, Triton Hero','Tymna the Weaver']));
 assert.equal(st.cmd.problem,'');assert.deepEqual([...st.cmd.identity],['White','Blue','Black','Green']);assert.equal(st.offColor,1);
});
test('banned, not legal and unchecked cards are counted separately from Scryfall commander legality',()=>{
 const h=harness();const st=h.api.deckStats(deck(['Atraxa, Praetors\' Voice','Mana Crypt','Shahrazad','Llanowar Elves'],['Atraxa, Praetors\' Voice']));
 assert.equal(st.banned,1);assert.equal(st.notLegal,1);assert.equal(st.unchecked,1);
});
test('invalid pairs, lone Backgrounds and non-commanders are reported',()=>{
 const h=harness();
 assert.match(h.api.commanderCheck(deck(['Atraxa, Praetors\' Voice','Tymna the Weaver'],['Atraxa, Praetors\' Voice','Tymna the Weaver'])).problem,/can't be commanders together/);
 assert.match(h.api.commanderCheck(deck(['Candlekeep Sage'],['Candlekeep Sage'])).problem,/Background needs/);
 assert.match(h.api.commanderCheck(deck(['Sol Ring'],['Sol Ring'])).problem,/can't be a commander/);
});
test('star toggle sets, pairs, swaps and removes commanders; ineligible cards refused',()=>{
 const h=harness();const d=deck(['Thrasios, Triton Hero','Tymna the Weaver','Atraxa, Praetors\' Voice','Sol Ring']);
 assert.match(h.api.toggleCommander(d,NV('Sol Ring')),/can't be a commander/);assert.deepEqual([...d.commanders],[]);
 h.api.toggleCommander(d,NV('Thrasios, Triton Hero'));assert.deepEqual([...d.commanders],[NV('Thrasios, Triton Hero')]);
 assert.match(h.api.toggleCommander(d,NV('Tymna the Weaver')),/second commander/);assert.equal(d.commanders.length,2);
 assert.match(h.api.toggleCommander(d,NV('Atraxa, Praetors\' Voice')),/changed to Atraxa/);assert.deepEqual([...d.commanders],[NV('Atraxa, Praetors\' Voice')]);
 assert.match(h.api.toggleCommander(d,NV('Atraxa, Praetors\' Voice')),/no longer a commander/);assert.deepEqual([...d.commanders],[]);
});
test('removing the commander card from the deck clears it as commander',()=>{
 const h=harness();const d=deck(['Atraxa, Praetors\' Voice','Sol Ring'],['Atraxa, Praetors\' Voice']);h.api.setState({decks:[d]});
 const live=h.api.getDecks()[0];assert.equal(h.api.deckAdd(live,NV('Atraxa, Praetors\' Voice'),-1),true);assert.deepEqual([...live.commanders],[]);
});
test('star button only appears on cards that can lead, pressed for the current commander',()=>{
 const h=harness();const d=deck(['Atraxa, Praetors\' Voice','Sol Ring'],['Atraxa, Praetors\' Voice']);h.api.setState({decks:[d]});
 assert.match(h.api.deckRowHTML(NV('Atraxa, Praetors\' Voice'),1,d),/data-act="cmd"[^>]*aria-pressed="true"/);
 assert.doesNotMatch(h.api.deckRowHTML(NV('Sol Ring'),1,d),/data-act="cmd"/);
});
test('import puts cards under a Commander heading in the command zone (Arena and vault markdown headings)',()=>{
 const h=harness();
 const a=h.api.parseDeckImport('Commander\n1 Atraxa, Praetors\' Voice\n\nDeck\n1 Sol Ring\n1 Forest');
 assert.deepEqual([...a.commanders],[NV('Atraxa, Praetors\' Voice')]);assert.equal(Object.keys(a.cards).length,3);
 const b=h.api.parseDeckImport('### Commander (2)\n1 Thrasios, Triton Hero\n1 Tymna the Weaver\n### Artifacts (1)\n1 Sol Ring');
 assert.deepEqual([...b.commanders],[NV('Thrasios, Triton Hero'),NV('Tymna the Weaver')]);
 assert.deepEqual([...h.api.parseDeckImport('1 Atraxa, Praetors\' Voice\n1 Sol Ring').commanders],[]);
});
test('sync shape: commanders travel only when set; decks without one keep their exact earlier value',()=>{
 assert.deepEqual(S.maps({inv:{},wish:{},decks:[{id:'a',name:'A',cards:{x:1}}]}).decks.a,{name:'A',cards:{x:1}});
 assert.deepEqual(S.maps({inv:{},wish:{},decks:[{id:'a',name:'A',cards:{x:1},commanders:[]}]}).decks.a,{name:'A',cards:{x:1}});
 assert.deepEqual(S.maps({inv:{},wish:{},decks:[{id:'a',name:'A',cards:{x:1},commanders:['x']}]}).decks.a,{name:'A',cards:{x:1},commanders:['x']});
 assert.throws(()=>S.validate({inv:{},wish:{},decks:[{id:'a',name:'A',cards:{},commanders:['a','b','c']}]}),/invalid commander/);
 assert.throws(()=>S.validate({inv:{},wish:{},decks:[{id:'a',name:'A',cards:{},commanders:'x'}]}),/invalid commander/);
});
test('MTG cloud writes carry commanders and guard PATCH on the previous commanders',async()=>{
 const h=harness();h.api.setState({});let call;h.api.setRest(async(...args)=>{call=args;return [{id:'d1'}];});
 await h.api.guardedWrite({section:'decks',id:'d1',value:{name:'A',cards:{x:1},commanders:['x']}},null);
 assert.equal(call[0],'POST');assert.deepEqual(call[2].commanders,['x']);assert.equal(call[2].game,'mtg');
 await h.api.guardedWrite({section:'decks',id:'d1',value:{name:'A',cards:{x:1}}},{updated_at:'2026-10-30T00:00:00Z',name:'A',cards:{x:1},deleted:false,commanders:['x']});
 assert.equal(call[0],'PATCH');assert.equal(JSON.stringify(call[2].commanders),'[]');assert.match(call[1],/commanders=eq\.%5B%22x%22%5D/);
 assert.equal(h.network.length,0);
});
test('Scryfall conversion keeps Commander legality',()=>{
 const c=MTG.fromScryfall({id:'abc',name:'Mana Crypt',set:'2xm',set_name:'X',collector_number:'270',rarity:'mythic',color_identity:[],type_line:'Artifact',legalities:{commander:'banned'}});
 assert.equal(c.lg,'banned');
 assert.equal(MTG.fromScryfall({id:'abd',name:'X',set:'x',collector_number:'1',type_line:'Artifact'}).lg,'');
});

const ID=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sf=(n,name,type,ci,lg='legal',faces)=>({id:ID(n),name,set:'tst',set_name:'Synthetic',collector_number:String(n),rarity:'rare',color_identity:ci,type_line:type,oracle_text:'',legalities:{commander:lg},...(faces?{card_faces:faces}:{})});
const DECKFILE=()=>JSON.stringify({kind:'inkscan-decks',version:1,game:'mtg',decks:[
 {name:'B4 · Atraxa',commanders:[ID(101)],cards:[[1,ID(101),'Atraxa'],[1,ID(102),'Fable of the Mirror-Breaker'],[30,ID(103),'Forest']]},
 {name:'B5 · Thrasios + Tymna',commanders:[ID(104),ID(105)],cards:[[1,ID(104),'Thrasios'],[1,ID(105),'Tymna'],[1,ID(106),'Mana Crypt']]}]});
const SFCARDS={[ID(101)]:sf(101,'Atraxa, Grand Unifier','Legendary Creature — Phyrexian Angel',['W','U','B','G']),
 [ID(102)]:sf(102,'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki','Enchantment — Saga // Enchantment Creature — Goblin Shaman',['R']),
 [ID(103)]:sf(103,'Forest','Basic Land — Forest',[]),
 [ID(104)]:{...sf(104,'Thrasios, Triton Hero','Legendary Creature — Merfolk Wizard',['G','U']),oracle_text:'Partner (x)'},
 [ID(105)]:{...sf(105,'Tymna the Weaver','Legendary Creature — Human Cleric',['W','B']),oracle_text:'Partner (x)'},
 [ID(106)]:sf(106,'Mana Crypt','Artifact',[],'banned')};
test('deck file rejects wrong kind, other games and malformed cards before importing anything',()=>{
 const h=harness();
 assert.throws(()=>h.api.parseDeckFile('{'),/not an InkScan deck file/);
 assert.throws(()=>h.api.parseDeckFile(JSON.stringify({kind:'inkscan-decks',version:1,game:'lorcana',decks:[]})),/Switch games/);
 assert.throws(()=>h.api.parseDeckFile(JSON.stringify({kind:'inkscan-decks',version:1,game:'mtg',decks:[{name:'X',cards:[[1,'not-an-id']]}]})),/invalid/);
 assert.equal(h.api.parseDeckFile(DECKFILE()).length,2);
});
test('deck file import fetches by Scryfall ID, keeps double-faced cards, sets commanders and partners',async()=>{
 const h=harness();h.api.setState({});h.api.setOnline(true);const calls=[];
 h.api.setScryfall(async(path,opts)=>{calls.push(path);const ids=JSON.parse(opts.body).identifiers.map(x=>x.id);return {data:ids.map(id=>SFCARDS[id])};});
 const list=h.api.parseDeckFile(DECKFILE());
 await h.api.importDeckFile(list,[...new Set(list.flatMap(d=>d.cards.map(c=>c.id)))]);
 const ds=h.api.getDecks();assert.equal(ds.length,2);assert.equal(calls.length,1);assert.equal(calls[0],'/cards/collection');
 const a=ds.find(d=>d.name==='B4 · Atraxa');assert.equal(Object.values(a.cards).reduce((x,y)=>x+y,0),32);
 assert.ok(a.cards[NV('Fable of the Mirror-Breaker // Reflection of Kiki-Jiki')]);assert.equal(a.unresolved,undefined);
 assert.deepEqual([...a.commanders],[NV('Atraxa, Grand Unifier')]);
 const b=ds.find(d=>d.name==='B5 · Thrasios + Tymna');const st=h.api.deckStats(b);
 assert.equal(st.cmd.problem,'');assert.equal(st.banned,1);assert.deepEqual([...st.cmd.identity],['White','Blue','Black','Green']);
});
test('deck file import offline or failing changes nothing',async()=>{
 const h=harness();h.api.setState({});h.api.setOnline(false);
 const list=h.api.parseDeckFile(DECKFILE());await h.api.importDeckFile(list,[ID(101)]);assert.equal(h.api.getDecks().length,0);
 h.api.setOnline(true);h.api.setScryfall(async()=>{throw Error('down');});await h.api.importDeckFile(list,[ID(101)]);assert.equal(h.api.getDecks().length,0);
});

function filterHarness(){
 const h=harness();
 const mk=(id,name,names,cmds,updated)=>({id,name,cards:Object.fromEntries(names.map(n=>[NV(n),1])),commanders:cmds.map(NV),updated});
 h.api.setState({decks:[
  mk('a','B4 · Atraxa',["Atraxa, Praetors' Voice",'Sol Ring','Forest'],["Atraxa, Praetors' Voice"],3),
  mk('b','B5 · Thrasios + Tymna',['Thrasios, Triton Hero','Tymna the Weaver','Mana Crypt'],['Thrasios, Triton Hero','Tymna the Weaver'],2),
  mk('c','Wilson and friends',['Wilson, Refined Grizzly','Candlekeep Sage','Sol Ring'],['Wilson, Refined Grizzly','Candlekeep Sage'],1),
  mk('d','Unfinished',['Lightning Bolt'],[],4)]});
 return h;
}
const names=h=>h.api.deckRows().map(r=>r.d.id).join('');
test('deck search matches deck names and commander names',()=>{
 const h=filterHarness();assert.equal(names(h),'dabc');
 h.el('df').value='tymna';assert.equal(names(h),'b');
 h.el('df').value='atraxa';assert.equal(names(h),'a');
});
test('color filter needs every chosen color; exact limits to exactly those colors',()=>{
 const h=filterHarness();h.api.deckInkSel.add('Green');assert.equal(names(h),'abc');
 h.api.deckInkSel.add('Blue');assert.equal(names(h),'abc');
 h.el('dExact').checked=true;assert.equal(names(h),'c');
});
test('rules, bracket, contains-card and sort filters',()=>{
 const h=filterHarness();
 h.el('dBracket').value='5';assert.equal(names(h),'b');h.el('dBracket').value='all';
 h.el('dStatus').value='short';assert.equal(names(h),'dabc');
 h.el('dCard').value='sol ring';assert.equal(names(h),'ac');h.el('dCard').value='';h.el('dStatus').value='all';
 h.el('dSort').value='name';assert.equal(names(h),'abdc');
});
test('deck home shows a match count and a no-match message',()=>{
 const h=filterHarness();h.api.renderDecks();assert.equal(h.el('dCount').textContent,'4 decks');
 h.el('df').value='tymna';h.api.renderDecks();assert.equal(h.el('dCount').textContent,'Showing 1 of 4 decks');
 h.el('df').value='zzz';h.api.renderDecks();assert.match(h.el('deckList').innerHTML,/No decks match/);
});

test('owned deck file adds exact printings and finishes once, even when the deck itself already exists',async()=>{
 const h=harness();h.api.setOnline(true);
 h.api.setState({decks:[{id:'x',name:'B4 · Atraxa',cards:{},updated:1}]});
 h.api.setScryfall(async(path,opts)=>({data:JSON.parse(opts.body).identifiers.map(x=>SFCARDS[x.id])}));
 const file=JSON.parse(DECKFILE());file.decks[0].owned=true;file.decks[0].cards[0][3]='foil';
 const list=h.api.parseDeckFile(JSON.stringify(file));
 const owned=list.filter(d=>d.owned);
 await h.api.importDeckFile([list[1]],[...new Set(list.flatMap(d=>d.cards.map(c=>c.id)))],owned);
 const inv=h.api.getInv();
 assert.equal(inv['sf_'+ID(101)].f,1);assert.equal(inv['sf_'+ID(103)].q,30);assert.equal(inv['sf_'+ID(102)].q,1);
 assert.equal(h.api.getDecks().length,2);
 await assert.doesNotReject(h.api.importDeckFile([],[],owned));
 assert.equal(h.api.getInv()['sf_'+ID(103)].q,30,'second import must not add the cards again');
});
test('deck file rejects an unknown finish',()=>{
 const h=harness();const file=JSON.parse(DECKFILE());file.decks[0].cards[0][3]='shiny';
 assert.throws(()=>h.api.parseDeckFile(JSON.stringify(file)),/invalid/);
});

test('Game Changers count against the deck bracket: none in 1-2, three in 3, any in 4-5',()=>{
 const h=harness();
 const gcCards=JSON.parse(JSON.stringify(CARDS)).map(c=>({...c,gc:['Sol Ring','Mana Crypt','Lightning Bolt','Forest'].includes(c.n)}));
 h.api.setCatalog({asof:'2026-10-31',sets:[{code:'tst',name:'S'}],cards:gcCards});
 const d=deck(["Atraxa, Praetors' Voice",'Sol Ring','Forest'],["Atraxa, Praetors' Voice"]);
 assert.equal(h.api.deckStats(d).gameChangers,2);assert.equal(h.api.deckStats(d).bracket,null);assert.equal(h.api.deckStats(d).gcOver,false);
 d.bracket=2;assert.equal(h.api.deckStats(d).gcOver,true);
 d.bracket=3;assert.equal(h.api.deckStats(d).gcOver,false);
 d.cards[NV('Lightning Bolt')]=1;d.cards[NV('Mana Crypt')]=1;assert.equal(h.api.deckStats(d).gameChangers,4);assert.equal(h.api.deckStats(d).gcOver,true);
 d.bracket=4;assert.equal(h.api.deckStats(d).gcOver,false);
 delete d.bracket;d.name='B1 · Atraxa';assert.equal(h.api.deckStats(d).bracket,'1');assert.equal(h.api.deckStats(d).gcOver,true);
});
test('missing cost never uses a digital-only printing and takes the cheapest paper one',()=>{
 const h=harness();
 const c=(id,set,p,dg)=>({id:'sf_'+id,n:'Mind Stone',v:'',s:set,sn:set,c:id,r:'common',pv:'',i:'Colorless',co:2,ik:1,ty:'Artifact',cl:'',tx:'',p,pf:null,pe:null,img:'',imgN:'',fn:[],lg:'legal',gc:false,dg});
 h.api.setCatalog({asof:'2026-10-31',sets:[{code:'trc',name:'T'},{code:'c21',name:'C'},{code:'wth',name:'W'}],cards:[c('1','trc',0.02,true),c('2','c21',0.25,false),c('3','wth',1.5,false)]});
 assert.equal(h.api.cheapest(NV('Mind Stone')),0.25);
});
test('deck bracket travels with the deck in sync and is validated',()=>{
 assert.deepEqual(S.maps({inv:{},wish:{},decks:[{id:'a',name:'A',cards:{x:1},bracket:3}]}).decks.a,{name:'A',cards:{x:1},bracket:3});
 assert.deepEqual(S.maps({inv:{},wish:{},decks:[{id:'a',name:'A',cards:{x:1},bracket:9}]}).decks.a,{name:'A',cards:{x:1}});
 assert.throws(()=>S.validate({inv:{},wish:{},decks:[{id:'a',name:'A',cards:{},bracket:7}]}),/invalid bracket/);
});
test('deck file can update same-name decks in place, keeping the deck id',async()=>{
 const h=harness();h.api.setOnline(true);
 h.api.setState({decks:[{id:'keep',name:'B4 · Atraxa',cards:{x:1},bracket:2,updated:1}]});
 h.api.setScryfall(async(path,opts)=>({data:JSON.parse(opts.body).identifiers.map(x=>SFCARDS[x.id])}));
 const file=JSON.parse(DECKFILE());file.decks[0].bracket=4;
 const list=h.api.parseDeckFile(JSON.stringify(file));
 await h.api.importDeckFile(list,[...new Set(list.flatMap(d=>d.cards.map(c=>c.id)))]);
 const ds=h.api.getDecks();assert.equal(ds.length,2);
 const a=ds.find(d=>d.id==='keep');assert.equal(a.bracket,4);assert.equal(a.cards.x,undefined);assert.ok(a.cards[NV('Atraxa, Grand Unifier')]);
});

test('MTG saves go to the MTG storage slot and never touch the Lorcana save',async()=>{
 const h=harness();h.api.setOnline(true);
 const lorcanaKey=S.KEY, mtgKey='inkscan.mtg:'+S.KEY, sentinel='{"lorcana":"untouched"}';
 h.storage.values.set(lorcanaKey,sentinel);
 h.api.setState({});h.api.saveDecks();
 h.api.setScryfall(async(path,opts)=>({data:JSON.parse(opts.body).identifiers.map(x=>SFCARDS[x.id])}));
 const file=JSON.parse(DECKFILE());file.decks[0].owned=true;
 const list=h.api.parseDeckFile(JSON.stringify(file));
 await h.api.importDeckFile(list,[...new Set(list.flatMap(d=>d.cards.map(c=>c.id)))],list.filter(d=>d.owned));
 assert.equal(h.storage.values.get(lorcanaKey),sentinel);
 const saved=JSON.parse(h.storage.values.get(mtgKey));assert.equal(saved.inv['sf_'+ID(103)].q,30);assert.equal(saved.decks.length,2);
 assert.doesNotMatch(fs.readFileSync(path.join(runtime,'app.js'),'utf8'),/InkSafety\.save\(localStorage/);
});

test('deck bracket syncs through the meta column and keeps unknown meta keys',async()=>{
 const h=harness();h.api.setState({});let call;h.api.setRest(async(...args)=>{call=args;return [{id:'d1'}];});
 await h.api.guardedWrite({section:'decks',id:'d1',value:{name:'A',cards:{x:1},bracket:3}},null);
 assert.equal(JSON.stringify(call[2].meta),'{"bracket":3}');
 await h.api.guardedWrite({section:'decks',id:'d1',value:{name:'A',cards:{x:1}}},{updated_at:'t',name:'A',cards:{x:1},deleted:false,commanders:[],meta:{bracket:3,tags:['fun']}});
 assert.equal(JSON.stringify(call[2].meta),'{"tags":["fun"]}');assert.match(call[1],/meta=eq\./);
 const maps=h.api.remoteMaps({inv:[],wish:[],decks:[{id:'d1',name:'A',cards:{x:1},deleted:false,commanders:[],meta:{bracket:4}},{id:'d2',name:'B',cards:{},deleted:false,commanders:[],meta:{}}]});
 assert.equal(maps.decks.d1.bracket,4);assert.equal(maps.decks.d2.bracket,undefined);
});

const GUIDE={overview:'Counters everywhere.',early:'Ramp.',middle:'Spread counters.',late:'Swing wide.',win:['Combat damage'],keys:['Sol Ring'],tip:'Hold removal.',themes:['+1/+1 Counters']};
test('deck guide renders collapsed panel with phases, wins, tappable key cards; hidden without a guide',()=>{
 const h=harness();const d=deck(["Atraxa, Praetors' Voice",'Sol Ring'],["Atraxa, Praetors' Voice"]);d.guide=GUIDE;
 h.api.renderDeckGuide(d);const html=h.el('deckGuideBody').innerHTML;
 assert.equal(h.el('deckGuide').hidden,false);assert.match(html,/Counters everywhere/);assert.match(html,/<dt>Closing<\/dt><dd>Swing wide\.<\/dd>/);
 assert.match(html,/class="keycard" data-card="sf_4"/);assert.match(html,/\+1\/\+1 Counters/);
 delete d.guide;h.api.renderDeckGuide(d);assert.equal(h.el('deckGuide').hidden,true);
 d.guide={overview:'<img src=x onerror=alert(1)>'};h.api.renderDeckGuide(d);assert.doesNotMatch(h.el('deckGuideBody').innerHTML,/<img/);
});
test('deck guide syncs through meta, survives deck file import and update, and is size-checked',async()=>{
 const h=harness();h.api.setState({});let call;h.api.setRest(async(...args)=>{call=args;return [{id:'d1'}];});
 await h.api.guardedWrite({section:'decks',id:'d1',value:{name:'A',cards:{x:1},bracket:2,guide:GUIDE}},null);
 assert.equal(call[2].meta.guide.overview,'Counters everywhere.');assert.equal(call[2].meta.bracket,2);
 assert.equal(h.api.remoteMaps({inv:[],wish:[],decks:[{id:'d1',name:'A',cards:{},deleted:false,commanders:[],meta:{guide:GUIDE}}]}).decks.d1.guide.tip,'Hold removal.');
 assert.throws(()=>S.validate({inv:{},wish:{},decks:[{id:'a',name:'A',cards:{},guide:{overview:'x'.repeat(7000)}}]}),/invalid guide/);
 h.api.setOnline(true);h.api.setScryfall(async(path,opts)=>({data:JSON.parse(opts.body).identifiers.map(x=>SFCARDS[x.id])}));
 h.api.setState({decks:[{id:'keep',name:'B4 · Atraxa',cards:{},updated:1}]});
 const file=JSON.parse(DECKFILE());file.decks[0].guide=GUIDE;
 const list=h.api.parseDeckFile(JSON.stringify(file));
 await h.api.importDeckFile(list,[...new Set(list.flatMap(d=>d.cards.map(c=>c.id)))]);
 assert.equal(h.api.getDecks().find(d=>d.id==='keep').guide.overview,'Counters everywhere.');
});

test('favorites: heart toggles, Favorites only filter, list shows the heart state',()=>{
 const h=filterHarness();const ds=h.api.getDecks();
 h.api.toggleFavorite(ds.find(d=>d.id==='b'));h.api.toggleFavorite(ds.find(d=>d.id==='c'));
 h.el('dFav').checked=true;assert.equal(names(h),'bc');
 h.el('df').value='tymna';assert.equal(names(h),'b');h.el('df').value='';
 h.api.toggleFavorite(ds.find(d=>d.id==='c'));assert.equal(names(h),'b');
 h.el('dFav').checked=false;assert.equal(names(h),'dabc');
 assert.match(h.api.deckItemHTML({d:ds.find(d=>d.id==='b'),st:h.api.deckStats(ds.find(d=>d.id==='b'))}),/data-fav="b" aria-pressed="true"[^>]*>♥</);
 assert.match(h.api.deckItemHTML({d:ds.find(d=>d.id==='a'),st:h.api.deckStats(ds.find(d=>d.id==='a'))}),/data-fav="a" aria-pressed="false"[^>]*>♡</);
});
test('favorite syncs through meta and survives a deck-file update',async()=>{
 assert.deepEqual(S.maps({inv:{},wish:{},decks:[{id:'a',name:'A',cards:{},favorite:true}]}).decks.a,{name:'A',cards:{},favorite:true});
 assert.deepEqual(S.maps({inv:{},wish:{},decks:[{id:'a',name:'A',cards:{}}]}).decks.a,{name:'A',cards:{}});
 assert.throws(()=>S.validate({inv:{},wish:{},decks:[{id:'a',name:'A',cards:{},favorite:'yes'}]}),/favorite/);
 const h=harness();h.api.setState({});let call;h.api.setRest(async(...args)=>{call=args;return [{id:'d1'}];});
 await h.api.guardedWrite({section:'decks',id:'d1',value:{name:'A',cards:{},favorite:true}},null);assert.equal(call[2].meta.fav,true);
 assert.equal(h.api.remoteMaps({inv:[],wish:[],decks:[{id:'d1',name:'A',cards:{},deleted:false,commanders:[],meta:{fav:true}}]}).decks.d1.favorite,true);
 h.api.setOnline(true);h.api.setScryfall(async(path,opts)=>({data:JSON.parse(opts.body).identifiers.map(x=>SFCARDS[x.id])}));
 h.api.setState({decks:[{id:'keep',name:'B4 · Atraxa',cards:{},favorite:true,updated:1}]});
 const list=h.api.parseDeckFile(DECKFILE());
 await h.api.importDeckFile(list,[...new Set(list.flatMap(d=>d.cards.map(c=>c.id)))]);
 assert.equal(h.api.getDecks().find(d=>d.id==='keep').favorite,true);
});

test('Favorites first pins hearted decks to the top and keeps the chosen order inside each group',()=>{
 const h=filterHarness();const ds=h.api.getDecks();
 ds.find(d=>d.id==='c').favorite=true;ds.find(d=>d.id==='a').favorite=true;
 assert.equal(names(h),'dabc');
 h.el('dFavFirst').checked=true;assert.equal(names(h),'acdb');
 h.el('dSort').value='name';assert.equal(names(h),'acbd');
});

function pauperHarness(){
 const h=harness();
 const L=(o)=>({commander:'legal',pauper:'legal',standard:'not_legal',pioneer:'not_legal',modern:'legal',legacy:'legal',vintage:'legal',...o});
 const cards=[card('20','Lightning Bolt','Instant','3 damage','Red'),card('21','Mountain','Basic Land — Mountain','','Colorless'),card('22','Sol Ring','Artifact','','Colorless'),card('23','Brainstorm','Instant','','Blue'),card('24','Grapeshot','Sorcery','','Red')];
 cards[0].lgs=L({});cards[1].lgs=L({});cards[2].lgs=L({pauper:'not_legal',modern:'not_legal',legacy:'banned',vintage:'restricted'});cards[3].lgs=L({vintage:'restricted'});cards[4].lgs=L({pauper:'banned'});
 h.api.setCatalog({asof:'2026-10-31',sets:[{code:'tst',name:'S'}],cards});
 return h;
}
test('Pauper deck: 60-card minimum, 4 copies, basics unlimited, Pauper legality from Scryfall',()=>{
 const h=pauperHarness();
 const d={id:'p',name:'Burn',format:'pauper',cards:{[NV('Lightning Bolt')]:4,[NV('Mountain')]:56},updated:1};
 let st=h.api.deckStats(d);assert.equal(st.format,'pauper');assert.equal(st.size,60);assert.equal(st.cmd,null);assert.equal(st.overCopies,0);assert.equal(st.banned+st.notLegal,0);
 d.cards[NV('Mountain')]=60;st=h.api.deckStats(d);assert.equal(st.main,64);
 d.cards[NV('Lightning Bolt')]=5;assert.equal(h.api.deckStats(d).overCopies,1);d.cards[NV('Lightning Bolt')]=4;
 d.cards[NV('Sol Ring')]=1;d.cards[NV('Grapeshot')]=1;st=h.api.deckStats(d);assert.equal(st.notLegal,1);assert.equal(st.banned,1);
 delete d.cards[NV('Sol Ring')];delete d.cards[NV('Grapeshot')];d.cards[NV('Mountain')]=50;assert.equal(h.api.deckStats(d).main,54);
});
test('adding cards respects the deck format: illegal cards refused, Vintage restricted cards one copy',()=>{
 const h=pauperHarness();h.api.setState({decks:[{id:'p',name:'P',format:'pauper',cards:{},updated:1},{id:'v',name:'V',format:'vintage',cards:{},updated:1}]});
 const [p,v]=h.api.getDecks();
 assert.match(h.api.deckAdd(p,NV('Sol Ring'),1),/not legal in Pauper/);assert.match(h.api.deckAdd(p,NV('Grapeshot'),1),/banned in Pauper/);
 assert.equal(h.api.deckAdd(p,NV('Lightning Bolt'),4),true);assert.match(h.api.deckAdd(p,NV('Lightning Bolt'),1),/at most 4/);
 assert.equal(h.api.deckAdd(v,NV('Brainstorm'),1),true);assert.match(h.api.deckAdd(v,NV('Brainstorm'),1),/restricted in Vintage/);
 assert.equal(h.api.deckRules({}).key,'commander');assert.equal(h.api.deckRules({format:'bogus'}).key,'commander');
});
test('format filters: decks by format, and Collection/Browse "Legal in" uses Scryfall legality',()=>{
 const h=filterHarness();h.api.getDecks().find(d=>d.id==='d').format='pauper';
 h.el('dFormat').value='pauper';assert.equal(names(h),'d');h.el('dFormat').value='commander';assert.equal(names(h),'abc');
 const hp=pauperHarness();
 assert.equal(hp.api.legalityMatches({lgs:{pauper:'legal'}},'pauper'),true);assert.equal(hp.api.legalityMatches({lgs:{pauper:'not_legal'}},'pauper'),false);
 assert.equal(hp.api.legalityMatches({lgs:{vintage:'restricted'}},'vintage'),true);assert.equal(hp.api.legalityMatches({},'pauper'),false);
 assert.equal(hp.api.legalityMatches({},'all'),true);
});
test('deck format syncs through meta, travels in deck files, and Commander is the default',async()=>{
 assert.deepEqual(S.maps({inv:{},wish:{},decks:[{id:'a',name:'A',cards:{},format:'pauper'}]}).decks.a,{name:'A',cards:{},format:'pauper'});
 assert.deepEqual(S.maps({inv:{},wish:{},decks:[{id:'a',name:'A',cards:{},format:'commander'}]}).decks.a,{name:'A',cards:{}});
 assert.throws(()=>S.validate({inv:{},wish:{},decks:[{id:'a',name:'A',cards:{},format:'Pauper!'}]}),/invalid format/);
 const h=harness();h.api.setState({});let call;h.api.setRest(async(...args)=>{call=args;return [{id:'d1'}];});
 await h.api.guardedWrite({section:'decks',id:'d1',value:{name:'A',cards:{},format:'pauper'}},null);assert.equal(call[2].meta.format,'pauper');
 assert.equal(h.api.remoteMaps({inv:[],wish:[],decks:[{id:'d1',name:'A',cards:{},deleted:false,commanders:[],meta:{format:'pauper'}}]}).decks.d1.format,'pauper');
 const f=JSON.parse(DECKFILE());f.decks[0].format='pauper';f.decks[1].format='nonsense';
 const list=h.api.parseDeckFile(JSON.stringify(f));assert.equal(list[0].format,'pauper');assert.equal(list[1].format,null);
});
test('Scryfall conversion keeps every supported format legality',()=>{
 const c=MTG.fromScryfall({id:'z',name:'Snap',set:'x',collector_number:'1',type_line:'Instant',legalities:{commander:'legal',pauper:'legal',vintage:'restricted'}});
 assert.equal(c.lgs.pauper,'legal');assert.equal(c.lgs.vintage,'restricted');assert.equal(c.lgs.standard,'not_legal');
});

test('deck panel lists a sideboard when the guide carries one, escaped',()=>{
 const h=harness();const d=deck(['Sol Ring']);d.format='pauper';d.guide={overview:'Meta deck.',sideboard:[[2,'Campfire'],[4,'Pyroblast'],[1,'<b>x</b>']],sideboard_plan:'Bring in Pyroblast against blue.'};
 h.api.renderDeckGuide(d);const html=h.el('deckGuideBody').innerHTML;
 assert.match(html,/Sideboard \(7\)/);assert.match(html,/Bring in Pyroblast against blue\./);assert.match(html,/<li>4 Pyroblast<\/li>/);assert.doesNotMatch(html,/<b>x<\/b>/);
});

test('a deck read back from the cloud with reordered guide keys is not a conflict (jsonb key order)',()=>{
 const g={overview:'O',early:'E',middle:'M',late:'L',win:['W'],keys:['K'],tip:'T',themes:['X'],source:'S'};
 const reordered={tip:'T',late:'L',win:['W'],keys:['K'],early:'E',middle:'M',source:'S',themes:['X'],overview:'O'};
 const base={inv:{},wish:{},decks:{v:{name:'Voja',cards:{a:1},commanders:['a'],guide:g}}};
 const local={inv:{},wish:{},decks:{v:{name:'Voja',cards:{a:1},commanders:['a'],guide:g,favorite:true}}};
 const remote={inv:{},wish:{},decks:{v:{name:'Voja',cards:{a:1},commanders:['a'],guide:reordered}}};
 const plan=S.plan(local,remote,base);
 assert.equal(plan.conflicts.length,0);assert.equal(plan.writes.length,1);assert.equal(plan.writes[0].value.favorite,true);
 assert.equal(S.plan(base,remote,base).pulls.length,0,'an unchanged deck must not be re-pulled just for key order');
 assert.equal(S.same({a:1,b:{c:2,d:[1,{e:1,f:2}]}},{b:{d:[1,{f:2,e:1}],c:2},a:1}),true);
 assert.equal(S.same({a:[1,2]},{a:[2,1]}),false);
});

test('One Piece deck files import by printed card code, offline, with the Leader and strategy',async()=>{
 const h=harness('onepiece');h.api.setState({});h.api.setOnline(false);
 const op=(id,v,n,ty,i)=>({id,n,v,s:v.split('-')[0],sn:'Synthetic',c:v.split('-')[1],r:'C',pv:id===v?'':'Parallel',i,co:2,ik:1,ty,cl:'',st:5000,wp:1000,lo:ty==='Leader'?5:null,at:'',tx:'',p:1,pf:null,img:''});
 h.api.setCatalog({asof:'2026-10-30',sets:[{code:'OP01',name:'Synthetic'},{code:'P',name:'Promo'}],cards:[op('OP01-001','OP01-001','Roronoa Zoro','Leader','Red'),op('OP01-016','OP01-016','Nami','Character','Red'),op('OP01-016_p1','OP01-016','Nami','Character','Red'),op('P-088_r1','P-088','Trafalgar Law','Character','Red')]});
 assert.throws(()=>h.api.parseDeckFile(JSON.stringify({kind:'inkscan-decks',version:1,game:'onepiece',decks:[{name:'X',cards:[[1,'0b5d2c1e-0000-0000-0000-000000000000']]}]})),/invalid/);
 const guide={overview:'Go wide.',keys:['Nami','Trafalgar Law'],source:'Limitless meta'};
 const file={kind:'inkscan-decks',version:1,game:'onepiece',decks:[{name:'OPM01 · Red Zoro',owned:true,cards:[[1,'OP01-001','Roronoa Zoro'],[4,'OP01-016','Nami'],[4,'P-088','Trafalgar Law'],[2,'OP09-999','Nobody']],guide}]};
 const list=h.api.parseDeckFile(JSON.stringify(file));assert.equal(list[0].owned,false);
 await h.api.importDeckFile(list,[]);
 const d=h.api.getDecks()[0];assert.equal(d.name,'OPM01 · Red Zoro');
 assert.deepEqual({...d.cards},{'op|op01001':1,'op|op01016':4,'op|p088':4});assert.deepEqual([...d.unresolved],['2 Nobody']);
 const st=h.api.deckStats(d);assert.equal(st.leaders,1);assert.equal(st.main,8);
 h.api.renderDeckGuide(d);const body=h.el('deckGuideBody').innerHTML;assert.match(body,/data-card="P-088_r1">Trafalgar Law/);assert.match(body,/Limitless meta/);
});
test('One Piece printings carry a TCGplayer product ID for store links',()=>{
 const cards=JSON.parse(fs.readFileSync(path.join(runtime,'onepiece-cards.json'),'utf8')).cards;
 assert.ok(cards.filter(c=>Number.isSafeInteger(c.t)).length>cards.length*0.95);
 assert.equal(cards.find(c=>c.id==='OP01-016').t,454534);
});
