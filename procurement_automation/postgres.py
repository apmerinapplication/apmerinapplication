"""Postgres transport for the shared workflow's small parameterized SQL surface."""
import re

TABLES = {
    'users': ('id name role password_hash active', 'id'),
    'jobs': ('id version data created_at updated_at', 'id'),
    'records': ('id job_id kind data created_at', 'id'),
    'events': ('id job_id actor kind data created_at', 'id'),
    'messages': ('id message_id content_hash data job_id status created_at', 'id'),
    'occurrences': ('mailbox folder validity uid message_key', 'mailbox folder validity uid'),
    'checkpoints': ('mailbox folder validity uid', 'mailbox folder'),
    'settings': ('key data', 'key'),
    'reminder_actions': ('id until_date reason actor', 'id'),
    'extraction_cache': ('hash data', 'hash'),
    'ai_usage': ('month spent reserved input_tokens output_tokens', 'month'),
    'worker_state': ('key data', 'key'),
    'login_attempts': ('key count last_at', 'key'),
    'job_imports': ('reference actor status data updated_at', 'reference'),
    'review_flag_actions': ('job_id flag_id data', 'job_id flag_id'),
    'tracking_shipments': ('id carrier kind number data', 'id'),
    'tracking_links': ('shipment_id job_id evidence', 'shipment_id job_id evidence'),
}


def sql(query):
    """Translate bindings and explicit SQLite upserts; values always stay bound."""
    match = re.match(r'INSERT OR (IGNORE|REPLACE) INTO (\w+)(\s*\([^)]*\))?', query, re.I)
    if match:
        mode, table, named = match.groups()
        columns, primary = TABLES[table]
        columns = named.strip()[1:-1].replace(',', ' ').split() if named else columns.split()
        primary = primary.split()
        prefix = 'INSERT INTO ' + table + (named or '')
        query = prefix + query[match.end():]
        if mode.upper() == 'IGNORE':
            query += ' ON CONFLICT DO NOTHING'
        else:
            updates = ','.join(f'{col}=EXCLUDED.{col}' for col in columns if col not in primary)
            query += ' ON CONFLICT (' + ','.join(primary) + ') DO UPDATE SET ' + updates
    # Do not substitute a question mark inside SQL string literals (e.g. LIKE text).
    chunks = re.split(r"('(?:[^']|'')*')", query)
    return ''.join(piece if i % 2 else piece.replace('?', '%s') for i, piece in enumerate(chunks))


class Row(dict):
    def __getitem__(self, key):
        return list(self.values())[key] if isinstance(key, int) else super().__getitem__(key)


class Cursor:
    def __init__(self, raw):
        self.raw = raw

    @property
    def rowcount(self):
        return self.raw.rowcount

    def _row(self, value):
        return None if value is None else Row(zip([d.name for d in self.raw.description], value))

    def fetchone(self):
        return self._row(self.raw.fetchone())

    def fetchall(self):
        return [self._row(value) for value in self.raw.fetchall()]

    def __iter__(self):
        return (self._row(value) for value in self.raw)


class Connection:
    def __init__(self, raw):
        self.raw = raw

    def execute(self, query, args=()):
        # Binding-free statements may contain literal percent signs such as LIKE 'presence:%'.
        statement = sql(query)
        return Cursor(self.raw.execute(statement, args if args else None))
