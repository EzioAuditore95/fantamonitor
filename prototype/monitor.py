"""FANTAMONITOR evidence store. Python 3.11+, standard library only."""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


class ValidationError(ValueError):
    pass


def instant(value):
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if result.tzinfo is None:
            raise ValueError('timezone required')
        return result.astimezone(timezone.utc)
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValidationError('invalid timestamp with timezone') from exc


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def validate(sample):
    if sample.get('schema_version') != 1 or sample.get('source') != 'authenticated_ui':
        raise ValidationError('unsupported schema or source')
    for key in ('league', 'season', 'competition_id', 'source_url'):
        if not isinstance(sample.get(key), str) or not sample[key].strip():
            raise ValidationError('missing ' + key)
    if type(sample.get('round')) is not int or sample['round'] < 1:
        raise ValidationError('invalid round')
    instant(sample.get('observed_at'))
    from urllib.parse import urlsplit
    url = urlsplit(sample['source_url'])
    path = f"/{sample['league']}/view/competition/{sample['competition_id']}/manage-lineups/{sample['round']}"
    if url.scheme != 'https' or url.netloc != 'leghe.fantacalcio.it' or url.path != path:
        raise ValidationError('source context mismatch')
    teams = sample.get('teams')
    if not isinstance(teams, list) or not teams:
        raise ValidationError('empty teams')
    keys = []
    for team in teams:
        if not isinstance(team, dict):
            raise ValidationError('invalid row')
        if not all(isinstance(team.get(k), str) and team[k].strip() for k in ('team_key', 'name')):
            raise ValidationError('invalid team identity')
        if type(team.get('present')) is not bool:
            raise ValidationError('unknown status')
        expected = 'check-circle' if team['present'] else 'Non inserita'
        if team.get('source_status') != expected:
            raise ValidationError('inconsistent status')
        keys.append(team['team_key'])
    if len(keys) != len(set(keys)):
        raise ValidationError('duplicate team')
    if type(sample.get('expected_total')) is not int or len(teams) != sample['expected_total']:
        raise ValidationError('incomplete teams')
    if type(sample.get('inserted')) is not int or sum(t['present'] for t in teams) != sample['inserted']:
        raise ValidationError('inconsistent count')


class Store:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS snapshots (
          id TEXT PRIMARY KEY, league TEXT NOT NULL, season TEXT NOT NULL,
          competition TEXT NOT NULL, round INTEGER NOT NULL, observed_at TEXT NOT NULL,
          state_hash TEXT NOT NULL, body TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS scope_time ON snapshots(league,season,competition,round,observed_at);
        CREATE TABLE IF NOT EXISTS sync_attempts (
          id INTEGER PRIMARY KEY, attempted_at TEXT NOT NULL, league TEXT NOT NULL,
          season TEXT NOT NULL, competition TEXT NOT NULL, round INTEGER NOT NULL,
          outcome TEXT NOT NULL, snapshot_id TEXT REFERENCES snapshots(id));
        CREATE TABLE IF NOT EXISTS delivery_events (
          id TEXT PRIMARY KEY, league TEXT NOT NULL, season TEXT NOT NULL,
          competition TEXT NOT NULL, round INTEGER NOT NULL, team_key TEXT NOT NULL,
          body TEXT NOT NULL);
        ''')

    def close(self):
        self.db.close()

    def add_event(self, event):
        # Separate immutable evidence; never overwrite a participant log with an admin edit.
        required = ('league','season','competition_id','team_key','source_url',
                    'source_label','source_time_text','observed_at')
        if any(not isinstance(event.get(k), str) or not event[k].strip() for k in required):
            raise ValidationError('incomplete event')
        if type(event.get('round')) is not int or event['round'] < 1:
            raise ValidationError('invalid event round')
        if event.get('actor') not in ('participant','admin','automatic','unknown'):
            raise ValidationError('unknown event actor')
        if event.get('occurred_at') is not None:
            instant(event['occurred_at'])
        instant(event['observed_at'])
        sample = self.latest(self.scope(event))
        if sample is None or event['team_key'] not in {t['team_key'] for t in sample['teams']}:
            raise ValidationError('event without known team and scope')
        identity = digest({k:v for k,v in event.items() if k != 'observed_at'})
        with self.db:
            cursor = self.db.execute('''INSERT OR IGNORE INTO delivery_events
              (id,league,season,competition,round,team_key,body) VALUES (?,?,?,?,?,?,?)''',
              (identity,*self.scope(event),event['team_key'],canonical(event)))
        return {'event_id':identity,'new_event':cursor.rowcount == 1}

    @staticmethod
    def scope(sample):
        return (sample['league'], sample['season'], sample['competition_id'], sample['round'])

    def latest(self, scope):
        row = self.db.execute('''SELECT body FROM snapshots
          WHERE league=? AND season=? AND competition=? AND round=?
          ORDER BY observed_at DESC, id DESC LIMIT 1''', scope).fetchone()
        return json.loads(row['body']) if row else None

    def record_failure(self, scope, attempted_at, code):
        if code not in {'AUTH_REQUIRED', 'PAGE_NOT_READY', 'INCOMPLETE_TEAMS',
                        'INCONSISTENT_COUNT', 'WRONG_CONTEXT', 'READ_FAILED'}:
            code = 'READ_FAILED'
        when = instant(attempted_at).isoformat()
        with self.db:
            self.db.execute('''INSERT INTO sync_attempts
              (attempted_at,league,season,competition,round,outcome) VALUES (?,?,?,?,?,?)''',
              (when, *scope, code))

    def ingest(self, sample):
        validate(sample)
        sample = json.loads(canonical(sample))
        sample['observed_at'] = instant(sample['observed_at']).isoformat()
        sample['teams'].sort(key=lambda t: t['team_key'])
        scope = self.scope(sample)
        # A content identity excludes acquisition time; every successful poll is retained.
        state = {k: v for k, v in sample.items() if k not in ('observed_at', 'source_url')}
        identity = digest(sample)
        with self.db:
            previous = self.latest(scope)
            conflict = self.db.execute('''SELECT id FROM snapshots WHERE league=?
              AND season=? AND competition=? AND round=? AND observed_at=?''',
              (*scope, sample['observed_at'])).fetchone()
            if conflict and conflict['id'] != identity:
                raise ValidationError('conflicting observation at the same time')
            if previous:
                if {t['team_key'] for t in previous['teams']} != {t['team_key'] for t in sample['teams']}:
                    raise ValidationError('roster changed; explicit migration required')
                if instant(previous['observed_at']) == instant(sample['observed_at']) and previous != sample:
                    raise ValidationError('conflicting observation at the same time')
            cursor = self.db.execute('''INSERT OR IGNORE INTO snapshots
              (id,league,season,competition,round,observed_at,state_hash,body)
              VALUES (?,?,?,?,?,?,?,?)''',
              (identity, *scope, sample['observed_at'], digest(state), canonical(sample)))
            new = cursor.rowcount == 1
            self.db.execute('''INSERT INTO sync_attempts
              (attempted_at,league,season,competition,round,outcome,snapshot_id)
              VALUES (?,?,?,?,?,?,?)''',
              (datetime.now(timezone.utc).isoformat(), *scope, 'OK' if new else 'REPLAY', identity))
        return {'snapshot_id': identity, 'new_snapshot': new, 'inserted': sample['inserted']}

    def view(self, scope, now, deadline=None, max_age_seconds=900):
        now = instant(now)
        if max_age_seconds < 0:
            raise ValidationError('negative maximum age')
        deadline_dt = instant(deadline) if deadline else None
        sample = self.latest(scope)
        if sample is None:
            return {'health': 'NO_DATA', 'teams': [], 'observed_at': None}
        age = (now - instant(sample['observed_at'])).total_seconds()
        attempt = self.db.execute('''SELECT outcome,attempted_at FROM sync_attempts
          WHERE league=? AND season=? AND competition=? AND round=?
          ORDER BY attempted_at DESC,id DESC LIMIT 1''', scope).fetchone()
        health = 'OK'
        if age < 0:
            health = 'CLOCK_ERROR'
        elif age > max_age_seconds:
            health = 'STALE'
        if attempt and attempt['outcome'] not in ('OK', 'REPLAY'):
            health = attempt['outcome']
        rows = []
        for team in sample['teams']:
            # Presence cannot establish author, recovery, or timely submission.
            if health != 'OK' or deadline_dt is None or now >= deadline_dt:
                status = 'NON_VERIFICABILE'
            else:
                status = 'INSERITA' if team['present'] else 'IN_ATTESA'
            rows.append({**team, 'status': status})
        return {'health': health, 'observed_at': sample['observed_at'],
                'inserted_observed': sample['inserted'], 'total': sample['expected_total'],
                'deadline': deadline, 'teams': rows}

    def transitions(self, scope):
        rows = self.db.execute('''SELECT body FROM snapshots
          WHERE league=? AND season=? AND competition=? AND round=?
          ORDER BY observed_at,id''', scope)
        result, previous = [], None
        for row in rows:
            sample = json.loads(row['body'])
            current = {t['team_key']: t['present'] for t in sample['teams']}
            if previous is not None:
                for key, value in current.items():
                    if previous[key] != value:
                        result.append({'team_key': key, 'from': previous[key], 'to': value,
                                       'first_observed_at': sample['observed_at']})
            previous = current
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', default='fantamonitor.sqlite')
    sub = parser.add_subparsers(dest='command', required=True)
    imp = sub.add_parser('ingest')
    imp.add_argument('files', nargs='+')
    event_imp = sub.add_parser('ingest-event')
    event_imp.add_argument('files', nargs='+')
    view = sub.add_parser('view')
    view.add_argument('--league', default='chefantavitae10')
    view.add_argument('--season', default='2026-2027')
    view.add_argument('--competition', default='337500')
    view.add_argument('--round', type=int, default=1)
    view.add_argument('--deadline')
    view.add_argument('--now', default=datetime.now(timezone.utc).isoformat())
    args = parser.parse_args()
    store = Store(args.db)
    try:
        if args.command in ('ingest', 'ingest-event'):
            for file in args.files:
                action = store.ingest if args.command == 'ingest' else store.add_event
                print(canonical(action(json.loads(Path(file).read_text()))))
        else:
            print(json.dumps(store.view((args.league,args.season,args.competition,args.round),
                  args.now,args.deadline), ensure_ascii=False, indent=2))
    finally:
        store.close()


if __name__ == '__main__':
    main()
