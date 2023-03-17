from __future__ import annotations

import logging
import math
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import boto3
from botocore.exceptions import ClientError
from cachetools import cached, TTLCache, LRUCache


class ConnectMetrics:
    __instance = None

    def __init__(self, connect_instance=os.environ["CONNECT_INSTANCE"]):
        self.connect_instance = connect_instance
        self.client = boto3.client('connect')
        ConnectMetrics.__instance = self

    @staticmethod
    def get_instance():
        if ConnectMetrics.__instance is None:
            ConnectMetrics()
        return ConnectMetrics.__instance

    @cached(TTLCache(maxsize=1024 * 8, ttl=3600 * 6))  # 6 hours
    def _refresh_queues(self) -> dict:
        """ Get queue list. This changes infrequently, so we cache it for a long time
        """
        queues = self.client.list_queues(
            InstanceId=self.connect_instance,
            QueueTypes=['STANDARD']
        )
        if queues['ResponseMetadata']['HTTPStatusCode'] != 200:
            logging.error("_refresh_queue network failure")
        return queues['QueueSummaryList']

    @cached(TTLCache(maxsize=1024 * 8, ttl=600))  # 10 minutes
    def _refresh_registered_users(self) -> dict:
        """ List all registered users
        """
        registered_users = self.client.list_users(InstanceId=self.connect_instance)
        if registered_users['ResponseMetadata']['HTTPStatusCode'] != 200:
            logging.error("_refresh_registered_users failure")
        return registered_users['UserSummaryList']

    @cached(TTLCache(maxsize=1024 * 32, ttl=4))
    def _refresh_metric(self) -> dict:
        """ Current metrics. No summation of data. Includes things like how many agents are available
        """

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

    @cached(TTLCache(maxsize=1024 * 32, ttl=30))
    def _refresh_hist_metric(self, start_time) -> dict:
        """ Historical data. Includes things like how many calls we have gotten today
            start_time is either hours ago [int] or a datetime. It is converted internally to UTC
        """

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
                {'Name': 'CONTACTS_ABANDONED', 'Statistic': 'SUM', 'Unit': 'COUNT'},
                {'Name': 'HANDLE_TIME', 'Statistic': 'AVG', 'Unit': 'SECONDS'},
                {'Name': 'QUEUE_ANSWER_TIME', 'Statistic': 'AVG', 'Unit': 'SECONDS'},
            ],
        )
        if metric_hist_data['ResponseMetadata']['HTTPStatusCode'] != 200:
            logging.error("_refresh_hist_metric network failure")

        return metric_hist_data['MetricResults'][0]['Collections']

    @cached(TTLCache(maxsize=1024 * 32, ttl=4))
    def _refresh_current_user_data(self) -> dict:
        queues = [q['Id'] for q in self._refresh_queues()]

        current_users = self.client.get_current_user_data(
            InstanceId=self.connect_instance,
            Filters={'Queues': queues},
        )

        if current_users['ResponseMetadata']['HTTPStatusCode'] != 200:
            logging.error("_refresh_userlist#current_users network failure")

        # Pending resolution of AWS Case Id 11904141851
        # Hack to ensure on call is set as on call and not available
        for user in current_users['UserDataList']:
            if user['Status']['StatusName'] == 'Available' and len(user['Contacts']) > 0 and user['Contacts'][0][
                'AgentContactState'].upper() == 'CONNECTED':
                user['Status']['StatusName'] = 'On call'

        return current_users['UserDataList']

    @cached(LRUCache(maxsize=64))
    def _describe_contact(self, contact_id):
        user_data = self.client.describe_contact(InstanceId=self.connect_instance, ContactId=contact_id)
        if user_data['ResponseMetadata']['HTTPStatusCode'] != 200:
            logging.error("_refresh_userlist#current_users network failure")
        return user_data['Contact']

    def describe_contact(self, contact_id):
        data = self._describe_contact(contact_id)
        agent_data = self._describe_user(data["AgentInfo"]["Id"])

        queue_time = data['AgentInfo']['ConnectedToAgentTimestamp'] - data['QueueInfo']['EnqueueTimestamp']
        call_to_queue_time = data['AgentInfo']['ConnectedToAgentTimestamp'] - data['InitiationTimestamp']

        response = {
            "id": data["Id"],
            "initiation_method": data["InitiationMethod"],
            "agent_name": f'{agent_data["IdentityInfo"]["FirstName"]} {agent_data["IdentityInfo"]["LastName"]}',
            "enqueue_timestamp": data["QueueInfo"]["EnqueueTimestamp"],
            "answered_timestamp": data["InitiationTimestamp"],
            "ended_timestamp": data["LastUpdateTimestamp"],
            "queue_time": queue_time.seconds,
            "call_to_queue_time": call_to_queue_time.seconds,
        }
        return response

    @cached(LRUCache(maxsize=64))
    def _describe_user(self, user_id) -> dict:
        try:
            user_data = self.client.describe_user(InstanceId=self.connect_instance, UserId=user_id)
            if user_data['ResponseMetadata']['HTTPStatusCode'] != 200:
                logging.error("_refresh_userlist#current_users network failure")
            return user_data['User']
        except ClientError as e:
            logging.error(e)

    def _refresh_userlist(self) -> list[dict[str, dict[str, Any] | dict[str, Any] | Any]]:
        user_list = list()

        current_users = self._refresh_current_user_data()

        for user in current_users:
            user_id = user['User']['Id']
            user_data = self._describe_user(user_id)
            res = {
                'user_id': user_id,
                'status': {
                    # 'start': user['Status']['StatusStartTimestamp'],
                    'name': user['Status']['StatusName'],
                },
                'user': {
                    'username': user_data['Username'],
                    'first_name': user_data['IdentityInfo']['FirstName'],
                    'last_name': user_data['IdentityInfo']['LastName'],
                },
            }
            user_list.append(res)

        return user_list

    def parsed(self) -> dict:
        r = {
            'available_agents': self.available_agents,
            'active_agents': self.active_agents,
            'queue_count': self.queue_count,
            'user_list': self.active_user_list,
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

    def handled_incoming(self, date=None) -> int:
        if date is None:
            date = datetime.now().replace(hour=1, minute=0, second=0, microsecond=0)
        data = self._refresh_hist_metric(date)
        for row in data:
            if row['Metric']['Name'] == 'CONTACTS_HANDLED_INCOMING':
                result = math.floor(row['Value'])
                return result
        return 0

    @property
    def active_user_list(self) -> list[dict[str, dict[str, Any] | dict[str, Any] | Any]]:
        return self._refresh_userlist()

    @property
    def registered_user_list(self):
        return self._refresh_registered_users()
