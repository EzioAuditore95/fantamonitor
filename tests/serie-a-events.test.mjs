import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkAgainstSeason,checkSubstitution,identifyCodes,loadFixtures,observations,weighCodes} from '../scripts/calibrate-live.mjs';
import {ASSIST_CODES,CLASSIC_BONUS,DID_NOT_PLAY,EVENT,NO_VOTE,UNNAMED_CODES,fantasyGrade,readGrade,roundIsFinal} from '../lib/serie-a-events.ts';

// The calibration is re-run here, not recorded: the fixtures are the two public sources as they
// were served, and `lib/serie-a-events.ts` has to keep falling out of them.
const {rounds,season}=await loadFixtures();
const obs=observations(rounds);
const {resolved,ambiguous,unobserved,seen}=identifyCodes(obs);
const {weights}=weighCodes(obs);

test('the fixtures still carry a sample worth calibrating on',()=>{
 assert.ok(rounds.length>=5,`only ${rounds.length} rounds of fixtures`);
 assert.ok(obs.length>1000,`only ${obs.length} graded player-rounds`);
 assert.ok(Object.keys(season).length>400);
});

test('every bonus column of the votes page resolves to the codes the table claims',()=>{
 assert.deepEqual(resolved,{
  'Gol segnati':[EVENT.goal],'Gol subiti':[EVENT.concededGoal],'Autoreti':[EVENT.ownGoal],
  'Rigori segnati':[EVENT.penaltyScored],'Rigori sbagliati':[EVENT.penaltyMissed],
  'Rigori parati':[EVENT.penaltySaved],'Assist':[...ASSIST_CODES],
  'Player of the match':[EVENT.manOfTheMatch],
 });
 assert.deepEqual(ambiguous,{},'a column stopped being explained by a single set of codes');
 assert.deepEqual(unobserved,[],'a column never fired: its code is no longer proven');
});

test('the weights derived from the published fantavoto are the ones the app scores with',()=>{
 for(const code of seen)assert.equal(weights.get(code),CLASSIC_BONUS[code],`weight of code ${code}`);
 // Every code the feed shows has a weight, so an unlisted code means the feed grew a new event.
 assert.deepEqual(seen,Object.keys(CLASSIC_BONUS).map(Number).sort((a,b)=>a-b));
 // The codes we could not name are exactly the ones no column answers for and no score uses:
 // the day one of them starts moving a fantavoto, this fails instead of quietly mis-scoring.
 const named=new Set(Object.values(resolved).flat());
 for(const code of UNNAMED_CODES){assert.equal(weights.get(code),0,`code ${code}`);assert.ok(!named.has(code));}
});

test('the table reproduces the fantavoto the site publishes',()=>{
 const wrong=obs.filter(o=>fantasyGrade({kind:'graded',value:o.grade},o.codes)!==o.fantaGrade);
 // One known exception over five rounds: in round 3 the feed keeps a booking for Piccoli that
 // the editorial votes dropped. The feed is live data, the page is the final word, and the two
 // disagree about one event in roughly a thousand. Ingestion must survive that, not deny it.
 assert.ok(wrong.length/obs.length<=0.001,`${wrong.length}/${obs.length} fantasy grades disagree: ${wrong.slice(0,5).map(o=>`${o.name} r${o.round}`).join(', ')}`);
});

test('cards are confirmed by the season totals, which have no per-round column',()=>{
 const yellow=checkAgainstSeason(rounds,season,EVENT.yellowCard,'yellow');
 const red=checkAgainstSeason(rounds,season,EVENT.redCard,'red');
 assert.ok(yellow.checked>400&&red.checked>400);
 assert.ok(yellow.agree/yellow.checked>=0.995,`yellow cards agree only ${yellow.agree}/${yellow.checked}`);
 assert.equal(red.agree,red.checked,`red cards disagree: ${JSON.stringify(red.disagree)}`);
});

test('players left without a vote are the ones who came on',()=>{
 const {players,withIn,withOut}=checkSubstitution(rounds,EVENT.subbedIn,EVENT.subbedOut);
 assert.ok(players>100);
 assert.ok(withIn/players>=0.97,`only ${withIn}/${players} carry the "substituted in" code`);
 // A handful started and went off early enough to stay unrated: that is the only way round.
 assert.ok(withOut/players<=0.05);
});

test('sentinels are read as states, never as grades',()=>{
 assert.deepEqual(readGrade(NO_VOTE),{kind:'no_vote'});
 assert.deepEqual(readGrade(DID_NOT_PLAY),{kind:'did_not_play'});
 assert.deepEqual(readGrade('5,5'),{kind:'graded',value:5.5});
 assert.equal(readGrade(''),null);
 assert.equal(fantasyGrade(readGrade(NO_VOTE),[EVENT.yellowCard]),null);
 assert.equal(fantasyGrade(readGrade(6),[EVENT.goal,EVENT.yellowCard]),8.5);
});

test('a round is final only when every one of its matches is over',()=>{
 const matches=round=>rounds.find(r=>r.round===round).live.data.inc;
 assert.equal(roundIsFinal(matches(1)),true);
 assert.equal(roundIsFinal(matches(5)),false,'round 5 was captured while it was still being played');
 assert.equal(roundIsFinal([]),false);
});
