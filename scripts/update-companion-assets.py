"""Update one existing companion from reviewed assets, preserving conversation data.

Run with the desktop app closed. Backups stay in the explicitly supplied private
directory. No credentials or conversation text are printed.
"""
import argparse
import copy
import json
import sqlite3
import subprocess
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', required=True)
    parser.add_argument('--card', required=True)
    parser.add_argument('--worldbook', required=True)
    parser.add_argument('--backup-dir', required=True)
    args = parser.parse_args()
    db_path = Path(args.database).resolve(strict=True)
    if db_path.name != 'xinyingongming-companion.sqlite3':
        raise ValueError('Not the companion database')
    card = json.loads(Path(args.card).read_text(encoding='utf-8-sig'))
    worldbook = json.loads(Path(args.worldbook).read_text(encoding='utf-8-sig'))
    backup_path = Path(args.backup_dir).resolve(strict=True) / 'companion-before.sqlite3'
    if backup_path.exists():
        raise FileExistsError('Refusing to replace an existing database backup')
    connection = sqlite3.connect(str(db_path), timeout=5)
    raw = connection.execute('SELECT state_json FROM app_state WHERE id=1').fetchone()[0]
    state = json.loads(raw)
    matches = [c for c in state['characters'] if c['id'] == card['id'] and c['name'] == card['name']]
    if len(matches) != 1:
        raise ValueError('Expected exactly one matching existing character')
    existing = matches[0]
    rows = connection.execute(
        'SELECT id,payload_json,status,mention_policy FROM memory_items WHERE character_id=?',
        (existing['id'],)).fetchall()
    memories = []
    for memory_id, payload, status, policy in rows:
        item = json.loads(payload)
        item.update(id=memory_id, status=status, mentionPolicy=policy)
        memories.append(item)
    prepared = subprocess.run(
        ['node', str(Path(__file__).with_name('prepare-companion-assets.mjs')), '--stdin'],
        input=json.dumps(dict(card=card, worldbook=worldbook, existing=existing, memories=memories), ensure_ascii=False),
        text=True, encoding='utf-8', capture_output=True, check=True)
    update = json.loads(prepared.stdout)
    revised = copy.deepcopy(state)
    revised['characters'] = [update['character'] if c['id'] == existing['id'] else c for c in state['characters']]
    for field in ['history', 'avatar', 'contextState', 'sourceMetadata']:
        assert update['character'].get(field) == existing.get(field), field
    assert revised['globals'] == state['globals']
    old_non_seeds = [m for m in memories if not str(m.get('subjectKey', '')).startswith('card:')]
    with sqlite3.connect(str(backup_path)) as backup:
        connection.backup(backup)
        assert backup.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    try:
        connection.execute('BEGIN IMMEDIATE')
        if connection.execute('SELECT state_json FROM app_state WHERE id=1').fetchone()[0] != raw:
            raise RuntimeError('App state changed during preparation; close the app and retry with a new backup directory')
        current_rows = connection.execute(
            'SELECT id,payload_json,status,mention_policy FROM memory_items WHERE character_id=?',
            (existing['id'],)).fetchall()
        if current_rows != rows:
            raise RuntimeError('Memories changed during preparation; retry after closing the app')
        connection.execute('UPDATE app_state SET state_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=1',
                           (json.dumps(revised, ensure_ascii=False),))
        for item in update['memories']:
            connection.execute('''INSERT INTO memory_items(id,character_id,payload_json,status,mention_policy,importance)
                VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                payload_json=excluded.payload_json,status=excluded.status,
                mention_policy=excluded.mention_policy,importance=excluded.importance,updated_at=CURRENT_TIMESTAMP''',
                (item['id'], existing['id'], json.dumps(item, ensure_ascii=False),
                 item['status'], item['mentionPolicy'], item['importance']))
        assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    print(json.dumps(dict(character=existing['name'], worldEntries=len(update['character']['worldbook']['entries']),
                         baseMemories=len(update['memories']), preservedChatMessages=len(existing.get('history', [])),
                         preservedOtherMemories=len(old_non_seeds), backup=str(backup_path)), ensure_ascii=False))
    connection.close()


if __name__ == '__main__':
    main()
