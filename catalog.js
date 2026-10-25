(function(root){
  'use strict';

  // Supplemental printings have their own provider namespace. This module never
  // aliases inventory IDs, supplies prices/artwork, or classifies a foil subtype.
  const clone=value=>Array.isArray(value)?value.map(clone):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)])):value;
  const record=value=>!!value && typeof value==='object' && !Array.isArray(value);
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const IDENTITY=['n','v','s','c','r'];
  const GAMEPLAY_STRINGS={i:100,ty:100,cl:1000,tx:20000};
  const GAMEPLAY_NUMBERS=['co','st','wp','lo','mv'];
  const EVIDENCE_KINDS=['printing','product','gameplay','finish'];
  const fail=message=>{throw Error(message);};

  function keys(value,required,optional=[]){
    if(!record(value) || required.some(key=>!own(value,key)) || Object.keys(value).some(key=>!required.includes(key)&&!optional.includes(key)))
      fail('A supplemental record has missing or unsupported fields.');
  }
  function text(value,max,empty=false){
    return typeof value==='string' && value.length<=(max||200) && (empty||value.trim().length>0) && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value);
  }
  function token(value){return typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,15}$/.test(value);}
  function day(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const time=Date.parse(value+'T00:00:00Z');
    return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
  }
  function https(value){
    if(!text(value,2000)||/\s/.test(value))return false;
    try{const url=new URL(value);return url.protocol==='https:' && !!url.hostname && !url.username && !url.password;}
    catch(_){return false;}
  }
  function identity(value){
    keys(value,IDENTITY);
    return text(value.n,200) && text(value.v,200,true) && token(value.s) && token(value.c) && text(value.r,50);
  }
  function baseIndex(base){
    if(!record(base)||!Array.isArray(base.cards)||base.cards.length>100000||!Array.isArray(base.sets)||base.sets.length>1000)
      fail('The base catalog is missing or invalid.');
    const index=new Map();
    for(const card of base.cards){
      if(!record(card)||!text(card.id,100)||index.has(card.id))fail('The base catalog has an invalid or duplicate ID.');
      index.set(card.id,card);
    }
    const sets=new Set();
    for(const set of base.sets){
      if(!record(set)||!token(set.code)||!text(set.name,200)||sets.has(set.code))fail('The base catalog has an invalid or duplicate set.');
      sets.add(set.code);
    }
    return index;
  }
  function project(entry,index,verifiedAt){
    keys(entry,['id','provider','productId','printing','gameplaySource','evidence','rawSubtype']);
    if(entry.provider!=='TCGplayer'||!Number.isSafeInteger(entry.productId)||entry.productId<=0||entry.productId>2147483647||entry.id!=='tcgplayer_'+entry.productId)
      fail('A supplemental provider/product ID is inconsistent.');
    const p=entry.printing;
    keys(p,['n','v','s','sn','c','r','language','printedSet','stamp']);
    if(!text(p.n,200)||!text(p.v,200,true)||!token(p.s)||!text(p.sn,200)||!token(p.c)||p.r!=='Promo'||p.language!=='EN'||!token(p.printedSet)||!text(p.stamp,200))
      fail('A supplemental printing identity is invalid.');
    if(entry.rawSubtype!==null&&!text(entry.rawSubtype,100))fail('A supplemental raw subtype is invalid.');
    const source=entry.gameplaySource;
    keys(source,['id','expectedIdentity']);
    if(!text(source.id,100)||!identity(source.expectedIdentity))fail('A supplemental gameplay reference is invalid.');
    const base=index.get(source.id);
    if(!base||base.supplemental||!IDENTITY.every(key=>base[key]===source.expectedIdentity[key])||base.n!==p.n||base.v!==p.v||base.s!==p.printedSet)
      fail('The exact verified gameplay source is unavailable or changed for '+entry.id+'.');
    if(!Array.isArray(entry.evidence)||entry.evidence.length<1||entry.evidence.length>10)fail('Supplemental provenance is missing or invalid.');
    const supported=new Set();
    for(const evidence of entry.evidence){
      keys(evidence,['url','supports'],['note']);
      if(!https(evidence.url)||!Array.isArray(evidence.supports)||!evidence.supports.length||evidence.supports.length>EVIDENCE_KINDS.length||new Set(evidence.supports).size!==evidence.supports.length||evidence.supports.some(kind=>!EVIDENCE_KINDS.includes(kind))||(own(evidence,'note')&&!text(evidence.note,2000)))
        fail('Supplemental provenance requires bounded HTTPS evidence.');
      evidence.supports.forEach(kind=>supported.add(kind));
    }
    if(!['printing','product','gameplay'].every(kind=>supported.has(kind)))fail('Supplemental evidence does not cover printing, product and gameplay.');
    const card={id:entry.id,n:p.n,v:p.v,s:p.s,sn:p.sn,c:p.c,r:p.r,t:entry.productId,p:null,pf:null,prf:null};
    for(const [key,max] of Object.entries(GAMEPLAY_STRINGS)){
      if(!text(base[key],max,key!=='i'&&key!=='ty'))fail('The verified gameplay source has an invalid '+key+' field.');
      card[key]=base[key];
    }
    for(const key of GAMEPLAY_NUMBERS){
      if(base[key]!==null&&(!Number.isSafeInteger(base[key])||base[key]<0||base[key]>100))fail('The verified gameplay source has an invalid '+key+' field.');
      card[key]=base[key];
    }
    for(const key of ['ik','lc']){
      if(base[key]!==0&&base[key]!==1)fail('The verified gameplay source has an invalid '+key+' field.');
      card[key]=base[key];
    }
    // Flavor, artist and image identity are printing-specific, not gameplay.
    card.fl='';card.il='';card.iv=null;
    card.supplemental={schemaVersion:1,game:'lorcana',provider:entry.provider,productId:entry.productId,language:p.language,printedSet:p.printedSet,stamp:p.stamp,rawSubtype:entry.rawSubtype,verifiedAt,gameplaySource:clone(source),evidence:clone(entry.evidence)};
    return card;
  }

  // Throws on any bad record: no partially accepted supplement is returned.
  function validateSupplement(supplement,base){
    const index=baseIndex(base);
    keys(supplement,['schemaVersion','game','verifiedAt','records']);
    if(supplement.schemaVersion!==1||supplement.game!=='lorcana'||!day(supplement.verifiedAt)||!Array.isArray(supplement.records)||supplement.records.length>500)
      fail('The supplemental catalog schema is invalid.');
    const ids=new Set(),cards=[];
    for(const entry of supplement.records){
      const card=project(entry,index,supplement.verifiedAt);
      if(ids.has(card.id))fail('The supplemental catalog contains a duplicate ID: '+card.id+'.');
      ids.add(card.id);
      const existing=index.get(card.id);
      // A second merge of this exact managed record is idempotent. Other base
      // records, including a provider-namespace collision, are never replaced.
      if(existing&&!Object.keys(card).every(key=>JSON.stringify(existing[key])===JSON.stringify(card[key])))
        fail('A supplemental ID collides with an existing base record: '+card.id+'.');
      cards.push(card);
    }
    return cards;
  }

  function merge(base,supplement){
    baseIndex(base);
    const catalog=clone(base),warnings=[];
    if(supplement===null||supplement===undefined)return {catalog,warnings};
    let additions;
    try{additions=validateSupplement(supplement,base);}
    catch(error){return {catalog,warnings:['Supplemental catalog not applied: '+error.message]};}
    const ids=new Set(catalog.cards.map(card=>card.id));
    const sets=new Map(catalog.sets.map(set=>[set.code,set]));
    for(const card of additions){
      if(!ids.has(card.id)){catalog.cards.push(card);ids.add(card.id);}
      if(!sets.has(card.s)){const set={code:card.s,name:card.sn,rel:null};catalog.sets.push(set);sets.set(card.s,set);}
      else if(sets.get(card.s).name!==card.sn)warnings.push('Supplemental set '+card.s+' has a different base set label; the original label was retained.');
      const duplicates=catalog.cards.filter(other=>other.id!==card.id&&String(other.s??'').toUpperCase()===card.s.toUpperCase()&&String(other.c??'').toUpperCase()===card.c.toUpperCase());
      if(duplicates.length)warnings.push('Ambiguous printing '+card.s+' #'+card.c+': '+[card.id,...duplicates.map(other=>other.id)].join(', ')+' are retained as distinct IDs; no automatic alias was made.');
    }
    return {catalog,warnings};
  }

  function buildTime(value){
    if(typeof value!=='string'||value.length>40)return null;
    const match=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/);
    if(!match)return null;
    const [,year,month,date,hour,minute,second,offsetHour='0',offsetMinute='0']=match;
    if(+year<2000||+month<1||+month>12||+date<1||+date>new Date(Date.UTC(+year,+month,0)).getUTCDate()||+hour>23||+minute>59||+second>59||+offsetHour>23||+offsetMinute>59)return null;
    const time=Date.parse(value);return Number.isFinite(time)?time:null;
  }

  // This is a price for the generic foil inventory bucket of one evidenced promo
  // product. "Holofoil" remains the provider's label, NOT a physical cold/rainbow
  // classification. No normal, rainbow or source-gameplay price is consulted.
  function validatedFoilQuote(card,quote,now=Date.now()){
    if(!record(card)||!record(card.supplemental)||!record(quote)||!Number.isFinite(now))return null;
    const meta=card.supplemental,expected=quote.expectedPrinting,product=meta.productId;
    if(meta.schemaVersion!==1||meta.game!=='lorcana'||meta.provider!=='TCGplayer'||!Number.isSafeInteger(product)||product<=0||product>2147483647||card.id!=='tcgplayer_'+product||card.t!==product||quote.printingId!==card.id||quote.tcgplayerProductId!==product)return null;
    if(!record(expected)||Object.keys(expected).length!==8||!['n','v','s','c','r','language','printedSet','stamp'].every(key=>own(expected,key)))return null;
    if(!text(card.n,200)||!text(card.v,200,true)||!token(card.s)||!token(card.c)||card.r!=='Promo'||!IDENTITY.every(key=>expected[key]===card[key])||meta.language!=='EN'||!token(meta.printedSet)||!text(meta.stamp,200)||!['language','printedSet','stamp'].every(key=>expected[key]===meta[key]))return null;
    if(meta.rawSubtype!=='Holofoil'||quote.rawSubtype!=='Holofoil'||quote.inventoryFinish!=='foil'||quote.physicalFinish!==null||quote.displayLabel!=='Holofoil (provider label)'||quote.provider!=='TCGplayer via TCGCSV'||quote.currency!=='USD')return null;
    if(!Array.isArray(quote.availableRawSubtypes)||quote.availableRawSubtypes.length!==1||quote.availableRawSubtypes[0]!=='Holofoil')return null;
    const amount=quote.marketPrice,row=quote.sourcePriceRow;
    if(typeof amount!=='number'||!Number.isFinite(amount)||amount<0||!record(row)||row.productId!==product||row.subTypeName!=='Holofoil'||row.marketPrice!==amount)return null;
    const group=quote.tcgplayerGroupId;
    if(!Number.isSafeInteger(group)||group<=0||group>2147483647||quote.sourceURL!=='https://tcgcsv.com/tcgplayer/71/'+group+'/prices'||quote.sourceBuildURL!=='https://tcgcsv.com/last-updated.txt')return null;
    const built=buildTime(quote.buildAsOf);
    if(built===null||built>now||now-built>7*86400000)return null;
    return amount;
  }

  const api=Object.freeze({validateSupplement,merge,validatedFoilQuote});
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.InkCatalog=api;
})(typeof globalThis!=='undefined'?globalThis:this);
