(function(root){
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const sorted = value => Object.fromEntries(Object.keys(value || {}).sort().map(k=>[k,value[k]]));
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const record = v => !!v && typeof v==='object' && !Array.isArray(v);
  const quantity = n => Number.isSafeInteger(n) && n>=0;
  const validInvQuantities = v => quantity(v.q??0) && quantity(v.f??0) && (!Object.hasOwn(v,'rf') || quantity(v.rf));
  const FINISH_FIELDS = Object.freeze({normal:'q',foil:'f',rainbow:'rf'});
  function invValue(v){
    if(!v) return null;
    if(!record(v) || !validInvQuantities(v)) throw Error('Saved collection has an invalid quantity.');
    if(!(v.q||v.f||v.rf)) return null;
    return {q:v.q||0,f:v.f||0,...(v.rf?{rf:v.rf}:{})};
  }
  // Commanders travel with the deck only when set, so decks without one keep their exact earlier shape.
  const commandersOf = d => Array.isArray(d?.commanders) ? d.commanders.filter(k=>typeof k==='string'&&k) : [];
  const bracketOf = d => Number.isInteger(d?.bracket) && d.bracket>=1 && d.bracket<=5 ? d.bracket : null;
  const guideOf = d => d?.guide && typeof d.guide==='object' && !Array.isArray(d.guide) ? d.guide : null;
  const deckValue = d => { if(!d || d.deleted) return null; const cmd=commandersOf(d), br=bracketOf(d), g=guideOf(d); return {name:d.name,cards:sorted(d.cards),...(cmd.length?{commanders:cmd}:{}),...(br?{bracket:br}:{}),...(g?{guide:clone(g)}:{}),...(d.favorite===true?{favorite:true}:{}),...(typeof d.format==='string'&&d.format&&d.format!=='commander'?{format:d.format}:{})}; };
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
      if(typeof v==='string'){ const fields=v.split('|'); if(fields.length!==2)throw Error('Legacy baseline is invalid.'); const [q,f]=fields.map(Number); const value=invValue({q,f}); if(value)result.inv[id]=value; }
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
    if(!record(state.inv) || !record(state.wish) || !Array.isArray(state.decks)) throw Error('Saved collection, wishlist or decks are missing or invalid.');
    const qty=quantity;
    for(const v of Object.values(state.inv)) if(!record(v) || !validInvQuantities(v)) throw Error('Saved collection has an invalid quantity.');
    for(const v of Object.values(state.wish)) if(!qty(v)) throw Error('Saved wishlist has an invalid quantity.');
    const ids=new Set();
    for(const d of state.decks){if(!d || typeof d.id!=='string' || ids.has(d.id) || typeof d.name!=='string' || !record(d.cards)) throw Error('Saved deck is invalid or duplicated.');ids.add(d.id);for(const v of Object.values(d.cards)) if(!qty(v)) throw Error('Saved deck has an invalid quantity.');if(d.bracket!=null && !(Number.isInteger(d.bracket)&&d.bracket>=1&&d.bracket<=5)) throw Error('Saved deck has an invalid bracket.');if(d.format!=null && !(typeof d.format==='string'&&/^[a-z]{2,20}$/.test(d.format))) throw Error('Saved deck has an invalid format.');if(d.favorite!=null && typeof d.favorite!=='boolean') throw Error('Saved deck has an invalid favorite flag.');if(d.guide!=null && (typeof d.guide!=='object'||Array.isArray(d.guide)||JSON.stringify(d.guide).length>6000)) throw Error('Saved deck has an invalid guide.');if(d.commanders!=null && (!Array.isArray(d.commanders) || d.commanders.length>2 || d.commanders.some(k=>typeof k!=='string'||!k||k.length>500))) throw Error('Saved deck has an invalid commander.');}
    return state;
  }
  const KEY='inkscan.state.v6';
  const LEGACY_KEY='inkscan.state.v5';
  const LEGACY_KEYS=Object.freeze([LEGACY_KEY,'inkscan.inv','inkscan.decks','inkscan.wish','inkscan.base','inkscan.lastSync']);
  const BACKUP_APP='inkscan-v6-backup';
  const checkpoints=new WeakMap();
  const isLegacyKey=key=>LEGACY_KEYS.includes(key);
  function captureLegacy(storage){return Object.fromEntries(LEGACY_KEYS.map(key=>[key,storage.getItem(key)]));}
  function validateCheckpoint(checkpoint){
    if(!record(checkpoint) || Object.keys(checkpoint).length!==LEGACY_KEYS.length || !LEGACY_KEYS.every(key=>Object.hasOwn(checkpoint,key)&&(checkpoint[key]===null||typeof checkpoint[key]==='string')))
      throw Error('Saved legacy checkpoint is missing or invalid. Back up before recovery.');
    return checkpoint;
  }
  function checkpointFor(storage,state){
    if(Object.hasOwn(state,'legacyCheckpoint'))return validateCheckpoint(state.legacyCheckpoint);
    if(checkpoints.has(storage))return checkpoints.get(storage);
    const raw=storage.getItem(KEY);
    if(raw!==null){const current=JSON.parse(raw);return validateCheckpoint(current?.legacyCheckpoint);}
    return captureLegacy(storage);
  }
  function checkLegacy(storage,state){
    const checkpoint=checkpointFor(storage,state);
    for(const key of LEGACY_KEYS)if(storage.getItem(key)!==checkpoint[key])
      throw Error('An older InkScan tab changed legacy saved data. This version did not overwrite it. Back up both versions, close older tabs and reconcile before saving or updating.');
    return true;
  }
  function preserveRainbow(restoredInv,currentInv={}){
    validate({inv:restoredInv,wish:{},decks:[]});validate({inv:currentInv,wish:{},decks:[]});
    const result=clone(restoredInv);
    for(const [id,value] of Object.entries(currentInv))if(value.rf){
      const before=Object.hasOwn(result,id)?result[id]:{q:0,f:0};
      Object.defineProperty(result,id,{value:{...before,rf:value.rf},enumerable:true,writable:true,configurable:true});
    }
    return result;
  }
  function restoreSnapshot(backup,currentInv={}){
    const modern=backup?.app===BACKUP_APP, legacy=backup?.app==='inkscan';
    if(!backup || (!modern&&!legacy) || !Object.hasOwn(backup,'inv') || !Object.hasOwn(backup,'wish') || !Object.hasOwn(backup,'decks'))
      throw Error('A complete InkScan backup must contain collection, decks and wishlist. Nothing was replaced.');
    if(modern && backup.v!==6)throw Error('This backup version is not supported. Nothing was replaced.');
    if(legacy && ((backup.v!==undefined && (!Number.isInteger(backup.v)||backup.v>5||backup.v<1)) || Object.values(backup.inv||{}).some(v=>record(v)&&Object.hasOwn(v,'rf'))))
      throw Error('Rainbow data needs a versioned InkScan v6 backup. Nothing was replaced.');
    const restored=clone(validate({inv:backup.inv,decks:backup.decks,wish:backup.wish}));
    if(legacy)restored.inv=preserveRainbow(restored.inv,currentInv);
    restored.restoreKind=modern?'v6':'legacy';
    restored.preservedRainbowCopies=legacy?Object.values(currentInv).reduce((n,v)=>n+(v.rf||0),0):0;
    if(Object.hasOwn(backup,'imports')){
      if(!record(backup.imports))throw Error('Backup import receipts are invalid. Nothing was replaced.');
      restored.imports=clone(backup.imports);
    }
    // A backup's account baseline/checkpoint belongs to its original device, never this one.
    return restored;
  }
  function load(storage){
    const read=(key,fallback)=>{const raw=storage.getItem(key);return raw===null?fallback:JSON.parse(raw);};
    const current=storage.getItem(KEY);
    if(current!==null){
      const state=validate(JSON.parse(current));
      if(state.v!==6)throw Error('Saved state has an unsupported version. Nothing was reset.');
      validateCheckpoint(state.legacyCheckpoint);checkpoints.set(storage,clone(state.legacyCheckpoint));
      return state; // Keep data readable for backup if an old tab later changed the legacy keys.
    }
    const legacyCheckpoint=captureLegacy(storage), v5=legacyCheckpoint[LEGACY_KEY];
    let state;
    if(v5!==null){
      state=clone(validate(JSON.parse(v5)));
      if(state.v!==5)throw Error('Legacy saved state has an unsupported version. Nothing was reset.');
    }else{
      const legacyBase=read('inkscan.base',null);
      state=validate({inv:read('inkscan.inv',{}),wish:read('inkscan.wish',{}),decks:read('inkscan.decks',[]),base:legacyBase?{uid:legacyBase.uid,...baseline(legacyBase)}:null,last:read('inkscan.lastSync',null),imports:{},revision:0});
    }
    state.v=6;state.legacyCheckpoint=legacyCheckpoint;checkpoints.set(storage,clone(legacyCheckpoint));
    return state;
  }
  function save(storage,state,expectedRaw){
    validate(state);
    const legacyCheckpoint=clone(checkpointFor(storage,state));
    checkLegacy(storage,{legacyCheckpoint});
    const next={...state,v:6,legacyCheckpoint}, encoded=JSON.stringify(next);
    if(arguments.length>=3 && storage.getItem(KEY)!==expectedRaw) throw Error('Another tab saved different data. Back up both tabs before reconciling; this tab did not overwrite it.');
    storage.setItem(KEY,encoded); // One atomic browser-storage replacement; legacy bytes are never modified.
    if(storage.getItem(KEY)!==encoded) throw Error('Saved data could not be verified.');
    checkLegacy(storage,{legacyCheckpoint});
    checkpoints.set(storage,clone(legacyCheckpoint));
    return next;
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
    if(typeof receiptId!=='string'||!receiptId||['__proto__','prototype','constructor'].includes(receiptId))throw Error('A valid confirmation ID is required.');
    if(Object.hasOwn(receipts,receiptId)) throw Error('This confirmation was already applied.');
    const next=clone(inv), changes=[];
    for(const item of items){
      if(typeof item.cardId!=='string' || !item.cardId || ['__proto__','prototype','constructor'].includes(item.cardId) || !Object.hasOwn(FINISH_FIELDS,item.finish) || !Number.isSafeInteger(item.qty) || item.qty<=0) throw Error('Choose a printing, finish and positive whole quantity for every item.');
      const field=FINISH_FIELDS[item.finish], current=Object.hasOwn(next,item.cardId)?next[item.cardId]:{q:0,f:0}, before=current[field]||0;
      invValue(current);
      if(!Number.isSafeInteger(before+item.qty)) throw Error('Quantity is too large.');
      next[item.cardId]={...current,[field]:before+item.qty};
      changes.push({...item,before,after:before+item.qty});
    }
    return {inv:next,changes,receipts:{...receipts,[receiptId]:{at:new Date().toISOString(),items:clone(items)}}};
  }
  function price(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;}
  // Curated product identity repair only. Never overwrite a different provider ID or infer a price/finish.
  function validatedProductMapping(card,mapping){
    if(!record(card)||!record(mapping)||!record(mapping.expectedIdentity))return null;
    const target=mapping.tcgplayerProductId;
    if(typeof card.id!=='string'||!card.id||mapping.printingId!==card.id || !Number.isSafeInteger(target)||target<=0)return null;
    for(const field of ['n','v','s','c','r']){
      if(typeof card[field]!=='string'||typeof mapping.expectedIdentity[field]!=='string'||card[field]!==mapping.expectedIdentity[field])return null;
      if(field!=='v'&&!card[field])return null;
    }
    if(!Object.hasOwn(mapping,'expectedCurrentTcgplayerId') || (mapping.expectedCurrentTcgplayerId!==null&&mapping.expectedCurrentTcgplayerId!==target))return null;
    if(card.t!==null&&card.t!==undefined&&card.t!==target)return null;
    return target;
  }
  // Quotes are opt-in mappings for a verified physical finish, not a classification of every Holofoil product.
  function validatedRainbowQuote(card,quote,now=Date.now()){
    if(!record(card)||!record(quote)||typeof now!=='number'||!Number.isFinite(now))return null;
    if(typeof card.id!=='string'||!card.id||typeof card.n!=='string'||!card.n||typeof card.v!=='string'||typeof card.s!=='string'||!card.s||typeof card.c!=='string'||!card.c||quote.printingId!==card.id || quote.finish!=='rainbow' ||
      quote.name!==card.n || quote.version!==(card.v||'') || quote.setCode!==String(card.s) ||
      quote.collectorNumber!==String(card.c) || !Number.isSafeInteger(card.t) || card.t<=0 || quote.tcgplayerProductId!==card.t ||
      quote.currency!=='USD' || quote.rawSubtype!=='Holofoil')return null;
    const amount=price(quote.marketPrice);if(amount===null)return null;
    if(typeof quote.buildAsOf!=='string')return null;
    const m=quote.buildAsOf.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/);
    if(!m)return null;
    const [,year,month,day,hour,minute,second,offsetHour='0',offsetMinute='0']=m.map((v,i)=>i?v===undefined?undefined:Number(v):v);
    if(month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate()||hour>23||minute>59||second>59||offsetHour>23||offsetMinute>59)return null;
    const built=Date.parse(quote.buildAsOf), age=now-built, DAY=86400000;
    if(!Number.isFinite(built)||age>7*DAY||age< -DAY)return null;
    return amount;
  }
  function valuation(rows,finish='all'){
    if(finish!=='all'&&!Object.hasOwn(FINISH_FIELDS,finish))throw Error('Unknown finish filter.');
    let value=0,copies=0,unpriced=0;
    for(const r of rows){
      if(!validInvQuantities(r))throw Error('Valuation has an invalid quantity.');
      for(const [field,pfield,variant] of [['q','p','normal'],['f','pf','foil'],['rf','prf','rainbow']]){
        if(finish!=='all'&&finish!==variant)continue;
        const qty=r[field]||0, unit=price(r.c?.[pfield]);copies+=qty;
        if(!Number.isSafeInteger(copies))throw Error('Quantity is too large.');
        if(unit===null)unpriced+=qty; else value+=qty*unit;
      }
    }
    return {value,copies,unpriced,partial:unpriced>0};
  }
  const api={clone,same,sorted,maps,baseline,plan,pending,validate,restoreSnapshot,load,save,applyPulls,collectionAddition,price,validatedProductMapping,validatedRainbowQuote,valuation,KEY,LEGACY_KEY,LEGACY_KEYS,BACKUP_APP,FINISH_FIELDS,isLegacyKey,checkLegacy,preserveRainbow};
  if(typeof module!=='undefined'&&module.exports) module.exports=api; else root.InkSafety=api;
})(typeof window!=='undefined'?window:globalThis);
