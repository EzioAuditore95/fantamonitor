import { constants,createCipheriv,createDecipheriv,privateDecrypt,publicEncrypt,randomBytes } from 'node:crypto';

// Hybrid envelope: a random AES key per message, sealed with RSA-OAEP. Playwright's
// storageState is far past RSA's size limit, and a single format means never picking a
// scheme based on how big the secret happens to be.
// Layout: v1.<rsa(aes key)>.<iv>.<tag>.<ciphertext>, all base64url.
const VERSION='v1';
const b64=(b:Buffer)=>b.toString('base64url');
const unb64=(s:string)=>Buffer.from(s,'base64url');
function pem(value:string){const text=value.includes('-----BEGIN')?value:Buffer.from(value,'base64').toString('utf8');return text.trim();}

export function credentialPublicKey():string|null{const raw=process.env.FM_CREDENTIAL_PUBLIC_KEY;return raw?pem(raw):null;}
export function credentialsConfigured(){return Boolean(credentialPublicKey());}
// La versione dice con quale chiave è stato sigillato un segreto, e si alza insieme alla
// chiave pubblica quando si ruota. Scriverla fissa nel codice rendeva il campo inutile.
export function credentialKeyVersion():number{
  const raw=process.env.FM_CREDENTIAL_KEY_VERSION;
  if(!raw)return 1;
  const value=Number(raw);
  if(!Number.isInteger(value)||value<1)throw new Error('FM_CREDENTIAL_KEY_VERSION non è un intero positivo.');
  return value;
}

export function seal(plaintext:string,publicKey:string=credentialPublicKey()??''):string{
  if(!publicKey)throw new Error('Chiave di cifratura non configurata.');
  const key=randomBytes(32),iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  const body=Buffer.concat([cipher.update(plaintext,'utf8'),cipher.final()]);
  const sealedKey=publicEncrypt({key:publicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key);
  return [VERSION,b64(sealedKey),b64(iv),b64(cipher.getAuthTag()),b64(body)].join('.');
}

// Opens an envelope. The private key lives ONLY on the connector: the web app must never
// call this with a real key — it is here to keep the format in one place and to make the
// round-trip test possible.
export function open(sealed:string,privateKey:string):string{
  const parts=sealed.split('.');
  if(parts.length!==5||parts[0]!==VERSION)throw new Error('Busta non riconosciuta.');
  const [,sealedKey,iv,tag,body]=parts;
  const key=privateDecrypt({key:pem(privateKey),padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},unb64(sealedKey));
  const decipher=createDecipheriv('aes-256-gcm',key,unb64(iv));
  decipher.setAuthTag(unb64(tag));
  return Buffer.concat([decipher.update(unb64(body)),decipher.final()]).toString('utf8');
}

// Same convention as secretFingerprint in lib/sync.ts: identifies without revealing.
export async function fingerprint(value:string){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('').slice(0,12);
}
