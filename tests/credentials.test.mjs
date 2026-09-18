import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {seal,open} from '../lib/credentials.ts';
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
