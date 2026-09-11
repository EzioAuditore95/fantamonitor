import { createClient } from './supabase/server';
import {TEAM_NAMES} from './model';
import {reviewInputSchema,type Review} from './penalties';
export class ReviewConflict extends Error {}
export async function listReviews():Promise<Review[]>{
 const client=await createClient();const rows:Review[]=[];
 for(let offset=0;;offset+=500){const {data,error}=await client.from('fm_lineup_reviews').select('id,revision,recorded_at,body').order('recorded_at').order('id').range(offset,offset+499);if(error)throw new Error('Reviews unavailable');
 rows.push(...data.map(r=>({...r.body,id:r.id,revision:r.revision,recorded_at:r.recorded_at})));if(data.length<500)break;}return rows;
}
export async function saveReview(input:unknown,_user:string){
 const {expected_revision,...record}=reviewInputSchema.parse(input);if(!TEAM_NAMES.includes(record.team))throw new ReviewConflict('Squadra non appartenente alla lega.');
 const client=await createClient();const {data,error}=await client.rpc('fm_save_review',{record,expected_revision});
 if(error){if(error.message.includes('review_conflict'))throw new ReviewConflict('Il registro è cambiato. Rileggi i dati prima di salvare nuovamente.');throw new Error('Review save failed');}
 return data;
}
