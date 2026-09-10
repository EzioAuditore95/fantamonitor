import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
try { await db.exec(await readFile(new URL('../supabase/migrations/202609100001_fantamonitor.sql',import.meta.url),'utf8')); } catch(e) { console.error({message:e.message,position:e.position,where:e.where,detail:e.detail});process.exit(1); }
const admin='00000000-0000-4000-8000-000000000001',viewer='00000000-0000-4000-8000-000000000002',stranger='00000000-0000-4000-8000-000000000003';
await db.query('insert into auth.users values ($1),($2),($3)',[admin,viewer,stranger]);
await db.query("insert into fm_members values ($1,'admin'),($2,'viewer')",[admin,viewer]);
async function asUser(id,sql,args=[]){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
const fixture=JSON.parse(await readFile(new URL('../prototype/tests/fixture.json',import.meta.url),'utf8'));
const observation={id:'a'.repeat(64),body:{...fixture,observed_at:'2025-09-01T00:00:00.000Z'}};
const review={team:'Real Hasbulla',round:1,status:'missed',deadline:'2025-09-01T00:00:00Z',note:'Log della formazione verificato.',source_url:'https://leghe.fantacalcio.it/chefantavitae10/view/competition/337500/manage-lineups/1'};
test('admin import is atomic and idempotent',async()=>{
 const sql='select fm_import_observations($1::jsonb) as result';
 assert.deepEqual((await asUser(admin,sql,[JSON.stringify([observation])])).rows[0].result,{imported:1,duplicates:0});
 assert.deepEqual((await asUser(admin,sql,[JSON.stringify([observation])])).rows[0].result,{imported:0,duplicates:1});
 const next={id:'b'.repeat(64),body:{...observation.body,observed_at:'2025-09-02T00:00:00.000Z'}};
 const conflict={...observation,body:{...observation.body,source_url:observation.body.source_url+'?changed=1'}};
 await assert.rejects(asUser(admin,sql,[JSON.stringify([next,conflict])]),/observation_conflict/);
 assert.equal((await db.query('select count(*)::int as n from fm_observations')).rows[0].n,1);
});
test('viewer can read but cannot write; nonmembers cannot read',async()=>{
 assert.equal((await asUser(viewer,'select * from fm_observations')).rows.length,1);
 assert.equal((await asUser(stranger,'select * from fm_observations')).rows.length,0);
 await assert.rejects(asUser(viewer,'select fm_save_review($1::jsonb,0)',[JSON.stringify(review)]),/admin_required/);
 await assert.rejects(asUser(viewer,"update fm_members set role='admin'"),/permission denied/);
 await assert.rejects(asUser(admin,'delete from fm_observations'),/permission denied/);
});
test('reviews keep revisions and retry safely, rejecting stale updates',async()=>{
 const sql='select fm_save_review($1::jsonb,$2) as result';
 assert.equal((await asUser(admin,sql,[JSON.stringify(review),0])).rows[0].result.duplicate,false);
 assert.equal((await asUser(admin,sql,[JSON.stringify(review),0])).rows[0].result.duplicate,true);
 const corrected={...review,status:'delivered'};
 await assert.rejects(asUser(admin,sql,[JSON.stringify(corrected),0]),/review_conflict/);
 await asUser(admin,sql,[JSON.stringify(corrected),1]);
 assert.equal((await db.query('select count(*)::int as n from fm_lineup_reviews')).rows[0].n,2);
});
test('direct RPC cannot bypass source, team or past-deadline validation',async()=>{
 const sql='select fm_save_review($1::jsonb,0)';
 await assert.rejects(asUser(admin,sql,[JSON.stringify({...review,round:2,deadline:'2099-01-01T00:00:00Z'})]),/past_deadline_required/);
 await assert.rejects(asUser(admin,sql,[JSON.stringify({...review,team:'Other'})]),/invalid_review_scope/);
 await assert.rejects(asUser(admin,sql,[JSON.stringify({...review,source_url:'https://example.com'})]),/invalid_source/);
 await assert.rejects(asUser(admin,'select fm_import_observations($1::jsonb)',[JSON.stringify([{...observation,body:{...observation.body,inserted:99}}])]),/invalid_count/);
});
after(async()=>{await db.close();});
