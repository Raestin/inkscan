(function(root){
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const sorted = value => Object.fromEntries(Object.keys(value || {}).sort().map(k=>[k,value[k]]));
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const invValue = v => v && (v.q || v.f) ? {q:v.q||0,f:v.f||0} : null;
  const deckValue = d => d && !d.deleted ? {name:d.name,cards:sorted(d.cards)} : null;
  function maps(state){
    return {
      inv:Object.fromEntries(Object.entries(state.inv||{}).map(([id,v])=>[id,invValue(v)]).filter(([,v])=>v)),
      wish:Object.fromEntries(Object.entries(state.wish||{}).filter(([,v])=>v>0)),
      decks:Object.fromEntries((state.decks||[]).map(d=>[d.id,deckValue(d)]).filter(([,v])=>v))
    };
  }
  function baseline(legacy){
    if(!legacy) return {inv:{},wish:{},decks:{}};
    const result={inv:{},wish:{},decks:{}};
    for(const [id,v] of Object.entries(legacy.inv||{})){
      if(typeof v==='string'){ const [q,f]=v.split('|').map(Number); if(q||f) result.inv[id]={q:q||0,f:f||0}; }
      else if(invValue(v)) result.inv[id]=invValue(v);
    }
    for(const [id,v] of Object.entries(legacy.wish||{})) if(Number(v)>0) result.wish[id]=Number(v);
    for(const [id,v] of Object.entries(legacy.decks||{})){
      if(!v) continue;
      if(typeof v==='string'){ const d=JSON.parse(v); result.decks[id]={name:d.n,cards:sorted(d.c)}; }
      else result.decks[id]=deckValue(v);
    }
    return result;
  }
  function plan(local, remote, agreed){
    const merged=clone(local), writes=[], conflicts=[], pulls=[];
    for(const section of ['inv','wish','decks']){
      merged[section]=merged[section]||{};
      for(const id of new Set([...Object.keys(local[section]||{}),...Object.keys(remote[section]||{}),...Object.keys(agreed[section]||{})])){
        const l=local[section]?.[id]??null, r=remote[section]?.[id]??null, b=agreed[section]?.[id]??null;
        if(!same(l,b)&&!same(r,b)&&!same(l,r)) {conflicts.push({section,id,local:l,cloud:r,previous:b});continue;}
        const value=same(l,b)?r:l;
        if(value===null) delete merged[section][id]; else merged[section][id]=clone(value);
        if(!same(value,r)) writes.push({section,id,value:clone(value)});
        if(!same(value,l)) pulls.push({section,id,value:clone(value)});
      }
    }
    return {merged,writes,conflicts,pulls};
  }
  function pending(local, agreed){
    const result={inv:0,wish:0,decks:0,total:0};
    for(const section of ['inv','wish','decks']) for(const id of new Set([...Object.keys(local[section]||{}),...Object.keys(agreed[section]||{})]))
      if(!same(local[section]?.[id]??null,agreed[section]?.[id]??null)){result[section]++;result.total++;}
    return result;
  }
  function validate(state){
    if(!state || typeof state!=='object' || Array.isArray(state)) throw Error('Saved data is not an object.');
    const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
    if(!record(state.inv) || !record(state.wish) || !Array.isArray(state.decks)) throw Error('Saved collection, wishlist or decks are missing or invalid.');
    const qty=n=>Number.isSafeInteger(n)&&n>=0;
    for(const v of Object.values(state.inv)) if(!record(v) || !qty(v.q??0)||!qty(v.f??0)) throw Error('Saved collection has an invalid quantity.');
    for(const v of Object.values(state.wish)) if(!qty(v)) throw Error('Saved wishlist has an invalid quantity.');
    const ids=new Set();
    for(const d of state.decks){if(!d || typeof d.id!=='string' || ids.has(d.id) || typeof d.name!=='string' || !record(d.cards)) throw Error('Saved deck is invalid or duplicated.');ids.add(d.id);for(const v of Object.values(d.cards)) if(!qty(v)) throw Error('Saved deck has an invalid quantity.');}
    return state;
  }
  function restoreSnapshot(backup){
    if(!backup || backup.app!=='inkscan' || !Object.hasOwn(backup,'inv') || !Object.hasOwn(backup,'wish') || !Object.hasOwn(backup,'decks'))
      throw Error('A complete InkScan backup must contain collection, decks and wishlist. Nothing was replaced.');
    const restored=clone(validate({inv:backup.inv,decks:backup.decks,wish:backup.wish}));
    if(Object.hasOwn(backup,'imports')){
      if(!backup.imports || typeof backup.imports!=='object' || Array.isArray(backup.imports))throw Error('Backup import receipts are invalid. Nothing was replaced.');
      restored.imports=clone(backup.imports);
    }
    return restored;
  }
  const KEY='inkscan.state.v5';
  function load(storage){
    const read=(key,fallback)=>{const raw=storage.getItem(key);return raw===null?fallback:JSON.parse(raw);};
    const current=storage.getItem(KEY);
    if(current!==null) return validate(JSON.parse(current));
    const legacyBase=read('inkscan.base',null);
    return validate({v:5,inv:read('inkscan.inv',{}),wish:read('inkscan.wish',{}),decks:read('inkscan.decks',[]),base:legacyBase?{uid:legacyBase.uid,...baseline(legacyBase)}:null,last:read('inkscan.lastSync',null),imports:{},revision:0});
  }
  function save(storage,state,expectedRaw){
    validate(state);
    const encoded=JSON.stringify(state);
    if(arguments.length>=3 && storage.getItem(KEY)!==expectedRaw) throw Error('Another tab saved different data. Back up both tabs before reconciling; this tab did not overwrite it.');
    storage.setItem(KEY,encoded); // One atomic browser-storage replacement; old state survives quota failure.
    if(storage.getItem(KEY)!==encoded) throw Error('Saved data could not be verified.');
  }
  function applyPulls(current,captured,pulls){
    const result=clone(current);
    for(const p of pulls){
      if(!same(current[p.section]?.[p.id]??null,captured[p.section]?.[p.id]??null)) continue;
      if(p.value===null) delete result[p.section][p.id]; else result[p.section][p.id]=clone(p.value);
    }
    return result;
  }
  function collectionAddition(inv,items,receiptId,receipts){
    if(receipts[receiptId]) throw Error('This confirmation was already applied.');
    const next=clone(inv), changes=[];
    for(const item of items){
      if(!item.cardId || !['normal','foil'].includes(item.finish) || !Number.isSafeInteger(item.qty) || item.qty<=0) throw Error('Choose a printing, finish and positive whole quantity for every item.');
      const field=item.finish==='foil'?'f':'q', current=next[item.cardId]||{q:0,f:0}, before=current[field]||0;
      if(!Number.isSafeInteger(before+item.qty)) throw Error('Quantity is too large.');
      next[item.cardId]={...current,[field]:before+item.qty};
      changes.push({...item,before,after:before+item.qty});
    }
    return {inv:next,changes,receipts:{...receipts,[receiptId]:{at:new Date().toISOString(),items:clone(items)}}};
  }
  function price(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;}
  function valuation(rows,finish='all'){
    let value=0,copies=0,unpriced=0;
    for(const r of rows){
      for(const [field,pfield,variant] of [['q','p','normal'],['f','pf','foil']]){
        if(finish!=='all'&&finish!==variant)continue;
        const qty=r[field]||0, unit=price(r.c[pfield]);copies+=qty;
        if(unit===null)unpriced+=qty; else value+=qty*unit;
      }
    }
    return {value,copies,unpriced,partial:unpriced>0};
  }
  const api={clone,same,sorted,maps,baseline,plan,pending,validate,restoreSnapshot,load,save,applyPulls,collectionAddition,price,valuation,KEY};
  if(typeof module!=='undefined'&&module.exports) module.exports=api; else root.InkSafety=api;
})(typeof window!=='undefined'?window:globalThis);
