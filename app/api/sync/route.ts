import { getAppUser } from '@/app/auth';
import { syncFromConnector } from '@/lib/sync';
const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user) return Response.json({ error: 'Accesso richiesto.' }, { status: 401, headers });
  if (user.role !== 'admin') return Response.json({ error: 'Operazione riservata all’amministratore.' }, { status: 403, headers });
  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: 'Origine non autorizzata.' }, { status: 403, headers });
  try {
    const input = await request.json() as { round?: unknown };
    const round = Number(input.round ?? 1);
    return Response.json(await syncFromConnector(user.userId, round), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('non configurato') || message.includes('Giornata non valida')) return Response.json({ error: message }, { status: 503, headers });
    if (message.includes('Firma') || message.includes('autenticazione')) return Response.json({ error: message }, { status: 502, headers });
    console.error('sync_failed', message);
    return Response.json({ error: 'Sincronizzazione non riuscita. Nessun dato è stato modificato.' }, { status: 502, headers });
  }
}
