/* InkScan — card scanner, collection and decks for Lorcana, MTG and One Piece. Everything is stored on this device. */
(() => {
'use strict';

/* =========================================================
   Utilities
   ========================================================= */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const money = n => n == null ? '—' : '$' + n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const money0 = n => '$' + Math.round(n || 0).toLocaleString('en-US');
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* ---- active game. Lorcana keeps its original storage key and behaviour exactly. ---- */
const GAMES = typeof InkGames!=='undefined' ? InkGames : null;
const GAME_ID = GAMES ? GAMES.currentId(localStorage) : 'lorcana';
const G = GAMES ? GAMES.get(GAME_ID) : {id:'lorcana'};
const LORCANA = GAME_ID==='lorcana';
const STORE = LORCANA ? localStorage : GAMES.namespaced(localStorage, GAME_ID);
const RARITY = LORCANA ? ['Common','Uncommon','Rare','Super_rare','Legendary','Epic','Enchanted','Iconic','Promo'] : G.rarities;
const rarityLabel = LORCANA ? r => (r || '').replace('_', ' ') : G.rarityLabel;
const INKS = LORCANA ? ['Amber','Amethyst','Emerald','Ruby','Sapphire','Steel'] : G.colors;
const API = 'https://api.lorcast.com/v0';
const IMG = 'https://cards.lorcast.io/card/digital/';
const FINISHES = ['normal','foil','rainbow'];
const finishKey = value => value==='rainbow'?'rainbow':value===true||value==='foil'?'foil':'normal';
const finishField = value => ({normal:'q',foil:'f',rainbow:'rf'})[finishKey(value)];
const finishLabel = value => (LORCANA ? {normal:'Normal',foil:'Foil',rainbow:'Rainbow foil'} : G.finishes)[finishKey(value)] || ({normal:'Normal',foil:'Foil',rainbow:'Rainbow foil'})[finishKey(value)];
const GAME_FINISHES = LORCANA ? ['normal','foil','rainbow'] : Object.keys(G.finishes);
const inventoryCount = value => (value?.q||0)+(value?.f||0)+(value?.rf||0);
// Lorcast's undifferentiated foil quote is ambiguous for these multi-finish products.
// Preserve generic legacy foil quantities; never silently reclassify them as cold foil.
const AMBIGUOUS_FOIL = new Set(["crd_fd8709ece8b04d599379c9d168510c43","crd_e2c38bf30c48489f914581f55acd67fb","crd_a7974610679d43d190ee370d23d6e0b3","crd_7f47cc5a26eb4220a9622e8ee83c528d","crd_c7f3b3cbe19c44f7943c510392ea88db","crd_977a785a450a4621b0dcff4404592877","crd_fb78388845f54934a97c596a774bb98f","crd_3881a0b53f854152ad578f5151143244","crd_01ba964bb84745b09a29da266cddccfd","crd_4b656001901d4c34829cfe124d5c166b","crd_0599c55386a649bb9af21a906ed52db5","crd_3a5f83e2f53f4bf0b0d621014cd8f6cf","crd_1a90e72da27d4638ad9aed26776feee5"]);
const AMBIGUOUS_FOIL_PRODUCTS = new Set([647652,647681,649224,650077,653916,657892,657893,657894,678236,678237,678238,690204,722508]);
const ambiguousFoil = c => !!c && (AMBIGUOUS_FOIL.has(c.id)||AMBIGUOUS_FOIL_PRODUCTS.has(Number(c.t)));
let finishQuotes={},promoFoilQuotes={}, productMappings=new Map(), finishQuoteBuild=null, finishQuoteLoaded=false;
function rainbowQuote(c){return c?finishQuotes[c.id+'|rainbow']:null;}
function promoFoilQuote(c){return c?promoFoilQuotes[c.id+'|provider:Holofoil']:null;}
function promoFoilPrice(c){return typeof InkCatalog!=='undefined'&&typeof InkCatalog.validatedFoilQuote==='function'?InkCatalog.validatedFoilQuote(c,promoFoilQuote(c)):null;}
function valuedCard(c){
  if(!c)return {};
  if(!LORCANA)return {...c,prf:c.pe??null};
  if(c.supplemental)return {...c,p:null,pf:promoFoilPrice(c),prf:null};
  return {...c,pf:ambiguousFoil(c)?null:c.pf,prf:InkSafety.validatedRainbowQuote(c,rainbowQuote(c))};
}
function finishPriceNote(){
  if(!LORCANA)return '';
  if(!finishQuoteLoaded)return 'Rainbow and supplemental promo foil prices unavailable: the separate exact-finish quote file could not be loaded. They are counted as unpriced.';
  const available=typeof byId!=='undefined'&&byId?Object.values(finishQuotes).filter(q=>InkSafety.validatedRainbowQuote(byId.get(q.printingId),q)!==null).length:0;
  const promoAvailable=typeof byId!=='undefined'&&byId?[...byId.values()].filter(c=>c.supplemental&&promoFoilPrice(c)!==null).length:0;
  return `Rainbow source: TCGplayer via TCGCSV, built ${finishQuoteBuild||'unknown'}. ${available} verified printing/finish quotes currently usable. Quotes older than 7 days, mismatched or missing stay unpriced; this date is separate from the Lorcast catalog date. Supplemental promo foil: ${promoAvailable} exact Holofoil (provider label) quotes usable for generic Foil only, never Normal or Rainbow.`;
}
async function loadFinishQuotes(){
  if(!LORCANA){finishQuoteLoaded=true;return;}
  finishQuotes={};promoFoilQuotes={};productMappings=new Map();finishQuoteBuild=null;finishQuoteLoaded=false;
  try{
    const r=await fetch('finish-quotes.json',{cache:'no-cache'});if(!r.ok)return;
    const file=await r.json();
    if(file?.schemaVersion!==1 || file.currency!=='USD' || file.provider!=='TCGplayer via TCGCSV' || !file.quotes || typeof file.quotes!=='object' || Array.isArray(file.quotes))return;
    finishQuotes=file.quotes;promoFoilQuotes=file.promoFoilQuotes&&typeof file.promoFoilQuotes==='object'&&!Array.isArray(file.promoFoilQuotes)?file.promoFoilQuotes:{};productMappings=new Map((Array.isArray(file.productMappings)?file.productMappings:[]).filter(m=>m && typeof m.printingId==='string').map(m=>[m.printingId,m]));finishQuoteBuild=typeof file.buildAsOf==='string'?file.buildAsOf:null;finishQuoteLoaded=true;
  }catch(e){/* Optional price data never blocks card access; unavailable remains unknown. */}
}
let promoSupplement=null,promoLoadError=null,promoCatalogWarnings=[];
async function loadPromoCatalog(){
  if(!LORCANA)return;
  promoSupplement=null;promoLoadError=null;
  try{
    const response=await fetch('promo-catalog.json',{cache:'no-cache'});
    if(!response.ok)throw Error('Supplemental catalog unavailable');
    promoSupplement=await response.json();
  }catch(e){promoLoadError='Supplemental promo catalog could not be loaded. Its exact printings are unavailable; never substitute a regular-set card.';}
}
function renderPromoCatalogStatus(){
  const messages=[promoLoadError,...promoCatalogWarnings].filter(Boolean),element=$('promoCatalogStatus');
  if(element){element.hidden=!messages.length;element.textContent=messages.join(' ');}
}
let coreRules=null,coreRulesLoadError=null,legalityIndex=null,legalityIndexDay=null;
async function loadCoreRules(){
  if(!LORCANA)return;
  coreRules=null;coreRulesLoadError=null;legalityIndex=null;
  try{const response=await fetch('core-rules.json',{cache:'no-cache'});if(!response.ok)throw Error('Rules unavailable');coreRules=await response.json();}
  catch(e){coreRulesLoadError='Verified Core Constructed rules could not be loaded. Eligibility is unknown, not assumed legal.';}
}
function currentLegalityIndex(){
  const day=new Date().toISOString().slice(0,10);
  if(!legalityIndex || legalityIndexDay!==day){
    legalityIndexDay=day;
    try{if(!DB||typeof InkLegality==='undefined')throw Error('Rules reader unavailable');legalityIndex=InkLegality.createIndex(DB,coreRules);}
    catch(e){legalityIndex={status:()=>({status:'unknown',reason:'rules-missing',anchor:null,verifiedAt:null,source:null}),info:{valid:false,reason:'rules-missing',displayName:'Core Constructed (Standard)',verifiedAt:null,reviewDue:null}};}
  }
  return legalityIndex;
}
function legalityOf(card){return LORCANA?currentLegalityIndex().status(card):{status:'unknown',reason:'rules-missing',anchor:null};}
function legalityMatches(card,filter){return !filter||filter==='all'||legalityOf(card).status===filter;}
const legalityLabel=status=>({legal:'Standard legal',not_legal:'Not legal for Standard',unknown:'Eligibility unknown'})[status]||'Eligibility unknown';
function legalityReason(reason){return ({
  'current-set-identity':'This full card name and version is in a verified eligible set.',
  'reprinted-identity':'An eligible reprint makes this exact full name and version playable, including older printings.',
  'rotated-identity':'This full name and version has only rotated printings in the verified card pool.',
  'banned':'This full name and version is explicitly banned by the verified Core policy.',
  'special-format-only':'This printing belongs to a separate special format, not Core Constructed.',
  'unverified-set':'This set is not covered by the verified Core policy.',
  'unresolved-identity':'This full card name and version could not be resolved against the verified card pool.',
  'unverified-supplement':'This supplemental printing could not be verified against its exact gameplay identity.',
  'rules-missing':'Verified rules are unavailable; eligibility is unknown.',
  'rules-invalid':'The rules snapshot could not be verified; eligibility is unknown.',
  'rules-future':'The rules snapshot is not yet effective; eligibility is unknown.',
  'rules-expired':'The rules snapshot needs review; eligibility is unknown until it is updated.'
})[reason]||'Eligibility could not be verified.';}
function legalityInfoHTML(){
  const info=currentLegalityIndex().info;
  const source=typeof info.source==='string'&&/^https:\/\/(?:files\.|www\.)?disneylorcana\.com\//.test(info.source)?info.source:'https://www.disneylorcana.com/en-US/resources/';
  return `<strong>Core Constructed (Standard)</strong> · verified ${esc(info.verifiedAt||'not available')}${info.reviewDue?' · review due '+esc(info.reviewDue):''}. <a class="link" href="${esc(source)}" target="_blank" rel="noopener">Official rules ↗</a> ${info.valid?'English card-pool eligibility only; check event-specific rules.':esc(coreRulesLoadError||legalityReason(info.reason))}`;
}
function renderLegalityInfo(){if(!LORCANA)return;for(const id of ['cLegalityInfo','bLegalityInfo']){const element=$(id);if(element)element.innerHTML=legalityInfoHTML();}}
function cardLegalityHTML(card){
  const result=legalityOf(card),anchor=result.anchor;
  return `${esc(legalityLabel(result.status))}. ${esc(legalityReason(result.reason))}${anchor?' Eligible reference: '+esc(anchor.setCode)+' #'+esc(anchor.collectorNumber)+'.':''}<br>${legalityInfoHTML()}`;
}
const inventoryRows = (c,v) => ({c:valuedCard(c),q:v?.q||0,f:v?.f||0,rf:v?.rf||0});


let toastT;
function toast(msg){ const t=$('toast'); t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2600); }
function lsGet(k, d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } }
function lsSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } }
let savedState=null, storageError=null, localRevision=0, knownStoredRaw=null;
try { savedState=InkSafety.load(STORE); localRevision=savedState.revision||0;knownStoredRaw=STORE.getItem(InkSafety.KEY); }
catch(e){ storageError='Saved data could not be read. Nothing was reset. Back up this browser before recovery: '+e.message; }
if(savedState&&LORCANA){try{InkSafety.checkLegacy(localStorage,savedState);}catch(e){storageError=e.message;}}
function snapshotState(){ return {v:6,inv,decks,wish,base,last:syncState.last,imports:savedState?.imports||{},recovery:savedState?.recovery||[],revision:localRevision,legacyCheckpoint:savedState?.legacyCheckpoint}; }
function recoveryPoints(reason){return [...(savedState.recovery||[]),{reason,at:new Date().toISOString(),inv:InkSafety.clone(inv),decks:InkSafety.clone(decks),wish:InkSafety.clone(wish),imports:InkSafety.clone(savedState.imports||{})}].slice(-3);}
function persistState(){
  try { if(!savedState) throw Error('Saved data needs recovery.'); InkSafety.save(STORE,snapshotState(),knownStoredRaw);knownStoredRaw=STORE.getItem(InkSafety.KEY); storageError=null; renderSaveStatus(); return true; }
  catch(e){ storageError='Save could not be confirmed on this device. Keep this tab open and download a backup. '+e.message; renderSaveStatus(); return false; }
}
function edited(){ localRevision++; persistState(); renderSyncBox(); }
window.addEventListener('storage',event=>{
  if(event.key===(LORCANA?InkSafety.KEY:STORE.keyOf(InkSafety.KEY)) && event.newValue!==knownStoredRaw){storageError='Another tab saved changes. Keep this tab open and back up both tabs before reconciling. Cloud updates are stopped until local saving is safe.';renderSaveStatus();}
  if(savedState && LORCANA && (event.key===null || InkSafety.isLegacyKey(event.key))){try{InkSafety.checkLegacy(localStorage,savedState);}catch(e){storageError=e.message;renderSaveStatus();}}
});
function renderSaveStatus(){
  const el=$('saveStatus'); if(!el) return;
  const unknown=typeof byId!=='undefined'&&byId ? Object.keys(inv).filter(id=>!byId.has(id)).length : 0;
  el.textContent=storageError || (unknown?`${unknown} collection printing(s) are missing from the catalog. They are retained in your collection and backup.`:'Saved on this device. Cloud updates run only when you tap Update.');
  el.classList.toggle('bad',!!storageError);
  const sheetStatus=$('sheetSaveStatus');
  if(sheetStatus){sheetStatus.textContent=storageError||'';sheetStatus.hidden=!storageError;}
  if(savedState){const counts=InkSafety.pending(InkSafety.maps({inv,wish,decks}),session?.uid && base?.uid===session.uid?base:{inv:{},wish:{},decks:{}});$('manualUpdate').textContent=`Update (${counts.total} pending)`;}
}

function download(name, text, type){
  const blob = new Blob([text], {type}); const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
}
async function copyText(text){
  try{ await navigator.clipboard.writeText(text); return true; }catch(e){ return false; }
}
const today = () => new Date().toISOString().slice(0,10);

/* =========================================================
   Card data
   ========================================================= */
let DB=null, byId, bySetNum, byPrinting, byNV, setIdx, setName, setCards, nvReps;
function nvKeyOf(c){ return LORCANA||!G.nvKey ? norm(c.n)+'|'+norm(c.v) : G.nvKey(c); }
function indexCards(d){
  promoCatalogWarnings=[];
  if(promoSupplement){
    try{
      if(typeof InkCatalog==='undefined')throw Error('Supplemental catalog reader unavailable');
      const merged=InkCatalog.merge(d,promoSupplement);d=merged.catalog;promoCatalogWarnings=merged.warnings||[];
    }catch(e){promoCatalogWarnings=['Supplemental promo catalog could not be verified. Its printings are unavailable; use only an exact known printing.'];}
  }
  renderPromoCatalogStatus();
  DB=d; byId=new Map(); bySetNum=new Map(); byPrinting=new Map(); byNV=new Map(); setIdx=new Map(); setName=new Map(); setCards=new Map();
  d.sets.forEach((s,i)=>{ setIdx.set(s.code,i); setName.set(s.code,s.name); setCards.set(s.code,[]); });
  for (const c of d.cards){
    const verifiedProduct=InkSafety.validatedProductMapping(c,productMappings.get(c.id));
    if(verifiedProduct!==null)c.t=verifiedProduct;
    c.prf=!LORCANA?(c.pe??null):c.supplemental?null:InkSafety.validatedRainbowQuote(c,rainbowQuote(c));
    c.nv = nvKeyOf(c);
    c.inks = (c.i||'').split('/').filter(Boolean);
    c.num = parseInt(c.c,10) || 0;
    byId.set(c.id,c);
    bySetNum.set(norm(c.s)+'|'+norm(c.c), c);
    const printingKey=printingToken(c.s)+'|'+(LORCANA?printingToken(c.c):collectorToken(c.c));
    (byPrinting.get(printingKey)||byPrinting.set(printingKey,[]).get(printingKey)).push(c);
    (byNV.get(c.nv) || byNV.set(c.nv,[]).get(c.nv)).push(c);
    setCards.get(c.s)?.push(c);
  }
  for (const list of byNV.values()) list.sort(bySetOrder);
  nvReps = [...byNV.keys()].map(k => byNV.get(k));
  legalityIndex=null;renderLegalityInfo();
}
function bySetOrder(a,b){ return (setIdx.get(a.s)-setIdx.get(b.s)) || (a.num-b.num) || a.c.localeCompare(b.c); }
const SPECIAL = new Set(['Enchanted','Promo','Iconic','Epic']);
const isSpecialCard = c => LORCANA ? SPECIAL.has(c.r) : G.special(c);
/* the printing we show for a name+version: one you own, else the first regular printing */
function repOf(nv){
  const list = byNV.get(nv); if(!list) return null;
  let best=null, bestN=0;
  for (const c of list){ const v=inv[c.id]; const n=inventoryCount(v); if(n>bestN){best=c;bestN=n;} }
  return best || list.find(c=>!c.dg&&!isSpecialCard(c)) || list.find(c=>!c.dg) || list[0];
}
function priceOf(c, finish){ const value=valuedCard(c); return InkSafety.price(value[finishKey(finish)==='rainbow'?'prf':finishKey(finish)==='foil'?'pf':'p']); }
// Cheapest paper printing we know of. Digital-only printings (MTGO sets) can't be bought, so they never price a deck.
function cheapest(nv){ let m=null; for (const c of byNV.get(nv)||[]){ if(c.dg) continue; const p=priceOf(c,false) ?? priceOf(c,true); if(p!=null && (m==null||p<m)) m=p; } return m; }
function foilPriceOnly(c){ return c && priceOf(c,false)===null && priceOf(c,true)!==null; }
function setLabel(c){ return !LORCANA&&G.setLabel ? G.setLabel(c) : /^\d+$/.test(c.s) ? 'Set '+c.s : c.s; }
function imgUrl(c, size){ if(!LORCANA) return G.imgUrl(c,size); return c.supplemental || c.iv===null ? '' : `${IMG}${size}/${c.id}.avif${c.iv?'?'+c.iv:''}`; }
function inkDot(c){
  if (c.inks.length > 1) return `<span class="ink dual" style="--c1:var(--${c.inks[0].toLowerCase()});--c2:var(--${c.inks[1].toLowerCase()})"></span>`;
  return `<span class="ink ${esc(c.inks[0]||'')}"></span>`;
}
function isType(c, t){ return LORCANA ? c.ty.split('/').includes(t) : new RegExp('\\b'+t+'\\b').test(c.ty||''); }

function catalogStamp(data){
  if(!data || !Array.isArray(data.cards) || !Array.isArray(data.sets) || typeof data.asof!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.asof))return null;
  const stamp=Date.parse(data.asof+'T00:00:00Z');
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0,10)===data.asof?stamp:null;
}
async function cacheGet(name){
  try{ if(!('caches' in window)) return null; const hit=await (await caches.open('inkscan-data')).match(name); return hit?await hit.json():null; }catch(e){ return null; }
}
async function cachePut(name,value){
  try{ if('caches' in window) await (await caches.open('inkscan-data')).put(name,new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}})); }catch(e){}
}
async function loadBundledCards(file, fresh){
  let bundled=null;
  try{ const r=await fetch(file,fresh?{cache:'no-cache'}:undefined); if(r.ok){ const v=await r.json(); if(catalogStamp(v)!==null) bundled=v; } }catch(e){}
  if(bundled){ cachePut(GAME_ID+'-cards.json',bundled); return bundled; }
  const cached=await cacheGet(GAME_ID+'-cards.json'); if(catalogStamp(cached)!==null) return cached;
  throw Error('No valid card catalog is available.');
}
/* ---- MTG: live Scryfall lookups. Only cards you look at, own, want or deck are kept on this phone. ---- */
const SCRYFALL='https://api.scryfall.com';
let sfLast=0; const liveQueries=new Set();
/* Scryfall rate-limits bulk lookups to about 2 a second, and its limit replies carry no CORS header,
   so the browser reports them as network failures. Pace collection calls at 600 ms and retry with backoff. */
async function scryfall(path, opts){
  const bulk=path.startsWith('/cards/collection'), gap=bulk?600:120;
  for(let attempt=0;;attempt++){
    const wait=sfLast+gap-Date.now(); if(wait>0) await sleep(wait); sfLast=Date.now();
    let r=null;
    try{ r=await fetch(SCRYFALL+path,{headers:{Accept:'application/json',...(opts?.body?{'Content-Type':'application/json'}:{})},...(opts||{})}); }
    catch(e){ if(attempt>=4||!navigator.onLine) throw e; }
    if(r){
      if(r.status===404) return null;
      if(r.ok) return r.json();
      if(!(r.status===429||r.status>=500)||attempt>=4) throw Error(`Scryfall answered ${r.status}`);
    }
    await sleep([2000,4000,8000,15000][attempt]);
  }
}
async function loadLiveCards(){
  const cached=await cacheGet(GAME_ID+'-cards.json');
  let sets=await cacheGet(GAME_ID+'-sets.json');
  const stale=!sets || (Date.now()-Date.parse(sets.fetched||0))>7*86400000;
  if(stale && navigator.onLine){
    try{
      const j=await scryfall('/sets');
      const list=(j?.data||[]).filter(x=>!x.digital && x.card_count>0).sort((a,b)=>(b.released_at||'').localeCompare(a.released_at||''))
        .map(x=>({code:x.code,name:x.name,rel:x.released_at,count:x.card_count}));
      if(list.length){ sets={fetched:new Date().toISOString(),sets:list}; cachePut(GAME_ID+'-sets.json',sets); }
    }catch(e){/* Offline: the cached set list still works. */}
  }
  const known=new Map((sets?.sets||[]).map(x=>[x.code,x]));
  for(const c of cached?.cards||[]) if(!known.has(c.s)) known.set(c.s,{code:c.s,name:c.sn,count:0});
  return {asof:cached?.asof||today(), sets:[...known.values()], cards:cached?.cards||[]};
}
function persistLiveCards(){
  if(!G.live||!DB) return;
  const keep=new Set([...Object.keys(inv),...Object.keys(wish)]);
  const nvs=new Set(decks.flatMap(d=>Object.keys(d.cards)));
  const cards=DB.cards.filter(c=>keep.has(c.id)||nvs.has(c.nv)).concat(DB.cards.filter(c=>!keep.has(c.id)&&!nvs.has(c.nv)).slice(-1500));
  cachePut(GAME_ID+'-cards.json',{asof:DB.asof,cards:cards.map(({nv,inks,num,prf,...c})=>c)});
}
function addLiveCards(cards){
  if(!cards?.length||!DB) return 0;
  const map=new Map(DB.cards.map(c=>[c.id,c])); let added=0;
  for(const c of cards){ if(!map.has(c.id)) added++; map.set(c.id,c); }
  const sets=new Map(DB.sets.map(x=>[x.code,x]));
  for(const c of cards) if(!sets.has(c.s)) sets.set(c.s,{code:c.s,name:c.sn,count:0});
  indexCards({...DB,sets:[...sets.values()],cards:[...map.values()]});
  persistLiveCards();
  return added;
}
async function liveSearch(query, unique){
  if(!G.live||!navigator.onLine) return false;
  const q=String(query||'').trim(); if(q.length<3) return false;
  const key=(unique||'cards')+'|'+q.toLowerCase(); if(liveQueries.has(key)) return false; liveQueries.add(key);
  try{
    const j=await scryfall(`/cards/search?q=${encodeURIComponent(q+' game:paper')}&unique=${unique||'cards'}&order=name`);
    return addLiveCards((j?.data||[]).map(G.fromScryfall))>0;
  }catch(e){ liveQueries.delete(key); return false; }
}
async function livePrinting(ref){
  if(!G.live||!ref?.set||!ref.collector||!navigator.onLine) return null;
  try{ const card=await scryfall(`/cards/${encodeURIComponent(ref.set.toLowerCase())}/${encodeURIComponent(ref.collector.toLowerCase())}`); if(!card) return null; const c=G.fromScryfall(card); addLiveCards([c]); return byId.get(c.id)||null; }
  catch(e){ return null; }
}
async function livePrints(card){
  if(!G.live||!card?.oid) return false;
  return liveSearch('oracleid:'+card.oid,'prints');
}
async function liveNames(names){
  if(!G.live) return 0;
  const missing=[...new Set(names)].filter(n=>!byNV.has(norm(n)+'|')); let added=0;
  for(let i=0;i<missing.length;i+=75){
    try{ const j=await scryfall('/cards/collection',{method:'POST',body:JSON.stringify({identifiers:missing.slice(i,i+75).map(name=>({name}))})}); added+=addLiveCards((j?.data||[]).map(G.fromScryfall)); }catch(e){}
  }
  return added;
}
async function refreshLivePrices(btn){
  const deckIds=decks.flatMap(d=>Object.keys(d.cards).map(nv=>repOf(nv)?.id)).filter(Boolean);
  const ids=[...new Set([...Object.keys(inv),...Object.keys(wish),...deckIds])].filter(id=>id.startsWith('sf_')).map(id=>id.slice(3));
  if(btn) btn.disabled=true; let n=0;
  try{
    for(let i=0;i<ids.length;i+=75){
      if(btn) btn.textContent=`Updating ${Math.min(i+75,ids.length)}/${ids.length}`;
      const j=await scryfall('/cards/collection',{method:'POST',body:JSON.stringify({identifiers:ids.slice(i,i+75).map(id=>({id}))})});
      const cards=(j?.data||[]).map(G.fromScryfall); n+=cards.length; addLiveCards(cards);
    }
    DB.asof=today(); persistLiveCards(); renderAll(); toast(`Prices updated for ${n} cards`);
  }catch(e){ toast('Couldn’t reach Scryfall. Check your connection and try again.'); }
  finally{ if(btn){ btn.disabled=false; btn.textContent='Update prices'; } }
}
async function loadCards(){
  if(!LORCANA) return G.live ? loadLiveCards() : loadBundledCards(G.catalog);
  let cached=null,bundled=null;
  try{
    if ('caches' in window){
      const hit=await (await caches.open('inkscan-data')).match('cards-live.json');
      if(hit){const value=await hit.json();if(catalogStamp(value)!==null)cached=value;}
    }
  }catch(e){/* Invalid/unavailable cache does not replace the bundled catalog. */}
  try{
    const response=await fetch('cards.json');
    if(response.ok){const value=await response.json();if(catalogStamp(value)!==null)bundled=value;}
  }catch(e){/* A usable live cache still supports offline card access. */}
  if(cached && (!bundled || catalogStamp(cached)>catalogStamp(bundled)))return cached;
  if(bundled)return bundled;
  throw Error('No valid card catalog is available.');
}
async function refreshFromLorcast(manual, btn){
  if (btn){ btn.disabled = true; }
  const label = btn?.textContent;
  try{
    const sr = await fetch(API+'/sets'); if(!sr.ok) throw 0;
    const sets = (await sr.json()).results; const cards = [];
    for (let i=0;i<sets.length;i++){
      const s = sets[i]; if (btn) btn.textContent = `Updating ${i+1}/${sets.length}`;
      const r = await fetch(`${API}/sets/${s.id}/cards`); if(!r.ok) throw 0;
      let list = await r.json(); if (!Array.isArray(list)) list = list.results || [];
      for (const c of list){
        const p = c.prices || {}; const f = x => { const n = parseFloat(x); return isFinite(n) ? n : null; };
        const small = c.image_uris?.digital?.small || ''; const m = small.match(/\?(\w+)$/);
        cards.push({id:c.id, n:c.name, v:c.version||'', s:s.code, sn:s.name, c:String(c.collector_number), r:c.rarity||'', i:c.ink || (c.inks||[]).join('/'),
          t:c.tcgplayer_id||null, p:f(p.usd), pf:f(p.usd_foil), co:c.cost, ik:c.inkwell?1:0, ty:(c.type||[]).join('/'), cl:(c.classifications||[]).join('/'),
          st:c.strength??null, wp:c.willpower??null, lo:c.lore??null, mv:c.move_cost??null, tx:c.text||'', fl:c.flavor_text||'',
          il:(c.illustrators||[]).join(', '), iv: small ? (m?m[1]:'') : null, lc: c.legalities?.core==='legal'?1:0});
      }
      await sleep(110);
    }
    if (cards.length < 1000) throw 0;
    const d = {asof:today(), sets:sets.map(s=>({code:s.code,name:s.name,rel:s.released_at})), cards};
    try{ await (await caches.open('inkscan-data')).put('cards-live.json', new Response(JSON.stringify(d), {headers:{'content-type':'application/json'}})); }catch(e){}
    await Promise.all([loadFinishQuotes(),loadPromoCatalog(),loadCoreRules()]);indexCards(d); renderAll(); renderSaveStatus();
    if (manual) toast('Prices and cards updated');
  }catch(e){ if (manual) toast('Couldn’t reach Lorcast. Check your connection and try again.'); }
  finally{ if (btn){ btn.textContent = label; btn.disabled = false; } }
}

/* =========================================================
   Saved state: collection, decks, wishlist
   ========================================================= */
let inv = {};     // cardId -> {q, f, rf?}; rainbow is a distinct physical finish
let decks = [];   // [{id, name, cards:{nv:qty}, updated}]
let wish = {};    // cardId -> qty wanted
function saveInv(){ edited(); renderTotals(); }
function saveDecks(){ edited(); }
function saveWish(){ edited(); }
function ownedOf(id){ return inventoryCount(inv[id]); }
function ownedNV(nv){ let n=0; for (const c of byNV.get(nv)||[]) n+=ownedOf(c.id); return n; }
function addQty(id, foil, n){
  const v = inv[id] || (inv[id] = {q:0,f:0});
  const field=finishField(foil), next=Math.max(0,(v[field]||0)+n);
  if(!Number.isSafeInteger(next)){toast('Quantity is too large. Nothing was changed.');return;}
  v[field]=next; if(field==='rf'&&!next)delete v.rf;
  if (!inventoryCount(v)) delete inv[id];
  if (n>0 && wish[id]){ wish[id]=Math.max(0,wish[id]-n); if(!wish[id]) delete wish[id]; saveWish(); }
  saveInv();
}
function totals(){
  let u=0, copies=0, val=0, unpriced=0;
  for (const [id,v] of Object.entries(inv)){ const c=byId.get(id); const n=inventoryCount(v); if(!n) continue; u++; copies+=n; const estimate=InkSafety.valuation([inventoryRows(c,v)]);val+=estimate.value;unpriced+=estimate.unpriced; }
  return {u,copies,val,unpriced};
}
function renderTotals(){ const t=totals(); $('tUnique').textContent=t.u.toLocaleString(); $('tCopies').textContent=t.copies.toLocaleString(); $('tValue').textContent=money0(t.val)+(t.unpriced?' (partial)':'');$('tValue').title=`Overall collection estimate; ${t.unpriced} copies unpriced. TCGplayer via Lorcast, catalog ${DB?.asof||'unknown'}. ${finishPriceNote()}`; }

/* =========================================================
   Shared rendering
   ========================================================= */
// A decorative local placeholder is never substituted into a real card <img>.
// Consume the optional normal-to-small fallback before retrying, then stop.
const IMAGE_ERROR="const fallback=this.dataset.fallbackSrc;this.removeAttribute('data-fallback-src');if(fallback&&this.src!==fallback){this.src=fallback;}else{this.nextElementSibling?.removeAttribute('hidden');this.remove();}";
function placeholderHTML(card,variant,hidden){
  const identity=`${card.n}${card.v?' – '+card.v:''} · ${card.s} #${card.c}`;
  const metadata=variant==='thumb'?'':`<span class="art-placeholder__identity" aria-hidden="true"><strong>${esc(card.n)}</strong>${card.v?`<span>${esc(card.v)}</span>`:''}<span>${esc(card.s)} #${esc(card.c)}</span></span>`;
  return `<span class="art-placeholder art-placeholder--${variant}" data-art-placeholder ${hidden?'hidden':''} role="img" aria-label="${esc('No image available for '+identity)}"><span class="art-placeholder__message" aria-hidden="true">No image available</span>${metadata}</span>`;
}
function artHTML(c,size){
  const url=imgUrl(c,size||'small');
  return (url?`<img data-card-art src="${esc(url)}" alt="" loading="lazy" decoding="async" onerror="${esc(IMAGE_ERROR)}">`:'')+placeholderHTML(c,'grid',!!url);
}
function detailArtHTML(c){
  const url=imgUrl(c,'normal'),small=imgUrl(c,'small');
  const fallback=small&&small!==url?` data-fallback-src="${esc(small)}"`:'';
  const image=url?`<img data-card-art src="${esc(url)}" alt="${esc(c.n+(c.v?' – '+c.v:''))}"${fallback} onerror="${esc(IMAGE_ERROR)}">`:'';
  return image+placeholderHTML(c,'detail',!!url);
}

/* the img sits above the placeholder text, which only shows if the image fails */
function tileHTML(c, opts={}){
  const q = opts.q ?? ownedOf(c.id), f = opts.f ?? (inv[c.id]?.f||0), rf=opts.rf??(inv[c.id]?.rf||0);
  const badge = opts.badge != null ? opts.badge : (q ? `<span class="badge${rf&&rf===q?' rainbow':f&&f===q?' foil':''}">${q}</span>` : '');
  return `<button class="tile${opts.dim && !q ? ' missing':''}" data-card="${c.id}" aria-label="${esc(c.n+(c.v?' – '+c.v:''))}"><div class="art">${artHTML(c)}${badge}</div>${opts.cap!==false?`<div class="cap">${esc(opts.cap || (setLabel(c)+' · #'+c.c))}</div>`:''}</button>`;
}
function thumbHTML(c){
  const url=imgUrl(c,'small');
  return `<span class="thumb">${url?`<img data-card-art src="${esc(url)}" alt="" loading="lazy" onerror="${esc(IMAGE_ERROR)}">`:''}${placeholderHTML(c,'thumb',!!url)}</span>`;
}
function printingProvider(card){return card?card.supplemental?.provider||'Lorcast':'Unknown';}
function printingNote(card){
  const meta=card?.supplemental;if(!meta)return '';
  return [meta.stamp?meta.stamp+' stamped promo':'Supplemental printing',meta.language,meta.printedSet?'printed release '+meta.printedSet:''].filter(Boolean).join(' · ');
}
function printingSource(card){return (card?.supplemental?.evidence||[]).map(item=>item.url).filter(url=>typeof url==='string'&&/^https:\/\//.test(url)).join(' | ');}
function supplementalDetails(card){
  const meta=card?.supplemental;if(!meta)return '';
  const sources=(meta.evidence||[]).map(item=>item.url).filter(url=>typeof url==='string'&&/^https:\/\//.test(url));
  const quote=promoFoilQuote(card),price=promoFoilPrice(card);
  const priceNote=`TCGplayer via TCGCSV; Holofoil (provider label), built ${quote?.buildAsOf||'unavailable'}. ${price===null?'No current exact quote: this foil is unpriced.':'This exact market quote applies to generic Foil only.'} Normal and Rainbow remain unpriced. Quotes expire after 7 days; no base-card or other-finish fallback.`;
  return `<dt>Printing</dt><dd>${esc(printingNote(card))}</dd><dt>Catalog provider</dt><dd>${esc(meta.provider)} · ${esc(card.id)} (not a Lorcast ID)</dd><dt>Provider finish term</dt><dd>${esc(meta.rawSubtype||'Unspecified')}; choose the actual physical finish separately. No rainbow or cold-foil classification is inferred.</dd><dt>Exact foil price source</dt><dd>${esc(priceNote)}</dd><dt>Printing evidence</dt><dd>${sources.map((url,index)=>`<a class="link" href="${esc(url)}" target="_blank" rel="noopener">Source ${index+1} ↗</a>`).join(' · ')}</dd>`;
}
function metaLine(c,foil){return `${esc(setLabel(c))} · #${esc(c.c)} · ${esc(rarityLabel(c.r))} · ${money(priceOf(c,foil))}${c.supplemental?' · '+esc(printingNote(c)):''}`;}

function inkChips(el, state, onChange){
  el.innerHTML = INKS.map(i=>`<button class="chip-btn" data-ink="${i}" aria-pressed="${state.has(i)}"><span class="ink ${i}"></span>${i}</button>`).join('');
  el.onclick = e => { const b=e.target.closest('[data-ink]'); if(!b) return; const i=b.dataset.ink; state.has(i)?state.delete(i):state.add(i); b.setAttribute('aria-pressed',state.has(i)); onChange(); };
}
function inkMatch(c, set){ return !set.size || c.inks.some(i=>set.has(i)); }
/* infinite list: renders `items` in chunks as the sentinel scrolls into view */
function chunked(container, sentinel, items, render, size=48){
  let shown = 0;
  const more = () => { const next = items.slice(shown, shown+size); container.insertAdjacentHTML('beforeend', next.map(render).join('')); shown += next.length; if (shown>=items.length) io.disconnect(); };
  container.innerHTML=''; if (container._io) container._io.disconnect();
  const io = new IntersectionObserver(es=>{ if (es.some(e=>e.isIntersecting)) more(); }, {rootMargin:'600px'});
  container._io = io; more(); if (shown<items.length) io.observe(sentinel);
}
/* symbol tokens in rules text */
const SYM = {S:'STR',W:'WILL',L:'LORE',E:'EXERT',I:'INK'};
function rulesHTML(t){
  if (!t) return '';
  return t.split('\n').map(line=>{
    let h = esc(line).replace(/\{([SWLEI])\}/g, (_,k)=>`<span class="sym">${SYM[k]}</span>`);
    h = h.replace(/^((?:[A-Z0-9'’!?,.&\-]+ ){1,6}[A-Z0-9'’!?,.&\-]+)(?= )/, '<span class="kw">$1</span>');
    h = h.replace(/^(Shift|Bodyguard|Evasive|Rush|Ward|Challenger|Resist|Reckless|Support|Singer|Sing Together|Boost|Vanish)\b/, '<span class="kw">$1</span>');
    return `<p>${h}</p>`;
  }).join('');
}

/* =========================================================
   Bottom sheet
   ========================================================= */
let sheetOpen = false, sheetOnClose = null;
function openSheet(title, html, onClose){
  $('sheetTitle').textContent = title; $('sheetBody').innerHTML = html; $('sheetBody').scrollTop = 0;
  $('sheet').hidden = false; $('scrim').hidden = false; sheetOnClose = onClose || null;
  renderSaveStatus();
  if (!sheetOpen){ sheetOpen = true; try{ history.pushState({sheet:1}, ''); }catch(e){} }
}
function closeSheet(fromPop){
  if (!sheetOpen) return;
  sheetOpen = false; $('sheet').hidden = true; $('scrim').hidden = true; $('sheetBody').innerHTML='';
  const cb = sheetOnClose; sheetOnClose = null; cb && cb();
  if (!fromPop){ try{ history.back(); }catch(e){} }
}
$('sheetClose').onclick = () => closeSheet();
$('scrim').onclick = () => closeSheet();
window.addEventListener('popstate', () => { if (sheetOpen) closeSheet(true); });
document.addEventListener('keydown', e => { if (e.key==='Escape' && sheetOpen) closeSheet(); });

/* ---------- card detail ---------- */
let sheetCard = null;
function openCard(id){
  const c = byId.get(id); if(!c) return;
  sheetCard = c.id;
  openSheet(c.n, cardDetailHTML(c), ()=>{ sheetCard=null; renderAfterEdit(); });
  if (G.live) livePrints(c).then(added=>{ if(added && sheetCard===c.id) $('sheetBody').innerHTML=cardDetailHTML(byId.get(c.id)||c); });
}
function cardDetailHTML(c){
  const v = inv[c.id] || {q:0,f:0}; const w = wish[c.id]||0;
  const stats = [];
  if (!LORCANA) for (const [label,val] of G.stats(c)) { if (val!=null && val!=='') stats.push(`<span class="stat">${esc(label)}<b>${esc(val)}</b></span>`); }
  else {
  if (c.co!=null) stats.push(`<span class="stat">Cost<b>${c.co}</b></span>`);
  stats.push(`<span class="stat">${c.ik?'Inkable':'Not inkable'}</span>`);
  if (c.st!=null) stats.push(`<span class="stat">Strength<b>${c.st}</b></span>`);
  if (c.wp!=null) stats.push(`<span class="stat">Willpower<b>${c.wp}</b></span>`);
  if (c.lo!=null) stats.push(`<span class="stat">Lore<b>${c.lo}</b></span>`);
  if (c.mv!=null) stats.push(`<span class="stat">Move<b>${c.mv}</b></span>`);
  }
  const others = (byNV.get(c.nv)||[]).filter(x=>x.id!==c.id);
  const inDecks = decks.filter(d=>d.cards[c.nv]).map(d=>`${esc(d.name)} (${d.cards[c.nv]})`);
  const deckOpts = decks.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('');
  return `<div class="detail">
    <div class="big">${detailArtHTML(c)}</div>
    <div class="facts">
      ${(LORCANA?c.v:G.displayVersion(c))?`<div class="ver">${esc(LORCANA?c.v:G.displayVersion(c))}</div>`:''}${!LORCANA&&c.mc?`<div class="note">${esc(c.mc)}</div>`:''}
      <div class="row">${inkDot(c)}<span class="note">${esc(c.i)} · ${esc(c.ty.replace('/',' · '))}${c.cl?' · '+esc(c.cl.replaceAll('/',' · ')):''}</span></div>
      <div class="stats">${stats.join('')}</div>
      ${c.tx?`<div class="rules">${rulesHTML(c.tx)}</div>`:''}
      ${c.fl?`<div class="flavor">${esc(c.fl)}</div>`:''}
      <dl class="kv">
        <dt>Set</dt><dd>${esc(c.sn)} · #${esc(c.c)}</dd>
        <dt>Rarity</dt><dd>${esc(rarityLabel(c.r))}</dd>
        ${supplementalDetails(c)}
        <dt>Price</dt><dd>${GAME_FINISHES.map(f=>`${money(priceOf(c,f))} ${finishLabel(f).toLowerCase()}${c.supplemental&&f==='foil'?' — Holofoil (provider label)':''}`).join(' · ')}</dd><dt>Finish pricing</dt><dd>— means unpriced.${LORCANA?` ${esc(finishPriceNote())} Rainbow never uses a generic foil quote.`:` ${esc(G.priceSource)}.`}${LORCANA&&ambiguousFoil(c)?' Generic foil pricing for this multi-finish printing is ambiguous and excluded.':''}</dd>
        ${c.il?`<dt>Artist</dt><dd>${esc(c.il)}</dd>`:''}
        ${LORCANA?`<dt>Core Constructed</dt><dd data-legality-status="${esc(legalityOf(c).status)}">${cardLegalityHTML(c)}</dd>`:''}
      </dl>
      <div class="own" id="ownBox">
        <div class="step"><label>${esc(finishLabel('normal'))}</label><button data-own="q" data-d="-1" aria-label="One fewer normal">−</button><output>${v.q||0}</output><button data-own="q" data-d="1" aria-label="One more normal">+</button></div>
        <div class="step"><label>Foil</label><button data-own="f" data-d="-1" aria-label="One fewer foil">−</button><output>${v.f||0}</output><button data-own="f" data-d="1" aria-label="One more foil">+</button></div>
        ${GAME_FINISHES.includes('rainbow')?`<div class="step"><label>${esc(finishLabel('rainbow'))}</label><button data-own="rf" data-d="-1" aria-label="One fewer ${esc(finishLabel('rainbow').toLowerCase())}">−</button><output>${v.rf||0}</output><button data-own="rf" data-d="1" aria-label="One more ${esc(finishLabel('rainbow').toLowerCase())}">+</button></div>`:''}
        <div class="step"><label>Wishlist</label><button data-want="-1" aria-label="Want one fewer">−</button><output>${w}</output><button data-want="1" aria-label="Want one more">+</button></div>
      </div>
      ${decks.length?`<div class="row"><select id="deckPick" class="slim" aria-label="Deck">${deckOpts}</select><button class="btn" id="deckAddOne">Add to deck</button></div>`:''}
      ${inDecks.length?`<div class="note">In ${inDecks.join(', ')}</div>`:''}
      ${others.length?`<div class="note">Other printings: ${others.map(o=>`<a href="#" class="link" data-card="${o.id}">${esc(setLabel(o))} #${esc(o.c)}${isSpecialCard(o)?' '+esc(LORCANA?rarityLabel(o.r):o.pv||rarityLabel(o.r)):''}</a>`).join(' · ')}</div>`:''}
      ${c.t?`<a class="link" href="https://www.tcgplayer.com/product/${c.t}" target="_blank" rel="noopener">View on TCGplayer ↗</a>`:''}
    </div></div>`;
}
$('sheetBody').addEventListener('click', e=>{
  const own = e.target.closest('[data-own]'), want = e.target.closest('[data-want]'), other = e.target.closest('a[data-card]');
  if (other){ e.preventDefault(); const id=other.dataset.card; sheetCard=id; const c=byId.get(id); $('sheetTitle').textContent=c.n; $('sheetBody').innerHTML=cardDetailHTML(c); $('sheetBody').scrollTop=0; return; }
  if (!sheetCard) return;
  const c = byId.get(sheetCard);
  if (own){ addQty(c.id, own.dataset.own==='rf'?'rainbow':own.dataset.own==='f', +own.dataset.d); }
  else if (want){ wish[c.id]=Math.max(0,(wish[c.id]||0)+ +want.dataset.want); if(!wish[c.id]) delete wish[c.id]; saveWish(); }
  else if (e.target.id==='deckAddOne'){
    const d = decks.find(x=>x.id===$('deckPick').value); if(!d) return;
    const r = deckAdd(d, c.nv, 1); toast(r===true?`Added to ${d.name}`:r);
  } else return;
  const keepPick = $('deckPick')?.value;
  $('sheetBody').innerHTML = cardDetailHTML(c);
  if (keepPick && $('deckPick')) $('deckPick').value = keepPick;
});
/* any tile or row anywhere opens the card */
document.addEventListener('click', e=>{
  const t = e.target.closest('[data-card]');
  if (t && !t.closest('#sheetBody') && !e.target.closest('button[data-act], .acts')) { openCard(t.dataset.card); }
});

/* =========================================================
   Tabs
   ========================================================= */
let tab = 'scan';
const VIEWS = {scan:'vScan', coll:'vColl', decks:'vDecks', browse:'vBrowse'};
function showTab(t){
  tab = t;
  for (const [k,v] of Object.entries(VIEWS)) $(v).hidden = k!==t;
  document.querySelectorAll('.tabbar button').forEach(b=>{ if (b.dataset.tab===t) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
  if (t!=='scan' && stream) stopCam();
  if (t==='coll') renderColl(); if (t==='decks') renderDecks(); if (t==='browse') renderBrowse();
  lsSet('inkscan.tab', t); window.scrollTo(0,0);
}
document.querySelector('.tabbar').addEventListener('click', e=>{ const b=e.target.closest('[data-tab]'); if(b) showTab(b.dataset.tab); });
function renderAll(){ renderTotals(); renderLog(); if(tab==='scan')renderQuick(); if(tab==='coll') renderColl(); if(tab==='decks') renderDecks(); if(tab==='browse') renderBrowse(); }
function renderAfterEdit(){ renderTotals(); renderLog(); if(tab==='coll') renderColl(); if(tab==='decks') renderDecks(true); if(tab==='browse') renderBrowse(); }

/* =========================================================
   SCAN
   ========================================================= */
let log = []; // {key, cardId, foil}
let seq = 0;
function logAdd(card, foil){
  card=card && byId.get(card.id);
  if(!card || !printingAllowed(card,scanPrintingScope))return false;
  // Price availability does not identify the finish of the user's physical card.
  addQty(card.id, foil, 1);
  log.unshift({key:++seq, cardId:card.id, foil});
  renderLog();
  return true;
}
function renderLog(){
  const el=$('log');
  $('logCount').textContent = log.length ? `(${log.length})` : '';
  if (!log.length){ el.innerHTML = `<div class="empty"><strong>No scans yet</strong>Each card you scan goes straight into your collection and shows up here, newest first. Tap Undo if it read the wrong card.</div>`; return; }
  el.innerHTML = log.slice(0,60).map(x=>{
    const c = byId.get(x.cardId); if(!c) return '';
    return `<div class="item"><div class="item-main" data-card="${c.id}">${thumbHTML(c)}<div class="who"><div class="n">${esc(c.n)}</div><div class="v">${esc(c.v)}</div><div class="m">${metaLine(c,x.foil)}</div></div>
      <div class="acts"><select class="log-finish" data-log-finish="${x.key}" aria-label="Finish for ${esc(c.n)}">${FINISHES.map(f=>`<option value="${f}" ${finishKey(x.foil)===f?'selected':''}>${finishLabel(f)}</option>`).join('')}</select><button data-act="lu" data-k="${x.key}">Undo</button></div></div></div>`;
  }).join('');
}
$('log').addEventListener('click', e=>{
  const b=e.target.closest('button[data-act]'); if(!b) return;
  const x = log.find(x=>x.key==b.dataset.k); if(!x) return;
  if (b.dataset.act==='lu'){ addQty(x.cardId, x.foil, -1); log = log.filter(y=>y!==x); renderLog(); toast('Removed one copy'); }
});
$('log').addEventListener('change',e=>{
  const select=e.target.closest('[data-log-finish]'); if(!select || !FINISHES.includes(select.value))return;
  const x=log.find(x=>x.key==select.dataset.logFinish);if(!x || finishKey(x.foil)===select.value)return;
  const next=InkSafety.clone(inv),value=next[x.cardId],before=finishField(x.foil),after=finishField(select.value);
  if(!value || !(value[before]>0)){toast('That scanned finish is no longer owned. Review the card before changing it.');renderLog();return;}
  if(!Number.isSafeInteger((value[after]||0)+1)){toast('Quantity is too large. Nothing was changed.');renderLog();return;}
  value[before]--;value[after]=(value[after]||0)+1;if(!value.rf)delete value.rf;
  const snapshot={...snapshotState(),inv:next,revision:localRevision+1};
  try{InkSafety.save(STORE,snapshot,knownStoredRaw);knownStoredRaw=STORE.getItem(InkSafety.KEY);}
  catch(err){storageError='Finish change could not be confirmed. Keep this tab open and back up before retrying. '+err.message;renderSaveStatus();renderLog();return;}
  inv=next;localRevision=snapshot.revision;storageError=null;x.foil=select.value;renderSaveStatus();renderSyncBox();renderTotals();renderLog();
});
// Printing identity and physical finish are independent choices.
let scanPrintingScope='all', lastScanResolution=null;
const printingToken=value=>String(value??'').trim().toUpperCase();
const collectorToken=value=>printingToken(value).replace(/^0+(?=\d)/,'');
const isSpecialPrinting=card=>!!card && (LORCANA ? (card.r==='Promo'||!/^\d+$/.test(String(card.s))) : isSpecialCard(card));
const printingAllowed=(card,scope)=>scope!=='promo'||isSpecialPrinting(card);
function exactPrinting(set,collector,scope='all'){
  const reference={set:printingToken(set),collector:collectorToken(collector)};
  const matches=byPrinting?.get(reference.set+'|'+reference.collector)||[];
  const candidates=matches.filter(card=>printingAllowed(card,scope));
  const label=`${reference.set} #${reference.collector}`;
  if(!matches.length)return {status:'missing',card:null,candidates:[],reference,message:`${label} is not in this catalog. Nothing was added. Choose the exact printing manually; do not substitute its regular-set version.`};
  if(!candidates.length)return {status:'blocked',card:null,candidates:[],reference,message:`${label} is a regular-set printing. Promo / special only is selected, so nothing was added. Search for the exact promo printing or switch printing scope.`};
  if(candidates.length!==1)return {status:'ambiguous',card:null,candidates,reference,message:`${label} matches multiple catalog printings. Nothing was added. Review and select the exact printing manually.`};
  return {status:'exact',card:candidates[0],candidates,reference,message:`${label} identified. Confirm the physical finish separately.`};
}
/* Other games: one code can cover a regular card plus parallels or alternate arts. The code alone
   can't tell them apart, so it lands on the regular printing and lists the rest to choose from. */
function regularPrinting(result){
  if(LORCANA||result.status!=='ambiguous')return result;
  const regular=result.candidates.filter(c=>!isSpecialCard(c));
  if(regular.length!==1)return result;
  const label=`${result.reference.set} #${result.reference.collector}`;
  return {...result,status:'exact',card:regular[0],message:`${label} identified as the regular printing. If yours is a parallel or alternate art, choose it from the list.`};
}
function resolveNumberLine(text,scope='all'){
  if(!LORCANA){
    const refs=[...new Map(G.parseCode(text).map(r=>[printingToken(r.set)+'|'+collectorToken(r.collector),r])).values()];
    if(!refs.length)return {status:'unrecognized',card:null,candidates:[],reference:null,message:'The card code could not be read. Nothing was added. Search by its printed code or card name.'};
    if(refs.length>1){const candidates=[...new Map(refs.flatMap(r=>exactPrinting(r.set,r.collector,scope).candidates).map(c=>[c.id,c])).values()];return {status:'ambiguous',card:null,candidates,reference:null,message:'More than one card code was read. Nothing was added. Choose the exact printing.'};}
    return regularPrinting(exactPrinting(refs[0].set,refs[0].collector,scope));
  }
  const source=String(text||'').replace(/\n/g,' '),references=[];
  // Full alphanumeric tokens are retained. A promo denominator is authoritative;
  // the trailing release number must never turn 11/PD1 EN14 into set14/#11.
  const pattern=/(?:^|[^A-Za-z0-9])([A-Za-z0-9|!]{1,32})\s*\/\s*([A-Za-z0-9]{1,32})(?![A-Za-z0-9])[\s·•:.,-]*(?:EN|FN|EM|ER|FR|DE|IT|JA|ZH|ES|E N)(?:[\s·•:.,-]*([A-Za-z0-9]{1,32})(?![A-Za-z0-9]|\s*\/))?/gi;
  for(const match of source.matchAll(pattern)){
    const collector=collectorToken(match[1]),denominator=printingToken(match[2]);
    const explicit=!/^\d+$/.test(denominator);
    const set=explicit?denominator:printingToken(match[3]||'');
    if(!set){references.push({set:'',collector,explicit});continue;}
    references.push({set,collector,explicit});
  }
  const unique=[...new Map(references.map(r=>[r.set+'|'+r.collector,r])).values()];
  if(!unique.length || unique.some(r=>!r.set))return {status:'unrecognized',card:null,candidates:[],reference:null,message:'The exact printing could not be read. Nothing was added. Search by its printed set code and full collector number, or card name.'};
  if(unique.length>1){const candidates=[...new Map(unique.flatMap(r=>exactPrinting(r.set,r.collector,scope).candidates).map(c=>[c.id,c])).values()];return {status:'ambiguous',card:null,candidates,reference:null,message:'Multiple printing references were read. Nothing was added. Review and select the exact printing manually.'};}
  return exactPrinting(unique[0].set,unique[0].collector,scope);
}
function parseLine(text){const result=resolveNumberLine(text,scanPrintingScope);return result.status==='exact'?result.card:null;}
function searchPrintings(query,scope=scanPrintingScope){
  const q=String(query||'').trim();
  if(!DB)return {candidates:[],reference:null,message:''};
  if(!LORCANA&&q){
    const refs=G.parseCode(q);
    if(refs.length===1)return regularPrinting(exactPrinting(refs[0].set,refs[0].collector,scope));
    const pair=/^([A-Za-z0-9]{2,6})\s*[#\s]\s*#?([0-9]{1,4}[A-Za-z★]?)$/.exec(q);
    if(G.live&&pair&&/[A-Za-z]/.test(pair[1]))return exactPrinting(pair[1],pair[2],scope);
  }
  if(q.includes('/') && /\b(?:EN|FR|DE|IT|JA|ZH|ES)\s*[0-9A-Za-z]*/i.test(q))return resolveNumberLine(q,scope);
  const pair=q.match(/^#?([A-Za-z0-9]+)\s*(?:\/|[#· -]|\s)\s*#?([A-Za-z0-9]+)$/);
  if(pair){
    const a=printingToken(pair[1]),b=printingToken(pair[2]);
    const knownSet=token=>DB.sets.some(set=>printingToken(set.code)===token);
    if(q.includes('/') && /^\d/.test(a) && /^[A-Za-z]/.test(b))return exactPrinting(b,a,scope);
    if(/^\d+$/.test(a) && /^\d+$/.test(b) && a!==b && knownSet(a) && knownSet(b)){
      const candidates=[...new Map([...exactPrinting(a,b,scope).candidates,...exactPrinting(b,a,scope).candidates].map(card=>[card.id,card])).values()];
      if(candidates.length)return {status:'ambiguous',card:null,candidates,reference:null,message:'Both numbers are catalog set codes. Nothing was added. Review the set and collector number shown on each result and choose the exact printing.'};
    }
    if(knownSet(b) && !/^\d+$/.test(b) && /^\d/.test(a))return exactPrinting(b,a,scope);
    if(knownSet(a) || (/^[A-Za-z]+\d+$/.test(a)&&/^\d/.test(b)))return exactPrinting(a,b,scope);
    if((knownSet(b)||q.includes('/')) && /^\d/.test(a))return exactPrinting(b,a,scope);
  }
  const nq=norm(q);
  const candidates=DB.cards.filter(c=>printingAllowed(c,scope) && (!q&&scope==='promo'||nq.length>=2&&(norm(c.n+c.v).includes(nq)||norm(c.n).startsWith(nq))));
  return {status:'search',candidates,reference:null,message:''};
}
function quickSearch(q,limit=30,scope=scanPrintingScope){return searchPrintings(q,scope).candidates.slice(0,limit);}
let qT,quickVisible=30;
$('q').addEventListener('input',()=>{quickVisible=30;clearTimeout(qT);qT=setTimeout(renderQuick,120);});
function renderQuick(){
  if(G.live){
    const q=$('q').value.trim(), pre=searchPrintings(q);
    if(pre.status==='missing'&&pre.reference) livePrinting(pre.reference).then(card=>{ if(card) renderQuick(); });
    else liveSearch(q).then(added=>{ if(added) renderQuick(); });
  }
  const result=searchPrintings($('q').value),res=result.candidates.slice(0,quickVisible),el=$('qres');
  el.hidden=!$('q').value.trim() && scanPrintingScope!=='promo';
  const hint=result.message && result.status!=='exact'?`<p class="note printing-search-note" role="status">${esc(result.message)}</p>`:'';
  const count=result.candidates.length>30?`<p class="note printing-search-note">Showing ${res.length} of ${result.candidates.length} matching printings. Search by name or full set code and collector number, or show more below.</p>`:'';
  el.innerHTML=hint+count+(res.length?res.map(c=>`<div class="item"><div class="item-main" data-card="${c.id}">${thumbHTML(c)}<div class="who"><div class="n">${esc(c.n)}</div><div class="v">${esc(c.v)}</div><div class="m">${metaLine(c,foilMode)}${isSpecialPrinting(c)?' · '+(LORCANA?'Promo / special printing':esc(c.pv)):''}</div>${result.status==='ambiguous'?`<div class="m">${esc(printingProvider(c))} ID: ${esc(c.id)}</div>`:''}</div><div class="acts"><button data-act="add" data-id="${c.id}" aria-label="Add ${esc(c.n)} ${esc(c.s)} number ${esc(c.c)}">Add</button></div></div></div>`).join(''):`<div class="empty" style="padding:16px">No exact printing found. Try its name or a full reference such as <b>P3 43</b>, <b>PD1 11</b>, or <b>P2 24B</b>. An absent printing cannot be added as its regular version.</div>`)+(result.candidates.length>res.length?`<button class="btn printing-more" id="qMore" data-more-printings>Show next ${Math.min(30,result.candidates.length-res.length)} printings</button>`:'');
}
$('qres').addEventListener('click',e=>{
  if(e.target.closest('[data-more-printings]')){quickVisible+=30;renderQuick();return;}
  const b=e.target.closest('button[data-act="add"]');if(!b)return;
  const card=byId.get(b.dataset.id);if(!card || !printingAllowed(card,scanPrintingScope))return;
  if(logAdd(card,foilMode)){clearScanResolution();toast(`Added ${card.n} · ${card.s} #${card.c}`);}
});
function clearScanResolution(){lastScanResolution=null;$('scanResolution').hidden=true;$('scanResolution').textContent='';$('scanManual').hidden=true;}
function showScanResolution(result){
  lastScanResolution=result;$('scanResolution').textContent=result.message;$('scanResolution').hidden=false;$('scanManual').hidden=false;
}
function reviewNumberLine(text){
  const result=resolveNumberLine(text,scanPrintingScope);
  if(result.status==='exact')clearScanResolution();
  else if(['missing','ambiguous','blocked'].includes(result.status))showScanResolution(result);
  return result;
}
function setScanPrintingScope(scope){
  if(!['all','promo'].includes(scope))return;
  scanPrintingScope=scope;$('scanPrintingScope').value=scope;quickVisible=30;lastKey=null;streak=0;cooldownKey=null;clearScanResolution();renderQuick();
  if(scanning)camMsg(scope==='promo'?'Promo / special only: read the full printed code, or choose the exact printing below.':'Line the number line up in the gold box');
}
$('scanPrintingScope').onchange=()=>setScanPrintingScope($('scanPrintingScope').value);
$('scanManual').onclick=()=>{quickVisible=30;if(lastScanResolution?.reference){const r=lastScanResolution.reference;$('q').value=r.set+' '+r.collector;}else $('q').value='';renderQuick();$('q').focus?.();$('q').scrollIntoView?.({block:'center',behavior:'smooth'});};

/* ---- camera + OCR loop ---- */
let stream=null, worker=null, workerReady=null, scanning=false;
let foilMode=false, lastKey=null, streak=0, cooldownKey=null, blankFrames=0, lastHitAt=0;
const video=$('video'), cv=document.createElement('canvas'), ctx=cv.getContext('2d',{willReadFrequently:true});
const abs = p => new URL(p, location.href).href;
function getWorker(){
  if (!workerReady){
    workerReady = Tesseract.createWorker('eng', 1, {
      workerPath: abs('worker.min.js'), corePath: abs('./'), langPath: abs('./'),
      workerBlobURL: false, gzip: true, cacheMethod: 'write'
    }).then(async w=>{ await w.setParameters({tessedit_pageseg_mode:'6'}); worker=w; return w; });
  }
  return workerReady;
}
function camMsg(s){ const el=$('camstate'); el.textContent=s; el.hidden=!s; }
async function startCam(){
  $('startBtn').disabled = true; $('startBtn').textContent = 'Starting…';
  try{ stream = await navigator.mediaDevices.getUserMedia({audio:false, video:{facingMode:{ideal:'environment'}, width:{ideal:1920}}}); }
  catch(e){
    $('startBtn').disabled=false; $('startBtn').textContent='Start scanning';
    toast(e && e.name==='NotAllowedError' ? 'Camera access is blocked. Allow it in your browser’s site settings, then try again.' : 'Couldn’t open the camera.');
    return;
  }
  video.srcObject = stream; await video.play().catch(()=>{});
  const track = stream.getVideoTracks()[0];
  try{ const caps = track.getCapabilities?.() || {}; $('torchBtn').hidden = !caps.torch;
       if (caps.focusMode && caps.focusMode.includes('continuous')) track.applyConstraints({advanced:[{focusMode:'continuous'}]}).catch(()=>{}); }catch(e){}
  $('camstart').hidden = true; $('guide').hidden = false; $('camtools').hidden = false;
  camMsg('Loading the reader…');
  try{ await getWorker(); }catch(e){ camMsg('The card reader didn’t load. Reload the page and try again.'); return; }
  scanning = true; camMsg('Line the number line up in the gold box');
  try{ await navigator.wakeLock?.request('screen'); }catch(e){}
  loop();
}
function stopCam(){
  scanning=false; if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
  video.srcObject=null; $('camstart').hidden=false; $('guide').hidden=true; $('camtools').hidden=true; camMsg('');
  $('startBtn').disabled=!DB; $('startBtn').textContent='Start scanning';
  $('torchBtn').setAttribute('aria-pressed','false');
}
function stripRectInVideo(){
  const box = $('cam').getBoundingClientRect(), strip = $('guide').firstElementChild.getBoundingClientRect();
  const vw=video.videoWidth, vh=video.videoHeight; if(!vw||!vh) return null;
  const sc = Math.max(box.width/vw, box.height/vh);
  const ox = (vw*sc - box.width)/2, oy = (vh*sc - box.height)/2;
  const padX = strip.width*0.06, padY = strip.height*0.35;
  let x=(strip.left-box.left-padX+ox)/sc, y=(strip.top-box.top-padY+oy)/sc, w=(strip.width+2*padX)/sc, h=(strip.height+2*padY)/sc;
  x=Math.max(0,x); y=Math.max(0,y); w=Math.min(vw-x,w); h=Math.min(vh-y,h);
  return {x,y,w,h};
}
function grabStrip(){
  const r = stripRectInVideo(); if(!r) return null;
  const s = 1300 / r.w;
  cv.width = Math.round(r.w*s); cv.height = Math.round(r.h*s);
  ctx.filter = 'grayscale(1)'; ctx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, cv.width, cv.height); ctx.filter = 'none';
  const img = ctx.getImageData(0,0,cv.width,cv.height), d=img.data; let lo=255, hi=0;
  for (let i=0;i<d.length;i+=16){ const v=d[i]; if(v<lo) lo=v; if(v>hi) hi=v; }
  const k = hi>lo ? 255/(hi-lo) : 1;
  for (let i=0;i<d.length;i+=4){ const v=(d[i]-lo)*k; d[i]=d[i+1]=d[i+2]=v; }
  ctx.putImageData(img,0,0);
  return cv;
}
async function loop(){
  while (scanning){
    if (document.hidden || !worker){ await sleep(400); continue; }
    const frame = grabStrip(); if(!frame){ await sleep(200); continue; }
    let card=null,resolution=null;
    try{const {data}=await worker.recognize(frame);resolution=reviewNumberLine(data.text);card=resolution.card;
      if(!card&&G.live&&resolution.status==='missing'&&resolution.reference){ if(await livePrinting(resolution.reference)){resolution=reviewNumberLine(data.text);card=resolution.card;} }
    }catch(e){}
    if (!scanning) break;
    if (!card){
      streak=0; lastKey=null; blankFrames++;
      if (blankFrames>=2) cooldownKey=null;
      if(resolution && ['missing','ambiguous','blocked'].includes(resolution.status)){showScanResolution(resolution);camMsg('Printing needs manual review. Nothing added.');}
      else if(Date.now()-lastHitAt>2500)camMsg('Line the number line up in the gold box');
    } else {
      clearScanResolution();blankFrames=0;
      streak = (card.id===lastKey) ? streak+1 : 1; lastKey = card.id;
      if (streak>=2 && card.id!==cooldownKey){ hit(card); cooldownKey = card.id; }
      else if (card.id===cooldownKey && Date.now()-lastHitAt > 1800) camMsg('Got it. Swap in the next card.');
    }
    await sleep(120);
  }
}
function beep(){
  try{
    const ac = beep.ac || (beep.ac = new (window.AudioContext||window.webkitAudioContext)());
    const o=ac.createOscillator(), g=ac.createGain(); o.frequency.value=1320; g.gain.value=0.08;
    o.connect(g); g.connect(ac.destination); o.start(); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime+0.12); o.stop(ac.currentTime+0.13);
  }catch(e){}
}
function hit(card){
  if(!card || !byId.has(card.id) || !printingAllowed(card,scanPrintingScope))return;
  lastHitAt = Date.now();
  logAdd(card, foilMode);
  const f=$('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  $('guide').classList.add('hit'); setTimeout(()=>$('guide').classList.remove('hit'),500);
  navigator.vibrate?.(60); beep();
  const x = log[0];
  camMsg(`${card.n} · ${card.v ? card.v+' · ' : ''}${money(priceOf(card,x.foil))} ${finishLabel(x.foil)}`);
}
$('startBtn').onclick = startCam;
$('stopBtn').onclick = stopCam;
function setScanFinish(finish){
  if(!FINISHES.includes(finish))return;
  foilMode=finish==='normal'?false:finish==='foil'?true:'rainbow';
  $('scanFinish').value=finish;$('foilBtn').textContent=finishLabel(finish);$('foilBtn').setAttribute('aria-pressed',finish!=='normal');
  renderQuick();toast(`Scans and search additions count as ${finishLabel(finish).toLowerCase()}.`);
}
$('scanFinish').onchange=()=>setScanFinish($('scanFinish').value);
$('foilBtn').onclick=()=>setScanFinish(finishKey(foilMode)==='foil'?'normal':'foil');
$('torchBtn').onclick = async ()=>{
  const t = stream?.getVideoTracks()[0]; if(!t) return; const on = $('torchBtn').getAttribute('aria-pressed')!=='true';
  try{ await t.applyConstraints({advanced:[{torch:on}]}); $('torchBtn').setAttribute('aria-pressed',on); }catch(e){ toast('This camera’s light can’t be controlled here.'); }
};
document.addEventListener('visibilitychange', ()=>{ if (document.hidden && stream) stopCam(); });

/* =========================================================
   COLLECTION: cards / sets / wishlist
   ========================================================= */
let csub = 'cards', layout = lsGet('inkscan.layout','grid');
const collInks = new Set();
document.querySelectorAll('[data-csub]').forEach(b=>b.onclick=()=>{ csub=b.dataset.csub; document.querySelectorAll('[data-csub]').forEach(x=>x.setAttribute('aria-pressed',x===b)); renderColl(); });
document.querySelectorAll('[data-lay]').forEach(b=>b.onclick=()=>{ layout=b.dataset.lay; lsSet('inkscan.layout',layout); renderColl(); });
let cfT; $('cf').addEventListener('input',()=>{ clearTimeout(cfT); cfT=setTimeout(renderColl,120); });
$('sortSel').onchange = renderColl;
$('cFinish').onchange=renderColl;
$('cLegality').onchange=renderColl;
$('cReset').onclick=()=>{$('cf').value='';collInks.clear();$('cFinish').value='all';$('cLegality').value='all';$('sortSel').value='set';inkChips($('collInks'),collInks,renderColl);renderColl();};
function valueSummary(rows,finish){
  const result=InkSafety.valuation(rows,finish);
  return `${result.partial?'Partial estimate':'Estimated value'}: ${money(result.value)} for ${result.copies} owned copies${result.unpriced?` · ${result.unpriced} copies unpriced`:''}`;
}
function valueNote(){
  if(!LORCANA) return `${G.priceSource}; ${G.live?'prices as of the last lookup or Update prices':'catalog as of '+(DB?.asof||'unknown')}. — means unpriced.`;
  return `TCGplayer market prices via Lorcast; catalog as of ${DB?.asof||'unknown'}. ${finishPriceNote()} Ambiguous generic foil quotes are excluded.`;
}

function renderFilterCount(){
  const el=$('cFilterCount'); if(!el) return;
  const n=collInks.size+($('cFinish').value!=='all')+($('cLegality').value!=='all');
  el.textContent=n?`(${n} on)`:'';
}
function renderColl(){
  renderFilterCount();
  $('collCards').hidden = csub!=='cards'; $('collSets').hidden = csub!=='sets'; $('collWish').hidden = csub!=='wish';
  if (csub==='cards') renderCollCards(); else if (csub==='sets') renderSets(); else renderWish();
}
function collRows(){
  const f = norm($('cf').value); const rows = [];
  for (const [id,v] of Object.entries(inv)){
    const c = byId.get(id); if(!c || !inventoryCount(v)) continue;
    const finish=$('cFinish').value||'all';
    const q=finish==='all'||finish==='normal'?(v.q||0):0, foil=finish==='all'||finish==='foil'?(v.f||0):0, rf=finish==='all'||finish==='rainbow'?(v.rf||0):0;
    if(!q&&!foil&&!rf)continue;
    if (!inkMatch(c, collInks)) continue;
    if (!legalityMatches(c,$('cLegality').value))continue;
    if (f && !norm(c.n+c.v+c.sn+c.i+c.r+c.cl).includes(f) && !(norm(setLabel(c))+norm(c.c)).includes(f)) continue;
    const estimate=InkSafety.valuation([{c:valuedCard(c),q,f:foil,rf}]);
    rows.push({c:valuedCard(c),q,f:foil,rf,val:estimate.value,unpriced:estimate.unpriced});
  }
  const bySet = (a,b)=>bySetOrder(a.c,b.c);
  const s = $('sortSel').value;
  rows.sort(s==='value'?(a,b)=>b.val-a.val||bySet(a,b)
    :s==='name'?(a,b)=>a.c.n.localeCompare(b.c.n)||a.c.v.localeCompare(b.c.v)||bySet(a,b)
    :s==='cost'?(a,b)=>(a.c.co??99)-(b.c.co??99)||a.c.n.localeCompare(b.c.n)
    :s==='rarity'?(a,b)=>RARITY.indexOf(b.c.r)-RARITY.indexOf(a.c.r)||bySet(a,b):bySet);
  return rows;
}
function renderCollCards(){
  renderLegalityInfo();
  document.querySelectorAll('[data-lay]').forEach(x=>x.setAttribute('aria-pressed',x.dataset.lay===layout));
  const el = $('coll'); const rows = collRows();
  $('cValue').textContent=valueSummary(rows,'all');
  const cNote=$('cValueNote'); if(cNote) cNote.textContent=valueNote();
  if (!rows.length){
    el.className=''; el.innerHTML = Object.keys(inv).length ? `<div class="list"><div class="empty"><strong>No matches</strong>Nothing in your collection matches that filter.</div></div>` : `<div class="list"><div class="empty"><strong>Your collection is empty</strong>Scan cards on the Scan tab, or open any card in Browse and add it.</div></div>`;
    return;
  }
  if (layout==='grid'){
    el.className='grid';
    el.innerHTML = rows.map(r=>tileHTML(r.c,{q:r.q+r.f+r.rf,f:r.f,rf:r.rf,cap: `${money(r.val)}${r.unpriced?' (partial)':''}`})).join('');
  } else {
    el.className='list';
    el.innerHTML = rows.map(r=>`<div class="item"><div class="item-main" data-card="${r.c.id}">${thumbHTML(r.c)}<div class="who"><div class="n">${esc(r.c.n)}</div><div class="v">${esc(r.c.v)}</div><div class="m">${esc(setLabel(r.c))} · #${esc(r.c.c)} · ${esc(rarityLabel(r.c.r))}</div></div><div class="qtyv"><div class="q">${r.q?`×${r.q}`:''}${r.q&&r.f?' ':''}${r.f?`<span class="chip foil">Foil ×${r.f}</span>`:''}${r.rf?` <span class="chip rainbow">Rainbow foil ×${r.rf}</span>`:''}</div><div class="p">${money(r.val)}${r.unpriced?' (partial)':''}</div></div></div></div>`).join('');
  }
}
function renderSets(){
  const rows = DB.sets.map(s=>{
    const cs = setCards.get(s.code)||[]; let own=0, val=0, miss=0, unpriced=0, missingUnpriced=0;
    for (const c of cs){ const n=ownedOf(c.id); if(n){own++;const estimate=InkSafety.valuation([inventoryRows(c,inv[c.id])]);val+=estimate.value;unpriced+=estimate.unpriced;}else{const price=priceOf(c,false)??priceOf(c,true);if(price===null)missingUnpriced++;else miss+=price;} }
    return {s, total:G.live?Math.max(s.count||0,cs.length):cs.length, own, val, miss:G.live?null:miss, unpriced, missingUnpriced};
  }).filter(r=>r.total&&(!G.live||r.own));
  const started = rows.filter(r=>r.own), rest = rows.filter(r=>!r.own);
  const row = r => `<div class="item"><button class="item-main" data-set="${esc(r.s.code)}"><div class="who"><div class="n">${esc(r.s.name)}</div><div class="m">${/^\d+$/.test(r.s.code)?'Set '+esc(r.s.code)+' · ':''}${r.own}/${r.total} cards · ${money0(r.val)} owned${r.unpriced?` (${r.unpriced} copies unpriced)`:''} ${r.miss===null?'':` · ${money0(r.miss)} to finish`}${r.missingUnpriced?' (partial estimate)':''}</div><div class="bar"><i style="width:${(100*r.own/r.total).toFixed(1)}%"></i></div></div><span class="note">${Math.round(100*r.own/r.total)}%</span></button></div>`;
  $('setList').innerHTML = (started.length?`<div class="group">Started<span>${started.length} sets</span></div>`+started.map(row).join(''):'') + (rest.length?`<div class="group">Not started<span>${rest.length} sets</span></div>`+rest.map(row).join(''):'');
}
$('setList').addEventListener('click', e=>{
  const b=e.target.closest('[data-set]'); if(!b) return;
  resetBrowse(); $('bSet').value=b.dataset.set; $('bOwn').value='miss'; $('bSort').value='price'; showTab('browse');
  if(G.live) liveSearch('e:'+b.dataset.set,'prints').then(added=>{ if(added&&tab==='browse') renderBrowse(); });
  toast(`Missing cards from ${setName.get(b.dataset.set)}, most expensive first`);
});
function renderWish(){
  const rows = Object.entries(wish).map(([id,q])=>({c:byId.get(id),q})).filter(r=>r.c).sort((a,b)=>bySetOrder(a.c,b.c));
  let total=0,n=0,unpriced=0;for(const r of rows){const price=priceOf(r.c,foilPriceOnly(r.c));if(price===null)unpriced+=r.q;else total+=r.q*price;n+=r.q;}
  $('wishSum').innerHTML = rows.length ? `<div><strong>${n}</strong>cards wanted</div><div><strong>${money(total)}${unpriced?' (partial)':''}</strong>${unpriced?`${unpriced} copies unpriced`:'at TCGplayer market'}</div><button class="btn primary" id="wishBuy" style="margin-left:auto;align-self:center">Buy on TCGplayer</button>` : '';
  if (rows.length) $('wishBuy').onclick = ()=>openTcg(rows.map(r=>({q:r.q, c:r.c})));
  $('wishList').innerHTML = rows.length ? rows.map(r=>`<div class="item"><div class="item-main" data-card="${r.c.id}">${thumbHTML(r.c)}<div class="who"><div class="n">${esc(r.c.n)}</div><div class="v">${esc(r.c.v)}</div><div class="m">${metaLine(r.c,foilPriceOnly(r.c))}${ownedNV(r.c.nv)?` · own ${ownedNV(r.c.nv)}`:''}</div></div>
    <div class="acts"><button data-act="w" data-id="${r.c.id}" data-d="-1" aria-label="Want one fewer">−</button><output>${r.q}</output><button data-act="w" data-id="${r.c.id}" data-d="1" aria-label="Want one more">+</button></div></div>
    ${r.c.t?`<div style="padding:0 12px 10px 62px"><a class="link tiny" href="https://www.tcgplayer.com/product/${r.c.t}" target="_blank" rel="noopener">Buy on TCGplayer ↗</a></div>`:''}</div>`).join('')
    : `<div class="empty"><strong>Your wishlist is empty</strong>Open any card and tap + next to Wishlist, or use "Wishlist missing" on a deck.</div>`;
}
$('wishList').addEventListener('click', e=>{
  const b=e.target.closest('button[data-act="w"]'); if(!b) return;
  const id=b.dataset.id; wish[id]=Math.max(0,(wish[id]||0)+ +b.dataset.d); if(!wish[id]) delete wish[id]; saveWish(); renderWish();
});

/* ---- TCGplayer Mass Entry: prefilled cart link ---- */
function massEntryUrl(items){ // items: [{q, c}]
  const lines = items.filter(x=>x.q>0 && x.c).map(x=>`${x.q} ${x.c.n}${LORCANA&&x.c.v?' - '+x.c.v:''}`);
  return 'https://www.tcgplayer.com/massentry?productline=' + encodeURIComponent(LORCANA?'Lorcana TCG':G.tcgLine) + '&c=' + lines.map(encodeURIComponent).join('||');
}
function openTcg(items, what){
  if (!items.some(x=>x.q>0)){ toast(`Nothing to buy${what?' '+what:''}`); return; }
  window.open(massEntryUrl(items), '_blank', 'noopener');
}
/* =========================================================
   BROWSE
   ========================================================= */
const bInks = new Set();
function fillSetSelect(){
  $('bSet').innerHTML = `<option value="">All sets</option>` + DB.sets.map(s=>`<option value="${esc(s.code)}">${/^\d+$/.test(s.code)?esc(s.code)+' · ':''}${esc(s.name)}</option>`).join('');
}
function resetBrowse(){
  $('bq').value=''; bInks.clear(); ['bSet','bType','bCost','bRar','bOwn'].forEach(id=>$(id).value=''); $('bSort').value='set';$('bFinish').value='all';$('bLegality').value='all';
  inkChips($('bInks'), bInks, renderBrowse);
}
$('bReset').onclick = ()=>{ resetBrowse(); renderBrowse(); };
let bT; $('bq').addEventListener('input',()=>{ clearTimeout(bT); bT=setTimeout(renderBrowse,150); });
['bSet','bType','bCost','bRar','bOwn','bSort','bFinish','bLegality'].forEach(id=>$(id).onchange=renderBrowse);
function renderBrowse(){
  if (!DB) return;
  if (G.live) liveSearch($('bq').value).then(added=>{ if(added&&tab==='browse') renderBrowse(); });
  renderLegalityInfo();
  const q = norm($('bq').value), set=$('bSet').value, type=$('bType').value, cost=$('bCost').value, rar=$('bRar').value, own=$('bOwn').value;
  const finish=$('bFinish').value||'all';
  let list = DB.cards.filter(c=>{
    if (set && c.s!==set) return false;
    if (!legalityMatches(c,$('bLegality').value))return false;
    if (!inkMatch(c,bInks)) return false;
    if (type && !isType(c,type)) return false;
    if (cost && (cost==='7' ? (c.co??0)<7 : c.co!=+cost)) return false;
    if (rar && c.r!==rar) return false;
    const owned=finish==='normal'?(inv[c.id]?.q||0):finish==='foil'?(inv[c.id]?.f||0):finish==='rainbow'?(inv[c.id]?.rf||0):ownedOf(c.id);
    if (own==='own' && !owned) return false;
    if (own==='miss' && owned) return false;
    if (q && !norm(c.n+c.v+c.cl+c.tx).includes(q)) return false;
    return true;
  });
  const shownPrice=c=>finish==='all'?(priceOf(c,false)??priceOf(c,true)??priceOf(c,'rainbow')):priceOf(c,finish);
  const s=$('bSort').value;
  list.sort(s==='name'?(a,b)=>a.n.localeCompare(b.n)||a.v.localeCompare(b.v)||bySetOrder(a,b)
    :s==='cost'?(a,b)=>(a.co??99)-(b.co??99)||a.n.localeCompare(b.n)
    :s==='price'?(a,b)=>((shownPrice(b)??-1)-(shownPrice(a)??-1))||bySetOrder(a,b):bySetOrder);
  let missCost=0, unpriced=0; if(own==='miss') for(const c of list){const p=shownPrice(c);if(p===null)unpriced++;else missCost+=p;}
  $('bCount').textContent = `${list.length.toLocaleString()} cards${own==='miss'&&list.length?` · ${money(missCost)} ${unpriced?`priced portion; ${unpriced} unpriced`:'estimated to buy them all'}`:''}`;
  $('bValue').textContent=valueSummary(list.map(c=>inventoryRows(c,inv[c.id])),finish);
  const bNote=$('bValueNote'); if(bNote) bNote.textContent=valueNote();
  chunked($('bGrid'), $('bSentinel'), list, c=>{const q=finish==='all'||finish==='normal'?(inv[c.id]?.q||0):0,f=finish==='all'||finish==='foil'?(inv[c.id]?.f||0):0,rf=finish==='all'||finish==='rainbow'?(inv[c.id]?.rf||0):0;return tileHTML(c,{q:q+f+rf,f,rf,dim:true,cap:`${setLabel(c)} #${c.c} · ${money(shownPrice(c))}${finish==='all'?'':' '+finish}`});});
}
function refreshBrowseBadges(){
  document.querySelectorAll('#bGrid .tile').forEach(t=>{
    const c = byId.get(t.dataset.card); const q = ownedOf(c.id);
    t.classList.toggle('missing', !q);
    const art = t.querySelector('.art'); art.querySelector('.badge')?.remove();
    if (q) art.insertAdjacentHTML('beforeend', `<span class="badge">${q}</span>`);
  });
}

/* =========================================================
   DECKS
   ========================================================= */
let curDeck = null, dsub = 'list', handIds = null;
const uid = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
function deckCount(d){ return Object.values(d.cards).reduce((a,b)=>a+b,0); }
function deckInks(d){ const s=new Set(); for (const nv of Object.keys(d.cards)) for (const i of (repOf(nv)?.inks||[])) s.add(i); return [...s].sort((a,b)=>INKS.indexOf(a)-INKS.indexOf(b)); }
/* MTG Commander: who leads the deck, its color identity, and what breaks the rules. */
function deckCommanders(d){ return (d.commanders||[]).filter(nv=>d.cards[nv]>0 && repOf(nv)); }
function commanderCheck(d){
  const nvs=deckCommanders(d), cmds=nvs.map(repOf), out={nvs, cmds, identity:[], problem:''};
  for (const c of cmds) for (const i of c.inks) if (i!=='Colorless' && !out.identity.includes(i)) out.identity.push(i);
  out.identity.sort((a,b)=>INKS.indexOf(a)-INKS.indexOf(b));
  const bad=cmds.find(c=>!G.canCommand(c));
  if (!cmds.length) out.problem='No commander yet';
  else if (bad) out.problem=`${bad.n} can't be a commander`;
  else if (cmds.length>2) out.problem='A deck can have at most two commanders';
  else if (cmds.length===2) out.problem=G.pairProblem(cmds[0],cmds[1]);
  else if (/\bBackground\b/.test(cmds[0].ty.split('//')[0])) out.problem='A Background needs a commander with Choose a Background';
  return out;
}
const offIdentity=(c,identity)=>c.inks.some(i=>i!=='Colorless' && !identity.includes(i));
function deckStats(d){
  let leaders=0, offColor=0, overCopies=0, banned=0, notLegal=0, unchecked=0, gameChangers=0, gcUnknown=0; const gcNames=[];
  const cmd = G.deck?.commander ? commanderCheck(d) : null;
  let total=0, inkable=0, missing=0, missCost=0, missingUnpriced=0, value=0; const curve=Array(8).fill(0); const types={};
  for (const [nv,q] of Object.entries(d.cards)){
    const c = repOf(nv); if(!c) continue;
    total+=q; if (c.ik) inkable+=q;
    curve[Math.min(7, Math.max(0,c.co||0))]+=q;
    const t = c.ty.split('/')[0]; types[t]=(types[t]||0)+q;
    const m=Math.max(0,q-ownedNV(nv)),price=cheapest(nv);missing+=m;if(price===null)missingUnpriced+=m;else missCost+=m*price;
    if (!LORCANA && G.deck.leaderType && c.ty===G.deck.leaderType) leaders+=q;
    if (!LORCANA && q>G.deck.maxCopies && !(G.deck.singletonExempt&&G.deck.singletonExempt(c))) overCopies++;
    if (cmd){
      if (cmd.cmds.length && !cmd.nvs.includes(nv) && offIdentity(c,cmd.identity)) offColor+=q;
      if (c.lg==='banned') banned+=q; else if (c.lg==='not_legal') notLegal+=q; else if (c.lg!=='legal') unchecked+=q;
      if (c.gc===true){ gameChangers++; gcNames.push(c.n); } else if (c.gc===undefined) gcUnknown++;
    }
  }
  if (!LORCANA && G.deck.leaderType){
    const leader=Object.keys(d.cards).map(repOf).find(c=>c&&c.ty===G.deck.leaderType);
    if (leader) for (const [nv,q] of Object.entries(d.cards)){ const c=repOf(nv); if(c&&c!==leader&&!c.inks.some(i=>leader.inks.includes(i))) offColor+=q; }
  }
  const main = total - leaders;
  const bracket = cmd ? deckBracket(d) : null, gcOver = bracket && gameChangers>GC_LIMIT[bracket] ? true : false;
  return {total, main, leaders, offColor, overCopies, banned, notLegal, unchecked, gameChangers, gcNames, gcUnknown, bracket, gcOver, cmd, inkable, missing, missCost, missingUnpriced, curve, types, inks: cmd&&cmd.cmds.length ? cmd.identity : deckInks(d)};
}
/* returns true or a message explaining why it couldn't add */
function deckAdd(d, nv, n){
  const cur = d.cards[nv]||0, next = cur+n;
  if (n>0 && LORCANA){
    if (next>4) return 'A deck can have at most 4 copies of a card';
    const c = repOf(nv), inks = new Set(deckInks(d)); c.inks.forEach(i=>inks.add(i));
    if (!d.cards[nv] && inks.size>2) return 'A deck can only use 2 inks';
  }
  if (n>0 && !LORCANA){
    const c = repOf(nv);
    if (G.deck.leaderType && c?.ty===G.deck.leaderType && next>1) return 'A deck has exactly one Leader';
    if (G.deck.leaderType && c?.ty===G.deck.leaderType && !d.cards[nv] && Object.keys(d.cards).some(k=>repOf(k)?.ty===G.deck.leaderType)) return 'This deck already has a Leader. Remove it first.';
    if (next>G.deck.maxCopies && !(G.deck.singletonExempt&&G.deck.singletonExempt(c))) return G.deck.maxCopies===1?'Commander decks are singleton: one copy of each card except basic lands':`A deck can have at most ${G.deck.maxCopies} copies of a card`;
  }
  if (next<=0){ delete d.cards[nv]; if (d.commanders?.includes(nv)) d.commanders=d.commanders.filter(k=>k!==nv); } else d.cards[nv]=next;
  d.updated = Date.now(); saveDecks(); return true;
}
/* Tapping the star makes a card the commander, adds a valid partner, or swaps the commander out. */
function toggleCommander(d, nv){
  const c=repOf(nv); if(!c || !d.cards[nv]) return 'Add the card to the deck first';
  const cur=deckCommanders(d);
  if (cur.includes(nv)){ d.commanders=cur.filter(k=>k!==nv); d.updated=Date.now(); saveDecks(); return `${c.n} is no longer a commander`; }
  if (!G.canCommand(c)) return `${c.n} can't be a commander`;
  if (cur.length===1 && !G.pairProblem(repOf(cur[0]),c)){ d.commanders=[cur[0],nv]; d.updated=Date.now(); saveDecks(); return `${c.n} added as a second commander`; }
  d.commanders=[nv]; d.updated=Date.now(); saveDecks();
  return cur.length ? `Commander changed to ${c.n}` : `${c.n} is the commander`;
}
function inkSetHTML(inks){ return `<span class="inkset">${inks.map(i=>`<span class="ink ${i}" title="${i}"></span>`).join('')}</span>`; }
/* Deck home: search plus a collapsible filter box, mirroring Collection. */
const deckInkSel=new Set();
let deckHomeScroll=0;
const deckBracket=d=>d.bracket?String(d.bracket):(/^B([1-5])\s*[·.\-:]/.exec(d.name)||[])[1]||null;
// Commander Brackets (beta, Feb 2026): Game Changers none in 1-2, up to 3 in 3, any in 4-5.
const GC_LIMIT={1:0,2:0,3:3,4:Infinity,5:Infinity};
function deckRulesState(st){
  if(!st.cmd) return null;
  const size=G.deck.size;
  if(st.main<size) return 'short';
  return !st.cmd.problem&&!st.offColor&&!st.overCopies&&!st.banned&&!st.notLegal&&!st.gcOver&&!st.unchecked&&st.main===size?'pass':(st.cmd.problem||st.offColor||st.overCopies||st.banned||st.notLegal||st.gcOver||st.main!==size)?'fix':'unchecked';
}
function deckLead(d,st){
  const cmd=st.cmd?.cmds?.[0]; if(cmd) return cmd;
  const lead=Object.entries(d.cards).sort((a,b)=>(repOf(b[0])?.co||0)-(repOf(a[0])?.co||0))[0];
  return lead&&repOf(lead[0]);
}
function deckFilterCount(){
  const n=($('dFav').checked?1:0)+deckInkSel.size+(deckInkSel.size&&$('dExact').checked?1:0)+($('dStatus').value!=='all')+($('dBracket').value!=='all')+($('dOwn').value!=='all')+(norm($('dCard').value)?1:0);
  $('dFilterCount').textContent=n?`(${n} on)`:'';
}
function deckRows(){
  const favOnly=$('dFav').checked, q=norm($('df').value), cardQ=norm($('dCard').value), status=$('dStatus').value, br=$('dBracket').value, own=$('dOwn').value, exact=$('dExact').checked;
  const rows=[];
  for(const d of decks){
    if(favOnly && !d.favorite) continue;
    const st=deckStats(d);
    if(q && !norm(d.name+' '+(st.cmd?.cmds||[]).map(c=>c.n).join(' ')).includes(q)) continue;
    if(deckInkSel.size){
      const inks=st.inks.filter(i=>i!=='Colorless');
      if(![...deckInkSel].every(i=>i==='Colorless'?!inks.length:inks.includes(i))) continue;
      if(exact && (inks.length!==[...deckInkSel].filter(i=>i!=='Colorless').length)) continue;
    }
    if(status!=='all' && deckRulesState(st)!==status) continue;
    if(br!=='all' && deckBracket(d)!==br) continue;
    if(own==='complete' && (st.missing||!st.total)) continue;
    if(own==='missing' && !st.missing) continue;
    if(cardQ && !Object.keys(d.cards).some(nv=>norm(repOf(nv)?.n||'').includes(cardQ))) continue;
    rows.push({d,st});
  }
  const s=$('dSort').value;
  rows.sort(s==='name'?(a,b)=>a.d.name.localeCompare(b.d.name,undefined,{numeric:true})
    :s==='owned'?(a,b)=>((b.st.total-b.st.missing)/(b.st.total||1))-((a.st.total-a.st.missing)/(a.st.total||1))||a.st.missCost-b.st.missCost
    :s==='cost'?(a,b)=>a.st.missCost-b.st.missCost||a.st.missing-b.st.missing
    :(a,b)=>b.d.updated-a.d.updated);
  // Favorites first: a stable re-sort that pins hearted decks above the rest, each group keeping the chosen order.
  if($('dFavFirst').checked) rows.sort((a,b)=>(b.d.favorite?1:0)-(a.d.favorite?1:0));
  return rows;
}
function deckItemHTML({d,st}){
  const c=deckLead(d,st), rules=deckRulesState(st), cmdNames=(st.cmd?.cmds||[]).map(x=>x.n).join(' + ');
  return `<div class="item"><button class="item-main" data-deck="${d.id}">${c?thumbHTML(c):'<span class="thumb"></span>'}<div class="who"><div class="n">${esc(d.name)}</div>${cmdNames&&norm(cmdNames)!==norm(d.name.replace(/^B[1-5]\s*[·.\-:]\s*/,''))?`<div class="m">${esc(cmdNames)}</div>`:''}<div class="m">${inkSetHTML(st.inks)} ${st.inks.join(' / ')||'No cards yet'}</div><div class="m">${LORCANA?st.total:st.main}/${LORCANA?60:G.deck.size} cards${st.missing?` · missing ${st.missing} (${money(st.missCost)}${st.missingUnpriced?` partial; ${st.missingUnpriced} unpriced`:''})`:st.total?' · you own every card':''}</div></div>${rules==='pass'?'<span class="chip ok">Rules pass</span>':rules==='fix'||rules==='short'?'<span class="chip warn">Fix rules</span>':LORCANA&&st.total>=60&&st.inks.length<=2?'<span class="chip">Size / ink check only</span>':''}</button><button class="fav" data-fav="${d.id}" aria-pressed="${!!d.favorite}" aria-label="${d.favorite?'Remove from favorites':'Add to favorites'}">${d.favorite?'♥':'♡'}</button></div>`;
}
function renderDecks(keepScroll){
  if (curDeck){ renderDeckEdit(keepScroll); return; }
  $('deckHome').hidden=false; $('deckEdit').hidden=true;
  const hasDecks=decks.length>0;
  for(const id of ['df','dFilters','dCount']) $(id).hidden=!hasDecks;
  $('dStatusWrap').hidden=!G.deck?.commander;
  const brackets=[...new Set(decks.map(deckBracket).filter(Boolean))].sort();
  $('dBracketWrap').hidden=!brackets.length;
  const cur=$('dBracket').value||'all';
  const opts='<option value="all">All brackets</option>'+brackets.map(b=>`<option value="${b}">Bracket ${b}</option>`).join('');
  if($('dBracket').innerHTML!==opts){ $('dBracket').innerHTML=opts; $('dBracket').value=brackets.includes(cur)?cur:'all'; }
  deckFilterCount();
  if(!hasDecks){ $('deckList').innerHTML=`<div class="empty"><strong>No decks yet</strong>Tap New deck to build one from your collection, or Import to paste a list from Dreamborn, Inktable or a website.</div>`; return; }
  const rows=deckRows();
  $('dCount').textContent=rows.length===decks.length?`${decks.length} decks`:`Showing ${rows.length} of ${decks.length} decks`;
  $('deckList').innerHTML=rows.length?rows.map(deckItemHTML).join(''):`<div class="empty"><strong>No decks match</strong>Change the search or tap Reset deck filters.</div>`;
}
let dfT; for(const id of ['df','dCard']) $(id).addEventListener('input',()=>{ clearTimeout(dfT); dfT=setTimeout(()=>renderDecks(),150); });
for(const id of ['dStatus','dBracket','dOwn','dSort','dExact','dFav']) $(id).onchange=()=>renderDecks();
$('dFavFirst').checked=lsGet('inkscan.favFirst',true)!==false;
$('dFavFirst').onchange=()=>{ lsSet('inkscan.favFirst',$('dFavFirst').checked); renderDecks(); };
$('dReset').onclick=()=>{ $('dFav').checked=false;$('dFavFirst').checked=true;lsSet('inkscan.favFirst',true);$('df').value='';$('dCard').value='';deckInkSel.clear();$('dExact').checked=false;$('dStatus').value='all';$('dBracket').value='all';$('dOwn').value='all';$('dSort').value='recent';inkChips($('deckInks'),deckInkSel,()=>renderDecks());renderDecks(); };
inkChips($('deckInks'),deckInkSel,()=>renderDecks());
function toggleFavorite(d){ if(!d) return; if(d.favorite) delete d.favorite; else d.favorite=true; saveDecks(); /* not an edit: keeps its place in Recently edited */ toast(d.favorite?`Added ${d.name} to favorites`:`Removed ${d.name} from favorites`); }
$('deckList').addEventListener('click', e=>{ const f=e.target.closest('[data-fav]'); if(f){ const y=window.scrollY; toggleFavorite(decks.find(x=>x.id===f.dataset.fav)); renderDecks(); window.scrollTo(0,y); return; } const b=e.target.closest('[data-deck]'); if(b){ deckHomeScroll=window.scrollY; curDeck=b.dataset.deck; dsub='list'; renderDecks(); window.scrollTo(0,0); } });
$('newDeckBtn').onclick = ()=>{
  const d = {id:uid(), name:`New deck ${decks.length+1}`, cards:{}, updated:Date.now()};
  decks.push(d); saveDecks(); curDeck=d.id; dsub='add'; renderDecks(); $('deckName').select();
};
$('deckBack').onclick = ()=>{ curDeck=null; renderDecks(); window.scrollTo(0,deckHomeScroll); };
$('deckName').addEventListener('change', ()=>{ const d=getDeck(); if(!d) return; d.name=$('deckName').value.trim()||'Untitled deck'; d.updated=Date.now(); saveDecks(); });
document.querySelectorAll('[data-dsub]').forEach(b=>b.onclick=()=>{ dsub=b.dataset.dsub; renderDeckEdit(); });
$('deckFavBtn').onclick=()=>{ toggleFavorite(getDeck()); renderDeckEdit(true); };
$('deckBracketSel').onchange=()=>{ const d=getDeck(); if(!d) return; const v=+$('deckBracketSel').value; if(v>=1&&v<=5) d.bracket=v; else delete d.bracket; d.updated=Date.now(); saveDecks(); renderDeckEdit(true); };
function getDeck(){ return decks.find(d=>d.id===curDeck); }

/* Cards cached before the ban check existed carry no Commander legality. Fetch just those, once per deck per visit. */
const legalityFilled=new Set();
async function fillDeckLegality(d){
  if(!G.deck?.commander||!G.live||!navigator.onLine||legalityFilled.has(d.id)) return;
  const ids=[...new Set(Object.keys(d.cards).map(repOf).filter(c=>c&&(!c.lg||c.gc===undefined)&&c.id.startsWith('sf_')).map(c=>c.id.slice(3)))];
  legalityFilled.add(d.id);
  try{
    for(let i=0;i<ids.length;i+=75){ const j=await scryfall('/cards/collection',{method:'POST',body:JSON.stringify({identifiers:ids.slice(i,i+75).map(id=>({id}))})}); addLiveCards((j?.data||[]).map(G.fromScryfall)); }
    // Cards with no priced paper printing cached: look up their paper printings (cheapest first), a few per visit.
    const unpriced=Object.keys(d.cards).filter(nv=>cheapest(nv)===null).map(repOf).filter(c=>c?.oid).slice(0,25);
    for(const c of unpriced){ try{ const j=await scryfall(`/cards/search?q=${encodeURIComponent('oracleid:'+c.oid+' game:paper')}&unique=prints&order=usd&dir=asc`); addLiveCards((j?.data||[]).slice(0,6).map(G.fromScryfall)); }catch(e){} }
    if(getDeck()===d && tab==='decks') renderDeckEdit(true);
  }catch(e){ legalityFilled.delete(d.id); }
}
/* Overview & strategy: a collapsible panel at the top of a deck, from the deck file's guide. */
function renderDeckGuide(d){
  const g=d.guide, box=$('deckGuide');
  box.hidden=!g; if(!g){ $('deckGuideBody').innerHTML=''; return; }
  if(box.dataset.deck!==d.id){ box.dataset.deck=d.id; box.open=lsGet('inkscan.guideOpen',false)===true; }
  const t=v=>typeof v==='string'?esc(v):'';
  const keyBtn=name=>{ const nv=G.nvKey?G.nvKey({n:name,v:''}):norm(name)+'|'; const c=repOf(nv)||[...byNV.keys()].filter(k=>k.startsWith(norm(name))).map(repOf)[0]; return c?`<button class="keycard" data-card="${esc(c.id)}">${esc(name)}</button>`:`<span class="keycard">${esc(name)}</span>`; };
  $('deckGuideBody').innerHTML=`${Array.isArray(g.themes)&&g.themes.length?`<div class="chips">${g.themes.slice(0,6).map(x=>`<span class="chip">${t(x)}</span>`).join('')}</div>`:''}
    ${g.overview?`<p>${t(g.overview)}</p>`:''}
    ${g.early||g.middle||g.late?`<h4>How it plays</h4><dl class="phase">${g.early?`<dt>Early</dt><dd>${t(g.early)}</dd>`:''}${g.middle?`<dt>Middle</dt><dd>${t(g.middle)}</dd>`:''}${g.late?`<dt>Closing</dt><dd>${t(g.late)}</dd>`:''}</dl>`:''}
    ${Array.isArray(g.win)&&g.win.length?`<h4>Wins with</h4><ul>${g.win.map(x=>`<li>${t(x)}</li>`).join('')}</ul>`:''}
    ${Array.isArray(g.keys)&&g.keys.length?`<h4>Key cards</h4><div class="chips">${g.keys.map(keyBtn).join('')}</div>`:''}
    ${g.tip?`<h4>Tip</h4><p>${t(g.tip)}</p>`:''}
    <p class="note">${t(g.source||'Built from EDHREC themes and combos, Scryfall card text and this decklist.')}</p>`;
}
$('deckGuide').addEventListener('toggle',()=>lsSet('inkscan.guideOpen',$('deckGuide').open));
function renderDeckEdit(keepScroll){
  const d = getDeck(); if(!d){ curDeck=null; renderDecks(); return; }
  fillDeckLegality(d);
  $('deckHome').hidden=true; $('deckEdit').hidden=false;
  if (document.activeElement!==$('deckName')) $('deckName').value = d.name;
  $('deckBracketWrap').hidden=!G.deck?.commander; if(G.deck?.commander) $('deckBracketSel').value=d.bracket?String(d.bracket):'';
  renderDeckGuide(d);
  $('deckFavBtn').setAttribute('aria-pressed',!!d.favorite); $('deckFavBtn').textContent=d.favorite?'♥':'♡'; $('deckFavBtn').setAttribute('aria-label',d.favorite?'Remove from favorites':'Add to favorites');
  document.querySelectorAll('[data-dsub]').forEach(x=>x.setAttribute('aria-pressed',x.dataset.dsub===dsub));
  const st = deckStats(d); const max = Math.max(1,...st.curve);
  const warns = [];
  if (LORCANA){
  if (st.total<60) warns.push(`<span class="chip warn">${60-st.total} more cards needed</span>`);
  if (st.inks.length>2) warns.push(`<span class="chip warn">More than 2 inks</span>`);
  if (st.total>=60 && st.inks.length<=2) warns.push(`<span class="chip">Size / ink check only</span>`);
  } else {
    const size=G.deck.size;
    if (st.main<size) warns.push(`<span class="chip warn">${size-st.main} more cards needed</span>`);
    if (st.main>size) warns.push(`<span class="chip warn">${st.main-size} cards over ${size}</span>`);
    if (G.deck.leaderType && st.leaders!==1) warns.push(`<span class="chip warn">${st.leaders?'More than one Leader':'No Leader yet'}</span>`);
    if (st.overCopies) warns.push(`<span class="chip warn">${st.overCopies} cards over the copy limit</span>`);
    if (st.cmd){
      if (st.cmd.problem) warns.push(`<span class="chip warn">${esc(st.cmd.problem)}</span>`);
      if (st.offColor) warns.push(`<span class="chip warn">${st.offColor} cards outside ${esc(st.cmd.identity.join(' / ')||'colorless')} identity</span>`);
      if (st.banned) warns.push(`<span class="chip warn">${st.banned} banned in Commander</span>`);
      if (st.notLegal) warns.push(`<span class="chip warn">${st.notLegal} not legal in Commander</span>`);
      if (st.unchecked) warns.push(`<span class="chip">${st.unchecked} not checked for bans yet${navigator.onLine?'':' (offline)'}</span>`);
      if (st.gcOver) warns.push(`<span class="chip warn" title="${esc(st.gcNames.join(', '))}">${st.gameChangers} Game Changer${st.gameChangers===1?'':'s'}: Bracket ${st.bracket} allows ${GC_LIMIT[st.bracket]||'none'}</span>`);
      else if (st.gameChangers) warns.push(`<span class="chip" title="${esc(st.gcNames.join(', '))}">${st.gameChangers} Game Changer${st.gameChangers===1?'':'s'}</span>`);
      if (st.main===size && !st.cmd.problem && !st.offColor && !st.overCopies && !st.banned && !st.notLegal && !st.gcOver && !st.unchecked) warns.push(`<span class="chip">Commander rules pass</span>`);
    }
    else if (st.offColor) warns.push(`<span class="chip warn">${st.offColor} cards off the Leader's colors</span>`);
    if (!st.cmd && st.main===size && !st.offColor && !st.overCopies && (!G.deck.leaderType||st.leaders===1)) warns.push(`<span class="chip">Size / copy check only</span>`);
  }
  if (st.missing) warns.push(`<span class="chip warn">Missing ${st.missing} · ${money(st.missCost)}${st.missingUnpriced?` partial; ${st.missingUnpriced} unpriced`:''}</span>`);
  $('deckStats').innerHTML = `<div class="nums"><div><strong>${st.total}</strong>cards</div>${LORCANA?`<div><strong>${st.inkable}</strong>inkable</div><div><strong>${(st.types.Character||0)}</strong>characters</div><div><strong>${(st.types.Action||0)+(st.types.Item||0)+(st.types.Location||0)}</strong>other</div>`:`<div><strong>${st.main}</strong>${G.deck.leaderType?'main deck':'total'}</div>${G.deck.leaderType?`<div><strong>${st.leaders}</strong>leader</div>`:''}`}<div>${inkSetHTML(st.inks)}<br>${st.inks.join(' / ')||'—'}</div></div>
    <div class="curve" aria-label="Cost curve">${st.curve.map((n,i)=>i===0&&!n?'':`<div><span>${n||''}</span><i style="height:${Math.round(44*n/max)}px"></i><span>${i===7?'7+':i}</span></div>`).join('')}</div>
    <div class="warns">${warns.join('')}</div>`;
  $('deckListPane').hidden = dsub!=='list'; $('deckAddPane').hidden = dsub!=='add';
  if (dsub==='list') renderDeckList(d); else renderDeckAdd(d, keepScroll);
}
function deckRowHTML(nv, q, d){
  const c = repOf(nv); const own = ownedNV(nv); const short = Math.max(0,q-own);
  return `<div class="item"><div class="item-main" data-card="${c.id}">${thumbHTML(c)}<div class="who"><div class="n">${esc(c.n)}</div><div class="v">${esc(c.v)}</div><div class="m">${LORCANA?`${c.co} cost · ${c.ik?'inkable':'not inkable'}`:esc(G.rowMeta(c))} · ${short?`<span style="color:var(--warn)">own ${own} of ${q}</span>`:`own ${own}`}</div></div>
    <div class="acts">${G.deck?.commander&&G.canCommand(c)?(()=>{const on=deckCommanders(d).includes(nv);return `<button data-act="cmd" data-nv="${esc(nv)}" aria-pressed="${on}" aria-label="${on?'Remove as commander':'Make commander'}" title="${on?'Remove as commander':'Make commander'}">★</button>`;})():''}<button data-act="dq" data-nv="${esc(nv)}" data-d="-1" aria-label="One fewer">−</button><output>${q}</output><button data-act="dq" data-nv="${esc(nv)}" data-d="1" aria-label="One more" ${q>=(LORCANA?4:(G.deck.singletonExempt&&G.deck.singletonExempt(c)?99:G.deck.maxCopies))?'disabled':''}>+</button></div></div></div>`;
}
function renderDeckList(d){
  const entries = Object.entries(d.cards).map(([nv,q])=>({nv,q,c:repOf(nv)})).filter(x=>x.c);
  if (!entries.length){ $('deckListPane').innerHTML = `<div class="list"><div class="empty"><strong>Empty deck</strong>Switch to Add cards to start building.</div></div>`; return; }
  const cmdNVs = G.deck?.commander ? deckCommanders(d) : [];
  const groups = LORCANA ? [['Characters',x=>isType(x.c,'Character')],['Actions & songs',x=>isType(x.c,'Action')],['Items',x=>isType(x.c,'Item')],['Locations',x=>isType(x.c,'Location')]] : [...(cmdNVs.length?[[cmdNVs.length>1?'Commanders':'Commander',x=>cmdNVs.includes(x.nv)]]:[]),...G.deckGroups.map(([label,fn])=>[label,x=>fn(x.c)])];
  let html=''; const placed=new Set();
  for (const [label,fn] of groups){
    const g = entries.filter(x=>!placed.has(x.nv)&&fn(x)).sort((a,b)=>(a.c.co-b.c.co)||a.c.n.localeCompare(b.c.n)); g.forEach(x=>placed.add(x.nv)); if(!g.length) continue;
    html += `<div class="group">${label}<span>${g.reduce((a,x)=>a+x.q,0)}</span></div>` + g.map(x=>deckRowHTML(x.nv,x.q,d)).join('');
  }
  $('deckListPane').innerHTML = `<div class="list">${html}</div>`;
}
function onDeckQty(e){
  const star=e.target.closest('button[data-act="cmd"]');
  if(star){ const d=getDeck(); if(d){ toast(toggleCommander(d, star.dataset.nv)); renderDeckEdit(true); } return; }
  const b=e.target.closest('button[data-act="dq"]'); if(!b) return;
  const d=getDeck(); const r = deckAdd(d, b.dataset.nv, +b.dataset.d);
  if (r!==true) toast(r);
  renderDeckEdit(true);
}
$('deckListPane').addEventListener('click', onDeckQty);
$('dRes').addEventListener('click', onDeckQty);
let dqT; $('dq').addEventListener('input',()=>{ clearTimeout(dqT); dqT=setTimeout(()=>renderDeckEdit(),150); });
$('dOwned').onchange = ()=>renderDeckEdit();
function renderDeckAdd(d, keepScroll){
  const inks = deckInks(d); const q = norm($('dq').value); const ownedOnly = $('dOwned').checked;
  if (LORCANA) $('dInkNote').textContent = inks.length>=2 ? `Showing ${inks.join(' and ')} cards` : inks.length===1 ? `${inks[0]} plus any second ink` : 'Any ink';
  else $('dInkNote').textContent = G.live && !ownedOnly ? 'Searching Scryfall as you type' : '';
  if (G.live && !ownedOnly) liveSearch($('dq').value).then(added=>{ if(added&&getDeck()===d) renderDeckAdd(d,true); });
  let list = nvReps.map(ps=>ps.find(c=>!isSpecialCard(c))||ps[0]).filter(c=>{
    if (LORCANA && inks.length>=2 && !c.inks.every(i=>inks.includes(i))) return false;
    if (LORCANA && inks.length===1){ const s=new Set([...inks,...c.inks]); if (s.size>2) return false; }
    if (ownedOnly && !ownedNV(c.nv) && !d.cards[c.nv]) return false;
    if (q && !norm(c.n+c.v+c.cl+c.tx).includes(q)) return false;
    return true;
  }).map(c=>repOf(c.nv));
  list.sort((a,b)=>(a.co-b.co)||a.n.localeCompare(b.n)||a.v.localeCompare(b.v));
  const y = window.scrollY;
  if (!list.length){ $('dRes').innerHTML = `<div class="empty">${ownedOnly?'None of your cards match. Uncheck "Cards I own" to search every card.':'No cards match that search.'}</div>`; $('dMore').innerHTML=''; return; }
  const render = c => deckRowHTML(c.nv, d.cards[c.nv]||0, d).replace('aria-label="One fewer"', 'aria-label="One fewer"'+(d.cards[c.nv]?'':' disabled'));
  chunked($('dRes'), $('dMore'), list, render, 60);
  if (keepScroll) window.scrollTo(0,y);
}

/* deck menu */
$('deckMoreBtn').onclick = ()=>{
  const d=getDeck(); if(!d) return;
  openSheet(d.name, `<div class="toolbtns">
      <button class="btn" data-dm="copy">Copy decklist</button>
      <button class="btn" data-dm="txt">Download .txt</button>
      <button class="btn" data-dm="wish">Wishlist missing cards</button>
      <button class="btn" data-dm="buy">Buy missing on TCGplayer</button>
      <button class="btn" data-dm="dup">Duplicate deck</button>
      <button class="btn" data-dm="newcards">Add list as new physical cards</button>
      ${d.importLines||d.unresolved?'<button class="btn" data-dm="source">Review imported source</button>':''}
    </div>
    <p class="note">${esc(LORCANA?'Decklists use the "4 Name - Version" format that Dreamborn, Inktable and most Lorcana sites import.':G.deckFormatNote)}</p>
    <div class="confirm row" id="delRow"><button class="btn danger" data-dm="del">Delete deck</button></div>`);
};
function deckText(d){
  return Object.entries(d.cards).map(([nv,q])=>({q,c:repOf(nv)})).filter(x=>x.c).sort((a,b)=>(a.c.co-b.c.co)||a.c.n.localeCompare(b.c.n))
    .map(x=>LORCANA?`${x.q} ${x.c.n}${x.c.v?' - '+x.c.v:''}`:GAME_ID==='onepiece'?`${x.q}x${x.c.v}`:`${x.q} ${x.c.n}`).join('\n');
}
$('sheetBody').addEventListener('click', async e=>{
  const b = e.target.closest('[data-dm]'); if(!b) return;
  const d = getDeck(); if(!d) return;
  const a = b.dataset.dm;
  if (a==='copy'){ toast(await copyText(deckText(d)) ? 'Decklist copied' : 'Couldn’t copy. Use Download instead.'); }
  else if (a==='txt'){ download(`${d.name.replace(/[^\w\- ]+/g,'').trim()||'deck'}.txt`, deckText(d), 'text/plain'); }
  else if (a==='newcards'){previewCollectionImport(d);}
  else if (a==='source'){openSheet('Imported source retained locally',`<p class="note">This source and unresolved lines are included in your device backup. The existing cloud schema stores the recognized deck contents only.</p><pre>${esc((d.importLines||[]).map(l=>l.raw).join('\n'))}</pre><p>Unresolved:</p><pre>${esc((d.unresolved||[]).join('\n'))}</pre>`);}
  else if (a==='buy'){ openTcg(Object.entries(d.cards).map(([nv,q])=>({q:Math.max(0,q-ownedNV(nv)), c:repOf(nv)})), '. You own every card in this deck'); }
  else if (a==='wish'){
    let n=0; for (const [nv,q] of Object.entries(d.cards)){ const m=Math.max(0,q-ownedNV(nv)); if(!m) continue; const c=repOf(nv); const cur=wish[c.id]||0; if (cur<m){ wish[c.id]=m; n+=m-cur; } }
    saveWish(); toast(n?`Added ${n} cards to your wishlist`:'You already own or want every card in this deck');
  }
  else if (a==='dup'){ const c={id:uid(), name:d.name+' (copy)', cards:{...d.cards}, ...(d.commanders?.length?{commanders:[...d.commanders]}:{}), updated:Date.now()}; decks.push(c); saveDecks(); curDeck=c.id; closeSheet(); renderDecks(); toast('Deck duplicated'); }
  else if (a==='del'){ $('delRow').innerHTML = `<span>Delete "${esc(d.name)}"? This can’t be undone.</span><button class="btn danger" data-dm="delyes">Delete</button><button class="btn ghost" data-dm="delno">Keep</button>`; }
  else if (a==='delyes'){ decks = decks.filter(x=>x!==d); saveDecks(); curDeck=null; closeSheet(); renderDecks(); toast('Deck deleted'); }
  else if (a==='delno'){ $('delRow').innerHTML = `<button class="btn danger" data-dm="del">Delete deck</button>`; }
});

/* sample hand */
$('deckHandBtn').onclick = ()=>{
  const d=getDeck(); if(!d) return;
  const pool=[]; for (const [nv,q] of Object.entries(d.cards)) for (let i=0;i<q;i++) pool.push(nv);
  if (pool.length<7){ toast('Add at least 7 cards first'); return; }
  const drawHand = () => { const p=pool.slice(); for (let i=p.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [p[i],p[j]]=[p[j],p[i]]; } return p.slice(0,7).map(nv=>repOf(nv)); };
  const show = () => {
    const hand = drawHand(); const ink = hand.filter(c=>c.ik).length;
    $('sheetBody').innerHTML = `<div class="hand">${hand.map(c=>tileHTML(c,{badge:'',cap:`${c.co} · ${c.ik?'inkable':'no ink'}`})).join('')}</div>
      <p class="note">${ink} of 7 inkable · ${hand.filter(c=>c.co<=2).length} cost 2 or less</p>
      <button class="btn primary" id="redraw">Draw another hand</button>`;
    $('redraw').onclick = show;
  };
  openSheet('Sample hand', ''); show();
};

/* Deck import does not change ownership. Source lines survive unresolved matches. */
function parseDeckImport(text){
  const cards={}, lines=[], unresolved=[], commanders=[];
  if(!LORCANA){
    let inCommander=false;
    for(const raw of text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)){
      // Headings such as "Commander", "### Commander (1)" or "// Commander" open a section; any other heading closes it.
      const heading=raw.replace(/^(?:\/\/|#+)\s*/,'').replace(/\s*\(\d+\)\s*$/,'');
      if(/^(\/\/|#|deck\b|sideboard\b|commanders?\b|main\b|leader\b)/i.test(raw)){ inCommander=/^commanders?$/i.test(heading); continue; }
      const parsed=G.deckLine(raw);
      if(!parsed){unresolved.push(raw);continue;}
      let nv=null;
      if(parsed.key&&byNV.has(parsed.key)) nv=parsed.key;
      else if(parsed.name&&byNV.has(norm(parsed.name)+'|')) nv=norm(parsed.name)+'|';
      const line={raw,qty:parsed.qty,nv};lines.push(line);
      if(nv) cards[nv]=(cards[nv]||0)+line.qty; else unresolved.push(raw);
      if(nv && inCommander && G.deck?.commander && !commanders.includes(nv)) commanders.push(nv);
    }
    return {cards,lines,unresolved,commanders};
  }
  for(const raw of text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)){
    if(/^(\/\/|#|deck\b|sideboard\b)/i.test(raw)) continue;
    const m=raw.match(/^(\d+)\s*x?\s+(.+?)\s*$/i);
    if(!m || !Number.isSafeInteger(+m[1]) || +m[1]<=0){unresolved.push(raw);continue;}
    const parts=m[2].split(/\s+[-\u2013\u2014]\s+/), name=parts[0], version=parts.slice(1).join(' - ');
    let nv=norm(name)+'|'+norm(version);
    if(!byNV.has(nv)){
      const matches=[...byNV.keys()].filter(k=>k.startsWith(norm(name)+'|') && (!version||k.endsWith('|'+norm(version))));
      nv=matches.length===1?matches[0]:null;
    }
    const line={raw,qty:+m[1],nv};lines.push(line);
    if(nv) cards[nv]=(cards[nv]||0)+line.qty; else unresolved.push(raw);
  }
  return {cards,lines,unresolved};
}
$('importDeckBtn').onclick=()=>{
  openSheet('Import a decklist',`<label for="impName">Deck name</label><input type="text" id="impName" placeholder="My new deck"><label for="impText">One card per line, such as ${LORCANA?'4 Elsa - Snow Queen':GAME_ID==='onepiece'?'4xOP01-016':'1 Sol Ring'}</label><textarea id="impText"></textarea><p class="note">Import saves a deck only. You can separately add these as new physical cards after reviewing printings and finishes. Unrecognized lines are retained for review.</p><button class="btn primary" id="impGo">Import deck only</button><p id="impMsg" role="status"></p>${G.live?`<label for="impFile">Or import a deck file (many decks at once)</label><input type="file" id="impFile" accept=".json,application/json">`:''}`);
  let imported=false;
  if(G.live) $('impFile').onchange=async e=>{ const f=e.target.files?.[0]; if(!f) return; try{ previewDeckFile(parseDeckFile(await f.text())); }catch(err){ $('impMsg').textContent=err.message; } e.target.value=''; };
  $('impGo').onclick=async()=>{
    if(imported)return;
    if(G.live){
      const names=$('impText').value.split(/\r?\n/).map(line=>G.deckLine(line.trim())?.name).filter(Boolean);
      if(names.length){ $('impMsg').textContent='Looking up cards on Scryfall…'; $('impGo').disabled=true; await liveNames(names); $('impGo').disabled=false; $('impMsg').textContent=''; }
      if(imported)return;
    }
    const parsed=parseDeckImport($('impText').value);
    if(!parsed.lines.length&&!parsed.unresolved.length){$('impMsg').textContent='Paste a decklist first.';return;}
    const d={id:uid(),name:$('impName').value.trim()||`Imported deck ${decks.length+1}`,cards:parsed.cards,...(parsed.commanders?.length?{commanders:parsed.commanders.slice(0,2)}:{}),importLines:parsed.lines,unresolved:parsed.unresolved,updated:Date.now()};
    imported=true; decks.push(d);saveDecks();curDeck=d.id;dsub='list';showTab('decks');
    openSheet('Deck imported',`<p>Deck saved. Your collection quantities have not changed.</p><p>${parsed.unresolved.length} unresolved line(s) retained locally for review.</p><button class="btn primary" id="importToCollection">Add these as new cards to collection</button><button class="btn" id="importDone">Done</button>`);
    $('importToCollection').onclick=()=>previewCollectionImport(d);
    $('importDone').onclick=()=>closeSheet();
  };
};
/* Deck files: {kind:'inkscan-decks', game, decks:[{name, commanders:[scryfallId], cards:[[qty, scryfallId, name]]}]}.
   Cards are matched by exact Scryfall ID, so double-faced cards and reprints never depend on name matching. */
const SF_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function parseDeckFile(text){
  let j; try{ j=JSON.parse(text); }catch(e){ throw Error('That file is not an InkScan deck file.'); }
  if(!j||j.kind!=='inkscan-decks'||j.version!==1||!Array.isArray(j.decks)) throw Error('That file is not an InkScan deck file.');
  if(j.game!==GAME_ID) throw Error(`That deck file is for ${GAMES?.get(j.game)?.name||"another game"}. Switch games first.`);
  if(j.decks.length>1000) throw Error('A deck file can hold at most 1,000 decks.');
  return j.decks.map((d,i)=>{
    if(!d||typeof d.name!=='string'||!d.name.trim()||d.name.length>200||!Array.isArray(d.cards)||d.cards.length>500) throw Error(`Deck ${i+1} in the file is invalid. Nothing was imported.`);
    const cards=d.cards.map(c=>{ if(!Array.isArray(c)||!Number.isSafeInteger(c[0])||c[0]<1||c[0]>250||!SF_ID.test(c[1])||(c[3]!=null&&!FINISHES.includes(c[3]))) throw Error(`A card in "${d.name}" is invalid. Nothing was imported.`); return {qty:c[0],id:c[1],name:typeof c[2]==='string'?c[2].slice(0,200):c[1],finish:c[3]||'normal'}; });
    const commanders=(Array.isArray(d.commanders)?d.commanders:[]).filter(id=>SF_ID.test(id)).slice(0,2);
    // owned: these are physical cards in hand, at these exact printings and finishes.
    const bracket=Number.isInteger(d.bracket)&&d.bracket>=1&&d.bracket<=5?d.bracket:null;
    const guide=d.guide&&typeof d.guide==='object'&&!Array.isArray(d.guide)&&JSON.stringify(d.guide).length<=6000?JSON.parse(JSON.stringify(d.guide)):null;
    return {name:d.name.trim(),cards,commanders,owned:d.owned===true,bracket,guide};
  });
}
const ownedReceipt=d=>'deckfile-owned:'+d.name;
const needsCard=id=>{ const c=byId.get('sf_'+id); return !c||!c.lg||c.gc===undefined; };
function previewDeckFile(list){
  const byName=new Map(decks.map(d=>[d.name,d])), fresh=list.filter(d=>!byName.has(d.name)), same=list.filter(d=>byName.has(d.name));
  const owned=list.filter(d=>d.owned && !Object.hasOwn(savedState?.imports||{},ownedReceipt(d))), addCopies=owned.reduce((n,d)=>n+d.cards.reduce((m,c)=>m+c.qty,0),0);
  const sheet=()=>{
    const replace=!!$('deckFileReplace')?.checked, use=replace?list:fresh;
    const ids=new Set([...use,...owned].flatMap(d=>d.cards.map(c=>c.id))), need=[...ids].filter(needsCard);
    return {replace,use,need,ids};
  };
  const ownedNote=owned.length?`<p><b>Adds ${addCopies} physical cards to your collection</b> from ${owned.map(d=>esc(d.name)).join(', ')}, at their exact printings and finishes. This happens once per deck; importing the same file again does not add them twice.</p>`:'';
  openSheet('Import deck file',`<p><b>${fresh.length} new deck(s)</b>${same.length?`, ${same.length} already here by name`:''}.${list.some(d=>d.guide)?` ${list.filter(d=>d.guide).length} include an overview and strategy.`:''}</p>${same.length?`<label class="note"><input type="checkbox" id="deckFileReplace"> Update the ${same.length} deck(s) already here with this file's version (keeps each deck, replaces its cards, commander, bracket and strategy)</label>`:''}${ownedNote}<p class="note" id="deckFileNeed"></p><button class="btn primary" id="deckFileGo">Import</button><button class="btn" id="deckFileCancel">Cancel</button><p id="deckFileMsg" role="status"></p>`);
  const refresh=()=>{ const {replace,use,need,ids}=sheet(), work=use.length+owned.length;
    $('deckFileNeed').textContent=`${ids.size.toLocaleString()} different cards. ${need.length?`${need.length.toLocaleString()} will be looked up on Scryfall first (needs signal, about ${Math.ceil(need.length/75)} lookups, roughly ${Math.max(1,Math.ceil(need.length/75*0.8/60))} minute${need.length>5700?'s':''}).`:'Every card is already on this phone.'}${owned.length?'':' Decks only: your collection does not change.'}`;
    const nNew=fresh.length, nUpd=replace?same.length:0;
    $('deckFileGo').textContent=[nNew?`Add ${nNew} deck${nNew===1?'':'s'}`:'',nUpd?`update ${nUpd}`:'',owned.length?'add cards':''].filter(Boolean).join(', ').replace(/^./,ch=>ch.toUpperCase())||'Nothing to import';
    $('deckFileGo').disabled=!work; };
  refresh(); if($('deckFileReplace')) $('deckFileReplace').onchange=refresh;
  $('deckFileCancel').onclick=()=>closeSheet();
  $('deckFileGo').onclick=()=>{ const {replace,need}=sheet(); importDeckFile(replace?list:fresh, need, owned); };
}
async function importDeckFile(list, need, owned=[]){
  owned=owned.filter(d=>!Object.hasOwn(savedState?.imports||{},ownedReceipt(d)));
  const go=$('deckFileGo'), msg=$('deckFileMsg'); go.disabled=true;
  if(need.length){
    if(!navigator.onLine){ msg.textContent='Offline. Connect and try again; nothing was imported.'; go.disabled=false; return; }
    const got=[];
    try{
      for(let i=0;i<need.length;i+=75){
        msg.textContent=`Looking up cards ${Math.min(i+75,need.length).toLocaleString()} of ${need.length.toLocaleString()}…`;
        const j=await scryfall('/cards/collection',{method:'POST',body:JSON.stringify({identifiers:need.slice(i,i+75).map(id=>({id}))})});
        got.push(...(j?.data||[]).map(G.fromScryfall));
      }
    }catch(e){ msg.textContent='Couldn’t reach Scryfall. Nothing was imported; try again with a better signal.'; go.disabled=false; return; }
    addLiveCards(got);
  }
  const now=Date.now(); let unresolved=0, updatedDecks=0;
  list.forEach((d,i)=>{
    const cards={}, lines=[], miss=[];
    for(const c of d.cards){ const card=byId.get('sf_'+c.id), nv=card?.nv||null; lines.push({raw:`${c.qty} ${c.name}`,qty:c.qty,nv}); if(nv) cards[nv]=(cards[nv]||0)+c.qty; else miss.push(`${c.qty} ${c.name}`); }
    unresolved+=miss.length;
    const commanders=d.commanders.map(id=>byId.get('sf_'+id)?.nv).filter(nv=>nv&&cards[nv]);
    const fields={name:d.name,cards,...(commanders.length?{commanders}:{}),...(d.bracket?{bracket:d.bracket}:{}),...(d.guide?{guide:d.guide}:{}),...(miss.length?{importLines:lines.filter(l=>!l.nv),unresolved:miss}:{}),updated:now-i};
    const existing=decks.find(x=>x.name===d.name&&!x.deleted);
    if(existing){ for(const k of ['commanders','bracket','guide','importLines','unresolved']) delete existing[k]; Object.assign(existing,fields); updatedDecks++; }
    else decks.push({id:uid(),...fields});
  });
  let added=0;
  if(owned.length){
    // Physical cards: exact printing and finish, guarded by a one-time receipt per deck, saved together with the decks.
    let nextInv=inv, receipts=savedState.imports||{};
    try{
      for(const d of owned){
        const items=d.cards.filter(c=>byId.has('sf_'+c.id)).map(c=>({cardId:'sf_'+c.id,finish:c.finish,qty:c.qty}));
        if(items.length!==d.cards.length) throw Error(`Some cards in "${d.name}" could not be found on Scryfall. Nothing was added to your collection.`);
        const r=InkSafety.collectionAddition(nextInv,items,ownedReceipt(d),receipts); nextInv=r.inv; receipts=r.receipts; added+=items.reduce((n,x)=>n+x.qty,0);
      }
      const next={...snapshotState(),inv:nextInv,imports:receipts,recovery:recoveryPoints('Before deck-file collection add'),revision:localRevision+1};
      InkSafety.save(STORE,next,knownStoredRaw); knownStoredRaw=STORE.getItem(InkSafety.KEY);
      inv=next.inv; savedState.imports=next.imports; savedState.recovery=next.recovery; localRevision=next.revision; storageError=null;
    }catch(e){ added=0; saveDecks(); $('deckFileMsg').textContent=e.message; persistLiveCards(); renderAll(); return; }
  } else saveDecks();
  persistLiveCards(); curDeck=null; closeSheet(); showTab('decks'); renderAll(); renderSaveStatus();
  toast([list.length-updatedDecks?`Imported ${list.length-updatedDecks} deck${list.length-updatedDecks===1?'':'s'}`:'',updatedDecks?`updated ${updatedDecks}`:'',added?`added ${added} cards to your collection`:'',unresolved?`${unresolved} card line(s) could not be matched and were kept for review`:''].filter(Boolean).join('; '));
}
function previewCollectionImport(deck){
  // The purchase list follows the deck as it exists now, not its original import.
  // Keep unresolved original lines visible, without guessing identities or quantities.
  const lines=Object.entries(deck.cards).filter(([,qty])=>qty>0).map(([nv,qty])=>{const c=repOf(nv);return {nv,qty,raw:c?`${qty} ${c.n}${c.v?' - '+c.v:''}`:nv};});
  for(const line of deck.importLines||[]) if(!line.nv) lines.push({...line});
  const receiptId=uid();
  const row=(line,i)=>{
    const candidates=line.nv?(byNV.get(line.nv)||[]):[];
    return `<div class="own"><p>${line.qty} new copies: ${esc(line.raw)}</p><label>Printing <select id="purchasePrint${i}"><option value="">Choose printing</option>${candidates.map(c=>`<option value="${esc(c.id)}">${esc(c.sn)} #${esc(c.c)} - ${esc(c.n)} ${esc(c.v)}</option>`).join('')}<option value="__skip">Keep unresolved; do not add this line</option></select></label><label>Finish <select id="purchaseFinish${i}"><option value="">Choose finish</option><option value="normal">Normal</option><option value="foil">Foil</option><option value="rainbow">Rainbow foil</option></select></label></div>`;
  };
  openSheet('Add new physical cards',`<p>Every listed copy will be added on top of what you own. No deductions or top-ups happen automatically.</p>${lines.map(row).join('')}<p class="note">${(deck.unresolved||[]).length} unresolved source line(s) are retained with this deck on this device. Unparsed lines cannot be added until corrected.</p><button class="btn primary" id="previewPurchase">Preview quantities</button><button class="btn" id="cancelPurchase">Cancel</button><p id="purchaseError" role="alert"></p>`);
  $('cancelPurchase').onclick=()=>closeSheet();
  $('previewPurchase').onclick=()=>{
    try{
      const items=[];
      for(let i=0;i<lines.length;i++){
        const cardId=$(`purchasePrint${i}`).value, finish=$(`purchaseFinish${i}`).value;
        if(cardId==='__skip')continue;
        const card=byId.get(cardId);
        if(!card || !FINISHES.includes(finish))throw Error('Choose a printing and finish, or explicitly keep each line unresolved.');
        // A missing price is not evidence that a physical finish is unavailable.
        items.push({cardId,finish,qty:lines[i].qty});
      }
      if(!items.length)throw Error('No cards selected to add. Cancel to keep the imported deck only.');
      const plan=InkSafety.collectionAddition(inv,items,receiptId,savedState.imports||{}), revision=localRevision, expectedRaw=knownStoredRaw;
      openSheet('Confirm collection additions',`<p>This adds ${items.reduce((n,x)=>n+x.qty,0)} new physical cards.</p>${plan.changes.map(c=>`<p>${esc(byId.get(c.cardId)?.n||c.cardId)} (${esc(finishLabel(c.finish))}): ${c.before} + ${c.qty} = <b>${c.after}</b></p>`).join('')}<p class="note">Confirm only once for this purchase. You can intentionally import the same list again for another purchase.</p><button class="btn primary" id="confirmPurchase">Confirm: add new cards</button><button class="btn" id="cancelPurchase">Cancel</button><p id="purchaseError" role="alert"></p>`);
      let applied=false;
      $('cancelPurchase').onclick=()=>closeSheet();
      $('confirmPurchase').onclick=()=>{
        if(applied)return;
        if(localRevision!==revision || knownStoredRaw!==expectedRaw){$('purchaseError').textContent='Collection changed during review. Cancel and preview the latest quantities.';return;}
        const checked=InkSafety.collectionAddition(inv,items,receiptId,savedState.imports||{});
        const next={...snapshotState(),inv:checked.inv,imports:checked.receipts,recovery:recoveryPoints('Before confirmed new-card purchase'),revision:localRevision+1};
        try{InkSafety.save(STORE,next,knownStoredRaw);knownStoredRaw=STORE.getItem(InkSafety.KEY);}catch(e){storageError='Addition could not be confirmed. Keep this tab open and back up before retrying. '+e.message;renderSaveStatus();$('purchaseError').textContent=storageError;return;}
        applied=true;inv=next.inv;savedState.imports=next.imports;savedState.recovery=next.recovery;localRevision=next.revision;storageError=null;renderAll();renderSaveStatus();closeSheet();toast('New cards saved on this device. Tap Update to send them to the cloud.');
      };
    }catch(e){$('purchaseError').textContent=e.message;}
  };
}

/* =========================================================
   CLOUD SYNC (Supabase). The phone keeps its own copy; the cloud is a second home.
   Each item is compared with the last value both sides agreed on ("base"):
   if the phone changed it, the phone's value is pushed; otherwise the cloud's value is taken.
   ========================================================= */
const SB_URL = 'https://fzavmefambwdhnzmbvxv.supabase.co';
const SB_KEY = 'sb_publishable_biFosNnFXZK8xSUiJOk0xw_wLrKGrD6';
const EPOCH = '1970-01-01T00:00:00Z';
let session = lsGet('inkscan.session', null);
let base = savedState?.base || null;
const syncState = {busy:false, last:savedState?.last||null, err:null, receipt:null};

function sbHeaders(tok){ const h={apikey:SB_KEY,'Content-Type':'application/json'}; if(tok) h.Authorization='Bearer '+tok; return h; }
async function authCall(path, body){
  ensureCloudOrigin();
  const r = await fetch(`${SB_URL}/auth/v1/${path}`, {method:'POST', headers:sbHeaders(), body:JSON.stringify(body)});
  const j = await r.json().catch(()=>({}));
  if (!r.ok){ const e = new Error(j.msg || j.error_description || j.message || `Sign-in failed (${r.status})`); e.status=r.status; throw e; }
  return j;
}
function keepSession(j){
  session = {access:j.access_token, refresh:j.refresh_token, exp:Date.now()+(j.expires_in||3600)*1000, uid:j.user?.id||session?.uid, email:j.user?.email||session?.email};
  if(!lsSet('inkscan.session', session)) throw Error('Signed in, but the session could not be saved on this device. Keep a backup before continuing.');
}
async function token(){
  if (!session) return null;
  if (Date.now() > session.exp - 60000){
    try{ keepSession(await authCall('token?grant_type=refresh_token', {refresh_token:session.refresh})); }
    catch(e){ if (e.status===400 || e.status===401){ session=null; lsSet('inkscan.session', null); } throw e; }
  }
  return session.access;
}
async function rest(method, path, body, extra){
  const t = await token(); if (!t){ const e=new Error('Not signed in'); e.status=401; throw e; }
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {method, headers:{...sbHeaders(t), ...(extra||{})}, body: body ? JSON.stringify(body) : undefined});
  if (!r.ok){ const j = await r.json().catch(()=>({})); const e = new Error(j.message || `Sync error ${r.status}`); e.status=r.status;e.code=j.code; throw e; }
  return r.status===204 ? null : r.json();
}
// Full owner-scoped reads avoid timestamp-only pagination and detect missing rows.
const TABLES={inv:'collection',wish:'wishlist',decks:'decks'};
// Every cloud row carries its game. This build reads and writes Lorcana rows only, so rows for other games can never enter this collection.
const GAME=GAME_ID;
let cloudRainbow=false;
async function probeRainbowCloud(){
  // Called only from explicit Update, never at startup or sign-in.
  try{await rest('GET',`collection?user_id=eq.${encodeURIComponent(session.uid)}&select=rainbow_foil&limit=0`);return true;}
  catch(e){if(e.code==='42703' && /rainbow_foil/i.test(e.message))return false;throw e;}
}
function hasRainbow(values){return Object.values(values||{}).some(v=>(v?.rf||0)>0);}
function ensureCloudOrigin(){
  if(location.origin!=='https://raestin.github.io' || !location.pathname.startsWith('/inkscan/'))
    throw Error('Cloud access is disabled in this isolated development preview.');
}
async function pullAll(section){
  const table=TABLES[section], key=section==='decks'?'id':'card_id', out=[];
  for(let offset=0;;offset+=1000){
    const page=await rest('GET',`${table}?user_id=eq.${encodeURIComponent(session.uid)}&game=eq.${GAME}&select=*&order=${key}.asc&limit=1000&offset=${offset}`);
    out.push(...page); if(page.length<1000) return out;
  }
}
function remoteMaps(rows){
  const inventory=Object.fromEntries(rows.inv.map(r=>{
    if(cloudRainbow && (!Number.isSafeInteger(r.rainbow_foil)||r.rainbow_foil<0))throw Error('Cloud rainbow quantities are missing or invalid. No collection changes were applied.');
    const value={q:r.q,f:r.f};if(r.rainbow_foil)value.rf=r.rainbow_foil;
    return [r.card_id,value];
  }));
  const state={inv:inventory,wish:Object.fromEntries(rows.wish.map(r=>[r.card_id,r.qty])),decks:rows.decks.filter(r=>!r.deleted).map(r=>({...r,bracket:Number.isInteger(r.meta?.bracket)?r.meta.bracket:undefined,guide:r.meta?.guide&&typeof r.meta.guide==='object'&&!Array.isArray(r.meta.guide)?r.meta.guide:undefined,favorite:r.meta?.fav===true?true:undefined}))};
  InkSafety.validate(state);return InkSafety.maps(state);
}
function reviewUpdate(plan){
  return new Promise(resolve=>{
    let settled=false;
    const finish=value=>{if(settled)return;settled=true;observer.disconnect();closeObserver.disconnect();closeSheet();resolve(value);};
    openSheet('Review cloud update',`<p>${plan.writes.length} cloud item(s) to send; ${plan.pulls.length} local item(s) to receive. Quantities include normal, foil and rainbow foil separately.</p><p class="note">A concurrent edit stops the update. A failed update may have confirmed some items; your local data and remaining changes are kept for retry.</p><button class="btn primary" id="applyUpdate">Apply update</button><button class="btn" id="cancelUpdate">Cancel</button>`);
    const observer=new MutationObserver(()=>{if(!$('applyUpdate'))finish(false);});
    observer.observe($('sheetBody'),{childList:true,subtree:true});
    $('applyUpdate').onclick=()=>finish(true); $('cancelUpdate').onclick=()=>finish(false);
    // Closing by backdrop / Escape also cancels, never confirms.
    const sheet=$('sheet');
    const closeObserver=new MutationObserver(()=>{if(sheet.hidden)finish(false);});
    closeObserver.observe(sheet,{attributes:true,attributeFilter:['hidden']});
  });
}
function replaceLocalMaps(values){
  inv=values.inv; wish=values.wish;
  decks=Object.entries(values.decks).map(([id,d])=>{const o={...decks.find(old=>old.id===id),id,name:d.name,cards:d.cards,commanders:d.commanders||[],updated:Date.now()};if(d.bracket)o.bracket=d.bracket;else delete o.bracket;if(d.guide)o.guide=d.guide;else delete o.guide;if(d.favorite)o.favorite=true;else delete o.favorite;return o;});
}
/* Per-deck extras ride in one jsonb "meta" column, so new deck settings never need a database change.
   Keys this build doesn't know (written by a newer build) are carried through untouched. */
function deckMeta(value,previous){
  const meta={...(previous?.meta&&typeof previous.meta==='object'&&!Array.isArray(previous.meta)?previous.meta:{})};
  if(value?.bracket) meta.bracket=value.bracket; else delete meta.bracket;
  if(value?.guide) meta.guide=value.guide; else delete meta.guide;
  if(value?.favorite) meta.fav=true; else delete meta.fav;
  return meta;
}
async function guardedWrite(operation,previous){
  const {section,id,value}=operation, table=TABLES[section], key=section==='decks'?'id':'card_id';
  if(section==='inv' && !cloudRainbow && (value?.rf||previous?.rainbow_foil))throw Error('Cloud rainbow support is unavailable. Nothing was downgraded to generic foil.');
  const row=section==='inv'?{user_id:session.uid,game:GAME,card_id:id,q:value?.q||0,f:value?.f||0,...(cloudRainbow?{rainbow_foil:value?.rf||0}:{})}
    :section==='wish'?{user_id:session.uid,game:GAME,card_id:id,qty:value||0}
    :{user_id:session.uid,game:GAME,id,name:value?.name||'Deleted deck',cards:value?.cards||{},deleted:!value,...(G.deck?.commander?{commanders:value?.commanders||[]}:{}),meta:deckMeta(value,previous)};
  let path=table, method='POST';
  if(previous){
    method='PATCH'; const eq=(k,v)=>`${k}=eq.${encodeURIComponent(typeof v==='object'?JSON.stringify(v):String(v))}`;
    const columns=section==='inv'?['q','f',...(cloudRainbow?['rainbow_foil']:[])]:section==='wish'?['qty']:['name','cards','deleted','meta',...(G.deck?.commander?['commanders']:[])];
    path+=`?${eq('user_id',session.uid)}&${eq('game',GAME)}&${eq(key,id)}&${eq('updated_at',previous.updated_at)}&`+columns.map(k=>previous[k]===null||previous[k]===undefined?`${k}=is.null`:eq(k,previous[k])).join('&');
  }
  const result=await rest(method,path,row,{Prefer:'return=representation'});
  if(!Array.isArray(result)||result.length!==1) throw Error('A cloud item changed during this update. Stopped without overwriting that item. Review and retry.');
  return result[0];
}
async function sync(manual){
  if(!manual||syncState.busy) return;
  if(!session){toast('Sign in first.');return;}
  syncState.busy=true;syncState.err=null;syncState.receipt=null;renderSyncBox();
  let acknowledged=0;
  try{
    ensureCloudOrigin();
    if(!navigator.onLine) throw Error('Offline. Local changes are kept. Reconnect and tap Update to retry.');
    if(!persistState()) throw Error('Local saving must succeed before a cloud update. Download a backup first.');
    if(base?.uid && base.uid!==session.uid) throw Error('This device has a different account baseline. Nothing was merged. Back up and review the account before updating.');
    const captured=InkSafety.maps({inv,wish,decks}), revision=localRevision;
    cloudRainbow=await probeRainbowCloud();
    if(!cloudRainbow && (hasRainbow(captured.inv)||hasRainbow(base?.inv)))throw Error('The cloud database does not support rainbow foil yet. No cloud items were written. Your distinct rainbow quantities stay on this device; back up before updating the app or database.');
    const rows={inv:await pullAll('inv'),wish:await pullAll('wish'),decks:await pullAll('decks')};
    const remote=remoteMaps(rows), agreed=base||{inv:{},wish:{},decks:{}};
    const plan=InkSafety.plan(captured,remote,agreed);
    if(plan.conflicts.length){
      syncState.conflicts=plan.conflicts;
      download(`inkscan-conflicts-${today()}.json`,JSON.stringify({app:'inkscan-conflict-review',saved:new Date().toISOString(),conflicts:plan.conflicts}),'application/json');
      throw Error(`${plan.conflicts.length} item(s) changed both here and in the cloud. Update stopped before any writes. Local and cloud values were preserved; a conflict review file was downloaded. Resolve against a backup before retrying.`);
    }
    if(!(await reviewUpdate(plan))){syncState.receipt='Update cancelled. No cloud items were written.';return;}
    if(localRevision!==revision) throw Error('Local data changed during review. Nothing was uploaded. Tap Update to review the latest changes.');
    savedState.recovery=recoveryPoints('Before confirmed cloud update');
    if(!persistState())throw Error('Recovery snapshot could not be saved. No cloud items were written. Back up before retrying.');
    if(!base) base={uid:session.uid,inv:{},wish:{},decks:{}};
    const finalCloud=InkSafety.clone(remote);
    for(const operation of plan.writes){
      if(storageError) throw Error('Local save failed. Remaining cloud writes stopped. Back up and retry.');
      const key=operation.section==='decks'?'id':'card_id';
      await guardedWrite(operation,rows[operation.section].find(r=>r[key]===operation.id));
      acknowledged++;
      if(operation.value===null){delete base[operation.section][operation.id];delete finalCloud[operation.section][operation.id];}
      else {base[operation.section][operation.id]=InkSafety.clone(operation.value);finalCloud[operation.section][operation.id]=InkSafety.clone(operation.value);}
      if(!persistState()) throw Error('Cloud accepted an item, but its local receipt could not be saved. Remaining writes stopped. Keep this tab open, back up and retry.');
    }
    const current=InkSafety.maps({inv,wish,decks});
    replaceLocalMaps(InkSafety.applyPulls(current,captured,plan.pulls));
    base={uid:session.uid,...finalCloud};
    const confirmed=Date.now(), previousLast=syncState.last; syncState.last=confirmed;
    if(!persistState()){syncState.last=previousLast;throw Error('Update completed on the server but local receipt saving failed. Keep this tab open and back up.');}
    syncState.receipt=`Update confirmed: ${acknowledged} item(s) sent, ${plan.pulls.length} item(s) received. New edits remain pending.`;
    renderAll();toast('Update confirmed.');
  }catch(e){
    syncState.err=`${e.message||'Update failed.'}${acknowledged?` ${acknowledged} item(s) already accepted; remaining changes are kept for retry.`:''}`;
    toast(syncState.err);
  }finally{syncState.busy=false;renderSyncBox();renderSaveStatus();}
}

function syncBoxHTML(){
  const agreed=session?.uid && base?.uid===session.uid?base:{inv:{},wish:{},decks:{}};
  const counts=InkSafety.pending(InkSafety.maps({inv,wish,decks}),agreed);
  const when=syncState.last?new Date(syncState.last).toLocaleString():'not yet';
  const common=`<p class="note">Manual cloud updates only. Pending on this device: ${counts.inv} collection printing(s), ${counts.decks} deck(s), ${counts.wish} wishlist item(s). Last confirmed update: ${esc(when)}.</p>
    ${syncState.err?`<p class="note" role="alert" style="color:var(--warn)">${esc(syncState.err)}</p>`:''}
    ${syncState.receipt?`<p class="note">${esc(syncState.receipt)}</p>`:''}`;
  if(!session) return `<h3 class="h2">Cloud update</h3>${common}<p class="note">Sign in, then tap Update to review cloud changes. Signing in does not sync your collection.</p>
    <input type="email" id="sbEmail" placeholder="Email" autocomplete="email" value="${esc(lsGet('inkscan.email','')||'')}">
    <input type="password" id="sbPass" placeholder="Password (6+ characters)" autocomplete="current-password">
    <div class="row"><button class="btn primary" data-sync="in">Sign in</button><button class="btn" data-sync="up">Create account</button></div><p class="note" id="sbMsg"></p>`;
  return `<h3 class="h2">Cloud update</h3>${common}<p class="note">${syncState.busy?'Checking / updating...':'Your collection stays local until you confirm an Update.'}</p>
    <div class="row"><button class="btn primary" data-sync="now" ${syncState.busy?'disabled':''}>Update</button><button class="btn ghost" data-sync="out" ${syncState.busy?'disabled':''}>Sign out</button></div>`;
}
function renderSyncBox(){ const el=$('syncBox'); if (el) el.innerHTML = syncBoxHTML(); }
$('sheetBody').addEventListener('click', async e=>{
  const b = e.target.closest('[data-sync]'); if(!b) return;
  const a = b.dataset.sync;
  if (a==='in' || a==='up'){
    const email = $('sbEmail').value.trim(), pass = $('sbPass').value; lsSet('inkscan.email', email);
    if (!email || pass.length<6){ $('sbMsg').textContent='Enter your email and a password of at least 6 characters.'; return; }
    b.disabled = true; $('sbMsg').textContent = a==='in' ? 'Signing in…' : 'Creating your account…';
    try{
      if (a==='in'){ keepSession(await authCall('token?grant_type=password', {email, password:pass})); }
      else {
        const j = await authCall(`signup?redirect_to=${encodeURIComponent(location.origin+location.pathname)}`, {email, password:pass});
        if (!j.access_token){ $('sbMsg').textContent = 'Account created. Open the confirmation email on this phone, tap the link, then come back here and tap Sign in.'; b.disabled=false; return; }
        keepSession(j);
      }
      renderSyncBox(); toast('Signed in. Tap Update when you are ready.');
    }catch(err){
      $('sbMsg').textContent = /confirm/i.test(err.message) ? 'Confirm your email first: tap the link in the message Supabase sent you, then Sign in.'
        : /invalid login/i.test(err.message) ? 'That email and password don’t match.' : err.message;
      b.disabled = false;
    }
  } else if (a==='now'){ sync(true); }
  else if (a==='out'){ session=null; lsSet('inkscan.session', null); renderSyncBox(); toast('Signed out. Everything stays on this phone.'); }
});
$('manualUpdate').onclick=()=>{ openSheet('Cloud update', `<div id="syncBox">${syncBoxHTML()}</div>`); };
function backupPayload(){
  const keys=[InkSafety.KEY,...InkSafety.LEGACY_KEYS];
  const raw=()=>Object.fromEntries(keys.map(k=>[k,STORE.getItem(k)]));
  return savedState?{app:InkSafety.BACKUP_APP,game:GAME_ID,...snapshotState(),saved:new Date().toISOString(),...(storageError?{recoveryRaw:raw()}: {})}:{app:'inkscan-raw-recovery',raw:raw()};
}
function downloadBackup(){
  try{download(`inkscan-${LORCANA?'':GAME_ID+'-'}${storageError?'recovery':'backup'}-${today()}.json`,JSON.stringify(backupPayload()),'application/json');}
  catch(e){toast('Backup could not read saved data. Keep this tab open for recovery.');}
}
$('safetyBackup').onclick=downloadBackup;

/* =========================================================
   TOOLS: export, backup, restore, prices, clear
   ========================================================= */
$('toolsBtn').onclick = ()=>{
  openSheet('Tools', `<div class="own" id="syncBox">${syncBoxHTML()}</div>
    <div class="toolbtns">
      <button class="btn primary" data-tool="csv">Export collection CSV</button>
      <button class="btn" data-tool="backup">Back up everything</button>
      <button class="btn" data-tool="restore">Restore a file</button>
      <button class="btn" data-tool="prices">Update prices</button>
    </div>
    <p class="note">${DB&&G.live?`${DB.cards.length.toLocaleString()} cards saved on this phone; everything else is looked up on Scryfall.`:''}${DB&&!G.live?`${DB.cards.length.toLocaleString()} cards through ${esc(DB.sets[DB.sets.length-1].name)}. TCGplayer prices from ${new Date(DB.asof+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}.`:''}</p>
    <p class="note">"Back up everything" saves your collection, decks and wishlist in one file; Restore takes that file or a collection CSV.</p>
    <div class="row" id="wipeRow"><button class="btn danger tiny" data-tool="wipe">Clear collection</button></div>`);
};
$('sheetBody').addEventListener('click', e=>{
  const b = e.target.closest('[data-tool]'); if(!b) return;
  const a = b.dataset.tool;
  if (a==='csv'){ if(!Object.keys(inv).length){ toast('Nothing to export yet'); return; } download(`${GAME_ID}-collection-${today()}.csv`, '﻿'+buildCsv(), 'text/csv'); toast('CSV downloaded'); }
  else if (a==='backup'){ downloadBackup(); }
  else if (a==='restore'){ $('fileIn').click(); }
  else if (a==='prices'){ if(LORCANA) refreshFromLorcast(true, b); else if(G.live) refreshLivePrices(b); else loadBundledCards(G.catalog,true).then(d=>{indexCards(d);renderAll();toast('Prices and cards updated');}).catch(()=>toast('Couldn’t load the card list. Check your connection.')); }
  else if (a==='wipe'){ $('wipeRow').innerHTML = `<span class="note">Remove every card from your collection? Decks and wishlist stay.</span><button class="btn danger tiny" data-tool="wipeyes">Remove all</button><button class="btn ghost tiny" data-tool="wipeno">Keep</button>`; }
  else if (a==='wipeyes'){ inv={}; log=[]; saveInv(); renderAll(); closeSheet(); toast('Collection cleared'); }
  else if (a==='wipeno'){ $('wipeRow').innerHTML = `<button class="btn danger tiny" data-tool="wipe">Clear collection</button>`; }
});
const LEGACY_HEAD = ['Name','Version','Set Code','Set Name','Card Number','Rarity','Ink','Finish','Quantity','Market Price','Total Value','TCGplayer Product ID','TCGplayer URL','Lorcast ID'];
const OLD_V6_HEAD=LEGACY_HEAD.map(name=>'InkScan v6 '+name);
const HEAD=[...LEGACY_HEAD.map(name=>name==='Lorcast ID'?'Printing ID':name),'Provider','Printing note','Provenance URL'].map(name=>'InkScan v6 '+name);
function csvCell(v){ v = v==null?'':String(v); return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; }
function buildCsv(){
  const rows=[HEAD];
  const sorted=Object.entries(inv).map(([id,v])=>({id,c:byId.get(id),v})).sort((a,b)=>a.c&&b.c?bySetOrder(a.c,b.c):a.id.localeCompare(b.id));
  for(const {id,c,v} of sorted)for(const finish of FINISHES){
    const n=v[finishField(finish)]||0;if(!n)continue;const price=priceOf(c,finish);
    rows.push([c?.n||'Unknown printing',c?.v||'',c?.s||'',c?.sn||'',c?.c||'',rarityLabel(c?.r),c?.i||'',finish==='rainbow'?'Rainbow Foil':finishLabel(finish),n,price==null?'':price.toFixed(2),price==null?'':(price*n).toFixed(2),c?.t||'',c?.t?`https://www.tcgplayer.com/product/${c.t}`:'',id,printingProvider(c),printingNote(c),printingSource(c)]);
  }
  return rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
}
function parseCsv(text){
  const rows=[]; let row=[], cell='', q=false;
  for (let i=0;i<text.length;i++){
    const ch=text[i];
    if (q){ if(ch==='"'){ if(text[i+1]==='"'){cell+='"';i++;} else q=false; } else cell+=ch; }
    else if (ch==='"') q=true; else if (ch===','){ row.push(cell); cell=''; }
    else if (ch==='\n'){ row.push(cell); rows.push(row); row=[]; cell=''; } else if (ch!=='\r') cell+=ch;
  }
  if (cell||row.length){ row.push(cell); rows.push(row); }
  return rows;
}
function previewRestore(restored, label){
  if(!savedState)throw Error('Current saved data needs recovery. Back up the raw saved state before restoring. Nothing was replaced.');
  const revision=localRevision, expectedRaw=knownStoredRaw;
  const copies=Object.values(restored.inv).reduce((n,v)=>n+inventoryCount(v),0);
  const unknown=Object.keys(restored.inv).filter(id=>!byId.has(id)).length;
  const rainbow=Object.values(restored.inv).reduce((n,v)=>n+(v.rf||0),0);
  const restoreNote=restored.restoreKind==='legacy'?`Existing rainbow foil quantities are preserved (${restored.preservedRainbowCopies||0} copies).`:`This complete v6 restore replaces all finish quantities, including rainbow foil; ${rainbow} rainbow foil copies will remain.`;
  openSheet('Review device restore',`<p>${esc(label)} will replace this device's collection, decks and wishlist with <b>${copies} physical cards</b> (${Object.keys(restored.inv).length} printings), <b>${restored.decks.length} decks</b> and <b>${Object.keys(restored.wish).length} wishlist items</b>.</p><p>${unknown} unknown printing ID(s) will be retained. ${restoreNote} Your current data will be kept in a local recovery snapshot. This does not update the cloud; this device's cloud baseline stays unchanged.</p><button class="btn primary" id="confirmRestore">Replace device data</button><button class="btn" id="cancelRestore">Cancel</button><p id="restoreError" role="alert"></p>`);
  let applied=false;
  $('cancelRestore').onclick=()=>closeSheet();
  $('confirmRestore').onclick=()=>{
    if(applied)return;
    if(localRevision!==revision || knownStoredRaw!==expectedRaw){$('restoreError').textContent='Device data changed during review. Cancel and choose the file again to review the latest state.';return;}
    const {restoreKind,preservedRainbowCopies,...payload}=InkSafety.clone(restored);
    const next={...snapshotState(),...payload,recovery:recoveryPoints('Before confirmed device restore'),revision:localRevision+1};
    try{InkSafety.save(STORE,next,expectedRaw);knownStoredRaw=STORE.getItem(InkSafety.KEY);}
    catch(e){storageError='Restore could not be confirmed. Keep this tab open and back up before retrying. '+e.message;renderSaveStatus();$('restoreError').textContent=storageError;return;}
    applied=true;inv=next.inv;decks=next.decks;wish=next.wish;savedState.imports=next.imports;savedState.recovery=next.recovery;localRevision=next.revision;storageError=null;curDeck=null;log=[];
    closeSheet();renderAll();renderSaveStatus();toast(`Restored ${copies} cards and ${decks.length} decks on this device. Cloud unchanged.`);
  };
}
$('fileIn').onchange = async e=>{
  const f=e.target.files[0]; e.target.value=''; if(!f) return;
  const text = (await f.text()).replace(/^﻿/,'');
  if (/^\s*\{/.test(text)){
    try{
      const backup=JSON.parse(text);
      if((backup.game||'lorcana')!==GAME_ID){ toast(`That backup is for ${GAMES?GAMES.get(backup.game||'lorcana').name:'another game'}. Switch to that game first. Nothing was replaced.`); return; }
      const restored=InkSafety.restoreSnapshot(backup,inv);
      previewRestore(restored, backup.app==='inkscan'?'This legacy backup (existing rainbow foil quantities are preserved)':'This complete v6 backup');
    }catch(err){ toast(err.message||'That file isn’t a complete InkScan backup. Nothing was replaced.'); }
    return;
  }
  const rows=parseCsv(text),h=rows.shift()||[];
  const modern=h.includes('InkScan v6 Quantity');
  const neutral=modern&&h.includes('InkScan v6 Printing ID');
  const ix=name=>h.indexOf((modern?'InkScan v6 ':'')+name);
  const iId=ix(neutral?'Printing ID':'Lorcast ID'),iSet=ix('Set Code'),iNum=ix('Card Number'),iFin=ix('Finish'),iQty=ix('Quantity');
  if(iQty<0 || iFin<0 || (iId<0&&(iSet<0||iNum<0)) || (modern && (!(neutral?HEAD:OLD_V6_HEAD).every(name=>h.includes(name)) || new Set(h).size!==h.length))){toast('That file isn’t a complete InkScan export. Nothing was replaced.');return;}
  let n=0,miss=0;const next={};
  for(const r of rows){
    if(r.every(cell=>!cell.trim()))continue;
    const sourceId=iId>=0?(r[iId]||'').trim():'';
    const lookup=sourceId?null:exactPrinting(r[iSet],r[iNum]);
    const c=sourceId?byId.get(sourceId):lookup.status==='exact'?lookup.card:null;
    const id=c?.id||(modern?sourceId:'');
    const qty=/^\d+$/.test(r[iQty]||'')?Number(r[iQty]):NaN;
    const label=(r[iFin]||'').trim().toLowerCase();
    const finish=label==='rainbow foil'&&modern?'rainbow':label;
    if(!id || ['__proto__','prototype','constructor'].includes(id) || !Number.isSafeInteger(qty)||qty<=0||!FINISHES.includes(finish)||(!modern&&finish==='rainbow')){miss++;continue;}
    const v=next[id]||(next[id]={q:0,f:0}),field=finishField(finish);v[field]=(v[field]||0)+qty;n+=qty;
  }
  if(miss||!n){toast(`CSV restore stopped: ${miss?`${miss} unrecognized or invalid row(s)`:'no valid card rows'}. Nothing was replaced.`);return;}
  try{
    let restored=InkSafety.validate({inv:next,decks:InkSafety.clone(decks),wish:InkSafety.clone(wish)});
    if(!modern){restored.inv=InkSafety.preserveRainbow(restored.inv,inv);restored.restoreKind='legacy';restored.preservedRainbowCopies=Object.values(inv).reduce((n,v)=>n+(v.rf||0),0);}
    else restored.restoreKind='v6';
    previewRestore(restored, modern?'This complete v6 collection CSV (decks and wishlist are kept)':'This legacy collection CSV (rainbow foil, decks and wishlist are kept)');
  }catch(err){toast('CSV restore stopped. '+err.message);}

};

/* =========================================================
   Boot
   ========================================================= */
function applyGameLabels(){
  const sel=$('gameSel');
  if(sel && GAMES){
    sel.innerHTML=GAMES.ORDER.map(id=>`<option value="${id}"${id===GAME_ID?' selected':''}>${esc(GAMES.get(id).name)}</option>`).join('');
    sel.onchange=()=>{ if(!persistState()){ sel.value=GAME_ID; toast('Save this game first: download a backup, then switch.'); return; } lsSet(GAMES.GAME_KEY, sel.value); location.reload(); };
  }
  if(LORCANA) return;
  document.body.dataset.game=GAME_ID;
  const setText=(id,prop,val)=>{ const el=$(id); if(el) el[prop]=val; };
  setText('bq','placeholder',G.searchPlaceholder); setText('q','placeholder',G.scanPlaceholder);
  const hint=$('camstart')?.querySelector('.note'); if(hint) hint.textContent=G.scanHint;
  if(G.guide==='bottom-right') $('guide')?.firstElementChild?.classList?.add('right');
  for(const id of ['cFinish','bFinish','scanFinish']){ const el=$(id); if(!el?.options) continue;
    for(const o of [...el.options]){ const k=o.value; if(!['normal','foil','rainbow'].includes(k)) continue; if(!G.finishes[k]) o.remove(); else o.textContent=id==='scanFinish'?G.finishes[k]:`${G.finishes[k]} only`; } }
  for(const id of ['cLegality','bLegality','scanPrintingScope']){ const el=$(id); const label=el?.closest?.('label'); if(label) label.hidden=true; }
  const fill=(id,first,values,label)=>{ const el=$(id); if(el) el.innerHTML=`<option value="">${first}</option>`+values.map(v=>`<option value="${esc(v)}">${esc(label?label(v):v)}</option>`).join(''); };
  fill('bType','All types',G.types); fill('bRar','Any rarity',G.rarities,G.rarityLabel);
  const caveat=$('deckLegalityCaveat'); if(caveat) caveat.textContent=G.id==='onepiece'?'Size, Leader, color and copy badges are structural checks only. Check the current ban list and event rules separately.':'Checks size, singleton, the commander, color identity and the Commander ban list (from Scryfall). Tap ★ on a legendary creature to make it the commander. Game Changers and bracket rules are not checked.';
  const promoNotes=document.querySelectorAll('#vScan > p.note'); promoNotes.forEach(n=>{ if(/Promos and special printings|Choose the physical finish/.test(n.textContent)) n.hidden=true; });
}
async function boot(){
  if(!savedState){ $('loadBanner').textContent=storageError; $('loadBanner').classList.add('bad'); renderSaveStatus(); return; }
  inv=InkSafety.clone(savedState.inv); decks=InkSafety.clone(savedState.decks); wish=InkSafety.clone(savedState.wish);
  renderSaveStatus();
  renderLog();
  let d;
  try{ [d] = await Promise.all([loadCards(),loadFinishQuotes(),loadPromoCatalog(),loadCoreRules()]); }
  catch(e){ $('loadBanner').textContent='The card list didn’t load. Check your connection and reload.'; $('loadBanner').classList.add('bad'); return; }
  indexCards(d); $('loadBanner').hidden = true;
  applyGameLabels();
  // Legacy catalog/localStorage keys remain intact for recovery.
  // Unknown printing IDs are retained, including while a catalog is stale or incomplete.
  renderSaveStatus();
  fillSetSelect(); inkChips($('collInks'), collInks, renderColl); inkChips($('bInks'), bInks, renderBrowse);
  renderTotals();
  $('startBtn').disabled = !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  if ($('startBtn').disabled) $('camstart').querySelector('.note').textContent = 'This browser can’t open the camera. Use Chrome, or add cards with search.';
  navigator.storage?.persist?.().catch(()=>{});
  showTab(lsGet('inkscan.tab','scan'));
  const age = (Date.now() - new Date(DB.asof+'T00:00:00').getTime())/86400000;
  if (LORCANA && age > 3 && navigator.onLine) refreshFromLorcast(false);
  getWorker().catch(()=>{});
  // Cloud reads and writes require an explicit Update confirmation.
}
boot();
if ('serviceWorker' in navigator && location.protocol==='https:') navigator.serviceWorker.register('sw.js').catch(()=>{});
window.__inkscan = {parseLine:t=>parseLine(t),resolveNumberLine:(text,scope)=>resolveNumberLine(text,scope),reviewNumberLine:text=>reviewNumberLine(text), get log(){return log}, get decks(){return decks}, get inv(){return inv}};
})();
