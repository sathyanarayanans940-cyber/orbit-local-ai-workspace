"""Independent, disposable checks for selected claims in the web-report audit."""
import json
import sqlite3
import tempfile
from pathlib import Path
checks=[]
def passed(name):checks.append({'claim':name,'passed':True})
with tempfile.TemporaryDirectory(prefix='orbit-sqlite-audit-') as directory:
    location=str(Path(directory)/'audit.db')
    a=sqlite3.connect(location, timeout=0, isolation_level=None)
    b=sqlite3.connect(location, timeout=0, isolation_level=None)
    try:
        assert a.execute('PRAGMA journal_mode=WAL').fetchone()[0]=='wal'
        a.execute('CREATE TABLE evidence (id INTEGER PRIMARY KEY, value INTEGER)')
        a.execute('INSERT INTO evidence VALUES (1,10)')
        b.execute('BEGIN');assert b.execute('SELECT value FROM evidence').fetchone()[0]==10
        a.execute('UPDATE evidence SET value=20 WHERE id=1')
        assert b.execute('SELECT value FROM evidence').fetchone()[0]==10
        passed('A WAL read transaction retains its earlier snapshot after another connection commits.')
        try:b.execute('UPDATE evidence SET value=30 WHERE id=1');raise AssertionError('Stale snapshot was allowed to write')
        except sqlite3.OperationalError as error:assert error.sqlite_errorcode==sqlite3.SQLITE_BUSY_SNAPSHOT
        b.execute('ROLLBACK');passed('An outdated WAL read snapshot cannot be upgraded to a write transaction.')
        a.execute('BEGIN IMMEDIATE')
        try:b.execute('BEGIN IMMEDIATE');raise AssertionError('Two simultaneous writers were admitted')
        except sqlite3.OperationalError as error:assert error.sqlite_errorcode==sqlite3.SQLITE_BUSY
        passed('WAL still permits only one active writer at a time.')
        b.execute('BEGIN');b.execute('SELECT * FROM evidence').fetchall()
        try:b.execute('UPDATE evidence SET value=50 WHERE id=1');raise AssertionError('Read transaction wrote through another active writer')
        except sqlite3.OperationalError as error:assert error.sqlite_errorcode==sqlite3.SQLITE_BUSY
        b.execute('ROLLBACK');passed('An active competing writer can cause SQLITE_BUSY, not SQLITE_BUSY_SNAPSHOT, during read-to-write upgrade.')
        b.execute('PRAGMA read_uncommitted=1');a.execute('INSERT INTO evidence VALUES (2,40)')
        assert b.execute('SELECT COUNT(*) FROM evidence').fetchone()[0]==1
        a.execute('COMMIT');passed('read_uncommitted alone does not expose another private-cache connection’s uncommitted changes.')
        dest=sqlite3.connect(str(Path(directory)/'backup.db'))
        try:a.backup(dest);assert dest.execute('SELECT * FROM evidence ORDER BY id').fetchall()==[(1,20),(2,40)]
        finally:dest.close()
        passed('The backup API copies a consistent database snapshot in this controlled example.')
    finally:a.close();b.close()
    a=sqlite3.connect(str(Path(directory)/'rollback.db'),timeout=0,isolation_level=None)
    b=sqlite3.connect(str(Path(directory)/'rollback.db'),timeout=0,isolation_level=None)
    try:
        a.execute('PRAGMA journal_mode=DELETE');a.execute('CREATE TABLE t (value)');a.execute('INSERT INTO t VALUES (1)')
        a.execute('BEGIN IMMEDIATE');a.execute('UPDATE t SET value=2')
        journal=Path(directory)/'rollback.db-journal';assert journal.exists()
        assert b.execute('SELECT value FROM t').fetchone()[0]==1
        assert journal.exists() and a.in_transaction
        a.execute('COMMIT');passed('A rollback journal can exist for an active writer without being a hot journal requiring crash recovery.')
    finally:a.close();b.close()
result={'sqliteVersion':sqlite3.sqlite_version,'checks':checks,'scope':'Controlled local examples; does not experimentally verify power-loss or hardware durability.'}
Path('tests/output/document-vision/web-report-sqlite-checks.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
