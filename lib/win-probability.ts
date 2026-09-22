import { DRAW_BAND_FP,type TeamPerformance } from './performance.ts';

// How many rounds both teams must have played before a probability is shown at all.
// Below it the sample says more about luck than about either team, and a number on
// screen would borrow a confidence the data does not have.
export const MIN_ROUNDS_FOR_PROBABILITY=4;
// Weight of the league average in the shrunk mean, expressed in rounds: at n rounds
// played a team counts n/(n+k) and the league the rest. Without it a team with three
// lucky outings in four would come out near 80% before the season has said anything.
export const LEAGUE_SHRINK_ROUNDS=6;
// Floor under the spread of a team's fantasy points. std() returns 0 for a single sample
// and stays small for a handful of them; a near-zero spread would turn a one-point edge
// into a certainty.
export const MIN_FP_STD_DEV=4;

export type WinProbability={
  /** Chance the team wins, as a fraction of 1. */
  win:number;
  draw:number;
  loss:number;
  /** Shrunk fantasy-point edge over the opponent: positive means favoured. */
  edge:number;
  /** Spread of that edge, in fantasy points. */
  sigma:number;
  /** Rounds the estimate rests on: the fewer of the two teams' played rounds. */
  rounds:number;
};

// Abramowitz & Stegun 7.1.26. Maximum absolute error 1.5e-7, three orders of magnitude
// below anything a percentage on screen can show.
function erf(x:number):number{
  const sign=Math.sign(x),a=Math.abs(x),t=1/(1+.3275911*a);
  return sign*(1-(((((1.061405429*t-1.453152027)*t+1.421413741)*t-.284496736)*t+.254829592)*t)*Math.exp(-a*a));
}
// Φ(z). Exact at the edges that matter: Math.sign(0) is 0, so Φ(0) is 0.5 on the nose,
// and exp(-Infinity) is 0, so Φ(±Infinity) is 1 and 0 rather than NaN.
export const normalCdf=(z:number)=>.5*(1+erf(z/Math.SQRT2));

export function leagueFantasyAverage(league:readonly TeamPerformance[]):number{
  const played=league.filter(t=>t.played>0);
  if(!played.length)return 0;
  return played.reduce((sum,t)=>sum+t.fantasyAverage,0)/played.length;
}

// Pulls a short record towards the league, so that an early-season outlier is read as
// the small sample it is.
export function shrunkAverage(team:TeamPerformance,leagueAverage:number):number{
  const n=team.played;
  if(n<=0)return leagueAverage;
  return (n*team.fantasyAverage+LEAGUE_SHRINK_ROUNDS*leagueAverage)/(n+LEAGUE_SHRINK_ROUNDS);
}

const spread=(team:TeamPerformance)=>Math.max(team.fantasyStdDev,MIN_FP_STD_DEV);

// The estimate: a team's fantasy total is the sum of about eleven near-independent
// contributions, so the difference between two of them is taken as normal. Everything it
// needs — the mean, the spread — is already measured from played rounds in
// computePerformance; nothing here is guessed.
//
// Returns null, never an even three-way split, when the record is too short: the caller
// has to say why the estimate is missing instead of printing a number that means nothing.
export function winProbability(team:TeamPerformance,opponent:TeamPerformance,league:readonly TeamPerformance[]):WinProbability|null{
  const rounds=Math.min(team.played,opponent.played);
  if(rounds<MIN_ROUNDS_FOR_PROBABILITY)return null;
  const leagueAverage=leagueFantasyAverage(league);
  const edge=shrunkAverage(team,leagueAverage)-shrunkAverage(opponent,leagueAverage);
  const sigma=Math.sqrt(spread(team)**2+spread(opponent)**2);
  const loss=normalCdf((-DRAW_BAND_FP-edge)/sigma);
  const win=1-normalCdf((DRAW_BAND_FP-edge)/sigma);
  return {win,draw:1-win-loss,loss,edge,sigma,rounds};
}

// Whole percentages that still add up to 100: the rounding residue goes to the largest
// bucket, which is the one where a point either way is least visible.
export function roundedSplit(p:Pick<WinProbability,'win'|'draw'|'loss'>):{win:number;draw:number;loss:number}{
  const keys=['win','draw','loss'] as const;
  const rounded={win:Math.round(p.win*100),draw:Math.round(p.draw*100),loss:Math.round(p.loss*100)};
  const residue=100-(rounded.win+rounded.draw+rounded.loss);
  if(residue){
    const largest=keys.reduce((best,key)=>p[key]>p[best]?key:best,keys[0]);
    rounded[largest]+=residue;
  }
  return rounded;
}
