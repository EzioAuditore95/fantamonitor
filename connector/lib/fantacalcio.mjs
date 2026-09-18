// Fantacalcio payload extractors, moved verbatim from server.mjs.
// They know nothing about leagues: they work on the shape of the JSON, not its content.
export function findTeamObjects(value,out=[]){if(Array.isArray(value)){for(const item of value)findTeamObjects(item,out);return out;}if(!value||typeof value!=='object')return out;const name=typeof value.n==='string'?value.n:typeof value.name==='string'?value.name:typeof value.nome==='string'?value.nome:'';const id=Number(value.id??value.teamId??value.tid);if(name&&Number.isInteger(id)&&id>0)out.push({name:name.trim(),id,raw:value});for(const child of Object.values(value))findTeamObjects(child,out);return out;}
export function normalizeAssetUrl(value){if(typeof value!=='string'||!value.trim())return undefined;const x=value.trim();if(/^https?:\/\//i.test(x))return x;if(x.startsWith('//'))return `https:${x}`;if(x.startsWith('/'))return `https://leghe.fantacalcio.it${x}`;return undefined;}
export function findByKey(value,keyPattern,accept,depth=0,seen=new Set()){if(depth>8||!value||typeof value!=='object'||seen.has(value))return undefined;seen.add(value);if(Array.isArray(value)){for(const item of value){const hit=findByKey(item,keyPattern,accept,depth+1,seen);if(hit!==undefined)return hit;}return undefined;}for(const [key,child] of Object.entries(value)){if(keyPattern.test(key)){const accepted=accept(child);if(accepted!==undefined)return accepted;if(child&&typeof child==='object'){const nested=findByKey(child,/^(name|nome|label|value|url|src)$/i,accept,depth+1,seen);if(nested!==undefined)return nested;}}}for(const child of Object.values(value)){const hit=findByKey(child,keyPattern,accept,depth+1,seen);if(hit!==undefined)return hit;}return undefined;}
export function metaString(value,pattern){return findByKey(value,pattern,v=>typeof v==='string'&&v.trim()?v.trim():undefined);}
export function metaNumber(value,pattern){return findByKey(value,pattern,v=>{const n=Number(v);return Number.isFinite(n)?n:undefined;});}
export function metaUrl(value,pattern){return findByKey(value,pattern,v=>normalizeAssetUrl(v));}
export function directString(value,keys){if(!value||typeof value!=='object')return undefined;for(const key of keys){const v=value[key];if(typeof v==='string'&&v.trim())return v.trim();}return undefined;}
export function directNumber(value,keys){if(!value||typeof value!=='object')return undefined;for(const key of keys){const n=Number(value[key]);if(Number.isFinite(n))return n;}return undefined;}
export function playerFromObject(value,path){if(!value||typeof value!=='object'||Array.isArray(value))return null;const first=directString(value,['firstName','firstname','nome','fn']);const last=directString(value,['lastName','lastname','cognome','ln']);const name=directString(value,['playerName','displayName','fullName','name','n'])||[first,last].filter(Boolean).join(' ').trim();const role=directString(value,['role','ruolo','position','r']);const id=directNumber(value,['playerId','idPlayer','pid','idCalciatore','id']);const playerish=/player|calciator|giocator|rosa|roster|lineup|titol|bench|panch/i.test(path);if(!name||(!role&&!playerish))return null;const shirt=directNumber(value,['shirtNumber','numeroMaglia','number']);const image=metaUrl(value,/^(image|imageUrl|photo|photoUrl|picture|avatar|src)$/i);return {id:id??undefined,name,role:role||undefined,shirt_number:Number.isInteger(shirt)?shirt:undefined,image_url:image};}
export function extractPlayers(value,path='',out=[] ,seen=new Set(),depth=0){if(depth>9||value==null)return out;if(Array.isArray(value)){for(const item of value)extractPlayers(item,path,out,seen,depth+1);return out;}if(typeof value!=='object'||seen.has(value))return out;seen.add(value);const player=playerFromObject(value,path);if(player){const section=/bench|panch/i.test(path)?'bench':/start|titol|lineup|formation|schier/i.test(path)?'starters':'roster';out.push({...player,section});}for(const [key,child] of Object.entries(value))extractPlayers(child,`${path}/${key}`,out,seen,depth+1);return out;}
export function uniquePlayers(players){const seen=new Set();const out=[];for(const p of players){const key=String(p.id??'')+'|'+p.name.toLowerCase();if(seen.has(key))continue;seen.add(key);const {section,...clean}=p;out.push({...clean,section});}return out;}
export function extractFormation(dto){if(!dto||typeof dto!=='object')return undefined;const players=uniquePlayers(extractPlayers(dto));const starters=players.filter(p=>p.section==='starters').map(({section,...p})=>p);const bench=players.filter(p=>p.section==='bench').map(({section,...p})=>p);const roster=players.map(({section,...p})=>p);const module=metaString(dto,/^(module|modulo|formation|schema|system)$/i);if(!module&&!roster.length)return undefined;return {module:module||undefined,starters:starters.length?starters:undefined,bench:bench.length?bench:undefined,roster:roster.length?roster:undefined};}

// --- da phase1-patch.mjs ---------------------------------------------------
// Globally patching `fetch` and `Object.entries` cannot work with several leagues: the
// only context those patches had was the request URL. The same transformations are
// explicit here, applied by the caller, which knows which league it is talking about.
const ASSET_BASE='https://d2lhpso9w1g8dk.cloudfront.net/web/risorse';
function asset(kind,file){return typeof file==='string'&&file.trim()?`${ASSET_BASE}/${kind}_2026/${file.trim()}`:undefined;}
function roleName(value){const raw=Array.isArray(value)?value[0]:value;if(typeof raw==='string'&&raw.trim())return raw.trim();return ({1:'P',2:'D',3:'C',4:'A'})[Number(raw)];}
function lineupPlayer(p){if(!p||typeof p!=='object')return null;const name=typeof p.plyr==='string'?p.plyr.trim():'';const id=Number(p.pid);if(!name||!Number.isInteger(id))return null;return {id,name,role:roleName(p.role)};}
export function teamLike(t){return Boolean(t&&typeof t==='object'&&Number.isInteger(Number(t.id))&&typeof t.n==='string'&&typeof t.nu==='string'&&Object.prototype.hasOwnProperty.call(t,'crs')&&Object.prototype.hasOwnProperty.call(t,'l'));}
// Replaces the Object.entries patch: the enriched keys become real keys, so the
// metaString/metaNumber/metaUrl scanners find them without global magic.
export function enrichTeam(t){if(!teamLike(t))return t;return {...t,manager:t.nu,budget:Number(t.crs),crest:asset('squadra',t.l),kit:asset('maglietta',t.ms)};}
// Replaces the globalThis.fetch patch for /gaming/v1/teamLineup/visualizza/.
export function enrichLineup(json){
 if(!json?.teamLineupDto)return json;
 const dto=json.teamLineupDto,info=Array.isArray(json.lineUpInfo)?json.lineUpInfo:[];
 const byId=new Map(info.map(x=>[Number(x.pid),x]));
 const resolve=ids=>(Array.isArray(ids)?ids:[]).map(id=>lineupPlayer(byId.get(Number(id)))).filter(Boolean);
 dto.module=typeof dto.mdl==='string'?dto.mdl:undefined;
 dto.startersPlayers=resolve(dto.starts);
 dto.benchPlayers=resolve(dto.bench);
 dto.rosterPlayers=info.map(lineupPlayer).filter(Boolean);
 return json;
}
