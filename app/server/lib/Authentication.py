import datetime
import hashlib
import logging
import math
from functools import wraps

import pytz
from cachetools import cached, LRUCache, TTLCache
from quart import request, abort

from .ConnectMetrics import cm, ConnectMetrics
from .Helper import HttpResponse


class AuthApiKey:
    def __init__(self, cm: ConnectMetrics):
        self.cm = cm
        self.accepted_tokens = set()

        self._utc_tz = pytz.timezone("UTC")

        self.hour = datetime.datetime.now(tz=self._utc_tz).hour

    @cached(TTLCache(maxsize=64, ttl=600))
    def __flush_tokens(self) -> None:
        """
        Tokens only change once an hour. This will get remove all invalid ones
        """
        current_hour = datetime.datetime.utcnow().replace(tzinfo=self._utc_tz).hour
        if current_hour > self.hour:
            self.hour = current_hour
            self.accepted_tokens = set()

    @staticmethod
    @cached(LRUCache(maxsize=32))
    def _generate_token(timestamp: str, agent_id: str, agent_username: str) -> str:
        sha256 = hashlib.sha256()

        unencoded_str = f"{timestamp}{agent_id}{agent_username}"

        sha256.update(unencoded_str.encode('utf-8'))
        return sha256.hexdigest()

    def verify_token(self, provided_token: str) -> bool:
        self.__flush_tokens()

        if provided_token in self.accepted_tokens:
            return True

        users = self.cm.userlist

        # UTC Timestamp
        now = datetime.datetime.utcnow().replace(minute=0, second=0, microsecond=0, tzinfo=self._utc_tz)
        timestamp = math.floor(now.timestamp())

        try:
            for user in users:
                generated_token = self._generate_token(
                    timestamp=timestamp,
                    agent_id=user["user_id"],
                    agent_username=user["user"]["username"])
                if generated_token == provided_token:
                    self.accepted_tokens.add(provided_token)
                    return True
            return False
        except Exception as e:
            logging.error(e)
            return e


auth_api_key = AuthApiKey(cm=cm)


def require_api_key(func):
    """
    Checks for an X-Api-Key header.
    Header should contain a sha256sum of:
    timestamp + agent id + agent username

    int: timestamp
    str: agent_id
    str: agent_username
    """
    auth = auth_api_key

    @wraps(func)
    async def check_api_key(*args, **kwargs):
        if 'X-Api-Key' not in request.headers:
            return abort(HttpResponse.UNAUTHORIZED)

        token = request.headers.get('X-Api-Key')
        if auth.verify_token(token) is True:
            return await func(*args, **kwargs)
        else:
            return abort(HttpResponse.UNAUTHORIZED)

    return check_api_key
