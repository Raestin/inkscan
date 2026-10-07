/* InkScan v2 — Lorcana scanner, collection, decks. Everything is stored on this device. */
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
const RARITY = ['Common','Uncommon','Rare','Super_rare','Legendary','Epic','Enchanted','Iconic','Promo'];
const rarityLabel = r => (r || '').replace('_', ' ');
const INKS = ['Amber','Amethyst','Emerald','Ruby','Sapphire','Steel'];
const API = 'https://api.lorcast.com/v0';
const IMG = 'https://cards.lorcast.io/card/digital/';

let toastT;
function toast(msg){ const t=$('toast'); t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2600); }
function lsGet(k, d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } }
function lsSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } }
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
let DB=null, byId, bySetNum, byNV, setIdx, setName, setCards, nvReps;
function nvKeyOf(c){ return norm(c.n)+'|'+norm(c.v); }
function indexCards(d){
  DB=d; byId=new Map(); bySetNum=new Map(); byNV=new Map(); setIdx=new Map(); setName=new Map(); setCards=new Map();
  d.sets.forEach((s,i)=>{ setIdx.set(s.code,i); setName.set(s.code,s.name); setCards.set(s.code,[]); });
  for (const c of d.cards){
    c.nv = nvKeyOf(c);
    c.inks = (c.i||'').split('/').filter(Boolean);
    c.num = parseInt(c.c,10) || 0;
    byId.set(c.id,c);
    bySetNum.set(norm(c.s)+'|'+norm(c.c), c);
    (byNV.get(c.nv) || byNV.set(c.nv,[]).get(c.nv)).push(c);
    setCards.get(c.s)?.push(c);
  }
  for (const list of byNV.values()) list.sort(bySetOrder);
  nvReps = [...byNV.keys()].map(k => byNV.get(k));
}
function bySetOrder(a,b){ return (setIdx.get(a.s)-setIdx.get(b.s)) || (a.num-b.num) || a.c.localeCompare(b.c); }
const SPECIAL = new Set(['Enchanted','Promo','Iconic','Epic']);
/* the printing we show for a name+version: one you own, else the first regular printing */
function repOf(nv){
  const list = byNV.get(nv); if(!list) return null;
  let best=null, bestN=0;
  for (const c of list){ const v=inv[c.id]; const n=v?(v.q||0)+(v.f||0):0; if(n>bestN){best=c;bestN=n;} }
  return best || list.find(c=>!SPECIAL.has(c.r)) || list[0];
}
function priceOf(c, foil){ if(!c) return null; return foil ? (c.pf ?? c.p) : (c.p ?? c.pf); }
function cheapest(nv){ let m=null; for (const c of byNV.get(nv)||[]){ const p=c.p ?? c.pf; if(p!=null && (m==null||p<m)) m=p; } return m; }
function foilOnly(c){ return c && c.p == null && c.pf != null; }
function normalOnly(c){ return c && c.pf == null && c.p != null; }
function setLabel(c){ return /^\d+$/.test(c.s) ? 'Set '+c.s : c.s; }
function imgUrl(c, size){ return c.iv===null ? '' : `${IMG}${size}/${c.id}.avif${c.iv?'?'+c.iv:''}`; }
function inkDot(c){
  if (c.inks.length > 1) return `<span class="ink dual" style="--c1:var(--${c.inks[0].toLowerCase()});--c2:var(--${c.inks[1].toLowerCase()})"></span>`;
  return `<span class="ink ${esc(c.inks[0]||'')}"></span>`;
}
function isType(c, t){ return c.ty.split('/').includes(t); }

async function loadCards(){
  try{
    if ('caches' in window){
      const hit = await (await caches.open('inkscan-data')).match('cards-live.json');
      if (hit) return await hit.json();
    }
  }catch(e){}
  const r = await fetch('cards.json'); if(!r.ok) throw new Error('cards'); return r.json();
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
    indexCards(d); renderAll();
    if (manual) toast('Prices and cards updated');
  }catch(e){ if (manual) toast('Couldn’t reach Lorcast. Check your connection and try again.'); }
  finally{ if (btn){ btn.textContent = label; btn.disabled = false; } }
}

/* =========================================================
   Saved state: collection, decks, wishlist
   ========================================================= */
let inv = {};     // cardId -> {q, f}
let decks = [];   // [{id, name, cards:{nv:qty}, updated}]
let wish = {};    // cardId -> qty wanted
function saveInv(){ if(!lsSet('inkscan.inv', inv)) toast('Couldn’t save. Your phone may be out of storage.'); renderTotals(); scheduleSync(); }
function saveDecks(){ lsSet('inkscan.decks', decks); scheduleSync(); }
function saveWish(){ lsSet('inkscan.wish', wish); scheduleSync(); }
function ownedOf(id){ const v=inv[id]; return v ? (v.q||0)+(v.f||0) : 0; }
function ownedNV(nv){ let n=0; for (const c of byNV.get(nv)||[]) n+=ownedOf(c.id); return n; }
function addQty(id, foil, n){
  const v = inv[id] || (inv[id] = {q:0,f:0});
  if (foil) v.f = Math.max(0,(v.f||0)+n); else v.q = Math.max(0,(v.q||0)+n);
  if (!v.q && !v.f) delete inv[id];
  if (n>0 && wish[id]){ wish[id]=Math.max(0,wish[id]-n); if(!wish[id]) delete wish[id]; saveWish(); }
  saveInv();
}
function totals(){
  let u=0, copies=0, val=0;
  for (const [id,v] of Object.entries(inv)){ const c=byId.get(id); if(!c) continue; const n=(v.q||0)+(v.f||0); if(!n) continue; u++; copies+=n; val += (v.q||0)*(priceOf(c,false)||0) + (v.f||0)*(priceOf(c,true)||0); }
  return {u,copies,val};
}
function renderTotals(){ const t=totals(); $('tUnique').textContent=t.u.toLocaleString(); $('tCopies').textContent=t.copies.toLocaleString(); $('tValue').textContent=money0(t.val); }

/* =========================================================
   Shared rendering
   ========================================================= */
function artHTML(c, size){
  const u = imgUrl(c, size||'small');
  return u ? `<img src="${u}" alt="" loading="lazy" decoding="async" onerror="this.remove()"><span class="ph" aria-hidden="true">${esc(c.n)}</span>` : `<span class="ph">${esc(c.n)}<br>${esc(c.v)}</span>`;
}
/* the img sits above the placeholder text, which only shows if the image fails */
function tileHTML(c, opts={}){
  const q = opts.q ?? ownedOf(c.id), f = inv[c.id]?.f||0;
  const badge = opts.badge != null ? opts.badge : (q ? `<span class="badge${f&&f===q?' foil':''}">${q}</span>` : '');
  return `<button class="tile${opts.dim && !q ? ' missing':''}" data-card="${c.id}" aria-label="${esc(c.n+(c.v?' – '+c.v:''))}"><div class="art">${artHTML(c)}${badge}</div>${opts.cap!==false?`<div class="cap">${esc(opts.cap || (setLabel(c)+' · #'+c.c))}</div>`:''}</button>`;
}
function thumbHTML(c){ return `<span class="thumb">${imgUrl(c,'small')?`<img src="${imgUrl(c,'small')}" alt="" loading="lazy" onerror="this.remove()">`:''}</span>`; }
function metaLine(c, foil){ return `${esc(setLabel(c))} · #${esc(c.c)} · ${esc(rarityLabel(c.r))} · ${money(priceOf(c,foil))}`; }
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
}
function cardDetailHTML(c){
  const v = inv[c.id] || {q:0,f:0}; const w = wish[c.id]||0;
  const stats = [];
  if (c.co!=null) stats.push(`<span class="stat">Cost<b>${c.co}</b></span>`);
  stats.push(`<span class="stat">${c.ik?'Inkable':'Not inkable'}</span>`);
  if (c.st!=null) stats.push(`<span class="stat">Strength<b>${c.st}</b></span>`);
  if (c.wp!=null) stats.push(`<span class="stat">Willpower<b>${c.wp}</b></span>`);
  if (c.lo!=null) stats.push(`<span class="stat">Lore<b>${c.lo}</b></span>`);
  if (c.mv!=null) stats.push(`<span class="stat">Move<b>${c.mv}</b></span>`);
  const others = (byNV.get(c.nv)||[]).filter(x=>x.id!==c.id);
  const inDecks = decks.filter(d=>d.cards[c.nv]).map(d=>`${esc(d.name)} (${d.cards[c.nv]})`);
  const deckOpts = decks.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('');
  return `<div class="detail">
    <div class="big">${imgUrl(c,'normal')?`<img src="${imgUrl(c,'normal')}" alt="${esc(c.n+' – '+c.v)}" onerror="this.onerror=null;this.src='${imgUrl(c,'small')}'">`:''}</div>
    <div class="facts">
      ${c.v?`<div class="ver">${esc(c.v)}</div>`:''}
      <div class="row">${inkDot(c)}<span class="note">${esc(c.i)} · ${esc(c.ty.replace('/',' · '))}${c.cl?' · '+esc(c.cl.replaceAll('/',' · ')):''}</span></div>
      <div class="stats">${stats.join('')}</div>
      ${c.tx?`<div class="rules">${rulesHTML(c.tx)}</div>`:''}
      ${c.fl?`<div class="flavor">${esc(c.fl)}</div>`:''}
      <dl class="kv">
        <dt>Set</dt><dd>${esc(c.sn)} · #${esc(c.c)}</dd>
        <dt>Rarity</dt><dd>${esc(rarityLabel(c.r))}</dd>
        <dt>Price</dt><dd>${c.p!=null?money(c.p)+' normal':''}${c.p!=null&&c.pf!=null?' · ':''}${c.pf!=null?money(c.pf)+' foil':''}${c.p==null&&c.pf==null?'—':''}</dd>
        ${c.il?`<dt>Artist</dt><dd>${esc(c.il)}</dd>`:''}
        <dt>Core format</dt><dd>${c.lc?'Legal':'Not legal (Infinity only)'}</dd>
      </dl>
      <div class="own" id="ownBox">
        <div class="step"><label>Normal</label><button data-own="q" data-d="-1" aria-label="One fewer normal">−</button><output>${v.q||0}</output><button data-own="q" data-d="1" aria-label="One more normal" ${foilOnly(c)?'disabled':''}>+</button></div>
        <div class="step"><label>Foil</label><button data-own="f" data-d="-1" aria-label="One fewer foil">−</button><output>${v.f||0}</output><button data-own="f" data-d="1" aria-label="One more foil" ${normalOnly(c)?'disabled':''}>+</button></div>
        <div class="step"><label>Wishlist</label><button data-want="-1" aria-label="Want one fewer">−</button><output>${w}</output><button data-want="1" aria-label="Want one more">+</button></div>
      </div>
      ${decks.length?`<div class="row"><select id="deckPick" class="slim" aria-label="Deck">${deckOpts}</select><button class="btn" id="deckAddOne">Add to deck</button></div>`:''}
      ${inDecks.length?`<div class="note">In ${inDecks.join(', ')}</div>`:''}
      ${others.length?`<div class="note">Other printings: ${others.map(o=>`<a href="#" class="link" data-card="${o.id}">${esc(setLabel(o))} #${esc(o.c)}${SPECIAL.has(o.r)?' '+esc(rarityLabel(o.r)):''}</a>`).join(' · ')}</div>`:''}
      ${c.t?`<a class="link" href="https://www.tcgplayer.com/product/${c.t}" target="_blank" rel="noopener">View on TCGplayer ↗</a>`:''}
    </div></div>`;
}
$('sheetBody').addEventListener('click', e=>{
  const own = e.target.closest('[data-own]'), want = e.target.closest('[data-want]'), other = e.target.closest('a[data-card]');
  if (other){ e.preventDefault(); const id=other.dataset.card; sheetCard=id; const c=byId.get(id); $('sheetTitle').textContent=c.n; $('sheetBody').innerHTML=cardDetailHTML(c); $('sheetBody').scrollTop=0; return; }
  if (!sheetCard) return;
  const c = byId.get(sheetCard);
  if (own){ addQty(c.id, own.dataset.own==='f', +own.dataset.d); }
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
function renderAll(){ renderTotals(); renderLog(); if(tab==='coll') renderColl(); if(tab==='decks') renderDecks(); if(tab==='browse') renderBrowse(); }
function renderAfterEdit(){ renderTotals(); renderLog(); if(tab==='coll') renderColl(); if(tab==='decks') renderDecks(true); if(tab==='browse') refreshBrowseBadges(); }

/* =========================================================
   SCAN
   ========================================================= */
let log = []; // {key, cardId, foil}
let seq = 0;
function logAdd(card, foil){
  if (foilOnly(card)) foil = true; if (normalOnly(card)) foil = false;
  addQty(card.id, foil, 1);
  log.unshift({key:++seq, cardId:card.id, foil});
  renderLog();
}
function renderLog(){
  const el=$('log');
  $('logCount').textContent = log.length ? `(${log.length})` : '';
  if (!log.length){ el.innerHTML = `<div class="empty"><strong>No scans yet</strong>Each card you scan goes straight into your collection and shows up here, newest first. Tap Undo if it read the wrong card.</div>`; return; }
  el.innerHTML = log.slice(0,60).map(x=>{
    const c = byId.get(x.cardId); if(!c) return '';
    return `<div class="item"><div class="item-main" data-card="${c.id}">${thumbHTML(c)}<div class="who"><div class="n">${esc(c.n)}</div><div class="v">${esc(c.v)}</div><div class="m">${metaLine(c,x.foil)}</div></div>
      <div class="acts"><button data-act="lf" data-k="${x.key}" aria-pressed="${x.foil}" ${foilOnly(c)||normalOnly(c)?'disabled':''}>Foil</button><button data-act="lu" data-k="${x.key}">Undo</button></div></div></div>`;
  }).join('');
}
$('log').addEventListener('click', e=>{
  const b=e.target.closest('button[data-act]'); if(!b) return;
  const x = log.find(x=>x.key==b.dataset.k); if(!x) return;
  if (b.dataset.act==='lu'){ addQty(x.cardId, x.foil, -1); log = log.filter(y=>y!==x); renderLog(); toast('Removed one copy'); }
  else { addQty(x.cardId, x.foil, -1); x.foil = !x.foil; addQty(x.cardId, x.foil, 1); renderLog(); }
});
function quickSearch(q, limit=30){
  q = q.trim(); if(!q || !DB) return [];
  const out = [];
  const m = q.match(/^#?\s*([A-Za-z]*\d*[A-Za-z]*)\s*[\s\/\-#·]\s*#?(\d+)$/);
  if (m){
    const a = bySetNum.get(norm(m[1])+'|'+norm(m[2])); if (a) out.push(a);
    const b = bySetNum.get(norm(m[2])+'|'+norm(m[1])); if (b && b!==a) out.push(b);
  }
  const nq = norm(q); if (nq.length < 2) return out;
  for (const c of DB.cards){ if (out.length>=limit) break; if (!out.includes(c) && (norm(c.n+c.v).includes(nq) || norm(c.n).startsWith(nq))) out.push(c); }
  return out;
}
let qT;
$('q').addEventListener('input', ()=>{ clearTimeout(qT); qT=setTimeout(renderQuick,120); });
function renderQuick(){
  const res = quickSearch($('q').value); const el=$('qres');
  el.hidden = !$('q').value.trim();
  el.innerHTML = res.length ? res.map(c=>`<div class="item"><div class="item-main" data-card="${c.id}">${thumbHTML(c)}<div class="who"><div class="n">${esc(c.n)}</div><div class="v">${esc(c.v)}</div><div class="m">${metaLine(c,foilOnly(c))}</div></div><div class="acts"><button data-act="add" data-id="${c.id}">Add</button></div></div></div>`).join('') : `<div class="empty" style="padding:16px">No cards match. Try part of the name, or a set and number like <b>5 207</b>.</div>`;
}
$('qres').addEventListener('click', e=>{
  const b=e.target.closest('button[data-act="add"]'); if(!b) return;
  const c = byId.get(b.dataset.id); logAdd(c, foilMode); toast(`Added ${c.n}`);
});

/* ---- reading the number line ---- */
const DIGITFIX = s => s.replace(/[oOD]/g,'0').replace(/[lI|!]/g,'1').replace(/[sS]/g,'5').replace(/[zZ]/g,'2').replace(/[B]/g,'8');
function parseLine(text){
  const t = text.replace(/\n/g,' ');
  const re = /([0-9oOlI|sSzZB]{1,3})\s*\/\s*([A-Z0-9]{1,4})\s*[^A-Za-z0-9]{0,4}\s*(EN|FN|EM|ER|FR|DE|IT|JA|ZH|E N)\s*[^A-Za-z0-9]{0,4}\s*([A-Za-z]{0,3}[0-9oOlIsSzZ]{1,2})?/i;
  const m = t.match(re); if (!m) return null;
  const num = String(parseInt(DIGITFIX(m[1]),10));
  const total = m[2].toUpperCase();
  let set = m[4] ? m[4].replace(/^([A-Za-z]*)(.*)$/, (_,a,b)=>a.toUpperCase()+DIGITFIX(b)) : '';
  if (!/^\d+$/.test(DIGITFIX(total))) { if(!set) set = total; }
  const tries = [];
  if (set) tries.push(set);
  if (!/^\d+$/.test(total)) tries.push(total);
  for (const s of tries){ const c = bySetNum.get(norm(s)+'|'+norm(num)); if (c) return c; }
  return null;
}

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
    let card = null;
    try{ const {data} = await worker.recognize(frame); card = parseLine(data.text); }catch(e){}
    if (!scanning) break;
    if (!card){
      streak=0; lastKey=null; blankFrames++;
      if (blankFrames>=2) cooldownKey=null;
      if (Date.now()-lastHitAt > 2500) camMsg('Line the number line up in the gold box');
    } else {
      blankFrames=0;
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
  lastHitAt = Date.now();
  logAdd(card, foilMode);
  const f=$('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  $('guide').classList.add('hit'); setTimeout(()=>$('guide').classList.remove('hit'),500);
  navigator.vibrate?.(60); beep();
  const x = log[0];
  camMsg(`${card.n} · ${card.v ? card.v+' · ' : ''}${money(priceOf(card,x.foil))}${x.foil?' foil':''}`);
}
$('startBtn').onclick = startCam;
$('stopBtn').onclick = stopCam;
$('foilBtn').onclick = ()=>{ foilMode=!foilMode; $('foilBtn').setAttribute('aria-pressed',foilMode); toast(foilMode?'Foil mode on: scans count as foil':'Foil mode off'); };
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

function renderColl(){
  $('collCards').hidden = csub!=='cards'; $('collSets').hidden = csub!=='sets'; $('collWish').hidden = csub!=='wish';
  if (csub==='cards') renderCollCards(); else if (csub==='sets') renderSets(); else renderWish();
}
function collRows(){
  const f = norm($('cf').value); const rows = [];
  for (const [id,v] of Object.entries(inv)){
    const c = byId.get(id); if(!c || !((v.q||0)+(v.f||0))) continue;
    if (!inkMatch(c, collInks)) continue;
    if (f && !norm(c.n+c.v+c.sn+c.i+c.r+c.cl).includes(f) && !(norm(setLabel(c))+norm(c.c)).includes(f)) continue;
    rows.push({c, q:v.q||0, f:v.f||0, val:(v.q||0)*(priceOf(c,false)||0)+(v.f||0)*(priceOf(c,true)||0)});
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
  document.querySelectorAll('[data-lay]').forEach(x=>x.setAttribute('aria-pressed',x.dataset.lay===layout));
  const el = $('coll'); const rows = collRows();
  if (!rows.length){
    el.className=''; el.innerHTML = Object.keys(inv).length ? `<div class="list"><div class="empty"><strong>No matches</strong>Nothing in your collection matches that filter.</div></div>` : `<div class="list"><div class="empty"><strong>Your collection is empty</strong>Scan cards on the Scan tab, or open any card in Browse and add it.</div></div>`;
    return;
  }
  if (layout==='grid'){
    el.className='grid';
    el.innerHTML = rows.map(r=>tileHTML(r.c,{cap: money(r.val)})).join('');
  } else {
    el.className='list';
    el.innerHTML = rows.map(r=>`<div class="item"><div class="item-main" data-card="${r.c.id}">${thumbHTML(r.c)}<div class="who"><div class="n">${esc(r.c.n)}</div><div class="v">${esc(r.c.v)}</div><div class="m">${esc(setLabel(r.c))} · #${esc(r.c.c)} · ${esc(rarityLabel(r.c.r))}</div></div><div class="qtyv"><div class="q">${r.q?`×${r.q}`:''}${r.q&&r.f?' ':''}${r.f?`<span class="chip foil">Foil ×${r.f}</span>`:''}</div><div class="p">${money(r.val)}</div></div></div></div>`).join('');
  }
}
function renderSets(){
  const rows = DB.sets.map(s=>{
    const cs = setCards.get(s.code)||[]; let own=0, val=0, miss=0;
    for (const c of cs){ const n=ownedOf(c.id); if(n){ own++; val+= (inv[c.id].q||0)*(priceOf(c,false)||0)+(inv[c.id].f||0)*(priceOf(c,true)||0); } else miss += (c.p ?? c.pf ?? 0); }
    return {s, total:cs.length, own, val, miss};
  }).filter(r=>r.total);
  const started = rows.filter(r=>r.own), rest = rows.filter(r=>!r.own);
  const row = r => `<div class="item"><button class="item-main" data-set="${esc(r.s.code)}"><div class="who"><div class="n">${esc(r.s.name)}</div><div class="m">${/^\d+$/.test(r.s.code)?'Set '+esc(r.s.code)+' · ':''}${r.own}/${r.total} cards · ${money0(r.val)} owned · ${money0(r.miss)} to finish</div><div class="bar"><i style="width:${(100*r.own/r.total).toFixed(1)}%"></i></div></div><span class="note">${Math.round(100*r.own/r.total)}%</span></button></div>`;
  $('setList').innerHTML = (started.length?`<div class="group">Started<span>${started.length} sets</span></div>`+started.map(row).join(''):'') + (rest.length?`<div class="group">Not started<span>${rest.length} sets</span></div>`+rest.map(row).join(''):'');
}
$('setList').addEventListener('click', e=>{
  const b=e.target.closest('[data-set]'); if(!b) return;
  resetBrowse(); $('bSet').value=b.dataset.set; $('bOwn').value='miss'; $('bSort').value='price'; showTab('browse');
  toast(`Missing cards from ${setName.get(b.dataset.set)}, most expensive first`);
});
function renderWish(){
  const rows = Object.entries(wish).map(([id,q])=>({c:byId.get(id),q})).filter(r=>r.c).sort((a,b)=>bySetOrder(a.c,b.c));
  let total=0, n=0; for (const r of rows){ total += r.q*(priceOf(r.c, foilOnly(r.c))||0); n+=r.q; }
  $('wishSum').innerHTML = rows.length ? `<div><strong>${n}</strong>cards wanted</div><div><strong>${money(total)}</strong>at TCGplayer market</div><button class="btn primary" id="wishBuy" style="margin-left:auto;align-self:center">Buy on TCGplayer</button>` : '';
  if (rows.length) $('wishBuy').onclick = ()=>openTcg(rows.map(r=>({q:r.q, c:r.c})));
  $('wishList').innerHTML = rows.length ? rows.map(r=>`<div class="item"><div class="item-main" data-card="${r.c.id}">${thumbHTML(r.c)}<div class="who"><div class="n">${esc(r.c.n)}</div><div class="v">${esc(r.c.v)}</div><div class="m">${metaLine(r.c,foilOnly(r.c))}${ownedNV(r.c.nv)?` · own ${ownedNV(r.c.nv)}`:''}</div></div>
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
  const lines = items.filter(x=>x.q>0 && x.c).map(x=>`${x.q} ${x.c.n}${x.c.v?' - '+x.c.v:''}`);
  return 'https://www.tcgplayer.com/massentry?productline=' + encodeURIComponent('Lorcana TCG') + '&c=' + lines.map(encodeURIComponent).join('||');
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
  $('bq').value=''; bInks.clear(); ['bSet','bType','bCost','bRar','bOwn'].forEach(id=>$(id).value=''); $('bSort').value='set';
  inkChips($('bInks'), bInks, renderBrowse);
}
$('bReset').onclick = ()=>{ resetBrowse(); renderBrowse(); };
let bT; $('bq').addEventListener('input',()=>{ clearTimeout(bT); bT=setTimeout(renderBrowse,150); });
['bSet','bType','bCost','bRar','bOwn','bSort'].forEach(id=>$(id).onchange=renderBrowse);
function renderBrowse(){
  if (!DB) return;
  const q = norm($('bq').value), set=$('bSet').value, type=$('bType').value, cost=$('bCost').value, rar=$('bRar').value, own=$('bOwn').value;
  let list = DB.cards.filter(c=>{
    if (set && c.s!==set) return false;
    if (!inkMatch(c,bInks)) return false;
    if (type && !isType(c,type)) return false;
    if (cost && (cost==='7' ? (c.co??0)<7 : c.co!=+cost)) return false;
    if (rar && c.r!==rar) return false;
    if (own==='own' && !ownedOf(c.id)) return false;
    if (own==='miss' && ownedOf(c.id)) return false;
    if (q && !norm(c.n+c.v+c.cl+c.tx).includes(q)) return false;
    return true;
  });
  const s=$('bSort').value;
  list.sort(s==='name'?(a,b)=>a.n.localeCompare(b.n)||a.v.localeCompare(b.v)||bySetOrder(a,b)
    :s==='cost'?(a,b)=>(a.co??99)-(b.co??99)||a.n.localeCompare(b.n)
    :s==='price'?(a,b)=>((b.p??b.pf??0)-(a.p??a.pf??0))||bySetOrder(a,b):bySetOrder);
  let missCost = 0; if (own==='miss') for (const c of list) missCost += (c.p ?? c.pf ?? 0);
  $('bCount').textContent = `${list.length.toLocaleString()} cards${own==='miss'&&list.length?` · ${money(missCost)} to buy them all`:''}`;
  chunked($('bGrid'), $('bSentinel'), list, c=>tileHTML(c,{dim:true, cap:`${setLabel(c)} #${c.c} · ${money(c.p ?? c.pf)}`}));
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
function deckStats(d){
  let total=0, inkable=0, missing=0, missCost=0, value=0; const curve=Array(8).fill(0); const types={};
  for (const [nv,q] of Object.entries(d.cards)){
    const c = repOf(nv); if(!c) continue;
    total+=q; if (c.ik) inkable+=q;
    curve[Math.min(7, Math.max(0,c.co||0))]+=q;
    const t = c.ty.split('/')[0]; types[t]=(types[t]||0)+q;
    const m = Math.max(0, q-ownedNV(nv)); missing+=m; missCost += m*(cheapest(nv)||0);
  }
  return {total, inkable, missing, missCost, curve, types, inks: deckInks(d)};
}
/* returns true or a message explaining why it couldn't add */
function deckAdd(d, nv, n){
  const cur = d.cards[nv]||0, next = cur+n;
  if (n>0){
    if (next>4) return 'A deck can have at most 4 copies of a card';
    const c = repOf(nv), inks = new Set(deckInks(d)); c.inks.forEach(i=>inks.add(i));
    if (!d.cards[nv] && inks.size>2) return 'A deck can only use 2 inks';
  }
  if (next<=0) delete d.cards[nv]; else d.cards[nv]=next;
  d.updated = Date.now(); saveDecks(); return true;
}
function inkSetHTML(inks){ return `<span class="inkset">${inks.map(i=>`<span class="ink ${i}" title="${i}"></span>`).join('')}</span>`; }
function renderDecks(keepScroll){
  if (curDeck){ renderDeckEdit(keepScroll); return; }
  $('deckHome').hidden=false; $('deckEdit').hidden=true;
  const sorted = decks.slice().sort((a,b)=>b.updated-a.updated);
  $('deckList').innerHTML = sorted.length ? sorted.map(d=>{
    const st = deckStats(d); const lead = Object.entries(d.cards).sort((a,b)=>(repOf(b[0])?.co||0)-(repOf(a[0])?.co||0))[0];
    const c = lead && repOf(lead[0]);
    return `<div class="item"><button class="item-main" data-deck="${d.id}">${c?thumbHTML(c):'<span class="thumb"></span>'}<div class="who"><div class="n">${esc(d.name)}</div><div class="m">${inkSetHTML(st.inks)} ${st.inks.join(' / ')||'No cards yet'}</div><div class="m">${st.total}/60 cards${st.missing?` · missing ${st.missing} (${money(st.missCost)})`:st.total?' · you own every card':''}</div></div>${st.total>=60&&st.inks.length<=2?'<span class="chip ok">Ready</span>':''}</button></div>`;
  }).join('') : `<div class="empty"><strong>No decks yet</strong>Tap New deck to build one from your collection, or Import to paste a list from Dreamborn, Inktable or a website.</div>`;
}
$('deckList').addEventListener('click', e=>{ const b=e.target.closest('[data-deck]'); if(b){ curDeck=b.dataset.deck; dsub='list'; renderDecks(); window.scrollTo(0,0); } });
$('newDeckBtn').onclick = ()=>{
  const d = {id:uid(), name:`New deck ${decks.length+1}`, cards:{}, updated:Date.now()};
  decks.push(d); saveDecks(); curDeck=d.id; dsub='add'; renderDecks(); $('deckName').select();
};
$('deckBack').onclick = ()=>{ curDeck=null; renderDecks(); window.scrollTo(0,0); };
$('deckName').addEventListener('change', ()=>{ const d=getDeck(); if(!d) return; d.name=$('deckName').value.trim()||'Untitled deck'; d.updated=Date.now(); saveDecks(); });
document.querySelectorAll('[data-dsub]').forEach(b=>b.onclick=()=>{ dsub=b.dataset.dsub; renderDeckEdit(); });
function getDeck(){ return decks.find(d=>d.id===curDeck); }

function renderDeckEdit(keepScroll){
  const d = getDeck(); if(!d){ curDeck=null; renderDecks(); return; }
  $('deckHome').hidden=true; $('deckEdit').hidden=false;
  if (document.activeElement!==$('deckName')) $('deckName').value = d.name;
  document.querySelectorAll('[data-dsub]').forEach(x=>x.setAttribute('aria-pressed',x.dataset.dsub===dsub));
  const st = deckStats(d); const max = Math.max(1,...st.curve);
  const warns = [];
  if (st.total<60) warns.push(`<span class="chip warn">${60-st.total} more cards needed</span>`);
  if (st.inks.length>2) warns.push(`<span class="chip warn">More than 2 inks</span>`);
  if (st.total>=60 && st.inks.length<=2) warns.push(`<span class="chip ok">Legal deck</span>`);
  if (st.missing) warns.push(`<span class="chip warn">Missing ${st.missing} · ${money(st.missCost)}</span>`);
  $('deckStats').innerHTML = `<div class="nums"><div><strong>${st.total}</strong>cards</div><div><strong>${st.inkable}</strong>inkable</div><div><strong>${(st.types.Character||0)}</strong>characters</div><div><strong>${(st.types.Action||0)+(st.types.Item||0)+(st.types.Location||0)}</strong>other</div><div>${inkSetHTML(st.inks)}<br>${st.inks.join(' / ')||'—'}</div></div>
    <div class="curve" aria-label="Cost curve">${st.curve.map((n,i)=>i===0&&!n?'':`<div><span>${n||''}</span><i style="height:${Math.round(44*n/max)}px"></i><span>${i===7?'7+':i}</span></div>`).join('')}</div>
    <div class="warns">${warns.join('')}</div>`;
  $('deckListPane').hidden = dsub!=='list'; $('deckAddPane').hidden = dsub!=='add';
  if (dsub==='list') renderDeckList(d); else renderDeckAdd(d, keepScroll);
}
function deckRowHTML(nv, q, d){
  const c = repOf(nv); const own = ownedNV(nv); const short = Math.max(0,q-own);
  return `<div class="item"><div class="item-main" data-card="${c.id}">${thumbHTML(c)}<div class="who"><div class="n">${esc(c.n)}</div><div class="v">${esc(c.v)}</div><div class="m">${c.co} cost · ${c.ik?'inkable':'not inkable'} · ${short?`<span style="color:var(--warn)">own ${own} of ${q}</span>`:`own ${own}`}</div></div>
    <div class="acts"><button data-act="dq" data-nv="${esc(nv)}" data-d="-1" aria-label="One fewer">−</button><output>${q}</output><button data-act="dq" data-nv="${esc(nv)}" data-d="1" aria-label="One more" ${q>=4?'disabled':''}>+</button></div></div></div>`;
}
function renderDeckList(d){
  const entries = Object.entries(d.cards).map(([nv,q])=>({nv,q,c:repOf(nv)})).filter(x=>x.c);
  if (!entries.length){ $('deckListPane').innerHTML = `<div class="list"><div class="empty"><strong>Empty deck</strong>Switch to Add cards to start building.</div></div>`; return; }
  const groups = [['Characters',x=>isType(x.c,'Character')],['Actions & songs',x=>isType(x.c,'Action')],['Items',x=>isType(x.c,'Item')],['Locations',x=>isType(x.c,'Location')]];
  let html='';
  for (const [label,fn] of groups){
    const g = entries.filter(fn).sort((a,b)=>(a.c.co-b.c.co)||a.c.n.localeCompare(b.c.n)); if(!g.length) continue;
    html += `<div class="group">${label}<span>${g.reduce((a,x)=>a+x.q,0)}</span></div>` + g.map(x=>deckRowHTML(x.nv,x.q,d)).join('');
  }
  $('deckListPane').innerHTML = `<div class="list">${html}</div>`;
}
function onDeckQty(e){
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
  $('dInkNote').textContent = inks.length>=2 ? `Showing ${inks.join(' and ')} cards` : inks.length===1 ? `${inks[0]} plus any second ink` : 'Any ink';
  let list = nvReps.map(ps=>ps.find(c=>!SPECIAL.has(c.r))||ps[0]).filter(c=>{
    if (inks.length>=2 && !c.inks.every(i=>inks.includes(i))) return false;
    if (inks.length===1){ const s=new Set([...inks,...c.inks]); if (s.size>2) return false; }
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
    </div>
    <p class="note">Decklists use the "4 Name - Version" format that Dreamborn, Inktable and most Lorcana sites import.</p>
    <div class="confirm row" id="delRow"><button class="btn danger" data-dm="del">Delete deck</button></div>`);
};
function deckText(d){
  return Object.entries(d.cards).map(([nv,q])=>({q,c:repOf(nv)})).filter(x=>x.c).sort((a,b)=>(a.c.co-b.c.co)||a.c.n.localeCompare(b.c.n))
    .map(x=>`${x.q} ${x.c.n}${x.c.v?' - '+x.c.v:''}`).join('\n');
}
$('sheetBody').addEventListener('click', async e=>{
  const b = e.target.closest('[data-dm]'); if(!b) return;
  const d = getDeck(); if(!d) return;
  const a = b.dataset.dm;
  if (a==='copy'){ toast(await copyText(deckText(d)) ? 'Decklist copied' : 'Couldn’t copy. Use Download instead.'); }
  else if (a==='txt'){ download(`${d.name.replace(/[^\w\- ]+/g,'').trim()||'deck'}.txt`, deckText(d), 'text/plain'); }
  else if (a==='buy'){ openTcg(Object.entries(d.cards).map(([nv,q])=>({q:Math.max(0,q-ownedNV(nv)), c:repOf(nv)})), '. You own every card in this deck'); }
  else if (a==='wish'){
    let n=0; for (const [nv,q] of Object.entries(d.cards)){ const m=Math.max(0,q-ownedNV(nv)); if(!m) continue; const c=repOf(nv); const cur=wish[c.id]||0; if (cur<m){ wish[c.id]=m; n+=m-cur; } }
    saveWish(); toast(n?`Added ${n} cards to your wishlist`:'You already own or want every card in this deck');
  }
  else if (a==='dup'){ const c={id:uid(), name:d.name+' (copy)', cards:{...d.cards}, updated:Date.now()}; decks.push(c); saveDecks(); curDeck=c.id; closeSheet(); renderDecks(); toast('Deck duplicated'); }
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

/* deck import */
$('importDeckBtn').onclick = ()=>{
  openSheet('Import a decklist', `<label for="impName" class="note">Deck name</label><input type="text" id="impName" placeholder="My new deck">
    <label for="impText" class="note">Paste the list, one card per line, like "4 Elsa - Snow Queen"</label>
    <textarea id="impText" placeholder="4 Tipo - Growing Son&#10;3 Sail the Azurite Sea&#10;2x Hades - Infernal Schemer"></textarea>
    <button class="btn primary" id="impGo">Import deck</button><div id="impMsg" class="note"></div>`);
  $('impGo').onclick = ()=>{
    const lines = $('impText').value.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    const cards={}, bad=[];
    for (const line of lines){
      const m = line.match(/^(\d+)\s*x?\s+(.+?)\s*$/i); if(!m){ if(!/^(\/\/|#|deck|sideboard)/i.test(line)) bad.push(line); continue; }
      const q=+m[1]; let name=m[2], ver='';
      const sp = name.split(/\s+[-–—]\s+/); if (sp.length>1){ name=sp[0]; ver=sp.slice(1).join(' - '); }
      let nv = norm(name)+'|'+norm(ver);
      if (!byNV.has(nv)){ const alt=[...byNV.keys()].find(k=>k.startsWith(norm(name)+'|') && (!ver || k.endsWith('|'+norm(ver)))); if (alt) nv=alt; else { bad.push(line); continue; } }
      cards[nv]=Math.min(4,(cards[nv]||0)+q);
    }
    if (!Object.keys(cards).length){ $('impMsg').textContent='No cards recognized. Check the format: a number, a space, then the card name.'; return; }
    const d={id:uid(), name:$('impName').value.trim()||`Imported deck ${decks.length+1}`, cards, updated:Date.now()};
    decks.push(d); saveDecks(); curDeck=d.id; dsub='list'; closeSheet(); showTab('decks');
    toast(`Imported ${deckCount(d)} cards${bad.length?`, ${bad.length} lines not recognized`:''}`);
    if (bad.length) setTimeout(()=>openSheet('Lines not recognized', `<p class="note">These lines didn’t match a card. Add them by hand from Add cards.</p><div class="rules">${bad.map(esc).join('<br>')}</div>`), 300);
  };
};

/* =========================================================
   CLOUD SYNC (Supabase). The phone keeps its own copy; the cloud is a second home.
   Each item is compared with the last value both sides agreed on ("base"):
   if the phone changed it, the phone's value is pushed; otherwise the cloud's value is taken.
   ========================================================= */
const SB_URL = 'https://fzavmefambwdhnzmbvxv.supabase.co';
const SB_KEY = 'sb_publishable_biFosNnFXZK8xSUiJOk0xw_wLrKGrD6';
const EPOCH = '1970-01-01T00:00:00Z';
let session = lsGet('inkscan.session', null);
let base = lsGet('inkscan.base', null);
const syncState = {busy:false, last: lsGet('inkscan.lastSync', null), err:null, again:false};
let syncT = null, applying = false;

function sbHeaders(tok){ const h={apikey:SB_KEY,'Content-Type':'application/json'}; if(tok) h.Authorization='Bearer '+tok; return h; }
async function authCall(path, body){
  const r = await fetch(`${SB_URL}/auth/v1/${path}`, {method:'POST', headers:sbHeaders(), body:JSON.stringify(body)});
  const j = await r.json().catch(()=>({}));
  if (!r.ok){ const e = new Error(j.msg || j.error_description || j.message || `Sign-in failed (${r.status})`); e.status=r.status; throw e; }
  return j;
}
function keepSession(j){
  session = {access:j.access_token, refresh:j.refresh_token, exp:Date.now()+(j.expires_in||3600)*1000, uid:j.user?.id||session?.uid, email:j.user?.email||session?.email};
  lsSet('inkscan.session', session);
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
  if (!r.ok){ const j = await r.json().catch(()=>({})); const e = new Error(j.message || `Sync error ${r.status}`); e.status=r.status; throw e; }
  return r.status===204 || r.status===201 ? null : r.json();
}
const sortObj = o => Object.keys(o).sort().reduce((a,k)=>(a[k]=o[k],a),{});
const invVal = id => { const v=inv[id]; return v && (v.q||v.f) ? `${v.q||0}|${v.f||0}` : ''; };
const wishVal = id => wish[id] ? String(wish[id]) : '';
const deckVal = d => d ? JSON.stringify({n:d.name, c:sortObj(d.cards)}) : '';
function freshBase(){ return {uid:session.uid, cur:{collection:EPOCH, wishlist:EPOCH, decks:EPOCH}, inv:{}, wish:{}, decks:{}}; }
async function pullTable(table){
  const out=[]; let cursor = base.cur[table];
  for (;;){
    const page = await rest('GET', `${table}?select=*&updated_at=gt.${encodeURIComponent(cursor)}&order=updated_at.asc&limit=1000`);
    out.push(...page); if (page.length<1000) break; cursor = page[page.length-1].updated_at;
  }
  return out;
}
async function upsert(table, rows, conflict){
  for (let i=0;i<rows.length;i+=500)
    await rest('POST', `${table}?on_conflict=${conflict}`, rows.slice(i,i+500), {Prefer:'resolution=merge-duplicates,return=minimal'});
}
function scheduleSync(){ if (!session || applying) return; clearTimeout(syncT); syncT = setTimeout(()=>sync(false), 2500); }
async function sync(manual){
  if (!session) return;
  if (syncState.busy){ syncState.again = true; return; }
  if (!navigator.onLine){ syncState.err = 'Offline. Changes are saved on this phone and will sync later.'; renderSyncBox(); return; }
  syncState.busy = true; renderSyncBox();
  let changed = false; const newDecks = []; let wishAdds = 0;
  try{
    const firstEver = !base || base.uid !== session.uid;
    if (firstEver) base = freshBase();
    /* ---- pull ---- */
    const later = (a,b) => (a > b ? a : b);
    for (const r of await pullTable('collection')){
      const id = r.card_id, sv = (r.q||r.f) ? `${r.q}|${r.f}` : '';
      if (invVal(id) === (base.inv[id]||'') && invVal(id) !== sv){ if (sv) inv[id]={q:r.q,f:r.f}; else delete inv[id]; changed = true; }
      if (sv) base.inv[id]=sv; else delete base.inv[id];
      base.cur.collection = later(base.cur.collection, r.updated_at);
    }
    for (const r of await pullTable('wishlist')){
      const id = r.card_id, sv = r.qty ? String(r.qty) : '';
      if (wishVal(id) === (base.wish[id]||'') && wishVal(id) !== sv){ if (sv && r.qty > (wish[id]||0)) wishAdds += r.qty-(wish[id]||0); if (sv) wish[id]=r.qty; else delete wish[id]; changed = true; }
      if (sv) base.wish[id]=sv; else delete base.wish[id];
      base.cur.wishlist = later(base.cur.wishlist, r.updated_at);
    }
    for (const r of await pullTable('decks')){
      const local = decks.find(d=>d.id===r.id);
      const sv = r.deleted ? '' : JSON.stringify({n:r.name, c:sortObj(r.cards||{})});
      if (deckVal(local) === (base.decks[r.id]||'') && deckVal(local) !== sv){
        if (!sv) decks = decks.filter(d=>d.id!==r.id);
        else if (local){ local.name=r.name; local.cards={...r.cards}; local.updated=Date.parse(r.updated_at)||Date.now(); }
        else { decks.push({id:r.id, name:r.name, cards:{...r.cards}, updated:Date.parse(r.updated_at)||Date.now()}); newDecks.push(r.name); }
        changed = true;
      }
      if (sv) base.decks[r.id]=sv; else delete base.decks[r.id];
      base.cur.decks = later(base.cur.decks, r.updated_at);
    }
    /* ---- push whatever the phone changed ---- */
    const invIds = new Set([...Object.keys(inv), ...Object.keys(base.inv)]);
    const invRows = [...invIds].filter(id=>invVal(id)!==(base.inv[id]||'')).map(id=>({user_id:session.uid, card_id:id, q:inv[id]?.q||0, f:inv[id]?.f||0}));
    const wishIds = new Set([...Object.keys(wish), ...Object.keys(base.wish)]);
    const wishRows = [...wishIds].filter(id=>wishVal(id)!==(base.wish[id]||'')).map(id=>({user_id:session.uid, card_id:id, qty:wish[id]||0}));
    const deckIds = new Set([...decks.map(d=>d.id), ...Object.keys(base.decks)]);
    const deckRows = [...deckIds].map(id=>({id, d:decks.find(x=>x.id===id)})).filter(x=>deckVal(x.d)!==(base.decks[x.id]||''))
      .map(x=>({id:x.id, user_id:session.uid, name:x.d?.name||'Deleted deck', cards:x.d?.cards||{}, deleted:!x.d}));
    if (invRows.length) await upsert('collection', invRows, 'user_id,card_id');
    if (wishRows.length) await upsert('wishlist', wishRows, 'user_id,card_id');
    if (deckRows.length) await upsert('decks', deckRows, 'id');
    for (const r of invRows){ const v=invVal(r.card_id); if (v) base.inv[r.card_id]=v; else delete base.inv[r.card_id]; }
    for (const r of wishRows){ const v=wishVal(r.card_id); if (v) base.wish[r.card_id]=v; else delete base.wish[r.card_id]; }
    for (const r of deckRows){ const v=deckVal(decks.find(d=>d.id===r.id)); if (v) base.decks[r.id]=v; else delete base.decks[r.id]; }
    /* ---- save ---- */
    applying = true;
    if (changed){ lsSet('inkscan.inv', inv); lsSet('inkscan.wish', wish); lsSet('inkscan.decks', decks); }
    lsSet('inkscan.base', base);
    syncState.last = Date.now(); lsSet('inkscan.lastSync', syncState.last); syncState.err = null;
    if (changed){ if (curDeck && !decks.find(d=>d.id===curDeck)) curDeck=null; renderAll(); }
    const news = [];
    if (newDecks.length) news.push(newDecks.length===1 ? `New deck: ${newDecks[0]}` : `${newDecks.length} new decks`);
    if (wishAdds) news.push(`${wishAdds} card${wishAdds===1?'':'s'} added to your wishlist`);
    if (news.length && !firstEver) toast(news.join(' · '));
    else if (manual) toast(changed ? 'Synced. Picked up changes from the cloud.' : 'Synced');
  }catch(e){
    syncState.err = e.status===401 ? 'Signed out. Sign in again to keep syncing.'
      : (e instanceof TypeError || e.status>=500) ? 'Can’t reach the cloud right now (offline, or the project is paused). Changes are saved on this phone and will sync later.'
      : (e.message || 'Sync failed');
    if (manual) toast(syncState.err);
  }finally{
    applying = false; syncState.busy = false; renderSyncBox();
    if (syncState.again){ syncState.again=false; scheduleSync(); }
  }
}
function syncBoxHTML(){
  if (!session) return `<h3 class="h2" style="font-size:17px">Cloud sync</h3>
    <p class="note">Sign in to keep your collection, decks and wishlist in your own cloud database, so they survive a lost phone and Claude can read and add to them.</p>
    <input type="email" id="sbEmail" placeholder="Email" autocomplete="email" value="${esc(lsGet('inkscan.email','')||'')}">
    <input type="password" id="sbPass" placeholder="Password (6+ characters)" autocomplete="current-password">
    <div class="row"><button class="btn primary" data-sync="in">Sign in</button><button class="btn" data-sync="up">Create account</button></div>
    <p class="note" id="sbMsg"></p>`;
  const when = syncState.last ? new Date(syncState.last).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'not yet';
  return `<h3 class="h2" style="font-size:17px">Cloud sync</h3>
    <p class="note">Signed in as <b>${esc(session.email||'')}</b>. ${syncState.busy?'Syncing…':`Last synced ${when}.`}</p>
    ${syncState.err?`<p class="note" style="color:var(--warn)">${esc(syncState.err)}</p>`:''}
    <div class="row"><button class="btn primary" data-sync="now" ${syncState.busy?'disabled':''}>Sync now</button><button class="btn ghost" data-sync="out">Sign out</button></div>`;
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
      renderSyncBox(); await sync(true);
    }catch(err){
      $('sbMsg').textContent = /confirm/i.test(err.message) ? 'Confirm your email first: tap the link in the message Supabase sent you, then Sign in.'
        : /invalid login/i.test(err.message) ? 'That email and password don’t match.' : err.message;
      b.disabled = false;
    }
  } else if (a==='now'){ sync(true); }
  else if (a==='out'){ session=null; lsSet('inkscan.session', null); renderSyncBox(); toast('Signed out. Everything stays on this phone.'); }
});
window.addEventListener('online', ()=>scheduleSync());
document.addEventListener('visibilitychange', ()=>{ if (!document.hidden && session) sync(false); });
setInterval(()=>{ if (!document.hidden && session) sync(false); }, 180000);

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
    <p class="note">${DB?`${DB.cards.length.toLocaleString()} cards through ${esc(DB.sets[DB.sets.length-1].name)}. TCGplayer prices from ${new Date(DB.asof+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}.`:''}</p>
    <p class="note">"Back up everything" saves your collection, decks and wishlist in one file; Restore takes that file or a collection CSV.</p>
    <div class="row" id="wipeRow"><button class="btn danger tiny" data-tool="wipe">Clear collection</button></div>`);
};
$('sheetBody').addEventListener('click', e=>{
  const b = e.target.closest('[data-tool]'); if(!b) return;
  const a = b.dataset.tool;
  if (a==='csv'){ if(!Object.keys(inv).length){ toast('Nothing to export yet'); return; } download(`lorcana-collection-${today()}.csv`, '﻿'+buildCsv(), 'text/csv'); toast('CSV downloaded'); }
  else if (a==='backup'){ download(`inkscan-backup-${today()}.json`, JSON.stringify({app:'inkscan', v:2, saved:new Date().toISOString(), inv, decks, wish}), 'application/json'); toast('Backup downloaded'); }
  else if (a==='restore'){ $('fileIn').click(); }
  else if (a==='prices'){ refreshFromLorcast(true, b); }
  else if (a==='wipe'){ $('wipeRow').innerHTML = `<span class="note">Remove every card from your collection? Decks and wishlist stay.</span><button class="btn danger tiny" data-tool="wipeyes">Remove all</button><button class="btn ghost tiny" data-tool="wipeno">Keep</button>`; }
  else if (a==='wipeyes'){ inv={}; log=[]; saveInv(); renderAll(); closeSheet(); toast('Collection cleared'); }
  else if (a==='wipeno'){ $('wipeRow').innerHTML = `<button class="btn danger tiny" data-tool="wipe">Clear collection</button>`; }
});
const HEAD = ['Name','Version','Set Code','Set Name','Card Number','Rarity','Ink','Finish','Quantity','Market Price','Total Value','TCGplayer Product ID','TCGplayer URL','Lorcast ID'];
function csvCell(v){ v = v==null?'':String(v); return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; }
function buildCsv(){
  const rows=[HEAD];
  const sorted = Object.entries(inv).map(([id,v])=>({c:byId.get(id),v})).filter(x=>x.c).sort((a,b)=>bySetOrder(a.c,b.c));
  for (const {c,v} of sorted) for (const [foil,n] of [[false,v.q||0],[true,v.f||0]]){
    if (!n) continue; const p = priceOf(c,foil);
    rows.push([c.n,c.v,c.s,c.sn,c.c,rarityLabel(c.r),c.i,foil?'Foil':'Normal',n,p==null?'':p.toFixed(2),p==null?'':(p*n).toFixed(2),c.t||'',c.t?`https://www.tcgplayer.com/product/${c.t}`:'',c.id]);
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
$('fileIn').onchange = async e=>{
  const f=e.target.files[0]; e.target.value=''; if(!f) return;
  const text = (await f.text()).replace(/^﻿/,'');
  if (/^\s*\{/.test(text)){
    try{
      const b = JSON.parse(text); if (b.app!=='inkscan') throw 0;
      inv = b.inv||{}; decks = b.decks||[]; wish = b.wish||{};
      saveInv(); saveDecks(); saveWish(); curDeck=null; closeSheet(); renderAll();
      toast(`Restored ${totals().copies} cards, ${decks.length} decks`);
    }catch(err){ toast('That file isn’t an InkScan backup.'); }
    return;
  }
  const rows = parseCsv(text); const h = rows.shift()||[]; const ix = n => h.indexOf(n);
  const iId=ix('Lorcast ID'), iSet=ix('Set Code'), iNum=ix('Card Number'), iFin=ix('Finish'), iQty=ix('Quantity');
  if (iQty<0 || (iId<0 && (iSet<0||iNum<0))){ toast('That file isn’t an InkScan export.'); return; }
  let n=0, miss=0; const next={};
  for (const r of rows){
    const c = (iId>=0 && byId.get(r[iId])) || bySetNum.get(norm(r[iSet])+'|'+norm(r[iNum]));
    const qty = parseInt(r[iQty],10); if(!c || !(qty>0)){ if(r.length>1) miss++; continue; }
    const v = next[c.id] || (next[c.id]={q:0,f:0}); if ((r[iFin]||'').toLowerCase()==='foil') v.f+=qty; else v.q+=qty; n+=qty;
  }
  inv = next; saveInv(); closeSheet(); renderAll(); toast(`Restored ${n} cards${miss?`, ${miss} rows skipped`:''}`);
};

/* =========================================================
   Boot
   ========================================================= */
async function boot(){
  inv = lsGet('inkscan.inv', {}) || {}; decks = lsGet('inkscan.decks', []) || []; wish = lsGet('inkscan.wish', {}) || {};
  renderLog();
  let d;
  try{ d = await loadCards(); }
  catch(e){ $('loadBanner').textContent='The card list didn’t load. Check your connection and reload.'; $('loadBanner').classList.add('bad'); return; }
  indexCards(d); $('loadBanner').hidden = true;
  /* v1 kept a slimmer card list in localStorage; drop it now that data lives in the cache */
  try{ localStorage.removeItem('inkscan.cards'); }catch(e){}
  for (const id of Object.keys(inv)) if(!byId.has(id)) delete inv[id];
  fillSetSelect(); inkChips($('collInks'), collInks, renderColl); inkChips($('bInks'), bInks, renderBrowse);
  renderTotals();
  $('startBtn').disabled = !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  if ($('startBtn').disabled) $('camstart').querySelector('.note').textContent = 'This browser can’t open the camera. Use Chrome, or add cards with search.';
  navigator.storage?.persist?.().catch(()=>{});
  showTab(lsGet('inkscan.tab','scan'));
  const age = (Date.now() - new Date(DB.asof+'T00:00:00').getTime())/86400000;
  if (age > 3 && navigator.onLine) refreshFromLorcast(false);
  getWorker().catch(()=>{});
  if (session) sync(false);
}
boot();
if ('serviceWorker' in navigator && location.protocol==='https:') navigator.serviceWorker.register('sw.js').catch(()=>{});
window.__inkscan = {parseLine:t=>parseLine(t), get log(){return log}, get decks(){return decks}, get inv(){return inv}};
})();
