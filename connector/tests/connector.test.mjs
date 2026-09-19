import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,generateKeyPairSync} from 'node:crypto';
import {createKeyedMutex,createLimiter} from '../lib/concurrency.mjs';
import {leagueForChat,leagueBySlug,shouldReuseSession} from '../lib/leagues.mjs';
import {open,seal,usernameFingerprint} from '../lib/credentials.mjs';
import {competitionFrom,dashboardUrl,manageLineupsUrl,score,snapshotFor,standingRows,toTeamStatus} from '../lib/snapshot.mjs';
import {buildMissingMessage,buildTelegramMessage,keyboardFor} from '../lib/telegram.mjs';
import {enrichLineup,enrichTeam,teamLike} from '../lib/fantacalcio.mjs';
import {bearerMatches,signedRequest} from '../lib/scheduler.mjs';

const alpha={id:'league-a',slug:'alfa',name:'Alfa',season:'2026-2027',competitionId:'337500',roundCount:35,
 telegramChatId:'-100111',telegramThreadId:null,telegramAdminChatId:'-100999',teams:['Uno','Due','Tre','Quattro']};
const beta={id:'league-b',slug:'beta',name:'Beta',season:'2026-2027',competitionId:'999001',roundCount:30,
 telegramChatId:'-100222',telegramThreadId:null,telegramAdminChatId:null,teams:['B1','B2']};
const leagues=[alpha,beta];

// This is where a message could end up in another league's channel.
test('an update is routed to the league that owns its chat, or to none',()=>{
 assert.equal(leagueForChat('-100111',leagues),alpha);
 assert.equal(leagueForChat(-100222,leagues),beta,'un id numerico vale come stringa');
 assert.equal(leagueForChat('-100999',leagues),alpha,'anche la chat admin appartiene alla lega');
 assert.equal(leagueForChat('-100333',leagues),null,'chat sconosciuta: si ignora, non si indovina');
 assert.equal(leagueForChat(null,leagues),null);
 assert.equal(leagueForChat('-100111',[]),null);
 // A league with no chat configured must not swallow updates with a null chat id.
 assert.equal(leagueForChat(null,[{...alpha,telegramChatId:null,telegramAdminChatId:null}]),null);
 assert.equal(leagueBySlug('beta',leagues),beta);
 assert.equal(leagueBySlug('inesistente',leagues),null);
});

test('the snapshot takes its scope from the league, never from a constant',()=>{
 const teams=alpha.teams.map((name,i)=>({team_key:name,name,present:i<2,source_status:i<2?'check-circle':'Non inserita'}));
 const snapshot=snapshotFor(alpha,7,teams,'2026-09-01T10:00:00.000Z');
 assert.equal(snapshot.league,'alfa');
 assert.equal(snapshot.season,'2026-2027');
 assert.equal(snapshot.competition_id,'337500');
 assert.equal(snapshot.expected_total,4);
 assert.equal(snapshot.inserted,2);
 assert.equal(snapshot.source_url,'https://leghe.fantacalcio.it/alfa/view/competition/337500/manage-lineups/7');
 const other=snapshotFor(beta,3,[],'2026-09-01T10:00:00.000Z');
 assert.equal(other.source_url,'https://leghe.fantacalcio.it/beta/view/competition/999001/manage-lineups/3');
 assert.equal(other.expected_total,2);
 assert.equal(manageLineupsUrl(beta,3),other.source_url);
 assert.equal(dashboardUrl(beta),'https://leghe.fantacalcio.it/beta/view/competition/999001/dashboard');
});

test('a lineup payload belonging to another team or round is refused',()=>{
 const team={name:'Uno',id:42,meta:undefined};
 assert.equal(toTeamStatus({team,dto:{tid:42,mday:5,ldate:'2026-09-01'}},5).present,true);
 assert.equal(toTeamStatus({team,dto:{tid:42,mday:5,ldate:''}},5).present,false);
 assert.equal(toTeamStatus({team,dto:null},5).present,false);
 assert.throws(()=>toTeamStatus({team,dto:{tid:43,mday:5}},5),/team_mismatch/);
 assert.throws(()=>toTeamStatus({team,dto:{tid:42,mday:6}},5),/round_mismatch/);
 assert.throws(()=>toTeamStatus({team,dto:'non-un-oggetto'},5),/invalid_payload/);
});

test('the session is reused only while it is plausibly alive',()=>{
 const now=Date.parse('2026-09-01T12:00:00Z');
 assert.equal(shouldReuseSession(null,now),false);
 assert.equal(shouldReuseSession({sessionState:null},now),false);
 assert.equal(shouldReuseSession({sessionState:'x'},now),true);
 assert.equal(shouldReuseSession({sessionState:'x',sessionExpiresAt:'2026-09-01T11:59:00Z'},now),false,'scaduta');
 assert.equal(shouldReuseSession({sessionState:'x',sessionExpiresAt:'2026-09-01T13:00:00Z'},now),true);
 assert.equal(shouldReuseSession({sessionState:'x',storedAt:'2026-08-30T12:00:00Z'},now,3600_000),false,'oltre il TTL');
});

test('an envelope written by the connector is readable only by its own key',()=>{
 const kp=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const state=JSON.stringify({cookies:[{name:'session',value:'x'.repeat(4000)}]});
 const sealed=seal(state,kp.privateKey);
 assert.equal(open(sealed,kp.privateKey),state);
 assert.ok(!sealed.includes('session'));
 assert.throws(()=>open('non-una-busta',kp.privateKey),/malformed/);
 assert.throws(()=>open(sealed,''),/key_missing/);
 assert.equal(usernameFingerprint('utente@example.com').length,12);
 assert.notEqual(usernameFingerprint('a'),usernameFingerprint('b'));
});

test('the keyboard and the messages point at the right league',()=>{
 const keyboard=keyboardFor(beta);
 const urls=keyboard.inline_keyboard.flat().map(b=>b.url).filter(Boolean);
 assert.ok(urls.every(u=>u.includes('/l/beta')),JSON.stringify(urls));
 assert.ok(!urls.some(u=>u.includes('/l/alfa')));
 const snapshot=snapshotFor(alpha,7,alpha.teams.map((name,i)=>({team_key:name,name,present:i===0,source_status:i===0?'check-circle':'Non inserita'})),'2026-09-01T10:00:00.000Z');
 const text=buildTelegramMessage(snapshot,'T-1h');
 assert.match(text,/Giornata 7/);
 assert.match(text,/1\/4/);
 assert.match(text,/• Due/);
 assert.match(buildMissingMessage(snapshot),/senza formazione \(3\)/);
});

test('the enrichment that replaced the global monkey-patches still fires',()=>{
 const raw={id:7,n:'Uno',nu:'Mario',crs:120,l:'stemma.png',ms:'maglia.png'};
 assert.equal(teamLike(raw),true);
 const enriched=enrichTeam(raw);
 assert.equal(enriched.manager,'Mario');
 assert.equal(enriched.budget,120);
 assert.match(enriched.crest,/squadra_2026\/stemma\.png$/);
 assert.match(enriched.kit,/maglietta_2026\/maglia\.png$/);
 assert.deepEqual(enrichTeam({nulla:1}),{nulla:1},'un oggetto non-squadra resta intatto');
 const lineup=enrichLineup({teamLineupDto:{mdl:'3-4-3',starts:[1],bench:[2]},lineUpInfo:[{pid:1,plyr:'Tizio',role:3},{pid:2,plyr:'Caio',role:'P'}]});
 assert.equal(lineup.teamLineupDto.module,'3-4-3');
 assert.deepEqual(lineup.teamLineupDto.startersPlayers,[{id:1,name:'Tizio',role:'C'}]);
 assert.deepEqual(lineup.teamLineupDto.benchPlayers,[{id:2,name:'Caio',role:'P'}]);
 assert.equal(lineup.teamLineupDto.rosterPlayers.length,2);
});

test('the standings are computed over the teams of that league only',()=>{
 assert.deepEqual(score('2-1'),{home:2,away:1});
 assert.equal(score('-'),null);
 const idToName=new Map([[1,'Uno'],[2,'Due'],[9,'Estranea']]);
 const calendar=[{calculated:true,matches:[{tIdH:1,tIdA:2,result:'2-1',standingPtH:3,standingPtA:0,ptH:75,ptA:70},
                                           {tIdH:9,tIdA:1,result:'5-0',standingPtH:3,standingPtA:0,ptH:99,ptA:0}]}];
 const rows=standingRows(alpha.teams,calendar,idToName);
 assert.equal(rows.length,4,'solo le squadre della lega');
 assert.ok(!rows.some(r=>r.name==='Estranea'));
 const uno=rows.find(r=>r.name==='Uno');
 assert.equal(uno.points,3,'la partita con una squadra estranea non conta');
 assert.equal(uno.played,1);
 assert.throws(()=>competitionFrom(alpha,null,null),/competition_payload_missing/);
});

test('the queue caps concurrency and serializes work per league', async()=>{
 const limiter=createLimiter(2);
 let active=0,peak=0;
 await Promise.all(Array.from({length:8},()=>limiter.run(async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;})));
 assert.equal(peak,2);
 assert.equal(limiter.active,0);
 assert.throws(()=>createLimiter(0),/invalid_limit/);
 const mutex=createKeyedMutex();
 const order=[];
 await Promise.all([
  mutex.run(alpha.id,async()=>{await new Promise(r=>setTimeout(r,20));order.push('a1');}),
  mutex.run(alpha.id,async()=>{order.push('a2');}),
  mutex.run(beta.id,async()=>{order.push('b1');}),
 ]);
 assert.deepEqual(order.slice(-2),['a1','a2'],'stessa lega: in sequenza');
 assert.ok(order.includes('b1'));
 // A failure must not stall the chain: the next task still runs.
 await assert.rejects(mutex.run('x',()=>Promise.reject(new Error('boom'))));
 assert.equal(await mutex.run('x',()=>'ok'),'ok');
 await new Promise(r=>setTimeout(r,0)); // la pulizia della catena avviene in un microtask successivo
 assert.equal(mutex.size,0,'le catene esaurite non restano in memoria');
});

test('the scheduler bearer is compared in constant time and never guessed',()=>{
 assert.equal(bearerMatches('Bearer segreto','segreto'),true);
 assert.equal(bearerMatches('Bearer sbagliato','segreto'),false);
 assert.equal(bearerMatches('segreto','segreto'),false,'senza il prefisso Bearer non vale');
 assert.equal(bearerMatches('Bearer segreto',''),false,'un segreto vuoto non autorizza nessuno');
 assert.equal(bearerMatches(undefined,'segreto'),false);
 assert.equal(bearerMatches('Bearer segreto piu lungo','segreto'),false);
 // Lunghezze diverse non devono far esplodere timingSafeEqual.
 assert.doesNotThrow(()=>bearerMatches('B','segreto-molto-lungo'));
});
test('the scheduler signs with the same HMAC the connector already checks',()=>{
 const a=signedRequest('chiave','{}',1700000000000);
 assert.equal(a.timestamp,'1700000000000');
 assert.equal(a.body,'{}');
 assert.match(a.signature,/^[0-9a-f]{64}$/);
 // Stessa formula di lib/config.mjs: HMAC su `${timestamp}.${body}`.
 const expected=createHmac('sha256','chiave').update('1700000000000.{}').digest('hex');
 assert.equal(a.signature,expected);
 assert.notEqual(signedRequest('altra','{}',1700000000000).signature,a.signature);
});
