(function(root){
  'use strict';
  const DAY=86400000,IDENTITY=['n','v','s','c','r'];
  const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const text=(value,empty=false)=>typeof value==='string'&&value.length<=500&&(empty||value.trim().length>0);
  const norm=value=>value.normalize('NFC').replace(/[\u2018\u2019]/g,"'").trim().replace(/\s+/gu,' ').toLowerCase();
  // JSON tuple encoding prevents punctuation or delimiters from colliding.
  const identity=card=>text(card?.n)&&text(card?.v,true)?JSON.stringify([norm(card.n),norm(card.v)]):null;
  const token=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/.test(value);
  function date(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
    const time=Date.parse(value+'T00:00:00Z');
    return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?time:null;
  }
  function officialURL(value){
    if(typeof value!=='string'||value.length>2000)return false;
    try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&['www.disneylorcana.com','files.disneylorcana.com'].includes(u.hostname);}
    catch(_){return false;}
  }
  function policy(rules){
    if(rules===null||rules===undefined)return {error:'rules-missing'};
    if(!record(rules)||rules.schemaVersion!==1||rules.game!=='lorcana'||rules.format!=='core'||!text(rules.displayName)||!text(rules.rulesScope)||!text(rules.maintenanceNote)||!officialURL(rules.primarySourceURL))return {error:'rules-invalid'};
    const verified=date(rules.verifiedAt),asof=date(rules.policyAsOf),due=date(rules.reviewDue),release=date(rules.newestVerifiedRelease?.legalFrom);
    if([verified,asof,due,release].some(value=>value===null)||asof>verified||release>asof||due<=verified||due-verified>31*DAY)return {error:'rules-invalid'};
    const fields=['eligibleReleasedSetCodes','rotatedSetCodes','knownPromoSetCodes','excludedSpecialFormatSets'],seen=new Set(),sets={};
    for(const field of fields){
      const values=rules[field];
      if(!Array.isArray(values)||values.length>100||values.some(value=>!token(value)||seen.has(value)||values.indexOf(value)!==values.lastIndexOf(value)))return {error:'rules-invalid'};
      values.forEach(value=>seen.add(value));sets[field]=new Set(values);
    }
    if(!sets.eligibleReleasedSetCodes.size||!rules.eligibleReleasedSetCodes.every(value=>/^[1-9]\d*$/.test(value))||!rules.rotatedSetCodes.every(value=>/^[1-9]\d*$/.test(value)))return {error:'rules-invalid'};
    const newest=rules.newestVerifiedRelease;
    if(!record(newest)||!sets.eligibleReleasedSetCodes.has(newest.setCode)||!officialURL(newest.sourceURL)||rules.eligibleReleasedSetCodes.some(value=>Number(value)>Number(newest.setCode)))return {error:'rules-invalid'};
    if(!Array.isArray(rules.sources)||rules.sources.length>30||!rules.sources.every(source=>{
      if(!record(source)||typeof source.url!=='string'||source.url.length>2000)return false;
      try{const u=new URL(source.url);return u.protocol==='https:'&&!u.username&&!u.password;}catch(_){return false;}
    })||!rules.sources.some(source=>source.url===rules.primarySourceURL)||!Array.isArray(rules.bannedGameplayIdentities)||rules.bannedGameplayIdentities.length>1000)return {error:'rules-invalid'};
    const bans=new Set();
    for(const ban of rules.bannedGameplayIdentities){
      const key=identity({n:ban?.name,v:ban?.version});
      if(!record(ban)||key===null||bans.has(key))return {error:'rules-invalid'};
      bans.add(key);
    }
    return {rules:clone(rules),verified,asof,due,release,sets,bans};
  }
  function validCard(card){return record(card)&&text(card.id)&&identity(card)!==null&&token(card.s)&&token(card.c)&&text(card.r);}
  function anchor(card){return {id:card.id,name:card.n,version:card.v,setCode:card.s,collectorNumber:card.c};}
  function supplemental(card){return !!card.supplemental||card.id.startsWith('tcgplayer_');}
  function validSupplement(card,cards,p){
    const meta=card.supplemental,source=meta?.gameplaySource,expected=source?.expectedIdentity;
    if(!record(meta)||meta.schemaVersion!==1||meta.game!=='lorcana'||meta.provider!=='TCGplayer'||!Number.isSafeInteger(meta.productId)||meta.productId<=0||card.id!=='tcgplayer_'+meta.productId||card.t!==meta.productId||meta.language!=='EN'||!text(meta.stamp)||!record(source)||!record(expected)||Object.keys(expected).length!==5)return false;
    const original=cards.get(source.id);
    return !!original&&!supplemental(original)&&IDENTITY.every(key=>Object.hasOwn(expected,key)&&expected[key]===original[key])&&card.n===original.n&&card.v===original.v&&meta.printedSet===original.s&&(p.sets.eligibleReleasedSetCodes.has(original.s)||p.sets.rotatedSetCodes.has(original.s));
  }
  function createIndex(catalog,rules,now){
    const clock=arguments.length>=3?()=>now:()=>Date.now(),p=policy(rules),cards=new Map(),eligible=new Map(),rotated=new Set();
    let catalogError=null;
    if(!record(catalog)||!Array.isArray(catalog.cards)||catalog.cards.length>100000)catalogError='catalog-invalid';
    else for(const card of catalog.cards){
      if(!validCard(card)||cards.has(card.id)){catalogError='catalog-invalid';break;}
      cards.set(card.id,clone({id:card.id,n:card.n,v:card.v,s:card.s,c:card.c,r:card.r,t:card.t,...(card.supplemental?{supplemental:card.supplemental}:{})}));
    }
    if(!p.error&&!catalogError){
      for(const card of cards.values()){
        if(supplemental(card))continue;
        const key=identity(card);
        if(p.sets.eligibleReleasedSetCodes.has(card.s)&&!p.bans.has(key)){
          if(!eligible.has(key))eligible.set(key,[]);eligible.get(key).push(card);
        }
        if(p.sets.rotatedSetCodes.has(card.s))rotated.add(key);
      }
      for(const list of eligible.values())list.sort((a,b)=>Number(a.s)-Number(b.s)||a.c.localeCompare(b.c,undefined,{numeric:true})||a.id.localeCompare(b.id));
    }
    function currentReason(){
      if(p.error)return p.error;
      const time=clock();
      if(typeof time!=='number'||!Number.isFinite(time))return 'rules-invalid';
      if(time<p.verified||time<p.asof||time<p.release)return 'rules-future';
      if(time>=p.due)return 'rules-expired';
      return catalogError;
    }
    function info(){
      const reason=currentReason();
      return {valid:reason===null,reason,displayName:p.rules?.displayName||'Core Constructed (Standard)',verifiedAt:p.rules?.verifiedAt||null,reviewDue:p.rules?.reviewDue||null,source:p.rules?.primarySourceURL||null,sources:clone(p.rules?.sources||[]),rulesScope:p.rules?.rulesScope||'Current English Core rules could not be verified.',maintenanceNote:p.rules?.maintenanceNote||'Missing or invalid rules are unknown, not evidence of card illegality.'};
    }
    function status(card){
      const result=(status,reason,matched=null)=>({status,reason,anchor:matched?anchor(matched):null,verifiedAt:p.rules?.verifiedAt||null,source:p.rules?.primarySourceURL||null});
      const unavailable=currentReason();if(unavailable)return result('unknown',unavailable);
      if(!validCard(card))return result('unknown','unresolved-printing');
      const saved=cards.get(card.id);
      if(!saved||!IDENTITY.every(key=>saved[key]===card[key]))return result('unknown','unresolved-printing');
      if(p.sets.excludedSpecialFormatSets.has(card.s))return result('not_legal','special-format-only');
      if(!p.sets.eligibleReleasedSetCodes.has(card.s)&&!p.sets.rotatedSetCodes.has(card.s)&&!p.sets.knownPromoSetCodes.has(card.s))return result('unknown','unverified-set');
      if((supplemental(card)||supplemental(saved))&&(!validSupplement(card,cards,p)||!validSupplement(saved,cards,p)))return result('unknown','unverified-supplement');
      const key=identity(saved);
      if(p.bans.has(key))return result('not_legal','banned');
      const matches=eligible.get(key);
      if(matches?.length)return result('legal',p.sets.eligibleReleasedSetCodes.has(card.s)?'current-set-identity':'reprinted-identity',matches.find(item=>item.id===card.id)||matches[0]);
      if(rotated.has(key))return result('not_legal','rotated-identity');
      return result('unknown','unresolved-identity');
    }
    return Object.freeze({status,get info(){return info();}});
  }
  const api=Object.freeze({createIndex});
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.InkLegality=api;
})(typeof globalThis!=='undefined'?globalThis:this);
