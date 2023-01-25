from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import boto3
from cachetools import cached, TTLCache

cache_length = 15


class ConnectMetrics:
    def __init__(self,
                 accesskey=os.environ["AWS_ACCESS_KEY_ID"],
                 secretkey=os.environ["AWS_SECRET_ACCESS_KEY"],
                 region=os.environ["AWS_DEFAULT_REGION"],
                 connect_instance=os.getenv("CONNECT_INSTANCE", None)
                 ):
        self.connect_instance = connect_instance
        self.client = boto3.client('connect')

    @cached(TTLCache(maxsize=1024 * 8, ttl=3600 * 6))
    def _refresh_queues(self) -> dict:
        queues = self.client.list_queues(
            InstanceId=os.getenv('CONNECT_INSTANCE', None),
            QueueTypes=['STANDARD']
        )
        if queues['ResponseMetadata']['HTTPStatusCode'] != 200:
            logging.error("_refresh_queue network failure")
        return queues['QueueSummaryList']

    @cached(TTLCache(maxsize=1024 * 32, ttl=cache_length))
    def _refresh_metric(self) -> dict:

        queues = [q['Id'] for q in self._refresh_queues()]

        metric_data = self.client.get_current_metric_data(
            InstanceId=self.connect_instance,
            Filters={'Queues': queues},
            CurrentMetrics=[
                {'Name': 'AGENTS_AVAILABLE', 'Unit': 'COUNT'},
                {'Name': 'AGENTS_STAFFED', 'Unit': 'COUNT'},
                {'Name': 'CONTACTS_IN_QUEUE', 'Unit': 'COUNT'},
            ],
        )
        if metric_data['ResponseMetadata']['HTTPStatusCode'] != 200:
            logging.error("_refresh_metric network failure")

        return metric_data['MetricResults']

    @cached(TTLCache(maxsize=1024 * 32, ttl=60))
    def _refresh_hist_metric(self, start_time) -> dict:

        queues = [q['Id'] for q in self._refresh_queues()]

        now = datetime.utcnow()
        five_minute_round = timedelta(minutes=(now.minute % 5))  # has to be rounded by 5 minutes
        end_time_conv = now - five_minute_round

        if type(start_time) is datetime:
            start_time_conv = start_time.replace(tzinfo=timezone.utc, minute=end_time_conv.minute)
        elif type(start_time) is int:
            if not 0 < start_time < 25:
                raise ValueError(f'_refresh_hist_metric: hours_ago must be between 1 and 24, not {start_time}.')
            hours = timedelta(hours=start_time)
            start_time_conv = (now - hours - five_minute_round) + timedelta(minutes=30)
        else:
            raise ValueError("_refresh_hist_metric: Invalid start_time: must be datetime or int")

        metric_hist_data = self.client.get_metric_data(
            InstanceId=self.connect_instance,
            StartTime=start_time_conv.replace(microsecond=0, second=0),
            EndTime=end_time_conv.replace(microsecond=0, second=0),
            Filters={'Queues': queues},
            HistoricalMetrics=[
                {'Name': 'CONTACTS_HANDLED_INCOMING', 'Statistic': 'SUM', 'Unit': 'COUNT'},
                {'Name': 'HANDLE_TIME', 'Statistic': 'AVG', 'Unit': 'SECONDS'},
                {'Name': 'QUEUE_ANSWER_TIME', 'Statistic': 'AVG', 'Unit': 'SECONDS'},
            ],
        )
        if metric_hist_data['ResponseMetadata']['HTTPStatusCode'] != 200:
            logging.error("_refresh_hist_metric network failure")

        return metric_hist_data['MetricResults']

    # @cached(TTLCache(maxsize=1024 * 32, ttl=cache_length))
    def _refresh_current_user_data(self) -> dict:
        queues = [q['Id'] for q in self._refresh_queues()]

        current_users = self.client.get_current_user_data(
            InstanceId=self.connect_instance,
            Filters={'Queues': queues},
        )

        if current_users['ResponseMetadata']['HTTPStatusCode'] != 200:
            logging.error("_refresh_userlist#current_users network failure")

        return current_users['UserDataList']

    # @cached(TTLCache(maxsize=1024 * 32, ttl=cache_length))
    def _refresh_userlist(self) -> list[dict[str, dict[str, Any] | dict[str, Any] | Any]]:
        user_list = list()

        current_users = self._refresh_current_user_data()

        for user in current_users:
            user_id = user['User']['Id']
            # user_data = self.client.describe_user(InstanceId=self.connect_instance, UserId=user_id)
            res = {
                'user_id': user_id,
                'status': {
                    # 'start': user['Status']['StatusStartTimestamp'],
                    'name': user['Status']['StatusName'],
                }
            }
            # res = {
            #     'user_id': user_id,
            #     'status': {
            #         # 'start': user['Status']['StatusStartTimestamp'],
            #         'name': user['Status']['StatusName'],
            #     },
            #     'user': {
            #         'username': user_data['User']['Username'],
            #         'first_name': user_data['User']['IdentityInfo']['FirstName'],
            #         'last_name': user_data['User']['IdentityInfo']['LastName'],
            #     },
            # }
            user_list.append(res)

        return user_list

    def parsed(self) -> dict:
        r = {
            'available_agents': self.available_agents,
            'active_agents': self.active_agents,
            'queue_count': self.queue_count,
            'user_list': self.userlist,
        }
        return r

    @property
    def available_agents(self) -> int:
        data = self._refresh_metric()
        if len(data) > 0:
            m = int(data[0]['Collections'][0]['Value'])
            return m
        return 0

    @property
    def active_agents(self):
        data = self._refresh_metric()
        if len(data) > 0:
            m = int(data[0]['Collections'][1]['Value'])
            return m
        return 0

    @property
    def queue_count(self) -> int:
        data = self._refresh_metric()
        if len(data) > 0:
            m = int(data[0]['Collections'][2]['Value'])
            return m
        return 0

    @property
    def userlist(self) -> list[dict[str, dict[str, str]]]:
        return self._refresh_userlist()
