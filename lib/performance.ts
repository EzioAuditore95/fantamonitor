import { TEAM_NAMES } from './model';

export type MatchResult = {
  round: number;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  homeFantasy: number | null;
  awayFantasy: number | null;
};

export type StandingRow = {
  name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  fantasyTotal: number | null;
};

export type PerformancePayload = {
  source: string;
  fetchedAt: string;
  matches: MatchResult[];
  standings: StandingRow[];
  warnings: string[];
};

export type TeamPerformance = {
  name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  fantasyTotal: number;
  fantasyAverage: number;
  fantasyStdDev: number;
  recentPoints: number;
  recentFantasyAverage: number;
  recentForm: ('W'|'D'|'L')[];
  unbeatenStreak: number;
  winStreak: number;
  losingStreak: number;
  winlessStreak: number;
  narrowWins: number;
  bigWins: number;
  lowScoreWins: number;
  highScoreLosses: number;
  shutoutWins: number;
  closeWinRate: number;
  drawRate: number;
  expectedPoints: number;
  luckDelta: number;
  formScore: number;
  powerScore: number;
  performanceIndex: number;
  consistencyIndex: number;
};

const clamp=(v:number,min=0,max=100)=>Math.max(min,Math.min(max,v));
const mean=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:0;
const std=(values:number[])=>{if(values.length<2)return 0;const m=mean(values);return Math.sqrt(mean(values.map(v=>(v-m)**2)));};
function normalize(values:number[],value:number,invert=false){if(!values.length)return 50;const min=Math.min(...values),max=Math.max(...values);if(max===min)return 50;const n=((value-min)/(max-min))*100;return invert?100-n:n;}

export function computePerformance(payload:PerformancePayload):TeamPerformance[]{
  const completed=[...payload.matches].filter(m=>TEAM_NAMES.includes(m.home)&&TEAM_NAMES.includes(m.away)).sort((a,b)=>a.round-b.round);
  const preliminary=TEAM_NAMES.map(name=>{
    const games=completed.filter(m=>m.home===name||m.away===name);
    const results=games.map(m=>{
      const home=m.home===name;
      const gf=home?m.homeGoals:m.awayGoals,ga=home?m.awayGoals:m.homeGoals;
      const fantasy=home?m.homeFantasy:m.awayFantasy;
      const oppFantasy=home?m.awayFantasy:m.homeFantasy;
      const pts=gf>ga?3:gf===ga?1:0;
      return {round:m.round,gf,ga,fantasy,oppFantasy,pts,result:(gf>ga?'W':gf===ga?'D':'L') as 'W'|'D'|'L'};
    });
    const fantasy=results.flatMap(r=>r.fantasy==null?[]:[r.fantasy]);
    const recent=results.slice(-5);
    const wins=results.filter(r=>r.result==='W').length,draws=results.filter(r=>r.result==='D').length,losses=results.length-wins-draws;
    const narrowWins=results.filter(r=>r.result==='W'&&r.gf-r.ga===1).length;
    const bigWins=results.filter(r=>r.result==='W'&&r.gf-r.ga>=2).length;
    const lowScoreWins=results.filter(r=>r.result==='W'&&r.fantasy!=null&&r.fantasy<70).length;
    const highScoreLosses=results.filter(r=>r.result==='L'&&r.fantasy!=null&&r.fantasy>=72).length;
    const shutoutWins=results.filter(r=>r.result==='W'&&r.oppFantasy!=null&&r.oppFantasy<66).length;
    const streak=(test:(r:typeof results[number])=>boolean)=>{let n=0;for(let i=results.length-1;i>=0&&test(results[i]);i--)n++;return n;};
    const expectedPoints=results.reduce((sum,r)=>{
      if(r.fantasy==null||r.oppFantasy==null)return sum+r.pts;
      const d=r.fantasy-r.oppFantasy;
      return sum+(d>=4?3:d<=-4?0:1);
    },0);
    return {
      name,played:results.length,wins,draws,losses,points:wins*3+draws,
      goalsFor:results.reduce((s,r)=>s+r.gf,0),goalsAgainst:results.reduce((s,r)=>s+r.ga,0),
      fantasyTotal:fantasy.reduce((a,b)=>a+b,0),fantasyAverage:mean(fantasy),fantasyStdDev:std(fantasy),
      recentPoints:recent.reduce((s,r)=>s+r.pts,0),recentFantasyAverage:mean(recent.flatMap(r=>r.fantasy==null?[]:[r.fantasy])),recentForm:recent.map(r=>r.result),
      unbeatenStreak:streak(r=>r.result!=='L'),winStreak:streak(r=>r.result==='W'),losingStreak:streak(r=>r.result==='L'),winlessStreak:streak(r=>r.result!=='W'),
      narrowWins,bigWins,lowScoreWins,highScoreLosses,shutoutWins,closeWinRate:wins?narrowWins/wins:0,drawRate:results.length?draws/results.length:0,
      expectedPoints,luckDelta:wins*3+draws-expectedPoints,
    };
  });
  const points=preliminary.map(x=>x.points),fantasyAvg=preliminary.map(x=>x.fantasyAverage),recentPoints=preliminary.map(x=>x.recentPoints),recentFantasy=preliminary.map(x=>x.recentFantasyAverage),volatility=preliminary.map(x=>x.fantasyStdDev);
  return preliminary.map(x=>{
    const resultIndex=normalize(points,x.points);
    const productionIndex=normalize(fantasyAvg,x.fantasyAverage);
    const recentResultIndex=normalize(recentPoints,x.recentPoints);
    const recentProductionIndex=normalize(recentFantasy,x.recentFantasyAverage);
    const consistencyIndex=normalize(volatility,x.fantasyStdDev,true);
    const formScore=clamp(.5*recentResultIndex+.3*recentProductionIndex+.2*((recentResultIndex+recentProductionIndex)/2));
    const performanceIndex=clamp(.6*productionIndex+.4*resultIndex);
    const powerScore=clamp(.35*formScore+.30*productionIndex+.20*resultIndex+.15*consistencyIndex);
    return {...x,goalDifference:x.goalsFor-x.goalsAgainst,formScore,powerScore,performanceIndex,consistencyIndex};
  }).sort((a,b)=>b.powerScore-a.powerScore);
}

export function classifyTeam(team:TeamPerformance,all:TeamPerformance[]){
  if(!team.played)return 'Dati insufficienti';
  const avgPerf=mean(all.filter(x=>x.played).map(x=>x.fantasyAverage));
  const avgPpg=mean(all.filter(x=>x.played).map(x=>x.points/x.played));
  const highPerf=team.fantasyAverage>=avgPerf,highResult=team.points/team.played>=avgPpg;
  if(highPerf&&highResult)return 'Dominante';
  if(!highPerf&&highResult)return 'Cinica';
  if(highPerf&&!highResult)return 'Sfortunata';
  return 'In difficoltà';
}
