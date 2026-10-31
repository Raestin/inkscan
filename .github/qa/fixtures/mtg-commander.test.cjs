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
function harness(){
 const elements=new Map(), events=[], network=[], localStorage=storage({'inkscan.game':JSON.stringify('mtg')});
 function el(id){if(!elements.has(id))elements.set(id,{id,value:'',hidden:false,checked:false,dataset:{},style:{},textContent:'',innerHTML:'',classList:{toggle(){},add(){},remove(){}},addEventListener(type,fn){events.push({id,type,fn});},setAttribute(){},getAttribute(){return 'false';},removeAttribute(){},querySelector(){return el('child');},querySelectorAll(){return[];},getContext(){return{};},appendChild(){},click(){},remove(){},insertAdjacentHTML(){},select(){}});return elements.get(id);}
 const doc={getElementById:el,querySelector:el,querySelectorAll:()=>[],createElement:el,addEventListener(type,fn){events.push({id:'document',type,fn});},body:el('body'),hidden:false,activeElement:null};
 const context={InkSafety:S,InkCatalog:require(path.join(runtime,'catalog.js')),InkLegality:require(path.join(runtime,'legality.js')),InkGames:Games,document:doc,localStorage,location:{origin:'https://raestin.github.io',pathname:'/inkscan/',protocol:'http:',href:'https://raestin.github.io/inkscan/'},navigator:{onLine:false},URL,Blob,Response,console,Date,Math,JSON,Map,Set,Promise,Number,Object,Array,String,Error,TypeError,encodeURIComponent,decodeURIComponent,parseInt,parseFloat,isFinite,MutationObserver:class{observe(){}disconnect(){}},IntersectionObserver:class{observe(){}disconnect(){}},history:{pushState(){},back(){}},setTimeout(fn){return 1;},clearTimeout(){},setInterval(){throw Error('Unexpected interval');},fetch:async(...args)=>{network.push(args);throw Error('Unexpected network');}};
 context.window=context;context.self=context;context.addEventListener=(type,fn)=>events.push({id:'window',type,fn});context.scrollTo=()=>{};
 let source=fs.readFileSync(path.join(runtime,'app.js'),'utf8');
 source=source.replace('\nboot();','\n// boot suppressed only inside this test harness');
 source=source.replace('window.__inkscan =',`window.testAPI={parseDeckFile,importDeckFile,setScryfall(fn){scryfall=fn;},setOnline(v){navigator.onLine=v;},deckStats,deckAdd,toggleCommander,commanderCheck,parseDeckImport,deckRowHTML,guardedWrite,
  setState(s){inv=InkSafety.clone(s.inv||{});wish=InkSafety.clone(s.wish||{});decks=InkSafety.clone(s.decks||[]);base=null;session={uid:'synthetic-owner',access:'synthetic',exp:Date.now()+3600000};},
  getDecks(){return decks;},setRest(fn){rest=fn;},setCatalog(d){indexCards(d);},saveDecks(){}};\nwindow.__inkscan =`);
 vm.runInNewContext(source,context);
 context.testAPI.setCatalog({asof:'2026-10-30',sets:[{code:'tst',name:'Synthetic set'}],cards:JSON.parse(JSON.stringify(CARDS))});
 return {api:context.testAPI,network};
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
