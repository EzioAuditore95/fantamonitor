import { createHmac, timingSafeEqual } from 'node:crypto';
import { snapshotSchema, normalize, type Snapshot } from './model';
import { importSnapshots } from './archive';

const MAX_RESPONSE = 262_144;
function secret() { return process.env.FANTAMONITOR_CONNECTOR_SECRET ?? ''; }
function signature(timestamp: string, body: string) {
  return createHmac('sha256', secret()).update(`${timestamp}.${body}`).digest('hex');
}

export async function syncFromConnector(userId: string, round: number) {
  const endpoint = process.env.FANTAMONITOR_CONNECTOR_URL;
  if (!endpoint || !secret()) throw new Error('Connettore non configurato.');
  if (!Number.isInteger(round) || round < 1 || round > 35) throw new Error('Giornata non valida.');
  const timestamp = String(Date.now());
  const requestBody = JSON.stringify({ round });
  const normalizedEndpoint = /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`;
  const response = await fetch(normalizedEndpoint.replace(/\/$/, '') + '/sync', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-fm-timestamp': timestamp, 'x-fm-signature': signature(timestamp, requestBody) },
    body: requestBody, cache: 'no-store', signal: AbortSignal.timeout(25_000),
  });
  const text = await response.text();
  if (text.length > MAX_RESPONSE) throw new Error('Risposta del connettore troppo grande.');
  if (!response.ok) throw new Error(response.status === 401 ? 'Autenticazione del connettore rifiutata.' : 'Connettore non disponibile.');
  const returnedSignature = response.headers.get('x-fm-signature') ?? '';
  const expected = signature(timestamp, text);
  if (!returnedSignature || returnedSignature.length !== expected.length || !timingSafeEqual(Buffer.from(returnedSignature), Buffer.from(expected))) throw new Error('Firma del connettore non valida.');
  const payload = JSON.parse(text) as { snapshot?: unknown };
  const snapshot = normalize(snapshotSchema.parse(payload.snapshot));
  return { ...(await importSnapshots(snapshot, userId)), round: snapshot.round, observedAt: snapshot.observed_at };
}
