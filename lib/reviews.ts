import { env } from 'cloudflare:workers';
import { TEAM_NAMES, canonical } from './model';
import { reviewInputSchema, type Review } from './penalties';
const scope=['chefantavitae10','2026-2027','337500'];
function db():D1Database {if(!env.DB)throw new Error('Storage unavailable');return env.DB;}
export class ReviewConflict extends Error {}
export async function listReviews():Promise<Review[]>{
  const result=await db().prepare('SELECT id,revision,recorded_at,body FROM lineup_reviews WHERE league=? AND season=? AND competition=? ORDER BY recorded_at,revision').bind(...scope).all<{id:string;revision:number;recorded_at:string;body:string}>();
  return result.results.map(row=>({...JSON.parse(row.body),id:row.id,revision:row.revision,recorded_at:row.recorded_at}));
}
export async function saveReview(input:unknown,user:string){
  const parsed=reviewInputSchema.parse(input);
  if(!TEAM_NAMES.includes(parsed.team))throw new ReviewConflict('Squadra non appartenente alla lega.');
  const {expected_revision,...body}=parsed;
  const previous=await db().prepare('SELECT revision,body FROM lineup_reviews WHERE league=? AND season=? AND competition=? AND team=? AND round=? ORDER BY revision DESC LIMIT 1').bind(...scope,body.team,body.round).first<{revision:number;body:string}>();
  // A retry after a lost response never adds an extra review or monetary charge.
  if(previous?.revision===expected_revision+1&&previous.body===canonical(body))return {saved:true,duplicate:true};
  if((previous?.revision??0)!==expected_revision)throw new ReviewConflict('Il registro è cambiato. Rileggi i dati prima di salvare nuovamente.');
  try{
    await db().prepare('INSERT INTO lineup_reviews (id,league,season,competition,team,round,revision,recorded_at,recorded_by,body) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(),...scope,body.team,body.round,expected_revision+1,new Date().toISOString(),user,canonical(body)).run();
  }catch(e){
    if(e instanceof Error && e.message.includes('UNIQUE constraint'))throw new ReviewConflict('Un altro aggiornamento è stato salvato. Rileggi i dati prima di riprovare.');
    throw e;
  }
  return {saved:true,duplicate:false};
}
