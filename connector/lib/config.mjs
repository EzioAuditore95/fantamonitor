import crypto from 'node:crypto';
// Un solo processo serve tutte le leghe: qui restano solo i segreti dell'infrastruttura.
// Slug, competizione, stagione, squadre e canali Telegram vivono ora in fm_leagues.
export const port=Number(process.env.PORT||8080);
export const secret=process.env.FANTAMONITOR_CONNECTOR_SECRET||'';
export const supabaseUrl=process.env.SUPABASE_URL||'';
export const supabaseKey=process.env.SUPABASE_PUBLISHABLE_KEY||'';
export const autoSyncSecret=process.env.AUTO_SYNC_DB_SECRET||'';
export const telegramBotToken=process.env.TELEGRAM_BOT_TOKEN||'';
export const credentialPrivateKey=process.env.FM_CREDENTIAL_PRIVATE_KEY||'';
export const publicUrl=(process.env.CONNECTOR_PUBLIC_URL||'https://fantamonitor-connector-production.up.railway.app').replace(/\/$/,'');
export const appUrl=(process.env.FANTAMONITOR_PUBLIC_URL||'https://fantamonitor-production.up.railway.app').replace(/\/$/,'');
export const telegramWebhookSecret=telegramBotToken?crypto.createHash('sha256').update(telegramBotToken).digest('hex').slice(0,48):'';
export const secretFingerprint=crypto.createHash('sha256').update(secret).digest('hex').slice(0,12);
// Un contesto Chromium costa 50–80 MB: la memoria del container è il limite di scala reale.
export const maxBrowserContexts=Number(process.env.CONNECTOR_MAX_CONTEXTS||2);
export const sessionTtlMs=Number(process.env.CONNECTOR_SESSION_TTL_MS||12*60*60*1000);
export const sign=(timestamp,body)=>crypto.createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex');
