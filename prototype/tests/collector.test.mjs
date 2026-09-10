import test from 'node:test';
import assert from 'node:assert/strict';
import { LEAGUE, parseSnapshot, openTeamList } from '../collector.mjs';

const url = 'https://leghe.fantacalcio.it/chefantavitae10/view/competition/337500/manage-lineups/1?team=12420064';
// Synthetic minimal UI fixture, not a raw historical browser capture.
const fixture = 'heading "CheFantaVitaE10"\ngeneric: Gestione formazioni Admin\ngeneric "Giornata 1"\ngeneric: 5/10 inserite\n- dialog:\ngeneric: Seleziona Squadra\n' +
  LEAGUE.teams.map((name,i) => `- generic: ${name}\n- generic: test user\n- img "${i<5?'check':'close'}-circle":\n- generic: ${i<5?'4-3-3':'Non inserita'}`).join('\n');
const parse = (s=fixture,u=url) => parseSnapshot(s,u,'2026-09-09T20:00:00Z');
test('complete UI returns all teams without user labels', () => {
  const r = parse(); assert.equal(r.teams.length,10); assert.equal(r.inserted,5);
  assert.ok(!JSON.stringify(r).includes('test user'));
});
test('expired login cannot be parsed as absence', () => assert.throws(() => parse('Sessione scaduta'), /AUTH_REQUIRED/));
test('different round rejected even with old loaded content', () => assert.throws(() => parse(fixture,url.replace('/1?', '/2?')), /WRONG_CONTEXT/));
test('collapsed team list asks for next phase', () => assert.throws(() => parse(fixture.split('- dialog:')[0]), /TEAM_LIST_NOT_READY/));
test('incomplete and duplicate team rows rejected', () => {
  assert.throws(() => parse(fixture.replace('- generic: Salamandre','- generic: missing')), /INCOMPLETE_TEAMS/);
  assert.throws(() => parse(fixture+'\n- generic: Salamandre'), /INCOMPLETE_TEAMS/);
});
test('inconsistent count rejected', () => assert.throws(() => parse(fixture.replace('5/10','4/10')), /INCONSISTENT_COUNT/));
test('unexpected status never inferred from absence', () => assert.throws(() => parse(fixture.replace('Non inserita','Caricamento')), /UNKNOWN_STATUS/));
test('open list is idempotent', async () => {
  await openTeamList({url:async()=>url,playwright:{domSnapshot:async()=>fixture,getByRole:()=>{throw Error('must not click');}}});
});
