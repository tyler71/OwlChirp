from __future__ import annotations

import asyncio
import json
import math
import os
import random
import typing
from dataclasses import dataclass
from typing import Any, AsyncGenerator

from cachetools import cached, TTLCache

from .ConnectMetrics import ConnectMetrics
from .Helper import sync_to_async

cache_length = int(os.getenv('AWS_CONNECT_CACHE_LENGTH', 10))


class ServerSentEvents:
    """
    Uses Server Sent Events (SSE) to deliver realtime updates to a client
    Updates are only sent when there is some change
    It returns two kinds of generators. Both generators will only yield data if something
    changes.
     - Return the whole dict
     - Return the individual key and new value

     This is blocking, so needs to be used in its own thread
    """

    def __init__(self, events: list, data_func: typing.Callable):
        self.events = events
        self.data_func = sync_to_async(data_func)
        self.get_data_lock = asyncio.Lock()

    async def _get_data(self):
        return await self.data_func()

    def get_data_generator(self, server_sent_event=False) -> AsyncGenerator[bytes | Any, Any]:
        """
        Returns a generator that returns all data on each change.
        """

        async def obj(func):
            previous_result = None
            while True:
                value = await func()
                if value != previous_result:
                    previous_result = value
                    if server_sent_event is True:
                        value = json.dumps(value)
                        event = ServerSentEvent(value)
                        yield event.sse
                    else:
                        yield value
                await asyncio.sleep(1)

        return obj(self._get_data)

    def get_data_event_generator(self, server_sent_event=False) -> AsyncGenerator[bytes | Any, Any]:
        """
        Will return a generator that always has changed data.
        Each individual event is in its own dict
        """

        async def obj(self_obj):
            event_generators = [self_obj._key_change(data=None, key=event_name)
                                for event_name in self_obj.events]
            # Start the generators
            for event in event_generators:
                event.__next__()
            async for metric_data in self_obj.get_data_generator():
                for event in event_generators:
                    value = event.send(metric_data)
                    event.__next__()
                    if value is not None:
                        if server_sent_event is True:
                            value = json.dumps(value)
                            event = ServerSentEvent(value)
                            yield event.sse
                        else:
                            yield value

        return obj(self)

    # Generators hold state (previous_result), so we use it to not return anything
    # if no new change has occurred.
    @staticmethod
    def _key_change(data: dict, key: str) -> typing.Generator[dict, dict, None]:
        """
        For a given key, returns a generator that will yield it back if that
        key has changed.
        """
        previous_result = None
        while True:
            value = yield data
            value = value[key]
            if value != previous_result:
                previous_result = value
                yield {key: value}
            else:
                yield None


@dataclass
class ServerSentEvent:
    data: str
    event: str = None
    id: int = None
    retry: int = None

    @property
    def sse(self) -> bytes:
        message = f"data: {self.data}"
        if self.event is not None:
            message = f"{message}\nevent: {self.event}"
        if self.id is not None:
            message = f"{message}\nid: {self.id}"
        if self.retry is not None:
            message = f"{message}\nretry: {self.retry}"
        message = f"{message}\r\n\r\n"
        return message.encode('utf-8')


@cached(TTLCache(maxsize=1024 * 32, ttl=cache_length))
def get_metric_data() -> dict:
    cm = ConnectMetrics.get_instance()
    r = {
        'queue_count': cm.queue_count,
        'available_count': cm.available_agents,
        'active_agent_count': cm.active_agents,
        'user_list': cm.active_user_list,
        'handled_incoming': cm.handled_incoming(),
    }
    return r


@cached(TTLCache(maxsize=64 * 1024, ttl=5))
def get_random_data() -> dict:
    def ran(x):
        return math.floor(random.random() * x)

    return {
        'result': ran(5),
    }
