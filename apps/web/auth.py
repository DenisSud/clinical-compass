"""Accounts and sessions.

Deliberately outside the clinical port. The port exists to protect clinical
invariants — who may sign, who may read a record. A password hash is a platform
concern, and putting it behind the same seam would imply the clinical module
cares how a session was established. It does not: it receives an `Actor` and
re-derives authority from the care link on every call.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

SESSION_COOKIE = "compass_session"
SESSION_TTL = timedelta(hours=12)


@dataclass(frozen=True)
class User:
    id: str
    email: str
    role: str
    display: str
    patient_id: str | None


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL, display TEXT NOT NULL, patient_id TEXT, login_token TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL
);
"""


def open_db(path: str | Path) -> sqlite3.Connection:
    # FastAPI runs handlers on a thread pool; one connection, no thread check,
    # single statements only. Anything multi-step belongs behind a unit of work.
    connection = sqlite3.connect(str(path), isolation_level=None, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.executescript(SCHEMA)
    return connection


def hash_password(password: str, *, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt$2^14$8$1${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, _, r, p, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    salt = bytes.fromhex(salt_hex)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=2**14, r=int(r), p=int(p)
    )
    return hmac.compare_digest(digest.hex(), digest_hex)


def find_by_email(db: sqlite3.Connection, email: str) -> sqlite3.Row | None:
    return db.execute(
        "SELECT * FROM users WHERE email = ?", (email.strip().lower(),)
    ).fetchone()


def find_by_token(db: sqlite3.Connection, token: str) -> sqlite3.Row | None:
    return db.execute("SELECT * FROM users WHERE login_token = ?", (token,)).fetchone()


def to_user(row: sqlite3.Row) -> User:
    return User(row["id"], row["email"] or "", row["role"], row["display"],
                row["patient_id"])


def create_session(db: sqlite3.Connection, user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + SESSION_TTL
    db.execute(
        "INSERT INTO sessions VALUES (?,?,?)", (token, user_id, expires.isoformat())
    )
    return token


def session_user(db: sqlite3.Connection, token: str | None) -> User | None:
    if not token:
        return None
    row = db.execute(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token = ? AND s.expires_at > ?",
        (token, datetime.now(timezone.utc).isoformat()),
    ).fetchone()
    return to_user(row) if row else None


def drop_session(db: sqlite3.Connection, token: str | None) -> None:
    if token:
        db.execute("DELETE FROM sessions WHERE token = ?", (token,))
