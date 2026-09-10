import {test} from 'node:test';
import assert from 'node:assert/strict';
import {halfForRound,serieARound,teamBalance,balances,reviewInputSchema} from '../lib/penalties.ts';
const team='Real Hasbulla';
const make=(round,status='missed',revision=1)=>({id:`${round}-${revision}`,team,round,status,revision,deadline:'2025-09-01T12:00:00Z',note:'Log della formazione verificato.',source_url:`https://leghe.fantacalcio.it/chefantavitae10/view/competition/337500/manage-lineups/${round}`,recorded_at:'2025-09-02T12:00:00Z'});
test('split Serie A: league round 16 = A19, round 17 = A20',()=>{
 assert.equal(halfForRound(16),'andata');assert.equal(halfForRound(17),'ritorno');assert.equal(serieARound(16),19);assert.equal(serieARound(17),20);assert.equal(serieARound(35),38);assert.throws(()=>halfForRound(36));
});
test('first omission consumes a token but is free; each later omission costs 5',()=>{
 assert.equal(teamBalance(team,'andata',[]).remaining,1);
 for(let n=1;n<=4;n++){const b=teamBalance(team,'andata',Array.from({length:n},(_,i)=>make(i+1)));assert.equal(b.remaining,0);assert.equal(b.penalty,(n-1)*5);}
});
test('tokens reset at return half and cannot be pooled',()=>{
 const r=balances([team],'complessivo',[make(15),make(16),make(17),make(18)])[0];
 assert.equal(r.penalty,10);assert.equal(r.andata.penalty,5);assert.equal(r.ritorno.penalty,5);assert.equal(r.used,2);
 const onlyReturn=balances([team],'complessivo',[make(17),make(18)])[0];assert.equal(onlyReturn.penalty,5);assert.equal(onlyReturn.andata.remaining,1);
});
test('unknown and delivered outcomes do not spend tokens',()=>{
 const b=teamBalance(team,'andata',[make(1,'unverified'),make(2,'delivered')]);assert.equal(b.penalty,0);assert.equal(b.remaining,1);assert.equal(b.verified,1);assert.equal(b.total,16);
});
test('repeated records and revisions never duplicate omissions',()=>{
 const a=make(1);const b=teamBalance(team,'andata',[a,a,{...a,revision:2,id:'new'}]);assert.equal(b.missed,1);assert.equal(b.penalty,0);
});
test('correction delivered or unverified recalculates subsequent charges',()=>{
 for(const status of ['delivered','unverified']){const b=teamBalance(team,'andata',[make(1),make(2),make(1,status,2)]);assert.equal(b.missed,1);assert.equal(b.penalty,0);assert.equal(b.entries[0].round,2);assert.equal(b.entries[0].token,true);}
});
test('late historical entry consumes the token chronologically, not by import time',()=>{
 const b=teamBalance(team,'andata',[make(8),make(3),make(6)]);assert.deepEqual(b.entries.map(e=>[e.round,e.charge]),[[3,0],[6,5],[8,5]]);
});
test('team balances are independent',()=>{
 const b=teamBalance(team,'andata',[{...make(1),team:'Salamandre'},make(2)]);assert.equal(b.missed,1);assert.equal(b.penalty,0);
});
test('unverified absence observations alone are never accounting evidence',()=>{
 // Raw snapshot count is intentionally absent from the accounting contract.
 assert.equal(balances([team],'andata',[])[0].missed,0);
});
test('definitive outcomes require a past deadline and a league round source',()=>{
 const {id,revision,recorded_at,...body}=make(1);const input={...body,expected_revision:0};assert.equal(reviewInputSchema.safeParse(input).success,true);
 for(const deadline of [null,'2099-01-01T00:00:00Z'])assert.equal(reviewInputSchema.safeParse({...input,deadline}).success,false);
 assert.equal(reviewInputSchema.safeParse({...input,source_url:make(2).source_url}).success,false);
 assert.equal(reviewInputSchema.safeParse({...input,source_url:'https://example.com'}).success,false);
 assert.equal(reviewInputSchema.safeParse({...input,status:'unverified',deadline:null}).success,true);
});
