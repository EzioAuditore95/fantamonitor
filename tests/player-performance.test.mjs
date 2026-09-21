import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseLiveRound} from '../lib/serie-a.ts';
import {CLASSIC_SCORING,bonusFor,fantasyPoints,keptCleanSheet,scoringFor,totalsFor} from '../lib/player-performance.ts';
import {ASSIST_CODES,EVENT} from '../lib/serie-a-events.ts';
import {CHEFANTAVITAE10,makeLeagueConfig} from '../lib/league.ts';

const read=async name=>JSON.parse(await readFile(new URL(`./fixtures/serie-a/${name}`,import.meta.url),'utf8'));
// Five rounds of the real feed, joined to the roles the same feed carries: the shape Fase 4 will
// read out of the database, built here from the fixtures instead.
const rows=[],roles=new Map();
for(let round=1;round<=5;round++){
 const payload=parseLiveRound(await read(`live-${round}.json`),'2026-27',round);
 for(const player of payload.players)roles.set(player.id,player.role);
 for(const grade of payload.grades)if(grade.status===4)
  rows.push({player_id:grade.player_id,round,state:grade.state,grade:grade.grade,events:grade.events,role:roles.get(grade.player_id)});
}
const season=await read('season-stats.json');
const totals=totalsFor(rows);
const row=(patch={})=>({player_id:1,round:1,state:'graded',grade:6,events:[],role:'A',...patch});

test('a grade becomes points only if there was a grade',()=>{
 assert.equal(fantasyPoints(row({events:[EVENT.goal,EVENT.yellowCard]})),8.5);
 assert.equal(fantasyPoints(row({state:'no_vote',grade:null,events:[EVENT.yellowCard]})),null,'no vote is not a zero');
 assert.equal(fantasyPoints(row({state:'did_not_play',grade:null})),null);
 assert.equal(bonusFor(row({events:[EVENT.penaltyScored,EVENT.penaltyMissed]})),0);
});

test('a clean sheet is read off the goals that did not happen',()=>{
 const keeper=row({role:'P',events:[]});
 assert.equal(keptCleanSheet(keeper),true);
 assert.equal(keptCleanSheet(row({role:'P',events:[EVENT.concededGoal]})),false);
 assert.equal(keptCleanSheet(row({role:'D',events:[]})),false,'only the keeper is paid for it');
 assert.equal(keptCleanSheet(row({role:'P',state:'no_vote',grade:null})),false);
 // Classic does not pay it, so nothing changes until a league says otherwise.
 assert.equal(fantasyPoints(keeper),6);
 assert.equal(fantasyPoints(keeper,{weights:CLASSIC_SCORING.weights,cleanSheet:1}),7);
});

test('a league scores its own way, or Classic if it says nothing',()=>{
 assert.deepEqual(scoringFor(CHEFANTAVITAE10),CLASSIC_SCORING);
 const house=makeLeagueConfig({...CHEFANTAVITAE10,rules:{scoring:{weights:{[ASSIST_CODES[0]]:2,[EVENT.yellowCard]:-1},cleanSheet:1}}});
 const scoring=scoringFor(house);
 assert.equal(scoring.weights[EVENT.yellowCard],-1,'overridden');
 assert.equal(scoring.weights[EVENT.goal],3,'everything else stays Classic');
 assert.equal(scoring.weights[ASSIST_CODES[0]],2);
 assert.equal(scoring.weights[ASSIST_CODES[1]],1,'one kind of assist repriced does not reprice the others');
 assert.equal(scoring.cleanSheet,1);
 assert.equal(fantasyPoints(row({events:[EVENT.yellowCard]}),scoring),5);
 // Junk in the jsonb must not silently produce a league that scores nothing.
 assert.deepEqual(scoringFor(makeLeagueConfig({...CHEFANTAVITAE10,rules:{scoring:'boh'}})),CLASSIC_SCORING);
 assert.deepEqual(scoringFor(makeLeagueConfig({...CHEFANTAVITAE10,rules:{}})),CLASSIC_SCORING);
});

// The real check of this phase: our arithmetic against the arithmetic Fantacalcio publishes.
const compared=totals.filter(t=>season[String(t.player_id)]);
const agreeing=compared.filter(t=>t.appearances===season[String(t.player_id)].played);
const off=(t,field,ours,tolerance=0)=>Math.abs(ours-season[String(t.player_id)][field])>tolerance;

test('the season totals are the ones the site publishes',()=>{
 assert.ok(compared.length>400,`only ${compared.length} players compared`);
 const wrong=field=>agreeing.filter(t=>off(t,field,t[field]));
 for(const field of ['goals','assists','red'])
  assert.deepEqual(wrong(field).map(t=>t.player_id),[],`${field} disagrees with the site`);
 // One known exception, the same one the calibration found: the feed keeps a booking for
 // Piccoli that the editorial votes dropped. The feed is live data; the page is the last word.
 const cards=agreeing.filter(t=>off(t,'yellow',t.yellow));
 assert.deepEqual(cards.map(t=>t.player_id),[4359]);
});

test('the fantasy average is the site’s, to the decimal it publishes',()=>{
 const grades=agreeing.filter(t=>t.grade!=null&&off(t,'grade',t.grade,0.051));
 assert.deepEqual(grades.map(t=>t.player_id),[],'the plain average must match exactly');
 const fantasy=agreeing.filter(t=>t.fantasyGrade!=null&&off(t,'fantaGrade',t.fantasyGrade,0.051));
 assert.deepEqual(fantasy.map(t=>t.player_id),[4359],'only the disputed booking moves a fantamedia');
});

test('appearances follow the feed, which credits a debut the official list does not',()=>{
 // Five players out of ~440 are rated by the feed in a round the site does not count for them:
 // each one is a debut before the player entered the official list, and the site starts his
 // record afterwards. Ours is the fuller reading, theirs is the ledger — do not silently align.
 const differing=compared.filter(t=>t.appearances!==season[String(t.player_id)].played);
 assert.ok(differing.length/compared.length<=0.02,`${differing.length}/${compared.length} appearance counts differ`);
 assert.ok(differing.every(t=>t.appearances>season[String(t.player_id)].played),'we may count more, never fewer');
});

test('a player who came on unrated is present without being averaged',()=>{
 const unrated=totalsFor([row({state:'no_vote',grade:null,events:[EVENT.yellowCard]}),row({round:2,grade:7})]);
 assert.equal(unrated.length,1);
 assert.equal(unrated[0].played,2,'both appearances count');
 assert.equal(unrated[0].appearances,1,'only one of them has a grade');
 assert.equal(unrated[0].grade,7);
 assert.equal(unrated[0].yellow,1,'the card counts even with no grade to attach it to');
 assert.equal(totalsFor([row({state:'did_not_play',grade:null})]).length,0,'never played is never listed');
});
