import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseLiveRound} from '../lib/serie-a.ts';
import {seasonPerformance,teamRound} from '../lib/lineup-performance.ts';
import {CLASSIC_SCORING} from '../lib/player-performance.ts';
import {CHEFANTAVITAE10,makeLeagueConfig} from '../lib/league.ts';

// Real grades, invented lineups: the players are public Serie A data from the fixtures, the teams
// are not this league's. Nothing of the real league is committed, here or anywhere in tests/.
const read=async name=>JSON.parse(await readFile(new URL(`./fixtures/serie-a/${name}`,import.meta.url),'utf8'));
const payload=parseLiveRound(await read('live-4.json'),'2026-27',4);
const roles=new Map(payload.players.map(p=>[p.id,p.role]));
const grades=new Map(payload.grades.map(g=>[g.player_id,
  {player_id:g.player_id,round:4,state:g.state,grade:g.grade,events:g.events,role:roles.get(g.player_id)??null}]));
const pick=predicate=>payload.grades.filter(predicate).map(g=>({id:g.player_id,name:`P${g.player_id}`}));
const rated=pick(g=>g.state==='graded'),unrated=pick(g=>g.state==='no_vote');
const formation=(starters,bench=[])=>({module:'433',starters,bench});
const cfg=CHEFANTAVITAE10;

test('a fielded eleven is priced player by player',()=>{
 const eleven=rated.slice(0,11);
 const entry=teamRound('Squadra A',1,formation(eleven,rated.slice(11,18)),grades);
 assert.equal(entry.starters.length,11);
 assert.equal(entry.rated,11);
 assert.equal(entry.unrated,0);
 const expected=eleven.reduce((sum,p)=>sum+grades.get(p.id).grade+
  grades.get(p.id).events.reduce((b,c)=>b+(CLASSIC_SCORING.weights[c]??0),0),0);
 assert.equal(entry.fieldedPoints,Math.round(expected*100)/100);
 assert.ok(entry.benchPoints>0);
 assert.equal(entry.bestBench.points,Math.max(...entry.bench.map(b=>b.points)));
});

test('a starter without a grade is not a zero, and neither is a missing round',()=>{
 const entry=teamRound('Squadra A',1,formation([...rated.slice(0,10),unrated[0]]),grades);
 assert.equal(entry.rated,10);
 assert.equal(entry.unrated,1);
 assert.equal(entry.starters.at(-1).state,'no_vote');
 assert.equal(entry.starters.at(-1).points,null);
 // A player the import has not reached yet is 'unknown', which is a different silence.
 const stranger=teamRound('Squadra A',1,formation([{id:999999,name:'Ignoto'}]),grades);
 assert.equal(stranger.starters[0].state,'unknown');
 assert.equal(stranger.starters[0].points,null);
 assert.equal(stranger.fieldedPoints,0);
});

test('the official total is read, never recomputed, and the gap is what the bench gave',()=>{
 // Reproducing it would need Fantacalcio's substitution engine; measured against ten real
 // results the obvious model got four exactly and missed the rest by one to three points.
 const eleven=rated.slice(0,11);
 const entry=teamRound('Squadra A',1,formation(eleven),grades,CLASSIC_SCORING,80);
 assert.equal(entry.official,80);
 assert.equal(entry.substitutionGain,Math.round((80-entry.fieldedPoints)*100)/100);
 assert.equal(teamRound('Squadra A',1,formation(eleven),grades).substitutionGain,null,'no official number, no invented one');
});

test('a season reads the league round through the Serie A offset',()=>{
 const eleven=rated.slice(0,11);
 const archive={snapshots:[{round:1,observed_at:'2026-09-12T10:00:00.000Z',teams:[
   {name:'Squadra A',present:true,formation:formation(eleven,rated.slice(11,14))}]}],reviews:[],events:[]};
 const byRound=new Map([[4,grades]]);
 const {rounds,season}=seasonPerformance(cfg,['Squadra A'],archive,byRound);
 assert.equal(rounds.length,1,'league round 1 is Serie A round 4');
 assert.equal(season[0].rounds,1);
 assert.equal(season[0].fieldedPoints,rounds[0].fieldedPoints);
 // Offset zero would look for round 1 of the championship, which this map does not hold.
 const flat=makeLeagueConfig({...cfg,serieAOffset:0});
 assert.equal(seasonPerformance(flat,['Squadra A'],archive,byRound).rounds.length,0);
});

test('the bench is a regret only when it beat someone who played',()=>{
 const best=[...rated].sort((a,b)=>grades.get(b.id).grade-grades.get(a.id).grade);
 const worst=[...best].reverse();
 const archive=eleven=>({snapshots:[{round:1,observed_at:'2026-09-12T10:00:00.000Z',
   teams:[{name:'Squadra A',present:true,formation:eleven}]}],reviews:[],events:[]});
 const byRound=new Map([[4,grades]]);
 // Eleven of the worst with the best on the bench: the regret is the distance between them.
 const regretted=seasonPerformance(cfg,['Squadra A'],archive(formation(worst.slice(0,11),best.slice(0,3))),byRound).season[0];
 assert.equal(regretted.regrets.length,1);
 assert.ok(regretted.regrets[0].gap>0);
 // The other way round there is nothing to regret, even with points on the bench.
 const content=seasonPerformance(cfg,['Squadra A'],archive(formation(best.slice(0,11),worst.slice(0,3))),byRound).season[0];
 assert.deepEqual(content.regrets,[]);
 assert.ok(content.benchPoints>0,'the bench still scored, it just scored less');
});

test('the players a team keeps fielding come with what they returned',()=>{
 const eleven=rated.slice(0,11);
 const archive={snapshots:[
   {round:1,observed_at:'2026-09-12T10:00:00.000Z',teams:[{name:'Squadra A',present:true,formation:formation(eleven)}]},
   {round:2,observed_at:'2026-09-19T10:00:00.000Z',teams:[{name:'Squadra A',present:true,formation:formation([...eleven.slice(0,10),rated[20]])}]},
 ],reviews:[],events:[]};
 const byRound=new Map([[4,grades],[5,grades]]);
 const season=seasonPerformance(cfg,['Squadra A'],archive,byRound).season[0];
 assert.equal(season.rounds,2);
 assert.equal(season.topStarters[0].starts,2);
 assert.equal(season.topStarters[0].average,Math.round(season.topStarters[0].points/2*100)/100);
 assert.ok(season.topStarters.every(p=>p.starts<=2));
});
