import {test} from 'node:test';
import assert from 'node:assert/strict';
import {competitionFrom,roundFor,fixtureFor,outcomeOf,missingLineups,lineupStateFor,standingFor,hasResults,
 headToHead,roundHighlights,characterOf} from '../lib/home-view.ts';

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

const result=(round,home,away,homeGoals,awayGoals,homeFantasy=null,awayFantasy=null)=>
 ({round,home,away,homeGoals,awayGoals,homeFantasy,awayFantasy});
const withMatches=(matches,calendar=[])=>({...competition(calendar),matches});

test('the head to head is told from the first team and counts only meetings',()=>{
 const c=withMatches([
  result(2,'A','B',2,1),result(3,'A','C',0,0),
  result(12,'B','A',3,1),result(20,'A','B',1,1,71.5,70),
 ]);
 const h=headToHead(c,'A','B');
 assert.equal(h.played,3);
 assert.equal(h.wins,1);assert.equal(h.draws,1);assert.equal(h.losses,1);
 // The last meeting is the highest round, whatever order the payload arrived in.
 assert.equal(h.last.round,20);assert.equal(h.last.fantasy,71.5);assert.equal(h.last.opponentFantasy,70);
 // Mirrored from the other side.
 const mirror=headToHead(c,'B','A');
 assert.equal(mirror.wins,1);assert.equal(mirror.losses,1);assert.equal(mirror.last.fantasy,70);
});

test('two teams that have never met have no head to head at all',()=>{
 const c=withMatches([result(2,'A','C',2,1)]);
 assert.equal(headToHead(c,'A','B'),null);
 assert.equal(headToHead(c,'A','A'),null);
 assert.equal(headToHead(c,'A',null),null);
 assert.equal(headToHead(null,'A','B'),null);
});

test('a fixture still to play cannot sneak into the head to head as a draw',()=>{
 // The calendar carries the future round with null goals; matches carries only what was played.
 const c=withMatches([result(2,'A','B',2,1)],[round(30,[match('A','B')])]);
 assert.equal(headToHead(c,'A','B').played,1);
});

test('the round highlights are the best and worst fantasy score of that round',()=>{
 const played=round(5,[
  match('A','B',{homeFantasy:83.5,awayFantasy:64.5,homeGoals:2,awayGoals:0}),
  match('C','D',{homeFantasy:70,awayFantasy:75,homeGoals:1,awayGoals:1}),
 ],true);
 const {best,worst}=roundHighlights(competition([played]),5);
 assert.deepEqual(best,{team:'A',fantasy:83.5});
 assert.deepEqual(worst,{team:'B',fantasy:64.5});
});

test('no highlights before the round is calculated, or without fantasy figures',()=>{
 const scheduled=competition([round(5,[match('A','B',{homeFantasy:83.5,awayFantasy:64.5})])]);
 assert.deepEqual(roundHighlights(scheduled,5),{best:null,worst:null});
 const blank=competition([round(5,[match('A','B')],true)]);
 assert.deepEqual(roundHighlights(blank,5),{best:null,worst:null});
 assert.deepEqual(roundHighlights(null,5),{best:null,worst:null});
 assert.deepEqual(roundHighlights(competition([round(5,[],true)]),5),{best:null,worst:null});
});

test('the character pairs the label with the distance between merit and table',()=>{
 const perf=(name,played,fantasyAverage,points)=>({name,played,fantasyAverage,points,fantasyStdDev:6});
 // A produces most and collects least: unlucky, and the gap says by how much.
 const teams=[perf('A',5,74,4),perf('B',5,70,12),perf('C',5,66,8)];
 const a=characterOf(teams,'A');
 assert.equal(a.fantasyRank,1);assert.equal(a.pointsRank,3);assert.equal(a.gap,-2);
 assert.equal(a.label,'Sfortunata');
 const b=characterOf(teams,'B');
 assert.equal(b.gap,1);
 assert.equal(characterOf(teams,'Z'),null);
 // A team that has not played, and a league of one, say nothing.
 assert.equal(characterOf([perf('A',0,0,0)],'A'),null);
 assert.equal(characterOf([perf('A',5,70,9)],'A'),null);
});
