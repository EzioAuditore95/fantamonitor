// Vocabulary of the public Fantacalcio live feed: the contract every later phase reads. Nothing
// here is copied from their code. `scripts/calibrate-live.mjs` derives the table from the feed
// itself, crossed with the votes page and the season statistics page, and
// `tests/serie-a-events.test.mjs` repeats that derivation over the fixtures on every CI run: a
// wrong code yields a plausible fantasy score rather than an error, so changing a number here
// without recalibrating has to break the tests.

export const SERIE_A_CHAMPIONSHIP=21;
export const liveRoundUrl=(round:number)=>`https://d2lhpso9w1g8dk.cloudfront.net/web/risorse/dati/live/${SERIE_A_CHAMPIONSHIP}/live_${round}.json`;

// Feed and site share two sentinel grades, and the difference is not cosmetic: a player who came
// on too late to be rated still collects cards and still counts as an appearance, one who never
// played collects nothing.
export const NO_VOTE=55,DID_NOT_PLAY=56;
export type Grade={kind:'graded';value:number}|{kind:'no_vote'}|{kind:'did_not_play'};
export function readGrade(value:unknown):Grade|null{
  const raw=typeof value==='number'?value:String(value??'').trim().replace(',','.');
  // An empty attribute is a missing grade, and Number('') is 0: a zero that reads as a real vote.
  const n=raw===''?NaN:Number(raw);
  if(!Number.isFinite(n))return null;
  if(n===NO_VOTE)return {kind:'no_vote'};if(n===DID_NOT_PLAY)return {kind:'did_not_play'};
  return {kind:'graded',value:n};
}

// `sto` reads the same on a player and on a match: 0 not started, 3 under way, 4 over. The feed
// is live, and a grade read at half time is a grade that will still change.
export const FINAL_STATUS=4;
export const roundIsFinal=(matches:readonly {sto?:number}[])=>matches.length>0&&matches.every(m=>m.sto===FINAL_STATUS);

// Events as they appear in `bm`. The eight published as bonus columns are proven one by one; the
// two cards, which have no column on the votes page, against the season totals instead.
export const EVENT={goal:3,concededGoal:4,ownGoal:10,penaltyScored:9,penaltyMissed:8,penaltySaved:7,
  yellowCard:1,redCard:2,manOfTheMatch:26,subbedIn:15,subbedOut:14} as const;
// The site prints one "Assist" figure, the feed keeps the kinds apart: same weight, so they sum.
export const ASSIST_CODES=[21,22,23] as const;
// Seen in the feed, worth nothing, and pinned to no meaning by either public source: listed so
// that an unknown code stays a known unknown.
export const UNNAMED_CODES=[11,12,16,17] as const;

// Classic weights read off the published fantavoto, not off a rule book: the preset a league
// starts from. Deliberately absent is the clean sheet — there is no event for it, it has to be
// derived from conceded goals being zero.
export const CLASSIC_BONUS:Readonly<Record<number,number>>=Object.freeze({
  [EVENT.goal]:3,[EVENT.penaltyScored]:3,[EVENT.penaltySaved]:3,[EVENT.penaltyMissed]:-3,
  [EVENT.ownGoal]:-2,[EVENT.concededGoal]:-1,[EVENT.yellowCard]:-0.5,[EVENT.redCard]:-1,
  [EVENT.manOfTheMatch]:0,[EVENT.subbedIn]:0,[EVENT.subbedOut]:0,
  ...Object.fromEntries(ASSIST_CODES.map(code=>[code,1])),
  ...Object.fromEntries(UNNAMED_CODES.map(code=>[code,0])),
});

export const bonusFor=(codes:readonly number[],weights:Readonly<Record<number,number>>=CLASSIC_BONUS)=>codes.reduce((sum,code)=>sum+(weights[code]??0),0);
// No vote is not a zero: scoring it would reward a manager for fielding someone who never played.
export function fantasyGrade(grade:Grade|null,codes:readonly number[],weights?:Readonly<Record<number,number>>):number|null{
  return grade?.kind==='graded'?Math.round((grade.value+bonusFor(codes,weights))*100)/100:null;
}
