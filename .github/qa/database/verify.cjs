'use strict';
// Only localhost synthetic PostgREST. Never accept a production URL override.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const BASE='http://127.0.0.1:4300';
const owner='11111111-1111-4111-8111-111111111111';
const secret='inkscan-synthetic-ci-jwt-secret-not-for-production';
function jwt(sub){const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const body=enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub,role:'qa_authenticated',exp:Math.floor(Date.now()/1000)+600});return body+'.'+crypto.createHmac('sha256',secret).update(body).digest('base64url');}
async function req(method,path,body,prefer='return=representation',authenticated=true){const r=await fetch(BASE+path,{method,headers:{'Content-Type':'application/json',Prefer:prefer,...(authenticated?{Authorization:'Bearer '+jwt(owner)}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();return {status:r.status,body:t?JSON.parse(t):null};}
async function own(){const r=await req('GET','/collection?user_id=eq.'+owner+'&card_id=eq.legacy-printing');assert.equal(r.status,200);assert.equal(r.body.length,1);return r.body[0];}
(async()=>{
 let row=await own();assert.deepEqual([row.q,row.f,row.rainbow_foil],[2,1,3]);
 // Exact old v4 merge-duplicates shape omits the new column.
 let r=await req('POST','/collection?on_conflict=user_id,card_id',{user_id:owner,card_id:'legacy-printing',q:4,f:2},'resolution=merge-duplicates,return=representation');assert.equal(r.status,201);row=await own();assert.deepEqual([row.q,row.f,row.rainbow_foil],[4,2,3]);
 // Released v5-style q/f patch and q/f tombstone must retain rainbow-only row.
 r=await req('PATCH','/collection?user_id=eq.'+owner+'&card_id=eq.legacy-printing&q=eq.4&f=eq.2&updated_at=eq.'+encodeURIComponent(row.updated_at),{user_id:owner,card_id:'legacy-printing',q:0,f:0});assert.equal(r.status,200);assert.equal(r.body.length,1);row=await own();assert.deepEqual([row.q,row.f,row.rainbow_foil],[0,0,3]);
 // Stale rainbow CAS cannot overwrite a more recent change.
 const prior=row;
 r=await req('PATCH','/collection?user_id=eq.'+owner+'&card_id=eq.legacy-printing',{rainbow_foil:4});assert.equal(r.status,200);
 r=await req('PATCH','/collection?user_id=eq.'+owner+'&card_id=eq.legacy-printing&rainbow_foil=eq.3&updated_at=eq.'+encodeURIComponent(prior.updated_at),{rainbow_foil:99});assert.equal(r.status,200);assert.deepEqual(r.body,[]);assert.equal((await own()).rainbow_foil,4);
 r=await req('POST','/collection',{user_id:owner,card_id:'new-legacy-printing',q:1,f:0});assert.equal(r.status,201);assert.equal(r.body[0].rainbow_foil,0);
 r=await req('PATCH','/collection?user_id=eq.'+owner+'&card_id=eq.legacy-printing',{rainbow_foil:-1});assert.equal(r.status,400);assert.equal((await own()).rainbow_foil,4);
 r=await req('GET','/collection');assert.equal(r.status,200);assert(r.body.every(x=>x.user_id===owner));
 r=await req('POST','/collection',{user_id:'22222222-2222-4222-8222-222222222222',card_id:'forbidden',q:1,f:0});assert.equal(r.status,403);
 r=await req('GET','/collection',undefined,undefined,false);assert([401,403].includes(r.status));
 console.log('PostgreSQL/PostgREST compatibility passed: additive default; v4 upsert preservation; v5 patch/tombstone preservation; stale-rainbow guard; no negative quantity; owner/anonymous isolation. Synthetic only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
