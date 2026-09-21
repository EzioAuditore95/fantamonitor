// Calibration of the public Fantacalcio live feed.
//
// `https://d2lhpso9w1g8dk.cloudfront.net/web/risorse/dati/live/21/live_{round}.json` is the
// bucket leghe.fantacalcio.it hydrates its live pages from. It carries a `bm` array of event
// codes per player and nothing that says what a code means. The Angular bundle of that site
// lists the events (goals, cards, assists, substitutions...) but numbers them for its icon
// sprite, and those numbers are NOT the ones in `bm` — so this table is derived from the data
// instead of copied from their code.
//
// Two public facts constrain it, and nothing here is accepted unless both agree:
//   - the votes page prints eight bonus columns per player, which fixes WHICH code is which;
//   - the same page's fantavoto minus its voto is the sum of the codes' weights, which fixes
//     HOW MUCH each code is worth. The weights are the official Classic formula, i.e. the
//     preset a league starts from.
//
// `node --experimental-strip-types scripts/calibrate-live.mjs` refreshes the fixtures from the
// network and prints the report; the flag is needed because the statistics parser is shared with
// the app. `tests/serie-a-events.test.mjs` re-runs the same derivation offline on the committed
// fixtures, so a wrong table fails CI instead of silently producing wrong fantasy points.

import { mkdir,readFile,readdir,writeFile } from 'node:fs/promises';
import { dirname,join } from 'node:path';
// One parser for the statistics page, shared with the app: run this script with
// `node --experimental-strip-types`, which is what npm test uses for the same reason.
import { parseSeasonStats } from '../lib/serie-a-history.ts';
import { fileURLToPath } from 'node:url';

export const SERIE_A=21; // championship id, the same 21 as in /api/v1/Excel/votes/21/{round}
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const FIXTURES=join(ROOT,'tests','fixtures','serie-a');
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36';
export const liveUrl=round=>`https://d2lhpso9w1g8dk.cloudfront.net/web/risorse/dati/live/${SERIE_A}/live_${round}.json`;
export const votesUrl=(season,round)=>`https://www.fantacalcio.it/voti-fantacalcio-serie-a/${season}/${round}`;
export const statsUrl=season=>`https://www.fantacalcio.it/statistiche-serie-a/${season}/riepilogo`;

// The site encodes "did not play" and "no vote" as out-of-range grades, in the HTML exactly as
// in the feed: the same two sentinels, which is why the parsers below share this reading.
export const NO_VOTE=55,DID_NOT_PLAY=56;
// `sto`, on a player and on a match alike: 0 not started, 3 under way, 4 over. A round is
// only worth freezing when every match in it reads 4.
export const FINAL=4;
// Number('') is 0, and an empty attribute on the page means "no value", not a grade of zero.
const number=value=>{const raw=String(value??'').trim().replace(',','.');const n=raw===''?NaN:Number(raw);return Number.isFinite(n)?n:null;};
export const readGrade=value=>{
  const n=number(value);
  if(n===null)return null;
  if(n===NO_VOTE)return {kind:'no_vote'};
  if(n===DID_NOT_PLAY)return {kind:'did_not_play'};
  return {kind:'graded',value:n};
};

const BONUS_TITLES=['Gol segnati','Gol subiti','Autoreti','Rigori segnati','Rigori sbagliati','Rigori parati','Assist','Player of the match'];
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const rows=html=>html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g)??[];
const all=(re,s)=>[...s.matchAll(re)].map(m=>m[1]);

// One row of the votes page, kept as the page printed it: the sentinels stay sentinels and the
// bonus columns stay a fixed-order array, so a fixture records the source rather than our
// reading of it. Three pills per player — editorial, statistical, "italia" — and only the
// first is kept, because it is the one the live feed's `v` carries.
export function parseVotesPage(html){
  const out={};
  for(const row of rows(html)){
    const id=row.match(/\/serie-a\/squadre\/[^/"]+\/[^/"]+\/(\d+)"/)?.[1];
    if(!id)continue;
    const grades=all(/class="player-grade[^"]*"\s*data-value="([^"]*)"/g,row);
    const fanta=all(/class="player-fanta-grade[^"]*"\s*data-value="([^"]*)"/g,row);
    const bonus=[...row.matchAll(/class="player-bonus[^"]*"\s*data-value="([^"]*)"\s*title="([^"]+)"/g)];
    if(!fanta.length||bonus.length!==BONUS_TITLES.length)continue;
    if(bonus.some(([,,title],i)=>title!==BONUS_TITLES[i]))throw new Error('votes page columns changed');
    out[id]={n:text(row.match(/<a class="player-name player-link"[\s\S]*?<\/a>/)?.[0]??''),
      r:row.match(/class="role"\s*data-value="([^"]*)"/)?.[1]??null,
      g:grades.length?number(grades[0]):null,f:number(fanta[0]),
      b:bonus.map(([,value])=>Number(value)||0)};
  }
  return out;
}

const counts=codes=>{const m=new Map();for(const c of codes)m.set(c,(m.get(c)??0)+1);return m;};
const round2=n=>Math.round(n*4)/4; // fantasy weights move in quarters at worst

// A player-round where both sources graded the same player. The feed's `v` must equal the
// page's editorial grade: if it does not, the two are not describing the same vote and the
// observation is dropped rather than averaged in.
export function observations(rounds){
  const out=[];
  for(const {round,live,votes} of rounds){
    for(const player of live?.data?.pl??[]){
      const page=votes[String(player.id)];
      if(!page)continue;
      const feed=readGrade(player.v),shown=readGrade(page.g),fanta=readGrade(page.f);
      if(feed?.kind!=='graded'||shown?.kind!=='graded'||fanta?.kind!=='graded')continue;
      if(feed.value!==shown.value)continue;
      out.push({round,id:player.id,name:player.n,role:player.r,grade:feed.value,
        fantaGrade:fanta.value,bonus:page.b,codes:player.bm??[]});
    }
  }
  return out;
}

// Which code is which. A column is not always one code — the site prints a single "Assist"
// figure while the feed distinguishes the kinds of assist — so a column is answered by the set
// of codes that never fires when the column is zero, never exceeds it, and sums to it exactly.
// One counter-example over the whole sample disqualifies the set.
export function identifyCodes(obs){
  const seen=[...new Set(obs.flatMap(o=>o.codes))].sort((a,b)=>a-b);
  const tallies=obs.map(o=>({counts:counts(o.codes),bonus:o.bonus}));
  const resolved={},ambiguous={},unobserved=[];
  for(const [column,title] of BONUS_TITLES.entries()){
    if(!obs.some(o=>o.bonus[column]>0)){unobserved.push(title);continue;}
    const exact=set=>tallies.every(({counts:c,bonus})=>set.reduce((sum,code)=>sum+(c.get(code)??0),0)===bonus[column]);
    // A single code that already accounts for the column is the answer; only a column no code
    // matches on its own is allowed to be a family, and then it must be the whole candidate set.
    const alone=seen.filter(code=>exact([code]));
    if(alone.length===1){resolved[title]=alone;continue;}
    const members=seen.filter(code=>tallies.every(({counts:c,bonus})=>{
      const n=c.get(code)??0;return n<=bonus[column]&&(n===0||bonus[column]>0);}));
    if(!alone.length&&members.length&&exact(members))resolved[title]=members;
    else ambiguous[title]=alone.length?alone:members;
  }
  return {resolved,ambiguous,unobserved,seen};
}

// What each code is worth: fantavoto - voto is the sum of the weights of that player's codes,
// so any observation with a single unknown code pins that code down, and the next pass uses it.
// Codes that never appear alone stay unknown instead of being guessed at.
export function weighCodes(obs){
  const weights=new Map();
  for(let pass=0;pass<12;pass++){
    let progress=false;
    for(const o of obs){
      const c=counts(o.codes);
      let residual=round2(o.fantaGrade-o.grade),unknown=null,unknownCount=0;
      for(const [code,n] of c){
        if(weights.has(code))residual=round2(residual-weights.get(code)*n);
        else if(unknown===null||unknown===code){unknown=code;unknownCount=n;}
        else {unknown=-1;break;}
      }
      if(unknown===-1||unknown===null)continue;
      const weight=round2(residual/unknownCount);
      if(!weights.has(unknown)){weights.set(unknown,weight);progress=true;}
    }
    if(!progress)break;
  }
  // Second reading of the whole sample with the finished table: a weight derived from one
  // observation and contradicted by another is worse than no weight at all.
  const unexplained=[];
  for(const o of obs){
    const c=counts(o.codes);
    if([...c.keys()].some(code=>!weights.has(code)))continue;
    const predicted=round2(o.grade+[...c].reduce((sum,[code,n])=>sum+weights.get(code)*n,0));
    if(predicted!==round2(o.fantaGrade))unexplained.push({...o,predicted});
  }
  return {weights,unexplained};
}

// Season-wide check for the two codes no single round can confirm: cards are not columns of
// the votes page, so they are confirmed by summing the candidate code over every finished
// round and comparing with the season totals the statistics page publishes. The tally walks
// the feed itself, not the graded observations: a booked player who came on too late to be
// rated has no vote and no page row, but the season total still counts his card.
export function checkAgainstSeason(rounds,season,code,field){
  const tally=new Map(),appearances=new Map();
  for(const {live} of rounds)for(const player of live?.data?.pl??[]){
    if(player.sto!==FINAL)continue;
    tally.set(player.id,(tally.get(player.id)??0)+(player.bm??[]).filter(c=>c===code).length);
    if(readGrade(player.v)?.kind==='graded')appearances.set(player.id,(appearances.get(player.id)??0)+1);
  }
  let checked=0,agree=0;const disagree=[];
  for(const [id,n] of tally){
    const row=season[String(id)];
    // Only players whose graded appearances we have seen in full: a player we observed in
    // three of his five rounds would "disagree" about our own coverage, not about the feed.
    if(!row||row[field]==null||row.played!==(appearances.get(id)??0))continue;
    checked++;
    if(row[field]===n)agree++;else disagree.push({id,ours:n,site:row[field]});
  }
  return {checked,agree,disagree};
}

// Independent evidence for the one code the bonus columns can never reach: a player marked
// "no vote" came on too late to be rated, so he must carry the code that means "substituted
// in" and cannot carry the one that means "substituted out".
export function checkSubstitution(rounds,inCode,outCode){
  let players=0,withIn=0,withOut=0;
  for(const {live} of rounds)for(const player of live?.data?.pl??[]){
    if(player.sto!==FINAL||readGrade(player.v)?.kind!=='no_vote')continue;
    players++;
    if((player.bm??[]).includes(inCode))withIn++;
    if((player.bm??[]).includes(outCode))withOut++;
  }
  return {players,withIn,withOut};
}

// --- network side, run by hand -------------------------------------------------------------

async function get(url,kind){
  const response=await fetch(url,{headers:{'user-agent':UA},signal:AbortSignal.timeout(30_000)});
  if(!response.ok)return {status:response.status,body:null};
  return {status:response.status,body:kind==='json'?await response.json():await response.text()};
}

// The fixtures are a calibration sample, not an archive: five rounds are already ~1400 graded
// player-rounds, enough for every code the two sources can prove, and the repository does not
// need a season of feeds it will never read.
const MAX_FIXTURE_ROUNDS=5;

async function refresh(season){
  await mkdir(FIXTURES,{recursive:true});
  const rounds=[];
  for(let round=1;round<=MAX_FIXTURE_ROUNDS;round++){
    const live=await get(liveUrl(round),'json');
    if(live.status!==200){console.log(`round ${round}: live ${live.status}, stopping`);break;}
    const votes=await get(votesUrl(season,round),'html');
    if(votes.status!==200){console.log(`round ${round}: votes page ${votes.status}, stopping`);break;}
    const parsed=parseVotesPage(votes.body);
    await writeFile(join(FIXTURES,`live-${round}.json`),JSON.stringify(live.body));
    await writeFile(join(FIXTURES,`votes-${round}.json`),JSON.stringify(parsed));
    console.log(`round ${round}: ${live.body.data.pl.length} feed players, ${Object.keys(parsed).length} graded rows`);
    rounds.push({round,live:live.body,votes:parsed});
  }
  const stats=await get(statsUrl(season),'html');
  // Keyed by player id: the calibration looks players up, it does not iterate them.
  const parsedStats=stats.status===200?Object.fromEntries(parseSeasonStats(stats.body)
    .map(row=>[String(row.player_id),{team:row.team,played:row.played,grade:row.grade,fantaGrade:row.fantasyGrade,
      goals:row.goals,conceded:row.conceded,saved:row.penaltiesSaved,assists:row.assists,
      yellow:row.yellow,red:row.red,own:row.ownGoals}])):{};
  await writeFile(join(FIXTURES,'season-stats.json'),JSON.stringify(parsedStats));
  console.log(`season stats: ${Object.keys(parsedStats).length} players`);
  return {rounds,season:parsedStats};
}

export async function loadFixtures(){
  const files=await readdir(FIXTURES);
  const numbers=files.filter(f=>/^live-\d+\.json$/.test(f)).map(f=>Number(f.match(/\d+/)[0])).sort((a,b)=>a-b);
  const rounds=[];
  // A round with no votes fixture is one there was nothing to cross-check against — a round
  // published but not yet played, for instance. Skipped, not an error.
  for(const round of numbers){
    if(!files.includes(`votes-${round}.json`))continue;
    rounds.push({round,
      live:JSON.parse(await readFile(join(FIXTURES,`live-${round}.json`),'utf8')),
      votes:JSON.parse(await readFile(join(FIXTURES,`votes-${round}.json`),'utf8'))});
  }
  const season=JSON.parse(await readFile(join(FIXTURES,'season-stats.json'),'utf8'));
  return {rounds,season};
}

function report({rounds,season}){
  const obs=observations(rounds);
  const {resolved,ambiguous,unobserved,seen}=identifyCodes(obs);
  const {weights,unexplained}=weighCodes(obs);
  console.log(`\n${obs.length} observations over ${rounds.length} rounds, codes seen: ${seen.join(', ')}`);
  console.log('\ncode  weight  meaning');
  const named=new Map();
  for(const [title,codes] of Object.entries(resolved))for(const code of codes)named.set(code,codes.length>1?`${title} (one of ${codes.join('/')})`:title);
  for(const code of seen){
    const w=weights.has(code)?String(weights.get(code)).padStart(5):'    ?';
    console.log(`${String(code).padStart(4)}  ${w}   ${named.get(code)??'(no bonus column answers for it)'}`);
  }
  if(Object.keys(ambiguous).length)console.log('\nambiguous:',ambiguous);
  if(unobserved.length)console.log('never happened in this sample:',unobserved.join(', '));
  if(unexplained.length)console.log(`\n${unexplained.length} observations contradict the weights`,unexplained.slice(0,3));
  for(const [code,field] of [[1,'yellow'],[2,'red']])
    console.log(`season check, code ${code} against ${field}:`,checkAgainstSeason(rounds,season,code,field));
  console.log('substituted in/out (players with no vote):',checkSubstitution(rounds,15,14));
  return {resolved,weights,seen};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const season=process.argv[3]??'2026-27';
  const data=process.argv[2]==='--offline'?await loadFixtures():await refresh(season);
  report(data);
}
