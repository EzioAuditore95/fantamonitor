import { z } from 'zod';
import { requireLeagueMember } from '@/app/auth';
import { syncFromConnector } from '@/lib/sync';
const headers = { 'Cache-Control': 'private, no-store' };
const syncInputSchema = z.object({ league: z.string().min(1), round: z.number().int().min(1) }).strict();

export async function POST(request: Request) {
  let input: z.infer<typeof syncInputSchema>;
  try { input = syncInputSchema.parse(await request.json()); }
  catch { return Response.json({ error: 'Richiesta non valida.' }, { status: 422, headers }); }
  const ctx = await requireLeagueMember(input.league);
  if (ctx instanceof Response) return ctx;
  const { user, cfg } = ctx;
  if (user.role !== 'admin') return Response.json({ error: 'Operazione riservata all’amministratore.' }, { status: 403, headers });
  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: 'Origine non autorizzata.' }, { status: 403, headers });
  try {
    return Response.json(await syncFromConnector(cfg, input.round), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('non configurato') || message.includes('Giornata non valida')) return Response.json({ error: message }, { status: 503, headers });
    if (message.includes('Firma') || message.includes('autenticazione')) return Response.json({ error: message }, { status: 502, headers });
    console.error('sync_failed', message);
    return Response.json({ error: 'Sincronizzazione non riuscita. Nessun dato è stato modificato.' }, { status: 502, headers });
  }
}
