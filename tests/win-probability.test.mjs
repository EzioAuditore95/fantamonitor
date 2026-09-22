import {test} from 'node:test';
import assert from 'node:assert/strict';
import {computePerformance,DRAW_BAND_FP} from '../lib/performance.ts';
import {normalCdf,shrunkAverage,leagueFantasyAverage,winProbability,roundedSplit,
 MIN_ROUNDS_FOR_PROBABILITY,LEAGUE_SHRINK_ROUNDS,MIN_FP_STD_DEV} from '../lib/win-probability.ts';

const near=(actual,expected,epsilon=1e-6,message)=>assert.ok(Math.abs(actual-expected)<=epsilon,
 message??`expected ${actual} within ${epsilon} of ${expected}`);
// Only the fields the estimate reads; the rest of TeamPerformance never enters it.
const perf=(name,{played=10,fantasyAverage=68,fantasyStdDev=8}={})=>({name,played,fantasyAverage,fantasyStdDev});

test('normalCdf matches the standard normal at its reference points',()=>{
 assert.equal(normalCdf(0),.5);
 near(normalCdf(1),.8413447);
 near(normalCdf(1.96),.9750021);
 near(normalCdf(-1),1-normalCdf(1),1e-12);
 assert.equal(normalCdf(Infinity),1);
 assert.equal(normalCdf(-Infinity),0);
});

test('swapping the two teams mirrors win and loss and leaves the draw alone',()=>{
 const a=perf('A',{fantasyAverage:74,fantasyStdDev:9});
 const b=perf('B',{fantasyAverage:65,fantasyStdDev:6});
 const ab=winProbability(a,b,[a,b]),ba=winProbability(b,a,[a,b]);
 near(ab.win,ba.loss,1e-12);near(ab.loss,ba.win,1e-12);near(ab.draw,ba.draw,1e-12);
 near(ab.edge,-ba.edge,1e-12);
});

test('the three outcomes always close at 1 and never leave the unit interval',()=>{
 for(const edge of [-30,-12,-4,0,3,4,11,25])for(const sd of [1,4,8,16,30]){
  const a=perf('A',{fantasyAverage:68+edge,fantasyStdDev:sd});
  const b=perf('B',{fantasyAverage:68,fantasyStdDev:sd});
  const p=winProbability(a,b,[a,b]);
  near(p.win+p.draw+p.loss,1,1e-12);
  for(const value of [p.win,p.draw,p.loss])assert.ok(value>=0&&value<=1,`out of range: ${value}`);
 }
});

test('a higher fantasy average strictly raises the win chance and lowers the loss',()=>{
 const opponent=perf('B');
 let previous=null;
 for(const average of [60,64,68,72,76,80]){
  const p=winProbability(perf('A',{fantasyAverage:average}),opponent,[perf('A',{fantasyAverage:average}),opponent]);
  if(previous){assert.ok(p.win>previous.win);assert.ok(p.loss<previous.loss);}
  previous=p;
 }
});

test('the draw band is DRAW_BAND_FP, the same one expectedPoints uses',()=>{
 // Two identical teams: the edge is zero, so the draw is exactly the mass within ±band.
 const a=perf('A',{fantasyStdDev:7}),b=perf('B',{fantasyStdDev:7});
 const p=winProbability(a,b,[a,b]);
 near(p.win,p.loss,1e-12);
 near(p.draw,2*normalCdf(DRAW_BAND_FP/p.sigma)-1,1e-12);
 // And the same threshold still decides expectedPoints: 3.9 apart is a draw, 4.1 a win.
 const played=(homeFantasy,awayFantasy)=>computePerformance(['A','B'],{source:'',fetchedAt:'',warnings:[],standings:[],
  matches:[{round:1,home:'A',away:'B',homeGoals:1,awayGoals:0,homeFantasy,awayFantasy}]});
 assert.equal(played(71.9,68).find(t=>t.name==='A').expectedPoints,1);
 assert.equal(played(72.1,68).find(t=>t.name==='A').expectedPoints,3);
});

test('a short record is pulled towards the league, a long one is not',()=>{
 const league=[perf('A',{fantasyAverage:90,played:4}),perf('B',{fantasyAverage:60}),perf('C',{fantasyAverage:62})];
 const average=leagueFantasyAverage(league);
 const opponent=perf('B',{fantasyAverage:60});
 const young=winProbability(perf('A',{fantasyAverage:90,played:4}),opponent,league);
 const grown=winProbability(perf('A',{fantasyAverage:90,played:20}),opponent,league);
 assert.ok(Math.abs(young.win-.5)<Math.abs(grown.win-.5));
 // With a long enough record the shrunk mean is the raw one again.
 near(shrunkAverage(perf('A',{fantasyAverage:90,played:2000}),average),90,.1);
 // A team that has played nothing is the league, not a zero.
 assert.equal(shrunkAverage(perf('A',{fantasyAverage:90,played:0}),average),average);
 assert.equal(leagueFantasyAverage([perf('A',{played:0})]),0);
});

test('more volatile teams draw less and win less at the same edge',()=>{
 const steady=winProbability(perf('A',{fantasyAverage:75,fantasyStdDev:5}),perf('B',{fantasyStdDev:5}),[]);
 const wild=winProbability(perf('A',{fantasyAverage:75,fantasyStdDev:20}),perf('B',{fantasyStdDev:20}),[]);
 assert.ok(wild.win<steady.win);
 assert.ok(wild.draw<steady.draw);
 assert.ok(wild.sigma>steady.sigma);
});

test('no estimate below the minimum number of rounds, from either side',()=>{
 const full=perf('B',{played:30});
 for(let played=0;played<MIN_ROUNDS_FOR_PROBABILITY;played++){
  assert.equal(winProbability(perf('A',{played}),full,[]),null);
  assert.equal(winProbability(full,perf('A',{played}),[]),null);
 }
 const atThreshold=winProbability(perf('A',{played:MIN_ROUNDS_FOR_PROBABILITY}),full,[]);
 assert.ok(atThreshold);
 assert.equal(atThreshold.rounds,MIN_ROUNDS_FOR_PROBABILITY);
});

test('a flat record does not divide by zero',()=>{
 const a=perf('A',{fantasyStdDev:0}),b=perf('B',{fantasyStdDev:0});
 const p=winProbability(a,b,[a,b]);
 assert.ok(Number.isFinite(p.win)&&Number.isFinite(p.draw)&&Number.isFinite(p.loss));
 near(p.sigma,Math.sqrt(2*MIN_FP_STD_DEV**2),1e-12);
 const rookie=winProbability(perf('A',{played:1}),perf('B',{played:1}),[]);
 assert.equal(rookie,null);
});

test('the spread floor applies to whichever team is flat, not to both at once',()=>{
 const p=winProbability(perf('A',{fantasyStdDev:1}),perf('B',{fantasyStdDev:6}),[]);
 near(p.sigma,Math.sqrt(MIN_FP_STD_DEV**2+6**2),1e-12);
 assert.ok(LEAGUE_SHRINK_ROUNDS>0);
});

test('rounded percentages add up to exactly 100 and stay non-negative',()=>{
 for(const split of [{win:1/3,draw:1/3,loss:1/3},{win:.004,draw:.002,loss:.994},{win:.5,draw:.5,loss:0},{win:.455,draw:.09,loss:.455}]){
  const r=roundedSplit(split);
  assert.equal(r.win+r.draw+r.loss,100);
  for(const value of [r.win,r.draw,r.loss])assert.ok(value>=0,`negative bucket: ${value}`);
 }
});
