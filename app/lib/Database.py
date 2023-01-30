from __future__ import annotations

import asyncio
import math
import os
import time
from datetime import datetime

from sqlalchemy import select, Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker


def javascript_timestamp():
    return math.floor(time.time() * 1000)


Base = declarative_base()


class User(Base):
    __tablename__ = 'users'

    id = Column(Integer(), primary_key=True)
    username = Column(String(50), index=True, unique=True)
    name = Column(String(50))
    created_on = Column(DateTime(), default=datetime.now)
    updated_on = Column(DateTime(), default=datetime.now, onupdate=datetime.now)


class PhoneLog(Base):
    __tablename__ = 'calls'

    id = Column(Integer(), primary_key=True)
    agent_id = Column(Integer(), ForeignKey('users.id'))
    phone_number = Column(String(20), index=True)
    timestamp = Column(Integer(), default=javascript_timestamp)
    contact_id = Column(String(36))
    created_on = Column(DateTime(), default=datetime.now)
    updated_on = Column(DateTime(), default=datetime.now, onupdate=datetime.now)
    agent = relationship("User", lazy='selectin')


class CallerId(Base):
    __tablename__ = "callerid"

    id = Column(Integer(), primary_key=True)
    phone_number = Column(String(20), index=True, unique=True)
    name = Column(String(30), index=True)
    created_on = Column(DateTime(), default=datetime.now)
    updated_on = Column(DateTime(), default=datetime.now, onupdate=datetime.now)


def cleanup_query(query):
    if query is not None:
        query = [r for (r,) in query]
    else:
        query = tuple()
    return query


class Db:
    def __init__(self):
        self.engine = None
        self.sessionmaker = None

    async def init(self):
        self.engine = create_async_engine(os.environ['DB_STRING'], future=True)
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.sessionmaker = sessionmaker(bind=self.engine, expire_on_commit=False, class_=AsyncSession)

    def __del__(self):
        asyncio.create_task(self.engine.dispose())

    async def add_user(self, username: str) -> User:
        obj = User(username=username)
        async with self.sessionmaker() as session:
            session.add(obj)
            await session.commit()
        return obj

    async def verify_user(self, username: str) -> bool:
        stmt = select(User) \
            .where(User.username == username)

        async with self.sessionmaker() as session:
            res = (await session.execute(stmt)).scalar()
            res = False if res is None else True
        return res

    async def add_phone_log(self, username, phone_number, timestamp=None, contact_id=None) -> PhoneLog:
        stmt = select(User) \
            .where(User.username == username)
        async with self.sessionmaker() as session:
            agent = (await session.execute(stmt)).scalar()
            obj = PhoneLog(
                agent=agent,
                phone_number=phone_number,
                timestamp=timestamp,
                contact_id=contact_id,
            )
            session.add(obj)
            await session.commit()
        return obj

    async def get_agent_calls(self, username, max_records: int = None, asc: bool = False):
        stmt = select(PhoneLog) \
            .join(User) \
            .where(User.username == username)
        if asc is False:
            stmt = stmt.order_by(PhoneLog.created_on.desc())
        if max_records is not None:
            stmt = stmt.limit(max_records)
        async with self.sessionmaker() as session:
            query = (await session.execute(stmt)).all()
            query = cleanup_query(query)
        return query

    async def get_phone_calls(self, phone_number, max_records: int = None, asc: bool = False) -> tuple:
        stmt = select(PhoneLog) \
            .where(PhoneLog.phone_number == phone_number)
        if asc is False:
            stmt = stmt.order_by(PhoneLog.created_on.desc())
        if max_records is not None:
            stmt = stmt.limit(max_records)
        async with self.sessionmaker() as session:
            query = (await session.execute(stmt)).all()
            query = cleanup_query(query)
        return query

    async def get_caller_id(self, phone_number: str):
        stmt = select(CallerId) \
            .where(CallerId.phone_number == phone_number)
        async with self.sessionmaker() as session:
            query = (await session.execute(stmt)).scalar()
        return query

    async def update_caller_id(self, phone_number, name: str) -> bool:
        stmt = select(CallerId) \
            .where(CallerId.phone_number == phone_number)
        async with self.sessionmaker() as session:
            query = (await session.execute(stmt)).scalar()
            if query is not None and query.__class__ == CallerId:
                query.name = name
                session.add(query)
                await session.commit()
            else:
                log = CallerId(phone_number=phone_number, name=name)
                session.add(log)
                await session.commit()
        return True
