import { getAppUser } from '@/app/auth';
import { TEAM_NAMES,type MatchResult,type PerformancePayload,type StandingRow } from '@/lib/performance';

const headers={'Cache-Control':'private, no-store'};
const ORIGIN='https://leghe.fantacalcio.it';
const LEAGUE='chefantavitae10';
const ROOT=`${ORIGIN}/${LEAGUE}`;

function entities(value:string){return value.replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&agrave;/gi,'à').replace(/&egrave;/gi,'è').replace(/&igrave;/gi,'ì').replace(/&ograve;/gi,'ò').replace(/&ugrave;/gi,'ù').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));}
function linesFromHtml(html:string){
  const cleaned=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'\n').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'\n').replace(/<!--([\s\S]*?)-->/g,'\n').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(?:div|p|li|tr|td|th|h[1-6]|section|article|a)>/gi,'\n').replace(/<[^>]+>/g,' ');
  return entities(cleaned).split(/\r?\n/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
}
function num(value:string){const s=value.replace(/\./g,'').replace(',','.').replace(/[^\d.-]/g,'');if(!s||!/^[-]?\d+(?:\.\d+)?$/.test(s))return null;const n=Number(s);return Number.isFinite(n)?n:null;}
function exactTeam(line:string){return TEAM_NAMES.find(t=>line===t||line.replace(/\d+$/,'').trim()===t)||null;}
function numericSlice(lines:string[],start:number,end:number){const out:number[]=[];for(let i=start;i<Math.min(end,lines.length);i++){const n=num(lines[i]);if(n!=null)out.push(n);}return out;}
function roundNear(lines:string[],index:number){
  for(let i=index;i>=Math.max(0,index-35);i--){const s=lines[i];let m=s.match(/(\d+)\s*[°ºª]?\s*(?:Euro)?Lega/i);if(m)return Number(m[1]);m=s.match(/Giornata\s*(\d+)/i);if(m)return Number(m[1]);m=s.match(/(\d+)\s*[°ºª]?\s*Giornata/i);if(m)return Number(m[1]);}
  return null;
}
function parseMatches(lines:string[]):MatchResult[]{
  const teamIndexes=lines.map((line,i)=>({i,team:exactTeam(line)})).filter((x):x is {i:number;team:string}=>Boolean(x.team));
  const matches:MatchResult[]=[];const seen=new Set<string>();
  for(let x=0;x<teamIndexes.length-1;x++){
    const a=teamIndexes[x],b=teamIndexes[x+1];if(a.team===b.team||b.i-a.i>12)continue;
    const aNums=numericSlice(lines,a.i+1,b.i);if(aNums.length<1||aNums.length>2)continue;
    const next=teamIndexes[x+2]?.i??Math.min(lines.length,b.i+12);const bNums=numericSlice(lines,b.i+1,next);if(bNums.length<1||bNums.length>2)continue;
    const round=roundNear(lines,a.i);if(!round||round<1||round>35)continue;
    const aGoal=aNums.find(n=>Number.isInteger(n)&&n>=0&&n<=20);const bGoal=bNums.find(n=>Number.isInteger(n)&&n>=0&&n<=20);if(aGoal==null||bGoal==null)continue;
    const aFantasy=aNums.find(n=>n>=40&&n<=150)??null,bFantasy=bNums.find(n=>n>=40&&n<=150)??null;
    const key=`${round}:${a.team}:${b.team}`;const rev=`${round}:${b.team}:${a.team}`;if(seen.has(key)||seen.has(rev))continue;
    seen.add(key);matches.push({round,home:a.team,away:b.team,homeGoals:aGoal,awayGoals:bGoal,homeFantasy:aFantasy,awayFantasy:bFantasy});x++;
  }
  return matches.sort((a,b)=>a.round-b.round);
}
function parseStandings(lines:string[]):StandingRow[]{
  const result:StandingRow[]=[];const seen=new Set<string>();
  for(let i=0;i<lines.length;i++){
    const name=exactTeam(lines[i]);if(!name||seen.has(name))continue;
    const nextTeam=lines.findIndex((line,j)=>j>i&&exactTeam(line)!=null);const end=nextTeam>0?Math.min(nextTeam,i+24):Math.min(lines.length,i+24);
    const ns=numericSlice(lines,i+1,end);
    if(ns.length<9)continue;
    const [played,wins,draws,losses,gf,ga,,points,fantasyTotal]=ns;
    if(![played,wins,draws,losses,gf,ga,points].every(Number.isFinite)||played<0||played>35||wins+draws+losses!==played)continue;
    result.push({name,played,wins,draws,losses,goalsFor:gf,goalsAgainst:ga,points,fantasyTotal:fantasyTotal>=0?fantasyTotal:null});seen.add(name);
  }
  return result;
}
function candidateUrls(html:string){
  const urls=new Set<string>([ROOT]);const re=/href=["']([^"']+)["']/gi;let m:RegExpExecArray|null;
  while((m=re.exec(html))){try{const u=new URL(entities(m[1]),ROOT);if(u.origin!==ORIGIN||!u.pathname.startsWith(`/${LEAGUE}`))continue;if(/calend|risultat|classific|statistic|competit/i.test(u.pathname+u.search))urls.add(u.toString());}catch{}}
  return [...urls].slice(0,12);
}
async function read(url:string){const response=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 FANTAMONITOR/1.0','accept-language':'it-IT,it;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.text();}

export async function GET(){
  const user=await getAppUser();if(!user)return Response.json({error:'Accesso richiesto.'},{status:401,headers});
  try{
    const warnings:string[]=[];const rootHtml=await read(ROOT);const urls=candidateUrls(rootHtml);const pages:{url:string;html:string}[]=[{url:ROOT,html:rootHtml}];
    await Promise.all(urls.filter(x=>x!==ROOT).map(async url=>{try{pages.push({url,html:await read(url)});}catch{warnings.push(`Sorgente secondaria non leggibile: ${new URL(url).pathname}`);}}));
    const matchMap=new Map<string,MatchResult>();let standings:StandingRow[]=[];
    for(const page of pages){const lines=linesFromHtml(page.html);for(const m of parseMatches(lines)){const key=`${m.round}:${[m.home,m.away].sort().join('|')}`;const old=matchMap.get(key);if(!old||(old.homeFantasy==null&&m.homeFantasy!=null))matchMap.set(key,m);}const parsed=parseStandings(lines);if(parsed.length>standings.length)standings=parsed;}
    const matches=[...matchMap.values()].sort((a,b)=>a.round-b.round);
    if(!matches.length)warnings.push('Lo storico risultati non è ancora esposto in forma leggibile dalla pagina pubblica della lega.');
    if(!standings.length)warnings.push('La classifica non è ancora esposta in forma leggibile dalla pagina pubblica della lega.');
    const payload:PerformancePayload={source:ROOT,fetchedAt:new Date().toISOString(),matches,standings,warnings};
    return Response.json(payload,{headers});
  }catch(error){console.error('performance_fetch_failed',error instanceof Error?error.message:error);return Response.json({error:'Dati performance non disponibili dalla sorgente Fantacalcio.'},{status:502,headers});}
}
