from __future__ import annotations

from contextlib import contextmanager
from functools import lru_cache
from typing import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from backend.app.core.config import get_settings
from backend.app.db.models import Base


@lru_cache(maxsize=1)
def get_engine():
    database_url = get_settings().database_url
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    return create_engine(database_url, connect_args=connect_args, future=True)


@lru_cache(maxsize=1)
def get_session_factory():
    return sessionmaker(bind=get_engine(), autoflush=False, autocommit=False, expire_on_commit=False, future=True)


def _sqlite_add_application_columns(engine) -> None:
    if not str(engine.url).startswith("sqlite"):
        return
    with engine.begin() as conn:
        rows = conn.execute(text("PRAGMA table_info(applications)")).fetchall()
        names = {row[1] for row in rows}
        if "applied_at" not in names:
            conn.execute(text("ALTER TABLE applications ADD COLUMN applied_at TIMESTAMP"))
        if "reminder_at" not in names:
            conn.execute(text("ALTER TABLE applications ADD COLUMN reminder_at TIMESTAMP"))


def _sqlite_add_autofill_resume_path(engine) -> None:
    if not str(engine.url).startswith("sqlite"):
        return
    with engine.begin() as conn:
        rows = conn.execute(text("PRAGMA table_info(autofill_profiles)")).fetchall()
        names = {row[1] for row in rows}
        if "candidate_resume_path" not in names:
            conn.execute(text("ALTER TABLE autofill_profiles ADD COLUMN candidate_resume_path TEXT DEFAULT ''"))


def init_db() -> None:
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    _sqlite_add_application_columns(engine)
    _sqlite_add_autofill_resume_path(engine)


@contextmanager
def session_scope() -> Iterator[Session]:
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
