import {test} from 'node:test';
import assert from 'node:assert/strict';
import {competitionFrom,roundFor,fixtureFor,outcomeOf,missingLineups,lineupStateFor,standingFor,hasResults} from '../lib/home-view.ts';

const match=(home,away,extra={})=>({homeId:1,awayId:2,home,away,homeFantasy:null,awayFantasy:null,
 homeStandingPoints:null,awayStandingPoints:null,homeGoals:null,awayGoals:null,result:null,resultSR:null,...extra});
const round=(n,matches,calculated=false)=>({round:n,championshipRound:n+3,calculated,matches});
const competition=(calendar,standings=[])=>({source:'https://example.test',fetchedAt:'2026-09-21T10:00:00Z',calendar,matches:[],standings,warnings:[]});
const snapshot=(n,teams,observed_at='2026-09-21T10:00:00Z')=>({round:n,observed_at,inserted:teams.filter(t=>t.present).length,
 expected_total:teams.length,teams:teams.map(t=>({team_key:t.name,name:t.name,present:t.present,source_status:t.present?'check-circle':'Non inserita'}))});
const present=name=>({name,present:true});
const absent=name=>({name,present:false});

test('the competition comes from the freshest snapshot that carries one',()=>{
 const old=competition([round(1,[])]),fresh=competition([round(2,[])]);
 const snapshots=[{...snapshot(1,[present('A')]),competition:old},snapshot(2,[present('A')]),{...snapshot(3,[present('A')]),competition:fresh}];
 assert.equal(competitionFrom(snapshots),fresh);
 // A snapshot without one does not erase the last that had it.
 assert.equal(competitionFrom([{...snapshot(1,[present('A')]),competition:old},snapshot(2,[present('A')])]),old);
 assert.equal(competitionFrom([snapshot(1,[present('A')])]),null);
 assert.equal(competitionFrom([]),null);
});

test('reading the competition leaves the archive in the order it arrived',()=>{
 const snapshots=[{...snapshot(1,[present('A')]),competition:competition([])},snapshot(2,[present('A')])];
 const before=snapshots.map(s=>s.round);
 competitionFrom(snapshots);
 assert.deepEqual(snapshots.map(s=>s.round),before);
});

test('a fixture is told from the point of view of one team, home or away',()=>{
 const c=competition([round(5,[match('A','B'),match('C','D')])]);
 const home=fixtureFor(c,5,'A');
 assert.equal(home.opponent,'B');assert.equal(home.home,true);assert.equal(home.championshipRound,8);
 const away=fixtureFor(c,5,'D');
 assert.equal(away.opponent,'C');assert.equal(away.home,false);
 // Scores follow the same side.
 const played=competition([round(5,[match('A','B',{homeGoals:2,awayGoals:1,homeFantasy:74.5,awayFantasy:69})],true)]);
 const mine=fixtureFor(played,5,'B');
 assert.equal(mine.goals,1);assert.equal(mine.opponentGoals,2);assert.equal(mine.fantasy,69);assert.equal(mine.opponentFantasy,74.5);
});

test('no fixture rather than a wrong one when anything is missing',()=>{
 const c=competition([round(5,[match('A','B')])]);
 assert.equal(fixtureFor(c,5,'Z'),null);
 assert.equal(fixtureFor(c,9,'A'),null);
 assert.equal(fixtureFor(c,5,null),null);
 assert.equal(fixtureFor(null,5,'A'),null);
 assert.equal(roundFor(null,5),null);
 assert.equal(roundFor(c,9),null);
});

test('an outcome exists only once the round is calculated',()=>{
 const scheduled=competition([round(5,[match('A','B')])]);
 assert.equal(outcomeOf(fixtureFor(scheduled,5,'A')),null);
 // Goals present but the round not yet calculated is still not a result.
 const early=competition([round(5,[match('A','B',{homeGoals:0,awayGoals:0})])]);
 assert.equal(outcomeOf(fixtureFor(early,5,'A')),null);
 const done=g=>competition([round(5,[match('A','B',g)],true)]);
 assert.equal(outcomeOf(fixtureFor(done({homeGoals:2,awayGoals:1}),5,'A')),'W');
 assert.equal(outcomeOf(fixtureFor(done({homeGoals:1,awayGoals:1}),5,'A')),'D');
 assert.equal(outcomeOf(fixtureFor(done({homeGoals:0,awayGoals:1}),5,'A')),'L');
 assert.equal(outcomeOf(fixtureFor(done({homeGoals:0,awayGoals:1}),5,'B')),'W');
 assert.equal(outcomeOf(null),null);
});

test('missing lineups are the teams a reading found without one',()=>{
 const s=snapshot(5,[present('A'),absent('B'),absent('C')]);
 assert.deepEqual(missingLineups(s),['B','C']);
 assert.deepEqual(missingLineups(snapshot(5,[present('A')])),[]);
 assert.deepEqual(missingLineups(undefined),[]);
});

test('a lineup state distinguishes "not inserted" from "never read"',()=>{
 const s=snapshot(5,[present('A'),absent('B')]);
 assert.equal(lineupStateFor(s,'A'),true);
 assert.equal(lineupStateFor(s,'B'),false);
 assert.equal(lineupStateFor(s,'Z'),undefined);
 assert.equal(lineupStateFor(undefined,'A'),undefined);
 assert.equal(lineupStateFor(s,null),undefined);
});

test('the position is the order the league already delivered',()=>{
 const rows=[{name:'A',played:3,points:9},{name:'B',played:3,points:4},{name:'C',played:3,points:1}];
 const c=competition([],rows);
 assert.equal(standingFor(c,'A').position,1);
 assert.equal(standingFor(c,'C').position,3);
 assert.equal(standingFor(c,'C').row.points,1);
 assert.equal(standingFor(c,'Z'),null);
 assert.equal(standingFor(null,'A'),null);
 assert.equal(standingFor(c,null),null);
});

test('a standings table nobody has played yet counts as no results',()=>{
 assert.equal(hasResults(competition([],[{name:'A',played:0,points:0}])),false);
 assert.equal(hasResults(competition([],[{name:'A',played:1,points:3}])),true);
 assert.equal(hasResults(competition([],[])),false);
 assert.equal(hasResults(null),false);
});
