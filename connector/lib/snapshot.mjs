// Snapshot shape and league URLs. Deliberately free of Playwright: this is the part the
// tests can exercise without a browser.
import { extractFormation,metaNumber,metaString,metaUrl } from './fantacalcio.mjs';

const ORIGIN='https://leghe.fantacalcio.it';
const STARTERS=11;
export const manageLineupsUrl=(league,round)=>`${ORIGIN}/${league.slug}/view/competition/${league.competitionId}/manage-lineups/${round}`;
export const dashboardUrl=league=>`${ORIGIN}/${league.slug}/view/competition/${league.competitionId}/dashboard`;
export function toTeamStatus(item,round){
  const dto=item.dto;
  if(dto!=null&&typeof dto!=='object')throw new Error('connector_lineup_invalid_payload');
  if(dto&&Number(dto.tid)!==item.team.id)throw new Error('connector_lineup_team_mismatch');
  if(dto&&Number(dto.mday)!==round)throw new Error('connector_lineup_round_mismatch');
  const formation=extractFormation(dto);
  // `lucnt` conta i salvataggi della formazione di quella giornata, ed è l'unico campo che
  // distingue una scelta da un riporto automatico: provato il 21/09 sulla giornata 3, dove
  // l'utente ha inserito la propria formazione e il contatore è passato a 1 solo per lui,
  // mentre altre sei squadre avevano undici nomi e modulo — ereditati dalla giornata 2 — con
  // il contatore a zero. Undici nomi non bastano: Fantacalcio li restituisce comunque.
  const saves=Number(dto?.lucnt);
  // Se il campo sparisse dall'API si torna a contare i nomi: una sovrastima è meno dannosa di
  // un "non inserita" per l'intera lega, che qui significherebbe penali inventate.
  const present=Boolean(dto&&Number(dto.mday)===round
    &&(Number.isFinite(saves)?saves>0:(formation?.starters?.length??0)>=STARTERS));
  const meta=item.team.meta;
  const manager=metaString(meta,/(manager|owner|president|presidente|username|userName|coach)/i);
  const budget=metaNumber(meta,/(budget|credit|crediti|remainingCredits|fcredit)/i);
  const crest=metaUrl(meta,/(crest|logo|stemma|badge)/i);
  const kit=metaUrl(meta,/(kit|shirt|maglia|jersey)/i);
  const result={team_key:item.team.name,name:item.team.name,present,source_status:present?'check-circle':'Non inserita',team_id:item.team.id};
  if(manager)result.manager=manager;
  if(budget!==undefined)result.budget=budget;
  if(crest)result.crest_url=crest;
  if(kit)result.kit_url=kit;
  if(formation)result.formation=formation;
  return result;
}

// The snapshot takes its scope, teams and URLs from the league config, never from constants.
export function snapshotFor(league,round,teamsData,observedAt=new Date().toISOString()){
  return {schema_version:1,league:league.slug,season:league.season,competition_id:league.competitionId,
    round,observed_at:observedAt,source:'authenticated_ui',source_url:manageLineupsUrl(league,round),
    expected_total:league.teams.length,inserted:teamsData.filter(t=>t.present).length,teams:teamsData};
}


// --- competition (from phase2-patch.mjs) ------------------------------------
export function score(result){if(typeof result!=='string')return null;const m=result.match(/(\d+)\s*[-:]\s*(\d+)/);return m?{home:Number(m[1]),away:Number(m[2])}:null;}
export function standingRows(teamNames,calendar,idToName){
  const rows=new Map(teamNames.map(name=>[name,{name,played:0,wins:0,draws:0,losses:0,goalsFor:0,goalsAgainst:0,points:0,fantasyTotal:0}]));
  for(const round of calendar){
    if(!round.calculated)continue;
    for(const match of round.matches||[]){
      const home=idToName.get(Number(match.tIdH)),away=idToName.get(Number(match.tIdA));
      if(!home||!away)continue;
      const h=rows.get(home),a=rows.get(away),s=score(match.result);
      if(!h||!a)continue;
      h.played++;a.played++;
      h.points+=Number(match.standingPtH)||0;a.points+=Number(match.standingPtA)||0;
      h.fantasyTotal+=Number(match.ptH)||0;a.fantasyTotal+=Number(match.ptA)||0;
      if(s){h.goalsFor+=s.home;h.goalsAgainst+=s.away;a.goalsFor+=s.away;a.goalsAgainst+=s.home;
        if(s.home>s.away){h.wins++;a.losses++;}else if(s.home<s.away){a.wins++;h.losses++;}else{h.draws++;a.draws++;}}
    }
  }
  return [...rows.values()].sort((a,b)=>b.points-a.points||(b.goalsFor-b.goalsAgainst)-(a.goalsFor-a.goalsAgainst)||b.fantasyTotal-a.fantasyTotal);
}
export function competitionFrom(league,calendar,teamsPayload){
  if(!Array.isArray(calendar)||!Array.isArray(teamsPayload?.data))throw new Error('competition_payload_missing');
  const idToName=new Map(teamsPayload.data.map(t=>[Number(t.id),String(t.n||'').trim()]));
  const normalized=calendar.map(r=>({round:Number(r.matchDay),championshipRound:Number(r.championshipMatchDay),calculated:Boolean(r.calculated),
    matches:(r.matches||[]).map(m=>{const s=score(m.result);return {
      homeId:Number(m.tIdH),awayId:Number(m.tIdA),
      home:idToName.get(Number(m.tIdH))||String(m.tIdH),away:idToName.get(Number(m.tIdA))||String(m.tIdA),
      homeFantasy:r.calculated?Number(m.ptH):null,awayFantasy:r.calculated?Number(m.ptA):null,
      homeStandingPoints:r.calculated?Number(m.standingPtH):null,awayStandingPoints:r.calculated?Number(m.standingPtA):null,
      homeGoals:s?.home??null,awayGoals:s?.away??null,
      result:r.calculated&&m.result&&m.result!=='-'?String(m.result):null,
      resultSR:r.calculated&&m.resultSR?String(m.resultSR):null};})}));
  const matches=normalized.flatMap(r=>r.calculated?r.matches.filter(m=>m.homeGoals!=null&&m.awayGoals!=null)
    .map(m=>({round:r.round,home:m.home,away:m.away,homeGoals:m.homeGoals,awayGoals:m.awayGoals,homeFantasy:m.homeFantasy,awayFantasy:m.awayFantasy})):[]);
  return {source:dashboardUrl(league),fetchedAt:new Date().toISOString(),calendar:normalized,matches,
    standings:standingRows(league.teams,calendar,idToName),
    warnings:calendar.some(r=>r.calculated)?[]:['Nessuna giornata della lega è ancora stata calcolata.']};
}
