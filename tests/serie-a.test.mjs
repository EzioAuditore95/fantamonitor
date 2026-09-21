import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {currentSourceSeason,monitoredRound,parseLiveRound,pendingRounds,roundHasStarted,sourceSeason} from '../lib/serie-a.ts';

const fixture=async round=>JSON.parse(await readFile(new URL(`./fixtures/serie-a/live-${round}.json`,import.meta.url),'utf8'));
const first=await fixture(1),fifth=await fixture(5);
const round1=parseLiveRound(first,'2026-27',1),round5=parseLiveRound(fifth,'2026-27',5);
const states=payload=>payload.grades.reduce((tally,g)=>({...tally,[g.state]:(tally[g.state]??0)+1}),{});

test('a finished round is read whole',()=>{
 assert.equal(round1.final,true);
 assert.equal(round1.matches.length,10);
 assert.equal(round1.teams.length,20,'each club named once, read off two sides of ten matches');
 assert.equal(round1.players.length,first.data.pl.length,'every match is over, so nobody is withheld');
 assert.deepEqual(states(round1),{graded:293,no_vote:26,did_not_play:230});
 assert.equal(round1.grades.length,round1.players.length);
});

test('kick-off times are UTC without saying so',()=>{
 const saturday=round1.matches.find(m=>m.kickoff==='2026-08-22T16:30:00Z');
 assert.ok(saturday,'the feed prints 16:30 with no zone');
 // The whole conversion is that Z, and it is worth a test: read as local time this becomes a
 // 16:30 Italian kick-off, and every deadline computed from it would be two hours early.
 assert.equal(new Date(saturday.kickoff).toLocaleString('it-IT',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit'}),'18:30');
 assert.ok(round1.matches.every(m=>m.kickoff?.endsWith('Z')));
});

test('a round still being played says nothing about the matches that have not started',()=>{
 assert.equal(round5.final,false);
 assert.ok(fifth.data.pl.length>round5.players.length,'some players are withheld');
 assert.equal(round5.players.length,554);
 assert.ok(round5.grades.every(g=>g.status!==0),'nobody is recorded as absent before his match kicks off');
 assert.ok(round5.matches.some(m=>m.status===0),'the match itself is still recorded, with its state');
});

test('a grade carries its events, its minutes and what the columns do not model',()=>{
 const skorupski=round5.grades.find(g=>g.player_id===133);
 assert.equal(skorupski.state,'graded');
 assert.equal(skorupski.grade,5);
 assert.deepEqual(skorupski.events,[4]);
 assert.deepEqual(skorupski.minutes,[77]);
 assert.equal(skorupski.presence_odds,100);
 assert.deepEqual(Object.keys(skorupski.raw).sort(),['i','id_sos','sp','t']);
 const player=round5.players.find(p=>p.id===133);
 assert.deepEqual(player,{id:133,name:'Skorupski',role:'P',team_id:2});
});

test('the feed may grow fields, but not lose the ones we read',()=>{
 // Deliberately not .strict(): a field they add one Saturday must not stop the season.
 const grown={data:{pl:[{...first.data.pl[0],nuovoCampo:'x'}],inc:[{...first.data.inc[0],altro:1}]}};
 assert.equal(parseLiveRound(grown,'2026-27',1).grades.length,1);
 assert.throws(()=>parseLiveRound({data:{pl:[{id:'x'}],inc:[]}},'2026-27',1));
 assert.throws(()=>parseLiveRound({},'2026-27',1));
});

test('a round whose fixtures are out but nobody has played is not an error',async()=>{
 // Round 6 as the feed served it on 21/09: ten matches dated in October, zero players. Asking
 // the database to store it raised invalid_grades and took a whole import run down with it.
 const future=parseLiveRound(await fixture(6),'2026-27',6);
 assert.equal(future.matches.length,10);
 assert.deepEqual(future.grades,[]);
 assert.equal(future.final,false);
 assert.equal(roundHasStarted(future),false);
 assert.equal(roundHasStarted(round1),true);
});

test('the two season vocabularies are translated, never mixed',()=>{
 assert.equal(sourceSeason('2026-2027'),'2026-27');
 assert.equal(sourceSeason('2026-27'),'2026-27');
 assert.throws(()=>sourceSeason('2026'));
});

test('the scheduled run reads the season off the calendar, having no league to ask',()=>{
 // July is the border: a Serie A season opens in August and closes in May.
 assert.equal(currentSourceSeason(new Date('2026-09-21T06:00:00Z')),'2026-27');
 assert.equal(currentSourceSeason(new Date('2027-05-30T06:00:00Z')),'2026-27');
 assert.equal(currentSourceSeason(new Date('2027-07-01T06:00:00Z')),'2027-28');
 assert.equal(currentSourceSeason(new Date('2029-08-10T06:00:00Z')),'2029-30');
 // The turn of the century keeps two digits rather than becoming '2099-100'.
 assert.equal(currentSourceSeason(new Date('2099-08-10T06:00:00Z')),'2099-00');
 assert.equal(sourceSeason(currentSourceSeason(new Date('2026-09-21T06:00:00Z'))),'2026-27');
});
test('a settled round is never asked for again, a live one is',()=>{
 assert.deepEqual(pendingRounds([{round:1,final:true},{round:2,final:false}],5),[2,3,4,5]);
 assert.deepEqual(pendingRounds([],3),[1,2,3]);
 assert.deepEqual(pendingRounds([{round:1,final:true},{round:2,final:true}],2),[]);
});

test('il monitor si apre sulla prima giornata non ancora conclusa',()=>{
 // Giornata di lega + 3 = giornata di Serie A, come nella lega reale.
 const cfg={serieAOffset:3,roundCount:35};
 const upTo=(serieARound,final=true)=>Array.from({length:serieARound},(_,i)=>({round:i+1,final:final||i+1<serieARound}));
 // 1) la giornata 2 è finita → si apre sulla 3
 assert.equal(monitoredRound(cfg,upTo(5)),3);
 // 2) la giornata 3 è in corso → resta la 3
 assert.equal(monitoredRound(cfg,[...upTo(5),{round:6,final:false}]),3);
 // 3) la giornata 3 si è conclusa → si apre sulla 4
 assert.equal(monitoredRound(cfg,upTo(6)),4);
 // Nessun dato di campionato: si usa il ripiego che arriva dall'archivio.
 assert.equal(monitoredRound(cfg,[],2),2);
 assert.equal(monitoredRound(cfg,[]),1);
 // Un ripiego fuori scala non porta il monitor su una giornata che non esiste.
 assert.equal(monitoredRound(cfg,[],99),35);
 assert.equal(monitoredRound(cfg,[],0),1);
 // Stagione finita: si resta sull'ultima.
 assert.equal(monitoredRound(cfg,upTo(38)),35);
 // Una lega senza scarto legge la giornata di Serie A come la propria.
 assert.equal(monitoredRound({serieAOffset:0,roundCount:38},upTo(2)),3);
});
