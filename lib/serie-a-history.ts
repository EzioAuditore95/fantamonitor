// Past seasons, read from the statistics page of www.fantacalcio.it.
//
// The live bucket only holds the season being played — next August it will serve round 1 of the
// next one — so anything older has to come from the published pages, and it comes as season
// totals, not as rounds with events. That is why it does NOT go in fm_serie_a_grades: a row there
// is a grade plus the events behind it, and pretending an aggregate is one would mean inventing
// the parts. It is its own ledger, keyed by the same player id.

export type SeasonTotals={player_id:number;name:string;team:string|null;role:string|null;
  played:number|null;grade:number|null;fantasyGrade:number|null;
  goals:number|null;conceded:number|null;penaltiesSaved:number|null;assists:number|null;
  yellow:number|null;red:number|null;ownGoals:number|null};

export const seasonStatsUrl=(season:string)=>`https://www.fantacalcio.it/statistiche-serie-a/${season}/riepilogo`;

const text=(html:string)=>html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const number=(value:string|undefined)=>{
  const raw=String(value??'').trim().replace(',','.');
  const n=raw===''?NaN:Number(raw);
  return Number.isFinite(n)?n:null;
};
// A past season appends itself to the player's URL — .../osimhen/4661/2022-23 — where the current
// one stops at the id. Requiring the id at the end of the href silently parsed zero rows.
const PLAYER_HREF=/\/serie-a\/squadre\/[^/"]+\/[^/"]+\/(\d+)(?:\/[\d-]+)?"/;

export function parseSeasonStats(html:string):SeasonTotals[]{
  const out:SeasonTotals[]=[];
  for(const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g)??[]){
    const id=row.match(PLAYER_HREF)?.[1];
    if(!id)continue;
    const cells=Object.fromEntries([...row.matchAll(/data-col-key="([^"]+)"[^>]*>([\s\S]*?)<\/t[dh]>/g)]
      .map(([,key,body])=>[key,text(body)]));
    if(!('pg' in cells))continue;
    const name=text(row.match(/<a class="player-name player-link"[\s\S]*?<\/a>/)?.[0]??'');
    if(!name)continue;
    out.push({player_id:Number(id),name,team:cells.sq||null,
      role:row.match(/class="role"\s*data-value="([^"]*)"/)?.[1]?.toUpperCase()??null,
      played:number(cells.pg),grade:number(cells.mv),fantasyGrade:number(cells.mfv),
      goals:number(cells.gol),conceded:number(cells.gs),penaltiesSaved:number(cells.rp),
      assists:number(cells.ass),yellow:number(cells.amm),red:number(cells.esp),ownGoals:number(cells.au)});
  }
  return out;
}

// Seasons in the source's own spelling, newest first, starting from the one before `current`.
// The pages stop somewhere in the last decade; asking for more simply returns nothing to import.
export function previousSeasons(current:string,count=4):string[]{
  const match=current.match(/^(\d{4})-(\d{2})$/);
  if(!match)throw new Error('Stagione non riconosciuta.');
  const start=Number(match[1]);
  return Array.from({length:count},(_,i)=>start-1-i).map(year=>`${year}-${String((year+1)%100).padStart(2,'0')}`);
}
