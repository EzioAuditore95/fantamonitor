import {test} from 'node:test';
import assert from 'node:assert/strict';
import {playerRounds,gradesByRound,rosterOf,topFantasyAverages,MIN_APPEARANCES_FOR_TOP} from '../lib/home-players.ts';
import {EVENT} from '../lib/serie-a-events.ts';

// Serie A round → rated rows. A plain 6 with no events is 6 fantasy points.
const row=(player_id,grade,events=[],state='graded')=>({player_id,grade,events,state});
const payload=(grades,players)=>({season:'2026-27',rounds:Object.keys(grades).map(Number),
 players:players??[...new Set(Object.values(grades).flat().map(r=>r.player_id))].map(id=>({id,role:'C'})),
 grades});
const snapshot=(round,observed_at,team,formation)=>({round,observed_at,
 teams:[{team_key:team,name:team,present:true,source_status:'check-circle',formation}]});

test('the flat rows carry the round and the role the payload lists separately',()=>{
 const p=payload({4:[row(10,7),row(11,5)],5:[row(10,6)]},[{id:10,role:'A'},{id:11,role:'P'}]);
 const rows=playerRounds(p);
 assert.equal(rows.length,3);
 assert.deepEqual(rows.filter(r=>r.player_id===10).map(r=>r.round).sort(),[4,5]);
 assert.equal(rows.find(r=>r.player_id===11).role,'P');
 assert.deepEqual(playerRounds(null),[]);
});

test('the indexed form is keyed by Serie A round and then by player',()=>{
 const byRound=gradesByRound(payload({4:[row(10,7),row(11,5)],5:[row(10,6)]}));
 assert.deepEqual([...byRound.keys()].sort(),[4,5]);
 assert.equal(byRound.get(4).get(11).grade,5);
 assert.equal(byRound.get(5).get(11),undefined);
 assert.equal(gradesByRound(null).size,0);
});

test('the roster comes from the most recent readable lineup, not from all of them merged',()=>{
 const sold={id:99,name:'Venduto',role:'A'},bought={id:77,name:'Comprato',role:'A'};
 const snapshots=[
  snapshot(2,'2026-09-10T10:00:00Z','A',{starters:[sold],bench:[],roster:[sold]}),
  snapshot(5,'2026-09-21T10:00:00Z','A',{starters:[bought],bench:[],roster:[bought]}),
 ];
 assert.deepEqual(rosterOf(snapshots,'A').map(p=>p.id),[77]);
 // Order of arrival does not matter: observed_at decides.
 assert.deepEqual(rosterOf([...snapshots].reverse(),'A').map(p=>p.id),[77]);
});

test('a reading with no lineup falls through to the last one that had it',()=>{
 const player={id:7,name:'Titolare',role:'C'};
 const snapshots=[
  snapshot(4,'2026-09-14T10:00:00Z','A',{starters:[player],bench:[],roster:[player]}),
  snapshot(5,'2026-09-21T10:00:00Z','A',undefined),
 ];
 assert.deepEqual(rosterOf(snapshots,'A').map(p=>p.name),['Titolare']);
 assert.deepEqual(rosterOf(snapshots,'Z'),[]);
 assert.deepEqual(rosterOf(snapshots,null),[]);
 assert.deepEqual(rosterOf([],'A'),[]);
});

test('players without a usable id are skipped, and duplicates counted once',()=>{
 const roster=[{id:7,name:'Buono',role:'C'},{name:'Senza id',role:'C'},{id:'abc',name:'Id rotto'},{id:7,name:'Doppione'}];
 const out=rosterOf([snapshot(5,'2026-09-21T10:00:00Z','A',{roster})],'A');
 assert.deepEqual(out,[{id:7,name:'Buono',role:'C'}]);
});

test('the top three are ordered by fantasy average, not by bare grade',()=>{
 const roster=[{id:1,name:'Bomber',role:'A'},{id:2,name:'Regista',role:'C'},{id:3,name:'Terzino',role:'D'},{id:4,name:'Riserva',role:'A'}];
 // Bomber: 6 in pagella but a goal each time (+3) → 9 di fantamedia.
 // Regista: 7,5 secchi. Terzino: 6,5 secchi. Riserva: un solo 10.
 const p=payload({
  4:[row(1,6,[EVENT.goal]),row(2,7.5),row(3,6.5),row(4,10)],
  5:[row(1,6,[EVENT.goal]),row(2,7.5),row(3,6.5)],
 },roster.map(r=>({id:r.id,role:r.role})));
 const top=topFantasyAverages(roster,p);
 assert.deepEqual(top.map(t=>t.name),['Bomber','Regista','Terzino']);
 assert.equal(top[0].fantasyGrade,9);
 assert.equal(top[0].appearances,2);
 // The single 10 does not top the list: one outing is not an average.
 assert.ok(!top.some(t=>t.name==='Riserva'));
});

test('the minimum appearances is a real gate, and the list can come back short',()=>{
 const roster=[{id:1,name:'Solo una',role:'A'}];
 const p=payload({4:[row(1,10)]},[{id:1,role:'A'}]);
 assert.deepEqual(topFantasyAverages(roster,p),[]);
 assert.equal(topFantasyAverages(roster,p,3,1).length,1);
 assert.ok(MIN_APPEARANCES_FOR_TOP>=2);
});

test('players outside the roster never appear, and a missing payload gives nothing',()=>{
 const roster=[{id:1,name:'Nostro',role:'A'}];
 const p=payload({4:[row(1,6),row(2,10)],5:[row(1,6),row(2,10)]},[{id:1,role:'A'},{id:2,role:'A'}]);
 const top=topFantasyAverages(roster,p);
 assert.deepEqual(top.map(t=>t.name),['Nostro']);
 assert.deepEqual(topFantasyAverages(roster,null),[]);
 assert.deepEqual(topFantasyAverages([],p),[]);
});

test('a player who never got a vote has no average and is left out',()=>{
 const roster=[{id:1,name:'Mai votato',role:'A'},{id:2,name:'Votato',role:'A'}];
 const p=payload({4:[row(1,null,[],'no_vote'),row(2,7)],5:[row(1,null,[],'did_not_play'),row(2,7)]},
  [{id:1,role:'A'},{id:2,role:'A'}]);
 assert.deepEqual(topFantasyAverages(roster,p).map(t=>t.name),['Votato']);
});
