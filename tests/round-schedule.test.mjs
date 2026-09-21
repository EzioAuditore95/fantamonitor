import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatRemaining,formatRemainingCoarse,formatKickoff,nextKickoff,kickoffFor} from '../lib/round-schedule.ts';

const row=(round,start_at)=>({round,serie_a_round:round+3,start_at,source:'test',source_url:null,updated_at:'2026-09-01T00:00:00Z'});
const minutes=n=>n*60_000,hours=n=>n*3_600_000,days=n=>n*86_400_000;

test('formatRemaining pads to hours and grows a day field only when needed',()=>{
 assert.equal(formatRemaining(0),'00h 00m 00s');
 assert.equal(formatRemaining(1000),'00h 00m 01s');
 assert.equal(formatRemaining(hours(2)+minutes(5)+9000),'02h 05m 09s');
 assert.equal(formatRemaining(days(1)+hours(4)),'1g 04h 00m 00s');
 assert.equal(formatRemaining(days(9)),'9g 00h 00m 00s');
});

test('a kickoff already past reads as zero, never as a negative countdown',()=>{
 assert.equal(formatRemaining(-1),'00h 00m 00s');
 assert.equal(formatRemaining(-days(3)),'00h 00m 00s');
 assert.equal(formatRemainingCoarse(-minutes(5)),'0 min');
});

test('the coarse countdown drops the seconds and the empty fields with them',()=>{
 assert.equal(formatRemainingCoarse(0),'0 min');
 assert.equal(formatRemainingCoarse(59_000),'0 min');
 assert.equal(formatRemainingCoarse(minutes(8)+59_000),'8 min');
 assert.equal(formatRemainingCoarse(hours(4)+minutes(12)),'4h 12m');
 assert.equal(formatRemainingCoarse(days(1)+hours(4)+minutes(12)),'1g 4h 12m');
});

test('kickoffs are formatted in Rome time, across the summer-time boundary',()=>{
 // 19:45 UTC is 21:45 in Rome under summer time and 20:45 under winter time.
 assert.match(formatKickoff('2026-08-22T19:45:00Z'),/21:45/);
 assert.match(formatKickoff('2026-12-05T19:45:00Z'),/20:45/);
});

test('nextKickoff takes the first round still to start and ignores the others',()=>{
 const now=Date.parse('2026-09-21T12:00:00Z');
 const rows=[row(3,'2026-09-28T16:00:00Z'),row(1,'2026-09-13T16:00:00Z'),row(2,'2026-09-21T16:00:00Z'),row(4,null)];
 assert.equal(nextKickoff(rows,now).round,2);
 assert.equal(nextKickoff([row(1,'2026-09-13T16:00:00Z')],now),null);
 assert.equal(nextKickoff([],now),null);
 assert.equal(nextKickoff([row(4,null)],now),null);
});

test('kickoffFor answers about one round, including the one already under way',()=>{
 const now=Date.parse('2026-09-21T18:00:00Z');
 const rows=[row(1,'2026-09-13T16:00:00Z'),row(2,'2026-09-21T16:00:00Z'),row(3,'2026-09-28T16:00:00Z'),row(4,null)];
 // Round 2 has started: the banner is already counting down to round 3, the Home tab is not.
 assert.equal(nextKickoff(rows,now).round,3);
 assert.equal(kickoffFor(rows,2).start_at,'2026-09-21T16:00:00Z');
 assert.equal(kickoffFor(rows,4),null);
 assert.equal(kickoffFor(rows,9),null);
});
