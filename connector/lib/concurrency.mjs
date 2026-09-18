// Due primitive separate perché risolvono due problemi diversi:
// il mutex per lega evita due login simultanei sulla stessa lega, il limite globale
// evita di far esplodere la memoria del container con troppi contesti Chromium insieme.
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
      // La catena non deve interrompersi se un task fallisce: il prossimo deve comunque partire.
      const current=previous.then(()=>fn(),()=>fn());
      // Si confronta con `tail`, cioè proprio ciò che è stato memorizzato: confrontare con
      // `current` non corrisponderebbe mai e la mappa crescerebbe senza fine.
      const tail=current.then(()=>{},()=>{}).then(()=>{if(chains.get(key)===tail)chains.delete(key);});
      chains.set(key,tail);
      return current;
    },
  };
}
