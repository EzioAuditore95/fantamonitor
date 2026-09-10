import copy
import json
import unittest
from pathlib import Path
from monitor import Store, ValidationError

SAMPLE = json.loads((Path(__file__).parent / 'fixture.json').read_text())
NOW = '2026-09-09T20:50:00Z'
DEADLINE = '2026-09-10T12:00:00Z'  # synthetic deadline; never a league fact


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(':memory:')
        self.sample = copy.deepcopy(SAMPLE)
        self.scope = Store.scope(self.sample)

    def tearDown(self):
        self.store.close()

    def view(self, **kw):
        return self.store.view(self.scope, kw.get('now', NOW), kw.get('deadline', DEADLINE))

    def test_exact_replay_is_idempotent(self):
        self.assertTrue(self.store.ingest(self.sample)['new_snapshot'])
        self.assertFalse(self.store.ingest(self.sample)['new_snapshot'])
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0], 1)

    def test_poll_without_change_retains_freshness_not_transition(self):
        self.store.ingest(self.sample)
        self.sample['observed_at'] = NOW
        self.store.ingest(self.sample)
        self.assertEqual(self.store.transitions(self.scope), [])
        self.assertEqual(self.view()['observed_at'], '2026-09-09T20:50:00+00:00')

    def test_realistic_change_and_admin_reversal_are_retained(self):
        self.sample['teams'][0]['present'] = True
        self.sample['teams'][0]['source_status'] = 'check-circle'
        self.sample['inserted'] += 1
        self.store.ingest(SAMPLE)
        self.sample['observed_at'] = '2026-09-09T20:48:00Z'
        self.store.ingest(self.sample)
        back = copy.deepcopy(SAMPLE)
        back['observed_at'] = NOW
        self.store.ingest(back)
        changes = self.store.transitions(self.scope)
        self.assertEqual([(x['from'],x['to']) for x in changes], [(False,True),(True,False)])

    def test_out_of_order_import_does_not_replace_latest(self):
        newer = copy.deepcopy(self.sample)
        newer['observed_at'] = NOW
        self.store.ingest(newer)
        self.store.ingest(self.sample)
        self.assertEqual(self.view()['observed_at'], '2026-09-09T20:50:00+00:00')

    def test_no_data_is_not_omission(self):
        self.assertEqual(self.view()['health'], 'NO_DATA')

    def test_before_deadline_distinguishes_waiting_and_present(self):
        self.store.ingest(self.sample)
        statuses = [t['status'] for t in self.view()['teams']]
        self.assertEqual(statuses.count('IN_ATTESA'), 5)
        self.assertEqual(statuses.count('INSERITA'), 5)

    def test_post_deadline_requires_evidence(self):
        self.sample['observed_at'] = DEADLINE
        self.store.ingest(self.sample)
        self.assertEqual({t['status'] for t in self.view(now=DEADLINE)['teams']}, {'NON_VERIFICABILE'})

    def test_unknown_deadline_is_not_assumed_open(self):
        self.store.ingest(self.sample)
        self.assertEqual({t['status'] for t in self.view(deadline=None)['teams']}, {'NON_VERIFICABILE'})

    def test_failed_login_keeps_evidence_but_invalidates_current_status(self):
        self.store.ingest(self.sample)
        self.store.record_failure(self.scope, '2099-01-01T00:00:00Z', 'AUTH_REQUIRED')
        view = self.view()
        self.assertEqual(view['health'], 'AUTH_REQUIRED')
        self.assertEqual(view['inserted_observed'], 5)
        self.assertEqual({t['status'] for t in view['teams']}, {'NON_VERIFICABILE'})

    def test_stale_and_future_data_are_not_current(self):
        self.store.ingest(self.sample)
        self.assertEqual(self.view(now='2026-09-09T22:00:00Z')['health'], 'STALE')
        self.assertEqual(self.view(now='2026-09-09T19:00:00Z')['health'], 'CLOCK_ERROR')

    def test_invalid_batch_has_no_partial_write(self):
        invalid = []
        for mutate in [lambda s: s['teams'].pop(),
                       lambda s: s.update(inserted=9),
                       lambda s: s['teams'][0].update(present='false'),
                       lambda s: s['teams'][0].update(team_key=s['teams'][1]['team_key']),
                       lambda s: s.update(observed_at='2026-09-09T20:00:00'),
                       lambda s: s.update(round=True),
                       lambda s: s.update(competition_id='other')]:
            bad = copy.deepcopy(self.sample)
            mutate(bad)
            invalid.append(bad)
        for bad in invalid:
            with self.subTest(bad=bad):
                with self.assertRaises(ValidationError):
                    self.store.ingest(bad)
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0], 0)

    def test_conflict_at_old_timestamp_rejected(self):
        self.store.ingest(self.sample)
        newer = copy.deepcopy(self.sample)
        newer['observed_at'] = NOW
        self.store.ingest(newer)
        self.sample['teams'][0]['name'] = 'different'
        with self.assertRaises(ValidationError):
            self.store.ingest(self.sample)

    def test_roster_migration_must_be_explicit(self):
        self.store.ingest(self.sample)
        self.sample['observed_at'] = NOW
        self.sample['teams'][0]['team_key'] = 'new team'
        with self.assertRaises(ValidationError):
            self.store.ingest(self.sample)

    def test_competitions_are_isolated(self):
        self.store.ingest(self.sample)
        self.assertIsNone(self.store.latest(('chefantavitae10','2026-2027','other',1)))

    def test_admin_event_preserves_participant_evidence(self):
        self.store.ingest(self.sample)
        event = dict(zip(('league','season','competition_id','round'),self.scope))
        event.update(team_key='Real Hasbulla', source_url='https://leghe.fantacalcio.it/example',
                     source_label='synthetic test log', source_time_text='synthetic time',
                     observed_at=NOW, occurred_at=None, actor='participant')
        self.assertTrue(self.store.add_event(event)['new_event'])
        self.assertFalse(self.store.add_event(event)['new_event'])
        event['actor'] = 'admin'
        self.assertTrue(self.store.add_event(event)['new_event'])
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM delivery_events').fetchone()[0],2)


if __name__ == '__main__':
    unittest.main()
