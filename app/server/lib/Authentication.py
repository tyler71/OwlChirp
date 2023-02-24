import datetime
import hashlib
import math
from functools import wraps

import pytz
from quart import request, abort

from cachetools import cached, LRUCache

from .ConnectMetrics import cm, ConnectMetrics

import logging

class AuthApiKey:
    def __init__(self, cm: ConnectMetrics):
        self.valid_user_tokens = dict()
        self.cm = cm

    @staticmethod
    def _generate_token(agent_id: str, agent_username: str) -> str:
        sha256 = hashlib.sha256()

        # Set to javascript timestamp in UTC
        utc_tz = pytz.timezone("UTC")
        now = datetime.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=utc_tz)
        timestamp = math.floor(now.timestamp())

        unencoded_str = str(timestamp) + agent_id + agent_username

        sha256.update(unencoded_str.encode('utf-8'))
        return sha256.hexdigest()

    @cached(LRUCache(maxsize=32))
    def verify_token(self, provided_token: str) -> bool:
        users = self.cm.userlist

        try:
            for user in users:
                generated_token = self._generate_token(agent_id=user["user_id"],
                                                       agent_username=user["user"]["username"])
                if generated_token == provided_token:
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
    javascript timestamp + agent id + agent username

    int: timestamp
    str: agent_id
    str: agent_username
    """
    auth = auth_api_key

    @wraps(func)
    async def check_api_key(*args, **kwargs):
        if 'X-Api-Key' not in request.headers:
            return abort(401)
        elif auth.verify_token(request.headers.get('X-Api-Key')):
            return await func(*args, **kwargs)
        else:
            return abort(401)

    return check_api_key
