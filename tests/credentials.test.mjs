import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {seal,open,credentialKeyVersion} from '../lib/credentials.ts';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:3072,
 publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
test('a sealed secret only opens with the matching private key',()=>{
 const secret=JSON.stringify({u:'utente@example.com',p:'pa$$word con spazi e àccenti'});
 const sealed=seal(secret,publicKey);
 assert.match(sealed,/^v1\./);
 assert.ok(!sealed.includes('utente'),'il testo in chiaro non deve comparire nella busta');
 assert.equal(open(sealed,privateKey),secret);
 const other=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 assert.throws(()=>open(sealed,other.privateKey));
});
test('the envelope carries a storageState far larger than RSA could hold',()=>{
 // Playwright's storageState is kilobytes: that is the reason for the hybrid envelope.
 const state=JSON.stringify({cookies:Array.from({length:120},(_,i)=>({name:`c${i}`,value:'x'.repeat(200),domain:'leghe.fantacalcio.it'}))});
 assert.ok(state.length>20000);
 assert.equal(open(seal(state,publicKey),privateKey),state);
});
test('a tampered envelope is rejected, never silently truncated',()=>{
 const sealed=seal('segreto',publicKey),parts=sealed.split('.');
 assert.equal(parts.length,5);
 const flip=s=>{const b=Buffer.from(s,'base64url');b[0]^=0xff;return b.toString('base64url');};
 for(const index of [1,2,3,4]){
  const broken=[...parts];broken[index]=flip(broken[index]);
  assert.throws(()=>open(broken.join('.'),privateKey),undefined,`parte ${index} manomessa`);
 }
 assert.throws(()=>open('v2.'+parts.slice(1).join('.'),privateKey),/Busta non riconosciuta/);
 assert.throws(()=>open('non-una-busta',privateKey),/Busta non riconosciuta/);
});

test('the key version comes from configuration, not from the code',()=>{
 // Era scritta fissa a 1: il campo esisteva, la migrazione lo valorizzava, ma non
 // distingueva una chiave dall'altra — quindi non diceva se un segreto fosse ancora apribile.
 const saved=process.env.FM_CREDENTIAL_KEY_VERSION;
 try{
  delete process.env.FM_CREDENTIAL_KEY_VERSION;
  assert.equal(credentialKeyVersion(),1,'senza configurazione vale 1');
  process.env.FM_CREDENTIAL_KEY_VERSION='2';
  assert.equal(credentialKeyVersion(),2);
  process.env.FM_CREDENTIAL_KEY_VERSION='17';
  assert.equal(credentialKeyVersion(),17);
  for(const bad of ['0','-1','due','1.5','']){
   process.env.FM_CREDENTIAL_KEY_VERSION=bad;
   if(bad===''){assert.equal(credentialKeyVersion(),1,'stringa vuota = non configurata');continue;}
   assert.throws(()=>credentialKeyVersion(),/intero positivo/,`accettato "${bad}"`);
  }
 }finally{
  if(saved===undefined)delete process.env.FM_CREDENTIAL_KEY_VERSION;
  else process.env.FM_CREDENTIAL_KEY_VERSION=saved;
 }
});
