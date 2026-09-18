import crypto from 'node:crypto';
import { credentialPrivateKey } from './config.mjs';
// Twin of lib/credentials.ts on the app side: same format, opposite direction.
// The PRIVATE key lives here, and only here. Layout: v1.<rsa(key)>.<iv>.<tag>.<data>
const VERSION='v1';
const unb64=s=>Buffer.from(s,'base64url');
function pem(value){const text=value.includes('-----BEGIN')?value:Buffer.from(value,'base64').toString('utf8');return text.trim();}

export function credentialsConfigured(){return Boolean(credentialPrivateKey);}
export function open(sealed,privateKey=credentialPrivateKey){
  if(!privateKey)throw new Error('connector_credential_key_missing');
  const parts=String(sealed||'').split('.');
  if(parts.length!==5||parts[0]!==VERSION)throw new Error('connector_credential_malformed');
  const [,sealedKey,iv,tag,body]=parts;
  const key=crypto.privateDecrypt({key:pem(privateKey),padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},unb64(sealedKey));
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,unb64(iv));
  decipher.setAuthTag(unb64(tag));
  return Buffer.concat([decipher.update(unb64(body)),decipher.final()]).toString('utf8');
}
export function seal(plaintext,publicKeyOrPrivate=credentialPrivateKey){
  if(!publicKeyOrPrivate)throw new Error('connector_credential_key_missing');
  const key=crypto.randomBytes(32),iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const body=Buffer.concat([cipher.update(plaintext,'utf8'),cipher.final()]);
  // The public key is derived from the private one: the connector reseals for itself.
  const pub=crypto.createPublicKey(pem(publicKeyOrPrivate));
  const sealedKey=crypto.publicEncrypt({key:pub,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key);
  const b64=b=>b.toString('base64url');
  return [VERSION,b64(sealedKey),b64(iv),b64(cipher.getAuthTag()),b64(body)].join('.');
}
export const usernameFingerprint=value=>crypto.createHash('sha256').update(String(value||'')).digest('hex').slice(0,12);
