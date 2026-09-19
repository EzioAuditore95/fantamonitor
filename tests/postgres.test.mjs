import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {makeSnapshotSchema} from '../lib/model.ts';
import {makeReviewInputSchema} from '../lib/penalties.ts';
import {CHEFANTAVITAE10,leagueConfigFromRows,periodForRound,teamNames} from '../lib/league.ts';
const bootstrap=`create schema extensions; create extension pgcrypto with schema extensions;
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`;
const migrationsUrl=new URL('../supabase/migrations/',import.meta.url);
const migrations=(await readdir(migrationsUrl)).filter(name=>name.endsWith('.sql')).sort();
const sqlOf=name=>readFile(new URL(name,migrationsUrl),'utf8');
async function freshDb(upTo=migrations.length){
 const instance=new PGlite({extensions:{pgcrypto}});
 await instance.exec(bootstrap);
 for(const migration of migrations.slice(0,upTo)){
  try { await instance.exec(await sqlOf(migration)); }
  catch(e) { console.error({migration,message:e.message,position:e.position,where:e.where,detail:e.detail});process.exit(1); }
 }
 return instance;
}
const db=await freshDb();

const ALPHA='9f3a1c60-5d4e-4b7a-9c21-6f0e2a8d4b13';
const BETA='11111111-2222-4333-8444-555555555555';
const alphaAdmin='00000000-0000-4000-8000-000000000001',alphaViewer='00000000-0000-4000-8000-000000000002',stranger='00000000-0000-4000-8000-000000000003';
const betaAdmin='00000000-0000-4000-8000-000000000004',betaViewer='00000000-0000-4000-8000-000000000005',bothUser='00000000-0000-4000-8000-000000000006';
await db.query('insert into auth.users values ($1),($2),($3),($4),($5),($6)',[alphaAdmin,alphaViewer,stranger,betaAdmin,betaViewer,bothUser]);
// Beta is seeded exactly the way a real second league would be: SQL, no UI.
await db.query(`insert into fm_leagues (id,slug,season,competition_id,name,round_count,serie_a_offset,period_mode,first_half_end,free_tokens,penalty_amount,rules)
 values ($1,'beta-league','2026-2027','999001','Beta League',30,0,'season',null,2,10,'{}'::jsonb)`,[BETA]);
await db.query(`insert into fm_league_teams (league_id,name,position,color)
 select $1,'Beta '||i,i,null from generate_series(1,8) i`,[BETA]);
await db.query(`insert into fm_memberships (league_id,user_id,role) values
 ($1,$3,'admin'),($1,$4,'viewer'),($2,$5,'admin'),($2,$6,'viewer'),($1,$7,'admin'),($2,$7,'viewer')`,
 [ALPHA,BETA,alphaAdmin,alphaViewer,betaAdmin,betaViewer,bothUser]);

async function asUser(id,sql,args=[]){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
async function loadLeague(id){
 const row=(await db.query('select * from fm_leagues where id=$1',[id])).rows[0];
 const teams=(await db.query('select name,position,color,fantacalcio_team_id from fm_league_teams where league_id=$1',[id])).rows;
 return leagueConfigFromRows(row,teams);
}
const cfgAlpha=await loadLeague(ALPHA),cfgBeta=await loadLeague(BETA);

// The whole auto-sync path sits behind fm_auto_sync_authorized, and the plaintext key only
// exists on Railway. Record that the real function rejects, then replace it with a known
// key so the logic behind the gate can be exercised at all.
const realAuthRejectsWrongKey=(await db.query("select public.fm_auto_sync_authorized('chiave-sbagliata') as ok")).rows[0].ok;
const realAuthRejectsEmpty=(await db.query("select public.fm_auto_sync_authorized('') as ok")).rows[0].ok;
const BOT_KEY='chiave-di-test';
await db.exec(`create or replace function public.fm_auto_sync_authorized(access_key text) returns boolean
 language sql immutable security definer set search_path='' as $$ select access_key='${BOT_KEY}' $$;`);
const bot=(sql,args=[])=>db.query(sql,args);
const alphaBody=(round,observedAt)=>({...observation.body,round,observed_at:observedAt,
 source_url:`https://leghe.fantacalcio.it/chefantavitae10/view/competition/337500/manage-lineups/${round}`});
const betaBodyAt=(round,observedAt)=>({...betaBody,round,observed_at:observedAt,
 source_url:`https://leghe.fantacalcio.it/beta-league/view/competition/999001/manage-lineups/${round}`});
const bodyForLeague=(leagueId,round,observedAt)=>leagueId===ALPHA?alphaBody(round,observedAt):betaBodyAt(round,observedAt);

const fixture=JSON.parse(await readFile(new URL('../prototype/tests/fixture.json',import.meta.url),'utf8'));
const observation={id:'a'.repeat(64),body:{...fixture,observed_at:'2025-09-01T00:00:00.000Z'}};
const review={team:'Real Hasbulla',round:1,status:'missed',deadline:'2025-09-01T00:00:00Z',note:'Log della formazione verificato.',source_url:'https://leghe.fantacalcio.it/chefantavitae10/view/competition/337500/manage-lineups/1'};
const saveReviewSql='select fm_save_review($1::jsonb,$2::int,$3::uuid)';
// A snapshot shaped for beta: eight teams, its own slug and competition.
const betaTeams=teamNames(cfgBeta).map(name=>({team_key:name,name,present:false,source_status:'Non inserita'}));
const betaBody={schema_version:1,league:'beta-league',season:'2026-2027',competition_id:'999001',round:1,
 observed_at:'2025-09-01T00:00:00.000Z',source:'authenticated_ui',
 source_url:'https://leghe.fantacalcio.it/beta-league/view/competition/999001/manage-lineups/1',
 expected_total:8,inserted:0,teams:betaTeams};
const betaObservation={id:'b'.repeat(64),body:betaBody};

test('all expected bot RPCs exist after running every migration',async()=>{
 const expected=['fm_bot_import_snapshot','fm_current_round_for_bot','fm_get_telegram_message','fm_next_round_for_bot','fm_upsert_telegram_message'];
 const result=await db.query(`select p.proname
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname=any($1::text[])
  order by p.proname`,[expected]);
 assert.deepEqual(result.rows.map(row=>row.proname),expected);
});
// Reapplying it on top of the multi-league migration would resurrect the single-league
// bodies, so the no-op property is checked where it is claimed: against production's state.
test('the production reconciliation migration is safe to reapply',async()=>{
 const index=migrations.findIndex(name=>name.endsWith('_reconcile_bot_rpcs.sql'));
 assert.ok(index>=0);
 const isolated=await freshDb(index+1);
 await isolated.exec(await sqlOf(migrations[index]));
 assert.equal((await isolated.query("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'fm_%_for_bot'")).rows[0].n,2);
 await isolated.close();
});
test('admin import is atomic and idempotent',async()=>{
 const sql='select fm_import_observations($1::jsonb) as result';
 assert.deepEqual((await asUser(alphaAdmin,sql,[JSON.stringify([observation])])).rows[0].result,{imported:1,duplicates:0});
 assert.deepEqual((await asUser(alphaAdmin,sql,[JSON.stringify([observation])])).rows[0].result,{imported:0,duplicates:1});
 const next={id:'b'.repeat(64),body:{...observation.body,observed_at:'2025-09-02T00:00:00.000Z'}};
 const conflict={...observation,body:{...observation.body,source_url:observation.body.source_url+'?changed=1'}};
 await assert.rejects(asUser(alphaAdmin,sql,[JSON.stringify([next,conflict])]),/observation_conflict/);
 assert.equal((await db.query('select count(*)::int as n from fm_observations')).rows[0].n,1);
});
test('viewer can read but cannot write; nonmembers cannot read',async()=>{
 assert.equal((await asUser(alphaViewer,'select count(*)::int as n from fm_observations')).rows[0].n,1);
 assert.equal((await asUser(stranger,'select count(*)::int as n from fm_observations')).rows[0].n,0);
 await assert.rejects(asUser(alphaViewer,saveReviewSql,[JSON.stringify(review),0,ALPHA]),/admin_required/);
 await assert.rejects(asUser(alphaViewer,"update fm_memberships set role='admin' where user_id=$1",[alphaViewer]),/permission denied/);
 await assert.rejects(asUser(alphaAdmin,'delete from fm_observations'),/permission denied/);
});
test('reviews keep revisions and retry safely, rejecting stale updates',async()=>{
 assert.deepEqual((await asUser(alphaAdmin,saveReviewSql,[JSON.stringify(review),0,ALPHA])).rows[0].fm_save_review,{saved:true,duplicate:false});
 assert.deepEqual((await asUser(alphaAdmin,saveReviewSql,[JSON.stringify(review),0,ALPHA])).rows[0].fm_save_review,{saved:true,duplicate:true});
 await assert.rejects(asUser(alphaAdmin,saveReviewSql,[JSON.stringify({...review,note:'Correzione dopo nuova verifica.'}),0,ALPHA]),/review_conflict/);
 assert.deepEqual((await asUser(alphaAdmin,saveReviewSql,[JSON.stringify({...review,status:'delivered',note:'Correzione dopo nuova verifica.'}),1,ALPHA])).rows[0].fm_save_review,{saved:true,duplicate:false});
 assert.equal((await db.query('select count(*)::int as n from fm_lineup_reviews')).rows[0].n,2);
});
test('direct RPC cannot bypass source, team or past-deadline validation',async()=>{
 await assert.rejects(asUser(alphaAdmin,saveReviewSql,[JSON.stringify({...review,deadline:'2099-01-01T00:00:00Z'}),2,ALPHA]),/past_deadline_required/);
 await assert.rejects(asUser(alphaAdmin,saveReviewSql,[JSON.stringify({...review,team:'Other'}),0,ALPHA]),/invalid_review_scope/);
 await assert.rejects(asUser(alphaAdmin,saveReviewSql,[JSON.stringify({...review,source_url:'https://example.com'}),2,ALPHA]),/invalid_source/);
 await assert.rejects(asUser(alphaAdmin,'select fm_import_observations($1::jsonb)',[JSON.stringify([{...observation,body:{...observation.body,inserted:99}}])]),/invalid_count/);
});

// The contract used to be written twice and compared. Now TypeScript builds its schema from
// the same fm_leagues row the RPCs read, so the drift it guarded against cannot exist.
test('TypeScript and SQL read the league contract from the same row',async()=>{
 for(const cfg of [cfgAlpha,cfgBeta]){
  for(const name of teamNames(cfg))assert.equal((await db.query('select public.fm_valid_team($1,$2) as ok',[cfg.id,name])).rows[0].ok,true,`${cfg.slug}/${name}`);
  for(const name of ['Other',''])assert.equal((await db.query('select public.fm_valid_team($1,$2) as ok',[cfg.id,name])).rows[0].ok,false,`${cfg.slug}/${name}`);
 }
 assert.equal(teamNames(cfgAlpha).length,10);
 assert.equal(teamNames(cfgBeta).length,8);
 // The assertion the single-league schema could not express.
 for(const name of teamNames(cfgBeta))assert.equal((await db.query('select public.fm_valid_team($1,$2) as ok',[ALPHA,name])).rows[0].ok,false,name);
 for(const name of teamNames(cfgAlpha))assert.equal((await db.query('select public.fm_valid_team($1,$2) as ok',[BETA,name])).rows[0].ok,false,name);

 const schemaAlpha=makeSnapshotSchema(cfgAlpha),schemaBeta=makeSnapshotSchema(cfgBeta);
 assert.equal(schemaAlpha.safeParse(observation.body).success,true);
 assert.equal(schemaBeta.safeParse(betaBody).success,true);
 // Round 31–35 are valid for alpha and out of range for beta.
 for(const [cfg,schema,body,admin_,league] of [[cfgAlpha,schemaAlpha,observation.body,alphaAdmin,ALPHA],[cfgBeta,schemaBeta,betaBody,betaAdmin,BETA]]){
  for(const round of [0,cfg.roundCount+1]){
   assert.throws(()=>periodForRound(cfg,round),`${cfg.slug}/${round}`);
   assert.equal(schema.safeParse({...body,round}).success,false,`${cfg.slug}/${round}`);
   await assert.rejects(asUser(admin_,'select fm_import_observations($1::jsonb)',[JSON.stringify([{id:'c'.repeat(64),body:{...body,round}}])]),/invalid_round_time/,`${cfg.slug}/${round}`);
   await assert.rejects(asUser(admin_,saveReviewSql,[JSON.stringify({...review,round}),0,league]),/invalid_review_scope/,`${cfg.slug}/${round}`);
  }
  for(const round of [1,cfg.roundCount])assert.doesNotThrow(()=>periodForRound(cfg,round));
 }
 const withRound=(body,round)=>({...body,round,source_url:body.source_url.replace(/\/manage-lineups\/\d+/,`/manage-lineups/${round}`)});
 assert.equal(schemaAlpha.safeParse(withRound(observation.body,31)).success,true);
 assert.equal(schemaBeta.safeParse(withRound(betaBody,31)).success,false);

 // An accepted source reaches the revision check; a rejected one never gets that far.
 const prefix='https://leghe.fantacalcio.it/chefantavitae10/view/competition/337500';
 const reviewSchema=makeReviewInputSchema(cfgAlpha);
 for(const [source_url,accepted] of [
  [`${prefix}/round/1`,true],[`${prefix}/manage-lineups/1`,true],[`${prefix}/manage-lineups/1?team=12420064`,true],
  [`${prefix}/manage-lineups/2`,false],[`${prefix.replace('337500','999999')}/manage-lineups/1`,false],
  [`${prefix.replace('https://','http://')}/manage-lineups/1`,false],['https://example.com/manage-lineups/1',false],
 ]){
  assert.equal(reviewSchema.safeParse({...review,source_url,expected_revision:0}).success,accepted,source_url);
  await assert.rejects(asUser(alphaAdmin,saveReviewSql,[JSON.stringify({...review,source_url}),999,ALPHA]),accepted?/review_conflict/:/invalid_source/,source_url);
 }
 // Alpha's source inside beta must fail on both sides.
 assert.equal(makeReviewInputSchema(cfgBeta).safeParse({...review,expected_revision:0}).success,false);

 for(const [field,value] of [['league','altra-lega'],['season','2025-2026'],['competition_id','999999']]){
  assert.equal(schemaAlpha.safeParse({...observation.body,[field]:value}).success,false,field);
  await assert.rejects(asUser(alphaAdmin,'select fm_import_observations($1::jsonb)',[JSON.stringify([{...observation,body:{...observation.body,[field]:value}}])]),/invalid_scope/,field);
 }
 // The genuinely dangerous case: beta's scope carrying alpha's teams.
 await assert.rejects(asUser(betaAdmin,'select fm_import_observations($1::jsonb)',
  [JSON.stringify([{id:'d'.repeat(64),body:{...betaBody,expected_total:10,teams:observation.body.teams,inserted:observation.body.inserted}}])]),/invalid_scope/);
});

// The preset in lib/league.ts is now just a fixture: if it drifts from the seeded row, the
// domain tests would be measuring a league that does not exist.
test('the TypeScript preset still matches the seeded league row',()=>{
 for(const key of ['id','slug','name','season','competitionId','roundCount','serieAOffset','freeTokens','penaltyAmount','teamCount'])
  assert.deepEqual(cfgAlpha[key],CHEFANTAVITAE10[key],key);
 assert.deepEqual(teamNames(cfgAlpha),teamNames(CHEFANTAVITAE10));
 assert.deepEqual(cfgAlpha.teams.map(t=>t.color),CHEFANTAVITAE10.teams.map(t=>t.color));
 assert.deepEqual(cfgAlpha.periods,CHEFANTAVITAE10.periods);
 assert.deepEqual(cfgAlpha.rules,CHEFANTAVITAE10.rules);
});
test('a member of one league sees none of the other',async()=>{
 await asUser(betaAdmin,'select fm_import_observations($1::jsonb)',[JSON.stringify([betaObservation])]);
 await asUser(betaAdmin,saveReviewSql,[JSON.stringify({team:'Beta 1',round:1,status:'missed',deadline:'2025-09-01T00:00:00Z',
  note:'Log della formazione verificato.',source_url:'https://leghe.fantacalcio.it/beta-league/view/competition/999001/manage-lineups/1'}),0,BETA]);
 for(const [table,column] of [['fm_observations','league_id'],['fm_lineup_reviews','league_id'],['fm_source_events','league_id'],
  ['fm_round_schedule','league_id'],['fm_auto_sync_runs','league_id'],['fm_league_teams','league_id'],['fm_leagues','id']]){
  const alphaRows=(await asUser(alphaViewer,`select count(*)::int as n from ${table} where ${column}<>$1`,[ALPHA])).rows[0].n;
  const betaRows=(await asUser(betaViewer,`select count(*)::int as n from ${table} where ${column}<>$1`,[BETA])).rows[0].n;
  assert.equal(alphaRows,0,`${table} leaked into alpha`);
  assert.equal(betaRows,0,`${table} leaked into beta`);
 }
 assert.equal((await asUser(betaViewer,'select count(*)::int as n from fm_observations')).rows[0].n,1);
 assert.equal((await asUser(alphaViewer,'select count(*)::int as n from fm_observations')).rows[0].n,1);
 assert.equal((await asUser(stranger,'select count(*)::int as n from fm_leagues')).rows[0].n,0);
 // A membership row of another league is not readable either.
 assert.equal((await asUser(alphaViewer,'select count(*)::int as n from fm_memberships')).rows[0].n,1);
 // An admin sees the roster of the league it administers.
 assert.equal((await asUser(alphaAdmin,'select count(*)::int as n from fm_memberships')).rows[0].n,3);
});
test('an admin of one league cannot write into another',async()=>{
 const before=(await db.query('select count(*)::int as n from fm_observations where league_id=$1',[ALPHA])).rows[0].n;
 await assert.rejects(asUser(betaAdmin,'select fm_import_observations($1::jsonb)',[JSON.stringify([observation])]),/admin_required/);
 assert.equal((await db.query('select count(*)::int as n from fm_observations where league_id=$1',[ALPHA])).rows[0].n,before);
 await assert.rejects(asUser(betaAdmin,saveReviewSql,[JSON.stringify(review),0,ALPHA]),/admin_required/);
 await assert.rejects(asUser(stranger,'select fm_import_observations($1::jsonb)',[JSON.stringify([observation])]),/admin_required/);
 // The case fm_members.role made inexpressible: admin here, viewer there.
 await assert.rejects(asUser(bothUser,'select fm_import_observations($1::jsonb)',[JSON.stringify([betaObservation])]),/admin_required/);
 assert.equal((await asUser(bothUser,'select count(*)::int as n from fm_observations')).rows[0].n,2);
 assert.deepEqual((await asUser(bothUser,saveReviewSql,[JSON.stringify({...review,status:'unverified',note:'Sospeso in attesa di verifica.'}),2,ALPHA])).rows[0].fm_save_review,{saved:true,duplicate:false});
});
test('two leagues can hold the same round at the same instant',async()=>{
 const stamp='2025-09-02T00:00:00.000Z';
 await asUser(alphaAdmin,'select fm_import_observations($1::jsonb)',[JSON.stringify([{id:'e'.repeat(64),body:{...observation.body,observed_at:stamp}}])]);
 await asUser(betaAdmin,'select fm_import_observations($1::jsonb)',[JSON.stringify([{id:'f'.repeat(64),body:{...betaBody,observed_at:stamp}}])]);
 assert.equal((await db.query('select count(*)::int as n from fm_observations where observed_at=$1 and round=1',[stamp])).rows[0].n,2);
 // The schedule and its runs are keyed per league too.
 await db.query(`insert into fm_round_schedule(league_id,round,serie_a_round,start_at) select $1,r,r,now() from generate_series(1,30) r`,[BETA]);
 for(const league of [ALPHA,BETA])await db.query(`insert into fm_auto_sync_runs(league_id,round,checkpoint,scheduled_at,status) values($1,1,'T-1h',now(),'success')`,[league]);
 assert.equal((await db.query("select count(*)::int as n from fm_auto_sync_runs where round=1 and checkpoint='T-1h'")).rows[0].n,2);
 await assert.rejects(db.query(`insert into fm_auto_sync_runs(league_id,round,checkpoint,scheduled_at,status) values($1,1,'T-1h',now(),'success')`,[ALPHA]),/duplicate key/);
 // A run cannot attach itself to another league's schedule.
 await assert.rejects(db.query(`insert into fm_auto_sync_runs(league_id,round,checkpoint,scheduled_at,status) values($1,99,'T-1h',now(),'success')`,[ALPHA]),/fm_auto_sync_runs_schedule_fkey|violates foreign key/);
});
test('the single-league bridge refuses to guess while two leagues are active',async()=>{
 await assert.rejects(asUser(alphaAdmin,'select fm_save_review($1::jsonb,0)',[JSON.stringify(review)]),/league_required/);
 await db.query('update fm_leagues set active=false where id=$1',[BETA]);
 try{
  const current=(await db.query("select coalesce(max(revision),0)::int as n from fm_lineup_reviews where league_id=$1 and team='Real Hasbulla' and round=1",[ALPHA])).rows[0].n;
  // With one active league the bridge resolves it and the write lands in that league.
  assert.deepEqual((await asUser(alphaAdmin,'select fm_save_review($1::jsonb,$2::int)',[JSON.stringify({...review,note:'Riverificato sul log della giornata.'}),current])).rows[0].fm_save_review,{saved:true,duplicate:false});
  assert.equal((await db.query('select count(*)::int as n from fm_lineup_reviews where league_id=$1 and revision=$2',[ALPHA,current+1])).rows[0].n,1);
  await assert.rejects(asUser(alphaAdmin,'select fm_save_review($1::jsonb,0)',[JSON.stringify({...review,note:'Tentativo con revisione superata.'})]),/review_conflict/);
 }finally{ await db.query('update fm_leagues set active=true where id=$1',[BETA]); }
});
const SEALED='v1.'+'a'.repeat(40)+'.'+'b'.repeat(16)+'.'+'c'.repeat(22)+'.'+'d'.repeat(30);
const setCredsSql='select fm_set_league_credentials($1::uuid,$2,$3,$4::int,$5::timestamptz) as result';
const statusSql='select fm_league_credential_status($1::uuid) as status';
// The ban on reading the ciphertext back is enforced by the database, not by the routes:
// there is no policy and no grant, so a badly written route still finds nothing to read.
test('the ciphertext is unreadable to every logged-in user, admins included',async()=>{
 for(const who of [alphaAdmin,alphaViewer,betaAdmin,bothUser])
  await assert.rejects(asUser(who,'select * from fm_league_credentials'),/permission denied/,who);
 await assert.rejects(asUser(alphaAdmin,'select payload from fm_league_credentials where league_id=$1',[ALPHA]),/permission denied/);
 // The connector's read function is out of reach for a user session too.
 await assert.rejects(asUser(alphaAdmin,'select fm_league_credentials_for_bot($1,$2::uuid)',['qualsiasi',ALPHA]),/permission denied/);
 await assert.rejects(db.query('select fm_league_credentials_for_bot($1,$2::uuid)',['chiave-sbagliata',ALPHA]),/unauthorized/);
});
test('only the admin of that league can store its credentials',async()=>{
 await assert.rejects(asUser(alphaViewer,setCredsSql,[ALPHA,'password',SEALED,1,null]),/admin_required/);
 await assert.rejects(asUser(betaAdmin,setCredsSql,[ALPHA,'password',SEALED,1,null]),/admin_required/);
 await assert.rejects(asUser(stranger,setCredsSql,[ALPHA,'password',SEALED,1,null]),/admin_required/);
 // bothUser is a viewer on beta: allowed on alpha, refused on beta.
 await assert.rejects(asUser(bothUser,setCredsSql,[BETA,'password',SEALED,1,null]),/admin_required/);
 assert.deepEqual((await asUser(bothUser,setCredsSql,[ALPHA,'password',SEALED,1,null])).rows[0].result,{saved:true});
});
test('only a well-formed envelope is accepted, and the mode is closed',async()=>{
 await assert.rejects(asUser(alphaAdmin,setCredsSql,[ALPHA,'password','non-una-busta',1,null]),/invalid_credential_payload/);
 await assert.rejects(asUser(alphaAdmin,setCredsSql,[ALPHA,'token',SEALED,1,null]),/invalid_credential_mode/);
});
test('status exposes metadata only, and never to another league',async()=>{
 const status=(await asUser(alphaViewer,statusSql,[ALPHA])).rows[0].status;
 assert.equal(status.configured,true);
 assert.equal(status.hasSession,false);
 for(const key of Object.keys(status))assert.ok(!['payload','sessionState','session_state'].includes(key),key);
 await assert.rejects(asUser(alphaViewer,statusSql,[BETA]),/forbidden/);
 assert.deepEqual((await asUser(betaViewer,statusSql,[BETA])).rows[0].status,{configured:false,hasSession:false});
});
test('storing a session leaves the password alone and resets the verification',async()=>{
 await db.query("update fm_league_credentials set last_verified_at=now(),last_verified_status='ok' where league_id=$1",[ALPHA]);
 const expires='2099-01-01T00:00:00Z';
 assert.deepEqual((await asUser(alphaAdmin,setCredsSql,[ALPHA,'session',SEALED,1,expires])).rows[0].result,{saved:true});
 const status=(await asUser(alphaAdmin,statusSql,[ALPHA])).rows[0].status;
 assert.equal(status.configured,true,'la password resta');
 assert.equal(status.hasSession,true);
 // A new secret invalidates whatever the previous one was verified as.
 assert.equal(status.lastVerifiedAt,null);
 assert.equal(status.lastVerifiedStatus,null);
});

test('the real authorization gate rejects anything but the Railway key',()=>{
 assert.equal(realAuthRejectsWrongKey,false);
 assert.equal(realAuthRejectsEmpty,false);
});
test('the connector directory lists active leagues with their rosters',async()=>{
 const listed=(await bot('select fm_leagues_for_bot($1) as l',[BOT_KEY])).rows[0].l;
 assert.equal(listed.length,2);
 const alpha=listed.find(l=>l.slug==='chefantavitae10'),beta=listed.find(l=>l.slug==='beta-league');
 assert.equal(alpha.competitionId,'337500');
 assert.equal(alpha.roundCount,35);
 assert.deepEqual(alpha.teams,teamNames(cfgAlpha),'le squadre arrivano in ordine di posizione');
 assert.equal(beta.teams.length,8);
 assert.equal(beta.roundCount,30);
 await assert.rejects(bot('select fm_leagues_for_bot($1)',['chiave-sbagliata']),/unauthorized/);
 // A deactivated league disappears from the directory: the connector stops serving it.
 await db.query('update fm_leagues set active=false where id=$1',[BETA]);
 assert.equal((await bot('select fm_leagues_for_bot($1) as l',[BOT_KEY])).rows[0].l.length,1);
 await db.query('update fm_leagues set active=true where id=$1',[BETA]);
});
test('two leagues are claimed independently and never twice',async()=>{
 // Deterministic schedule: the T-1h checkpoint of each league is due right now.
 await db.query('update fm_round_schedule set start_at=null');
 await db.query("update fm_leagues set auto_sync_enabled=true where id=$1",[BETA]);
 for(const league of [ALPHA,BETA])
  await db.query("update fm_round_schedule set start_at=now()+interval '1 hour' where league_id=$1 and round=5",[league]);
 const first=(await bot('select fm_claim_due_auto_sync($1) as c',[BOT_KEY])).rows[0].c;
 const second=(await bot('select fm_claim_due_auto_sync($1) as c',[BOT_KEY])).rows[0].c;
 const third=(await bot('select fm_claim_due_auto_sync($1) as c',[BOT_KEY])).rows[0].c;
 assert.ok(first&&second,'entrambe le leghe devono essere reclamabili');
 assert.equal(third,null,'niente da reclamare una terza volta');
 assert.notEqual(first.league_id,second.league_id,'un claim su una lega non blocca l’altra');
 for(const claim of [first,second]){assert.equal(claim.round,5);assert.equal(claim.checkpoint,'T-1h');}
 assert.equal((await db.query("select count(*)::int as n from fm_auto_sync_runs where round=5 and checkpoint='T-1h'")).rows[0].n,2);
 // A league with auto-sync switched off is never scheduled.
 await db.query('delete from fm_auto_sync_runs where round=5');
 await db.query('update fm_leagues set auto_sync_enabled=false where id=$1',[BETA]);
 const onlyAlpha=(await bot('select fm_claim_due_auto_sync($1) as c',[BOT_KEY])).rows[0].c;
 assert.equal(onlyAlpha.league_id,ALPHA);
 assert.equal((await bot('select fm_claim_due_auto_sync($1) as c',[BOT_KEY])).rows[0].c,null);
 await db.query('update fm_leagues set auto_sync_enabled=true where id=$1',[BETA]);
});
test('completing a checkpoint writes into the league the body names',async()=>{
 await db.query('delete from fm_auto_sync_runs where round=5');
 const claim=(await bot('select fm_claim_due_auto_sync($1) as c',[BOT_KEY])).rows[0].c;
 assert.ok(claim);
 const stamp=new Date().toISOString();
 const foreign=claim.league_id===ALPHA?betaBodyAt(5,stamp):alphaBody(5,stamp);
 // Another league's body finds no claim: the scope is the body itself.
 await assert.rejects(bot('select fm_complete_auto_sync($1,5,$2,$3::jsonb)',[BOT_KEY,claim.checkpoint,JSON.stringify(foreign)]),/claim_required/);
 const body=bodyForLeague(claim.league_id,5,stamp);
 const result=(await bot('select fm_complete_auto_sync($1,5,$2,$3::jsonb) as r',[BOT_KEY,claim.checkpoint,JSON.stringify(body)])).rows[0].r;
 assert.deepEqual(result,{ok:true,inserted:1});
 const stored=(await db.query('select league_id,round from fm_observations where observed_at=$1',[stamp])).rows;
 assert.equal(stored.length,1);
 assert.equal(stored[0].league_id,claim.league_id);
 const run=(await db.query("select status,observation_id from fm_auto_sync_runs where league_id=$1 and round=5 and checkpoint=$2",[claim.league_id,claim.checkpoint])).rows[0];
 assert.equal(run.status,'success');
 assert.ok(run.observation_id);
 // A body outside the time window does not get through.
 await db.query('delete from fm_auto_sync_runs where round=5');
 const stale=(await bot('select fm_claim_due_auto_sync($1) as c',[BOT_KEY])).rows[0].c;
 const old=new Date(Date.now()-30*60*1000).toISOString();
 await assert.rejects(bot('select fm_complete_auto_sync($1,5,$2,$3::jsonb)',[BOT_KEY,stale.checkpoint,JSON.stringify(bodyForLeague(stale.league_id,5,old))]),/invalid_snapshot_time/);
});
test('a failed checkpoint is recorded and retried, then given up',async()=>{
 await db.query('delete from fm_auto_sync_runs where round=5');
 await db.query('update fm_leagues set auto_sync_enabled=false where id=$1',[BETA]);
 for(let attempt=1;attempt<=3;attempt++){
  const claim=(await bot('select fm_claim_due_auto_sync($1) as c',[BOT_KEY])).rows[0].c;
  assert.ok(claim,`tentativo ${attempt} reclamabile`);
  await bot('select fm_fail_auto_sync($1,$2::uuid,5,$3,$4)',[BOT_KEY,claim.league_id,claim.checkpoint,`errore ${attempt}`]);
  const run=(await db.query("select status,attempt_count,error from fm_auto_sync_runs where league_id=$1 and round=5",[ALPHA])).rows[0];
  assert.equal(run.status,'failed');
  assert.equal(run.attempt_count,attempt);
  assert.equal(run.error,`errore ${attempt}`);
 }
 // After three attempts the checkpoint is no longer picked up: no infinite retry loop.
 assert.equal((await bot('select fm_claim_due_auto_sync($1) as c',[BOT_KEY])).rows[0].c,null);
 // The four-argument bridge, still used by the old connector, must never leave a run in
 // 'running': that would be unrecoverable, since the claim only picks up 'failed' ones.
 await db.query('delete from fm_auto_sync_runs where round=5');
 const stuck=(await bot('select fm_claim_due_auto_sync($1) as c',[BOT_KEY])).rows[0].c;
 await bot('select fm_fail_auto_sync($1,5,$2,$3)',[BOT_KEY,stuck.checkpoint,'vecchio connettore']);
 assert.equal((await db.query("select status from fm_auto_sync_runs where league_id=$1 and round=5",[ALPHA])).rows[0].status,'failed');
 await db.query('update fm_leagues set auto_sync_enabled=true where id=$1',[BETA]);
});
test('the bot importer derives its league from the body, like the admin one',async()=>{
 const stamp=new Date().toISOString();
 const result=(await bot('select fm_bot_import_snapshot($1,$2::jsonb) as r',[BOT_KEY,JSON.stringify(betaBodyAt(9,stamp))])).rows[0].r;
 assert.equal(result.ok,true);
 assert.equal(result.inserted,1);
 assert.equal((await db.query('select league_id from fm_observations where round=9 and observed_at=$1',[stamp])).rows[0].league_id,BETA);
 // Idempotent: the same body does not duplicate.
 assert.equal((await bot('select fm_bot_import_snapshot($1,$2::jsonb) as r',[BOT_KEY,JSON.stringify(betaBodyAt(9,stamp))])).rows[0].r.inserted,0);
 // A slug that resolves to no active league gets in nowhere.
 await assert.rejects(bot('select fm_bot_import_snapshot($1,$2::jsonb)',[BOT_KEY,JSON.stringify({...betaBodyAt(9,stamp),league:'lega-fantasma'})]),/invalid_snapshot/);
 // Round 31 does not exist for beta, even though it does for alpha.
 await assert.rejects(bot('select fm_bot_import_snapshot($1,$2::jsonb)',[BOT_KEY,JSON.stringify(betaBodyAt(31,stamp))]),/invalid_snapshot_time/);
});
// PostgREST risolve le funzioni per NOME degli argomenti: una chiamata con un argomento
// che la firma non ha fallisce con PGRST202 a runtime, e nessun test sul solo SQL o sul
// solo connettore se ne accorge. È successo davvero, ed è ciò che questo test presidia.
test('every RPC the connector calls exists with exactly those argument names',async()=>{
 const sources=await Promise.all(['../connector/server.mjs','../connector/lib/telegram.mjs','../connector/lib/leagues.mjs','../connector/lib/capture.mjs']
  .map(f=>readFile(new URL(f,import.meta.url),'utf8')));
 const calls=new Map();
 for(const src of sources){
  for(const m of src.matchAll(/rpc\('(fm_[a-z_]+)',\s*withKey\(\{/g)){
   // Scansione con contatore di profondità: gli argomenti contengono graffe annidate
   // (Object.fromEntries(...)), che una regex non sa chiudere.
   let i=m.index+m[0].length,depth=0,buf='';
   for(;i<src.length;i++){
    const c=src[i];
    if(c==='{'||c==='('||c==='[')depth++;
    else if(c==='}'&&depth===0)break;
    else if(c==='}'||c===')'||c===']')depth--;
    buf+=c;
   }
   const args=['access_key'];
   let key='',d=0;
   for(const c of buf+','){
    if(c==='{'||c==='('||c==='[')d++;
    else if(c==='}'||c===')'||c===']')d--;
    if(c===','&&d===0){const name=key.split(':')[0].trim();if(name)args.push(name);key='';}
    else key+=c;
   }
   calls.set(m[1]+'|'+args.sort().join(','),{name:m[1],args:args.sort()});
  }
 }
 assert.ok(calls.size>=8,`trovate solo ${calls.size} chiamate: la regex non sta leggendo il connettore`);
 for(const {name,args} of calls.values()){
  const rows=(await db.query(`select pg_get_function_identity_arguments(p.oid) as sig
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`,[name])).rows;
  assert.ok(rows.length,`${name} non esiste in nessuna migrazione`);
  const shapes=rows.map(r=>r.sig.split(',').map(a=>a.trim().split(' ')[0]).sort().join(','));
  assert.ok(shapes.includes(args.join(',')),
   `${name}(${args.join(',')}) non corrisponde a nessuna firma: ${shapes.map(x=>'('+x+')').join(' ')}`);
 }
});
test('the bot RPCs are scoped by the league they are given',async()=>{
 await assert.rejects(bot('select fm_current_round_for_bot($1,null::uuid)',[BOT_KEY]),/league_required/);
 await assert.rejects(bot('select fm_get_telegram_message($1,null::uuid,5)',[BOT_KEY]),/league_required/);
 assert.equal((await bot('select fm_current_round_for_bot($1,$2::uuid) as r',[BOT_KEY,ALPHA])).rows[0].r,5);
 assert.equal((await bot('select fm_next_round_for_bot($1,$2::uuid) as r',[BOT_KEY,ALPHA])).rows[0].r.round,5);
 // Beta ha il proprio calendario: la stessa chiamata deve dare una risposta diversa.
 await db.query("update fm_round_schedule set start_at=null where league_id=$1",[BETA]);
 await db.query("update fm_round_schedule set start_at=now()+interval '2 hours' where league_id=$1 and round=7",[BETA]);
 assert.equal((await bot('select fm_current_round_for_bot($1,$2::uuid) as r',[BOT_KEY,BETA])).rows[0].r,7);
 // I messaggi Telegram non si mescolano fra leghe.
 await bot("select fm_upsert_telegram_message($1,$2::uuid,5,'-100alpha',11,'T-1h')",[BOT_KEY,ALPHA]);
 await bot("select fm_upsert_telegram_message($1,$2::uuid,5,'-100beta',22,'T-1h')",[BOT_KEY,BETA]);
 assert.equal((await bot('select fm_get_telegram_message($1,$2::uuid,5) as m',[BOT_KEY,ALPHA])).rows[0].m.message_id,11);
 assert.equal((await bot('select fm_get_telegram_message($1,$2::uuid,5) as m',[BOT_KEY,BETA])).rows[0].m.message_id,22);
 assert.equal((await db.query('select count(*)::int as n from fm_telegram_messages where round=5')).rows[0].n,2);
 // Una giornata fuori dal calendario della lega non è accettata.
 await assert.rejects(bot("select fm_upsert_telegram_message($1,$2::uuid,31,'-100beta',22,'T-1h')",[BOT_KEY,BETA]),/invalid_telegram_state/);
});
test('the connector can store a session and team ids for one league only',async()=>{
 const SEALED2='v1.'+'z'.repeat(40)+'.'+'y'.repeat(16)+'.'+'x'.repeat(22)+'.'+'w'.repeat(30);
 await bot('select fm_store_league_session($1,$2::uuid,$3,$4::timestamptz)',[BOT_KEY,BETA,SEALED2,'2099-01-01T00:00:00Z']);
 const record=(await bot('select fm_league_credentials_for_bot($1,$2::uuid) as c',[BOT_KEY,BETA])).rows[0].c;
 assert.equal(record.sessionState,SEALED2);
 assert.equal(record.payload,null,'beta non ha mai collegato una password');
 await assert.rejects(bot('select fm_store_league_session($1,$2::uuid,$3,null)',[BOT_KEY,BETA,'non-una-busta']),/invalid_credential_payload/);
 await bot('select fm_record_credential_check($1,$2::uuid,$3)',[BOT_KEY,BETA,'auth_failed']);
 assert.equal((await asUser(betaViewer,statusSql,[BETA])).rows[0].status.lastVerifiedStatus,'auth_failed');
 await assert.rejects(bot('select fm_record_credential_check($1,$2::uuid,$3)',[BOT_KEY,BETA,'boh']),/invalid_credential_outcome/);
 // Team ids are written only into the named league, even for identical names.
 await bot('select fm_store_league_team_ids($1,$2::uuid,$3::jsonb)',[BOT_KEY,BETA,JSON.stringify({'Beta 1':555,'Beta 2':556})]);
 const ids=(await db.query('select name,fantacalcio_team_id from fm_league_teams where league_id=$1 order by position',[BETA])).rows;
 assert.equal(ids[0].fantacalcio_team_id,555);
 assert.equal((await db.query('select count(*)::int as n from fm_league_teams where fantacalcio_team_id is not null and league_id=$1',[ALPHA])).rows[0].n,0);
});
after(async()=>{await db.close();});
