import {test} from 'node:test';
import assert from 'node:assert/strict';
import {storedTeamKey,readStoredTeam} from '../lib/stored-team.ts';
import {CHEFANTAVITAE10} from '../lib/league.ts';

const cfg=CHEFANTAVITAE10;

test('the key is scoped to the league, so two leagues do not share a choice',()=>{
 assert.equal(storedTeamKey('chefantavitae10'),'fm:team:chefantavitae10');
 assert.notEqual(storedTeamKey('altra-lega'),storedTeamKey('chefantavitae10'));
});

test('a current team name is kept',()=>{
 assert.equal(readStoredTeam(cfg,'Real Hasbulla'),'Real Hasbulla');
 assert.equal(readStoredTeam(cfg,cfg.teams[0].name),cfg.teams[0].name);
});

test('anything the league does not know reads as no choice',()=>{
 for(const raw of [null,undefined,'','Squadra Inesistente','real hasbulla',' Real Hasbulla','{"team":"Real Hasbulla"}'])
  assert.equal(readStoredTeam(cfg,raw),null,`should not survive: ${JSON.stringify(raw)}`);
});

test('a renamed team drops the stale choice instead of showing a ghost',()=>{
 const renamed={...cfg,teams:cfg.teams.map(t=>t.name==='Real Hasbulla'?{...t,name:'Real Hasbulla II'}:t)};
 assert.equal(readStoredTeam(renamed,'Real Hasbulla'),null);
 assert.equal(readStoredTeam(renamed,'Real Hasbulla II'),'Real Hasbulla II');
});
