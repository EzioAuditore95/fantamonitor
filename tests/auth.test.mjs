import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./helpers/auth-loader.mjs',import.meta.url);
const {getAppUser,requireLeagueMember}=await import('../app/auth.ts');
const archive=await import('../app/api/archive/route.ts');
const sync=await import('../app/api/sync/route.ts');
const credentials=await import('../app/api/credentials/route.ts');
const identity={id:'user',email:'user@example.test'};
beforeEach(()=>{
 const fixture={configured:true,user:identity,configs:{alpha:{id:'a',slug:'alpha'},beta:{id:'b',slug:'beta'}},memberships:[{user_id:'user',league_id:'a',role:'admin'},{user_id:'user',league_id:'b',role:'viewer'}],connectorCalls:[],membershipError:null};
 fixture.client={auth:{getUser:async()=>({data:{user:fixture.user},error:null})},from(table){
  assert.equal(table,'fm_memberships');const filters={};
  return {select(columns){assert.equal(columns,'league_id,role');return this;},eq(key,value){filters[key]=value;return this;},async maybeSingle(){
   assert.equal(filters.user_id,'user');assert.ok(filters.league_id,'membership must target the requested league');
   return {data:fixture.memberships.find(row=>row.user_id===filters.user_id&&row.league_id===filters.league_id)??null,error:fixture.membershipError};
  }};
 }};
 globalThis.fmAuthFixture=fixture;
});
const request=(path,method='GET',body)=>new Request(`https://app.example.test${path}`,{method,headers:{origin:'https://app.example.test','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
test('authentication returns identity without borrowing a membership role',async()=>{
 assert.deepEqual(await getAppUser(),{userId:'user',email:'user@example.test'});
 globalThis.fmAuthFixture.memberships=[];
 assert.deepEqual(await getAppUser(),{userId:'user',email:'user@example.test'});
});
test('requested league determines permissions regardless of membership order',async()=>{
 for(const reverse of [false,true]){
  if(reverse)globalThis.fmAuthFixture.memberships.reverse();
  for(const [slug,role,id] of [['alpha','admin','a'],['beta','viewer','b']]){
   const ctx=await requireLeagueMember(slug);
   assert.equal(ctx.user.role,role);assert.equal(ctx.user.leagueId,id);
   const response=await archive.GET(request(`/api/archive?league=${slug}`));
   assert.equal(response.status,200);assert.equal((await response.json()).canManage,role==='admin');
  }
 }
});
test('viewer requests stop before invoking the connector, including the reverse role arrangement',async()=>{
 for(const swap of [false,true]){
  if(swap)for(const row of globalThis.fmAuthFixture.memberships)row.role=row.role==='admin'?'viewer':'admin';
  const viewer=swap?'alpha':'beta',admin=swap?'beta':'alpha';
  for(const [handler,req] of [[sync.POST,request('/api/sync','POST',{league:viewer,round:1})],[credentials.PUT,request(`/api/credentials?league=${viewer}`,'PUT')],[archive.POST,request(`/api/archive?league=${viewer}`,'POST',{})]]){
   assert.equal((await handler(req)).status,403);
  }
  assert.equal(globalThis.fmAuthFixture.connectorCalls.length,0);
  assert.equal((await sync.POST(request('/api/sync','POST',{league:admin,round:1}))).status,200);
  assert.equal((await credentials.PUT(request(`/api/credentials?league=${admin}`,'PUT'))).status,200);
  assert.deepEqual(globalThis.fmAuthFixture.connectorCalls,[swap?'b':'a',swap?'b':'a']);
  globalThis.fmAuthFixture.connectorCalls.length=0;
 }
});
test('unauthenticated, unconfigured and inaccessible league requests retain their status codes',async()=>{
 for(const user of [null,identity]){
  globalThis.fmAuthFixture.user=user;globalThis.fmAuthFixture.configured=user===null;
  assert.equal((await requireLeagueMember('alpha')).status,401);
 }
 globalThis.fmAuthFixture.configured=true;
 assert.equal((await requireLeagueMember(null)).status,400);
 assert.equal((await requireLeagueMember('gamma')).status,404);
 globalThis.fmAuthFixture.memberships=[];
 assert.equal((await requireLeagueMember('alpha')).status,404);
 globalThis.fmAuthFixture.memberships=[{user_id:'user',league_id:'a',role:'owner'}];
 assert.equal((await requireLeagueMember('alpha')).status,404);
});
test('membership lookup errors never grant access',async()=>{
 globalThis.fmAuthFixture.membershipError=new Error('database unavailable');
 await assert.rejects(requireLeagueMember('alpha'),/Membership unavailable/);
 assert.equal(globalThis.fmAuthFixture.connectorCalls.length,0);
});
