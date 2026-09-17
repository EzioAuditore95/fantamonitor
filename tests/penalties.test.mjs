import {test} from 'node:test';
import assert from 'node:assert/strict';
import {serieARound,teamBalance,balances,reviewInputSchema} from '../lib/penalties.ts';
import {AGGREGATE_PERIOD,CHEFANTAVITAE10,makeLeagueConfig,periodForRound} from '../lib/league.ts';
const cfg=CHEFANTAVITAE10;
const team='Real Hasbulla';
const make=(round,status='missed',revision=1)=>({id:`${round}-${revision}`,team,round,status,revision,deadline:'2025-09-01T12:00:00Z',note:'Log della formazione verificato.',source_url:`https://leghe.fantacalcio.it/chefantavitae10/view/competition/337500/manage-lineups/${round}`,recorded_at:'2025-09-02T12:00:00Z'});
test('split Serie A: league round 16 = A19, round 17 = A20',()=>{
 assert.equal(periodForRound(cfg,16).key,'andata');assert.equal(periodForRound(cfg,17).key,'ritorno');assert.equal(serieARound(cfg,16),19);assert.equal(serieARound(cfg,17),20);assert.equal(serieARound(cfg,35),38);assert.throws(()=>periodForRound(cfg,36));
});
test('first omission consumes a token but is free; each later omission costs 5',()=>{
 assert.equal(teamBalance(cfg,team,'andata',[]).remaining,1);
 for(let n=1;n<=4;n++){const b=teamBalance(cfg,team,'andata',Array.from({length:n},(_,i)=>make(i+1)));assert.equal(b.remaining,0);assert.equal(b.penalty,(n-1)*5);}
});
test('tokens reset at return half and cannot be pooled',()=>{
 const r=balances(cfg,[team],AGGREGATE_PERIOD,[make(15),make(16),make(17),make(18)])[0];
 assert.equal(r.penalty,10);assert.equal(r.periods.andata.penalty,5);assert.equal(r.periods.ritorno.penalty,5);assert.equal(r.used,2);
 const onlyReturn=balances(cfg,[team],AGGREGATE_PERIOD,[make(17),make(18)])[0];assert.equal(onlyReturn.penalty,5);assert.equal(onlyReturn.periods.andata.remaining,1);
});
test('unknown and delivered outcomes do not spend tokens',()=>{
 const b=teamBalance(cfg,team,'andata',[make(1,'unverified'),make(2,'delivered')]);assert.equal(b.penalty,0);assert.equal(b.remaining,1);assert.equal(b.verified,1);assert.equal(b.total,cfg.periods[0].rounds.length);
});
test('repeated records and revisions never duplicate omissions',()=>{
 const a=make(1);const b=teamBalance(cfg,team,'andata',[a,a,{...a,revision:2,id:'new'}]);assert.equal(b.missed,1);assert.equal(b.penalty,0);
});
test('correction delivered or unverified recalculates subsequent charges',()=>{
 for(const status of ['delivered','unverified']){const b=teamBalance(cfg,team,'andata',[make(1),make(2),make(1,status,2)]);assert.equal(b.missed,1);assert.equal(b.penalty,0);assert.equal(b.entries[0].round,2);assert.equal(b.entries[0].token,true);}
});
test('late historical entry consumes the token chronologically, not by import time',()=>{
 const b=teamBalance(cfg,team,'andata',[make(8),make(3),make(6)]);assert.deepEqual(b.entries.map(e=>[e.round,e.charge]),[[3,0],[6,5],[8,5]]);
});
test('team balances are independent',()=>{
 const b=teamBalance(cfg,team,'andata',[{...make(1),team:'Salamandre'},make(2)]);assert.equal(b.missed,1);assert.equal(b.penalty,0);
});
test('unverified absence observations alone are never accounting evidence',()=>{
 // Raw snapshot count is intentionally absent from the accounting contract.
 assert.equal(balances(cfg,[team],'andata',[])[0].missed,0);
});
test('definitive outcomes require a past deadline and a league round source',()=>{
 const {id,revision,recorded_at,...body}=make(1);const input={...body,expected_revision:0};assert.equal(reviewInputSchema.safeParse(input).success,true);
 for(const deadline of [null,'2099-01-01T00:00:00Z'])assert.equal(reviewInputSchema.safeParse({...input,deadline}).success,false);
 assert.equal(reviewInputSchema.safeParse({...input,source_url:make(2).source_url}).success,false);
 assert.equal(reviewInputSchema.safeParse({...input,source_url:'https://example.com'}).success,false);
 assert.equal(reviewInputSchema.safeParse({...input,status:'unverified',deadline:null}).success,true);
});

const beta=makeLeagueConfig({
 id:'11111111-2222-4333-8444-555555555555',slug:'beta-league',name:'Beta',season:'2026-2027',competitionId:'999001',
 teams:Array.from({length:8},(_,i)=>({name:`Beta ${i+1}`,position:i+1,color:''})),
 roundCount:30,serieAOffset:0,periodMode:'season',firstHalfEnd:null,freeTokens:2,penaltyAmount:10,
 rules:{},updatedAt:'2026-09-16T00:00:00.000Z',
});
const betaTeam='Beta 1';
const betaReview=(round)=>({id:`b-${round}`,team:betaTeam,round,status:'missed',revision:1,deadline:'2025-09-01T12:00:00Z',note:'Log della formazione verificato.',source_url:`https://leghe.fantacalcio.it/beta-league/view/competition/999001/manage-lineups/${round}`,recorded_at:'2025-09-02T12:00:00Z'});
test('a league with its own rules charges from its own free-token count',()=>{
 for(let n=0;n<=4;n++){const b=teamBalance(beta,betaTeam,'stagione',Array.from({length:n},(_,i)=>betaReview(i+1)));
  assert.equal(b.penalty,Math.max(0,n-2)*10);assert.equal(b.remaining,Math.max(0,2-n));assert.equal(b.used,Math.min(2,n));}
});
test('a single-period league never resets tokens mid-season',()=>{
 assert.equal(beta.periods.length,1);assert.equal(periodForRound(beta,30).key,'stagione');
 const r=balances(beta,[betaTeam],AGGREGATE_PERIOD,[betaReview(1),betaReview(20),betaReview(29)])[0];
 assert.equal(r.penalty,10);assert.equal(r.total,30);assert.equal(r.periods.stagione.remaining,0);
});
test('the Serie A offset and round count follow the league, not a constant',()=>{
 assert.equal(serieARound(beta,1),1);assert.equal(serieARound(beta,30),30);
 assert.throws(()=>periodForRound(beta,31));assert.throws(()=>periodForRound(beta,0));
 assert.equal(periodForRound(cfg,31).key,'ritorno');
});
