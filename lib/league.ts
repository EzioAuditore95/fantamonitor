export type LeagueTeam={name:string;position:number;color:string;fantacalcioTeamId?:number};
export type LeaguePeriod={key:string;label:string;rounds:number[]};
export type LeaguePeriodMode='half'|'season';
// Sorgente della configurazione: rispecchia una riga di fm_leagues. La config derivata
// si ottiene con makeLeagueConfig e non va costruita a mano.
export type LeagueDefinition={
  id:string;slug:string;name:string;season:string;competitionId:string;
  teams:LeagueTeam[];roundCount:number;serieAOffset:number;
  periodMode:LeaguePeriodMode;firstHalfEnd:number|null;
  freeTokens:number;penaltyAmount:number;
  rules:Record<string,unknown>;updatedAt:string;
};
export type LeagueConfig=LeagueDefinition&{teamCount:number;periods:LeaguePeriod[]};
export const AGGREGATE_PERIOD='complessivo';

const range=(from:number,to:number)=>Array.from({length:to-from+1},(_,i)=>from+i);
function derivePeriods(def:LeagueDefinition):LeaguePeriod[]{
  if(def.periodMode==='season')return [{key:'stagione',label:'Stagione',rounds:range(1,def.roundCount)}];
  const split=def.firstHalfEnd;
  if(!split||split<1||split>=def.roundCount)throw new Error('Configurazione della lega non valida: girone di andata fuori intervallo.');
  return [{key:'andata',label:'Andata',rounds:range(1,split)},{key:'ritorno',label:'Ritorno',rounds:range(split+1,def.roundCount)}];
}
export function makeLeagueConfig(def:LeagueDefinition):LeagueConfig{return {...def,teamCount:def.teams.length,periods:derivePeriods(def)};}

export const CHEFANTAVITAE10=makeLeagueConfig({
  id:'9f3a1c60-5d4e-4b7a-9c21-6f0e2a8d4b13',
  slug:'chefantavitae10',name:'CheFantaVitaE10',season:'2026-2027',competitionId:'337500',
  teams:[
    {name:'AC Idovalproico',position:1,color:'#b6a1f7'},
    {name:'Atletico Fontanelle',position:2,color:'#efa88d'},
    {name:'FC LBVLA',position:3,color:'#8bb8f6'},
    {name:'FC SEMINI',position:4,color:'#e4bc6e'},
    {name:'FC Villaggio Mau Mau',position:5,color:'#91cdd0'},
    {name:'FDS Sballo',position:6,color:'#afbcf3'},
    {name:'I PIPPISTRELLI',position:7,color:'#d4ee8a'},
    {name:'Pro Spritz',position:8,color:'#f0a0b8'},
    {name:'Real Hasbulla',position:9,color:'#c3e878'},
    {name:'Salamandre',position:10,color:'#b9a6ec'},
  ],
  roundCount:35,serieAOffset:3,periodMode:'half',firstHalfEnd:16,
  freeTokens:1,penaltyAmount:5,
  rules:{season_label:'Stagione 2026 / 27 · Serie A',mode_label:'CLASSIC',formula_one_base_eur:70,europe_top:5},
  updatedAt:'2026-09-16T00:00:00.000Z',
});

export const teamNames=(cfg:LeagueConfig)=>cfg.teams.map(t=>t.name);
export const leaguePath=(cfg:LeagueConfig)=>`/${cfg.slug}/view/competition/${cfg.competitionId}/`;
export function findPeriod(cfg:LeagueConfig,key:string){const p=cfg.periods.find(x=>x.key===key);if(!p)throw new Error('Periodo non valido per questa lega.');return p;}
export function periodForRound(cfg:LeagueConfig,round:number):LeaguePeriod{
  if(!Number.isInteger(round)||round<1||round>cfg.roundCount)throw new Error('Giornata di lega non valida.');
  const period=cfg.periods.find(p=>p.rounds.includes(round));
  if(!period)throw new Error('Giornata di lega non valida.');
  return period;
}
// Nessun colore configurato non deve produrre un crest trasparente: il fallback è
// deterministico sul nome, così una lega senza palette resta leggibile.
export function teamColor(cfg:LeagueConfig,name:string):string{
  const team=cfg.teams.find(t=>t.name===name);
  if(team?.color)return team.color;
  let hash=0;for(const char of name)hash=(hash*31+char.charCodeAt(0))|0;
  return `hsl(${Math.abs(hash)%360} 62% 78%)`;
}
