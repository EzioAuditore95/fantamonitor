import http from 'node:http';
import { spawn } from 'node:child_process';

const port=Number(process.env.PORT||8080);
const eventSecret=process.env.EVENT_SCHEDULER_SECRET||'';
let running=false;

function json(res,status,body){
  res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify(body));
}

function authorized(req){
  const header=String(req.headers.authorization||'');
  return Boolean(eventSecret)&&header===`Bearer ${eventSecret}`;
}

function runCron(){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['cron.mjs'],{cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('scheduler_child_timeout'));},120000);
    child.stdout.on('data',chunk=>{stdout+=chunk.toString();process.stdout.write(chunk);});
    child.stderr.on('data',chunk=>{stderr+=chunk.toString();process.stderr.write(chunk);});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('exit',code=>{
      clearTimeout(timer);
      if(code===0)resolve({ok:true,stdout:stdout.slice(-1200)});
      else reject(new Error(`scheduler_child_exit_${code}:${stderr.slice(-600)}`));
    });
  });
}

const server=http.createServer(async(req,res)=>{
  if(req.method==='GET'&&req.url==='/health')return json(res,200,{ok:true,running});
  if(req.method!=='POST'||req.url!=='/run')return json(res,404,{error:'not_found'});
  if(!authorized(req))return json(res,401,{error:'unauthorized'});
  if(running)return json(res,202,{status:'already_running'});
  running=true;
  try{
    const result=await runCron();
    return json(res,200,{status:'complete',result});
  }catch(error){
    console.error('event_scheduler_failed',{error:error instanceof Error?error.message:String(error)});
    return json(res,500,{error:error instanceof Error?error.message:String(error)});
  }finally{
    running=false;
  }
});

server.listen(port,()=>console.log(`event scheduler listening on ${port}`));
