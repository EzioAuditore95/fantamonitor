import { getAppUser } from '@/app/auth';
import { listSnapshots,importSnapshots,listEvents } from '@/lib/archive';
import { ZodError } from 'zod';
import { listReviews } from '@/lib/reviews';
const headers={'Cache-Control':'private, no-store'};
export async function GET(){
  const user=await getAppUser();
  if(!user)return Response.json({error:'Accesso richiesto.'},{status:401,headers});
  try{return Response.json({canManage:user.role==='admin',snapshots:await listSnapshots(),reviews:await listReviews(),events:await listEvents()},{headers});}
  catch(e){console.error('archive_read_failed',e instanceof Error?e.message:'unknown');return Response.json({error:'Archivio non disponibile. Riprova tra poco.'},{status:503,headers});}
}
export async function POST(request:Request){
  const user=await getAppUser();
  if(!user)return Response.json({error:'Accesso richiesto.'},{status:401,headers});
  if(user.role!=='admin')return Response.json({error:'Operazione riservata all’amministratore.'},{status:403,headers});
  if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Origine non autorizzata.'},{status:403,headers});
  if(!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'Formato JSON richiesto.'},{status:415,headers});
  try{
    const reader=request.body?.getReader();if(!reader)throw new Error('File vuoto.');
    let size=0;const chunks:Uint8Array[]=[];
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>262144){await reader.cancel();return Response.json({error:'Il file supera 256 KB.'},{status:413,headers});}chunks.push(value);}
    const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}
    const result=await importSnapshots(JSON.parse(new TextDecoder().decode(bytes)),user.userId);
    return Response.json(result,{headers});
  }catch(e){
    if(e instanceof ZodError)return Response.json({error:e.issues[0]?.message??'Lettura non valida.'},{status:422,headers});
    if(e instanceof SyntaxError)return Response.json({error:'Il file non contiene JSON valido.'},{status:400,headers});
    const message=e instanceof Error?e.message:'';
    if(message.startsWith('Una lettura')||message.startsWith('Importa')||message==='File vuoto.')return Response.json({error:message},{status:409,headers});
    console.error('archive_import_failed',message);return Response.json({error:'Importazione non riuscita. Il file può essere riprovato senza duplicare le letture.'},{status:503,headers});
  }
}
