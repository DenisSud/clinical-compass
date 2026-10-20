"""Composition root: the one place where an adapter is chosen.

`Clinical` never names SQLite. This file does, and it is the only file that has
to change when the database does.
"""

from __future__ import annotations

import os
from pathlib import Path

from apps.api.clinic import Clinical, SqliteStore
from apps.api.clinic.cadence import load_cadences
from compass.instruments import load_strict

DEFAULT_PATH = Path(os.environ.get("COMPASS_DB", "var/compass.db"))


def connect(db_path: Path | None = None) -> Clinical:
    path = Path(db_path) if db_path else DEFAULT_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    return Clinical(
        SqliteStore(str(path)),
        load_strict(),
        #: No drug catalog yet: prescribing is a later slice, and an empty
        #: catalog refuses every prescription rather than accepting a wrong one.
        _NoCatalog(),
        cadences=load_cadences(),
    )


class _NoCatalog:
    def validate(self, drug_code: str, dose: str) -> None:
        from apps.api.clinic import ErrorKind, Rejected

        raise Rejected(ErrorKind.UNKNOWN_DRUG, "каталог препаратов ещё не подключён")
