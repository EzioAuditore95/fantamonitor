import { constants,createCipheriv,createDecipheriv,privateDecrypt,publicEncrypt,randomBytes } from 'node:crypto';

// Busta ibrida: chiave AES casuale per messaggio, sigillata con RSA-OAEP. Serve perché lo
// storageState di Playwright supera abbondantemente il limite di RSA, e usare un solo
// formato evita di dover scegliere lo schema in base alla dimensione del segreto.
// Formato: v1.<rsa(chiave AES)>.<iv>.<tag>.<ciphertext>, tutti in base64url.
const VERSION='v1';
const b64=(b:Buffer)=>b.toString('base64url');
const unb64=(s:string)=>Buffer.from(s,'base64url');
function pem(value:string){const text=value.includes('-----BEGIN')?value:Buffer.from(value,'base64').toString('utf8');return text.trim();}

export function credentialPublicKey():string|null{const raw=process.env.FM_CREDENTIAL_PUBLIC_KEY;return raw?pem(raw):null;}
export function credentialsConfigured(){return Boolean(credentialPublicKey());}

export function seal(plaintext:string,publicKey:string=credentialPublicKey()??''):string{
  if(!publicKey)throw new Error('Chiave di cifratura non configurata.');
  const key=randomBytes(32),iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  const body=Buffer.concat([cipher.update(plaintext,'utf8'),cipher.final()]);
  const sealedKey=publicEncrypt({key:publicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key);
  return [VERSION,b64(sealedKey),b64(iv),b64(cipher.getAuthTag()),b64(body)].join('.');
}

// Apre una busta. La chiave privata vive SOLO sul connettore: la web app non deve mai
// chiamare questa funzione con una chiave reale — esiste qui per tenere il formato in
// un posto solo e per il test di andata e ritorno.
export function open(sealed:string,privateKey:string):string{
  const parts=sealed.split('.');
  if(parts.length!==5||parts[0]!==VERSION)throw new Error('Busta non riconosciuta.');
  const [,sealedKey,iv,tag,body]=parts;
  const key=privateDecrypt({key:pem(privateKey),padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},unb64(sealedKey));
  const decipher=createDecipheriv('aes-256-gcm',key,unb64(iv));
  decipher.setAuthTag(unb64(tag));
  return Buffer.concat([decipher.update(unb64(body)),decipher.final()]).toString('utf8');
}

// Convenzione già usata per secretFingerprint in lib/sync.ts: identifica senza rivelare.
export async function fingerprint(value:string){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('').slice(0,12);
}
