import { getChatGPTUser } from '@/app/chatgpt-auth';
import { saveReview, ReviewConflict } from '@/lib/reviews';
import { ZodError } from 'zod';
const headers={'Cache-Control':'private, no-store'};
export async function POST(request:Request){
  const user=await getChatGPTUser();
  if(!user)return Response.json({error:'Accesso richiesto.'},{status:401,headers});
  if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Origine non autorizzata.'},{status:403,headers});
  if(!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'Formato JSON richiesto.'},{status:415,headers});
  try{
    const reader=request.body?.getReader();if(!reader)return Response.json({error:'Esito assente.'},{status:400,headers});
    let size=0;const chunks:Uint8Array[]=[];
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();return Response.json({error:'Esito troppo grande.'},{status:413,headers});}chunks.push(value);}
    const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}
    return Response.json(await saveReview(JSON.parse(new TextDecoder().decode(bytes)),user.userId),{headers});
  }catch(e){
    if(e instanceof ZodError)return Response.json({error:e.issues[0]?.message??'Esito non valido.'},{status:422,headers});
    if(e instanceof SyntaxError)return Response.json({error:'JSON non valido.'},{status:400,headers});
    if(e instanceof ReviewConflict)return Response.json({error:e.message},{status:409,headers});
    console.error('review_save_failed',e instanceof Error?e.message:'unknown');
    return Response.json({error:'Salvataggio non riuscito. Puoi riprovare senza duplicare le penalità.'},{status:503,headers});
  }
}
