import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseSeasonStats,previousSeasons,seasonStatsUrl} from '../lib/serie-a-history.ts';

const html=await readFile(new URL('./fixtures/serie-a/season-2022-23.html',import.meta.url),'utf8');
const rows=parseSeasonStats(html);

test('a past season is read from the page that publishes it',()=>{
 assert.equal(rows.length,3);
 const osimhen=rows.find(r=>r.player_id===4661);
 // The capocannoniere of 2022-23, read off the page rather than remembered.
 assert.deepEqual(osimhen,{player_id:4661,name:'Osimhen',team:'NAP',role:'A',
  played:32,grade:6.73,fantasyGrade:9.14,goals:26,conceded:0,penaltiesSaved:0,assists:4,yellow:4,red:0,
  // That season's page has no own-goals column: absent is null, not zero.
  ownGoals:null});
 assert.deepEqual(rows.map(r=>r.name),['Osimhen','Dybala','Martinez L.']);
});

test('the player id survives the season appended to his URL',()=>{
 // A past season links to .../osimhen/4661/2022-23 where the current one stops at the id.
 // Anchoring the id to the end of the href parsed the whole page into nothing, silently.
 assert.ok(html.includes('/osimhen/4661/2022-23'));
 assert.ok(rows.every(r=>Number.isInteger(r.player_id)&&r.player_id>0));
 assert.deepEqual(parseSeasonStats(html.replace(/\/2022-23"/g,'"')).map(r=>r.player_id),rows.map(r=>r.player_id),
  'the current season\'s shorter href reads the same');
});

test('a page that stops looking like itself yields nothing, not garbage',()=>{
 assert.deepEqual(parseSeasonStats('<table><tbody><tr><td>niente</td></tr></tbody></table>'),[]);
 assert.deepEqual(parseSeasonStats(''),[]);
 // A row with the link but no statistics columns is not half a player.
 assert.deepEqual(parseSeasonStats('<tr><a class="player-name player-link" href="https://www.fantacalcio.it/serie-a/squadre/roma/x/1"><span>X</span></a></tr>'),[]);
});

test('the seasons asked for are the ones before the current, newest first',()=>{
 assert.deepEqual(previousSeasons('2026-27'),['2025-26','2024-25','2023-24','2022-23']);
 assert.deepEqual(previousSeasons('2026-27',2),['2025-26','2024-25']);
 assert.deepEqual(previousSeasons('2100-01',1),['2099-00'],'the turn of the century keeps two digits');
 assert.throws(()=>previousSeasons('2026-2027'),/Stagione/);
 assert.equal(seasonStatsUrl('2022-23'),'https://www.fantacalcio.it/statistiche-serie-a/2022-23/riepilogo');
});
