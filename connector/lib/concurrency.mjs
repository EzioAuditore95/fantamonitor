// Two separate primitives because they solve two different problems: the per-league mutex
// prevents two simultaneous logins on one league, the global limit prevents too many
// Chromium contexts at once from blowing up the container's memory.
export function createLimiter(max){
  if(!Number.isInteger(max)||max<1)throw new Error('invalid_limit');
  let active=0;const waiting=[];
  const next=()=>{if(active>=max)return;const task=waiting.shift();if(!task)return;active++;task();};
  return {
    get active(){return active;},
    get queued(){return waiting.length;},
    run(fn){
      return new Promise((resolve,reject)=>{
        waiting.push(()=>{
          Promise.resolve().then(fn).then(resolve,reject).finally(()=>{active--;next();});
        });
        next();
      });
    },
  };
}
export function createKeyedMutex(){
  const chains=new Map();
  return {
    get size(){return chains.size;},
    run(key,fn){
      const previous=chains.get(key)??Promise.resolve();
      // The chain must not break when a task fails: the next one still has to run.
      const current=previous.then(()=>fn(),()=>fn());
      // Compared against `tail`, which is what was actually stored: comparing against
      // `current` would never match and the map would grow without bound.
      const tail=current.then(()=>{},()=>{}).then(()=>{if(chains.get(key)===tail)chains.delete(key);});
      chains.set(key,tail);
      return current;
    },
  };
}
