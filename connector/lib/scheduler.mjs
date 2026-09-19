import crypto from 'node:crypto';
// Pure half of the scheduler shell, so the bearer check is testable without a server.
// Constant-time on purpose: the original compared with `===`, and this token is the only
// thing standing between the public internet and a forced synchronization.
export function bearerMatches(header,secret){
  if(!secret)return false;
  const offered=String(header||'');
  const expected=`Bearer ${secret}`;
  const a=Buffer.from(offered),b=Buffer.from(expected);
  if(a.length!==b.length)return false;
  return crypto.timingSafeEqual(a,b);
}
// The shell signs an empty body with the same HMAC that already protects /sync, so the
// connector gains no new kind of authentication.
export function signedRequest(secret,body='{}',now=Date.now()){
  const timestamp=String(now);
  return {timestamp,body,signature:crypto.createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex')};
}
