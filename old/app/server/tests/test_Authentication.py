import datetime
import math

import pytz

from app.server.lib.Authentication import AuthApiKey

auth_api_key = AuthApiKey(True)

def test__generate_token():
    successful_result = '8823afc57f039f607acdecb2f7988ff72ba1eddceed163f517215b110db9576a'

    now = datetime.datetime.utcnow().replace(year=2023, month=3, day=6, hour=9, minute=0, second=0, microsecond=0, tzinfo=pytz.timezone("UTC"))
    timestamp = timestamp = math.floor(now.timestamp())
    agent_id = "jcepmnr2-s334-p0yo-fj61-jwohzng3o3qt"
    agent_username = "user@domain.tld"

    res = auth_api_key._generate_token(timestamp, agent_id, agent_username)
    assert res == successful_result


