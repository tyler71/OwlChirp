import { useStore } from '@nanostores/react';
import { Fragment, useState } from 'react';

import { apiFetch } from '../lib/auth';
import { getCallerIdName } from '../lib/callerId';
import { API, CURSOR_HELP_CLASS, LOADING_CLASS } from '../lib/const';
import { formatCallTime, formatPhoneNumber, formatSecondsToTime } from '../lib/helpers';
import { $calls, $config, $recentCallsExpanded, type Call } from '../lib/stores';
import { Button, Card, Icon } from './ui';

const TITLE = 'Recent Calls';

type ContactDetail = {
  id: string;
  agent_name: string;
  answered_timestamp: string;
  queue_time: number;
  call_to_queue_time: number;
};

type Detail = { status: 'loading' } | { status: 'error' } | { status: 'ready'; contact: ContactDetail; callerId: string | null };

function DetailTable({ detail }: { detail: Detail }) {
  const config = useStore($config);

  if (detail.status === 'loading') {
    return <div className={`h-16 ${LOADING_CLASS}`} />;
  }
  if (detail.status === 'error') {
    return <p className="text-xs text-secondary-500 dark:text-secondary-400">Details unavailable</p>;
  }

  const { contact, callerId } = detail;
  const rows: { key: string; value: React.ReactNode; tooltip?: string }[] = [];

  if (callerId) rows.push({ key: 'CallerId', value: callerId });
  rows.push({ key: 'Name', value: contact.agent_name });
  rows.push({ key: 'Answered', value: formatCallTime(contact.answered_timestamp), tooltip: contact.answered_timestamp });
  rows.push({
    key: 'Answer Time',
    value: formatSecondsToTime(contact.call_to_queue_time + contact.queue_time),
    tooltip: `${formatSecondsToTime(contact.call_to_queue_time)} spent in menu + ${formatSecondsToTime(contact.queue_time)} spent in queue`,
  });
  rows.push({
    key: 'Id',
    value: config ? (
      <a
        href={`${config.connectDomain}/contact-trace-records/details/${contact.id}?tx=${encodeURIComponent(config.timeZone)}`}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="font-medium text-primary-600 hover:underline dark:text-primary-400"
      >
        {contact.id.split('-')[0]}
      </a>
    ) : (
      contact.id.split('-')[0]
    ),
  });

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-secondary-50 p-3 text-xs dark:bg-secondary-950/40">
      {rows.map((row) => (
        <Fragment key={row.key}>
          <dt className="text-secondary-500 dark:text-secondary-400">{row.key}</dt>
          <dd className={`font-medium ${row.tooltip ? CURSOR_HELP_CLASS : ''}`} title={row.tooltip}>
            {row.value}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

async function loadDetail(call: Call): Promise<Detail> {
  const params = new URLSearchParams({ contact_id: call.contactId });
  const [res, callerId] = await Promise.all([
    apiFetch(`${API}/calls/detail?${params}`),
    getCallerIdName(call.phoneNumber).catch(() => null),
  ]);
  if (!res.ok) return { status: 'error' };
  return { status: 'ready', contact: await res.json(), callerId };
}

export default function RecentCallList() {
  const calls = useStore($calls);
  const expanded = useStore($recentCallsExpanded);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (calls === null) {
    return (
      <Card title={TITLE}>
        <div id="recentCallList" className="p-4">
          <div className={`h-10 ${LOADING_CLASS}`} />
        </div>
      </Card>
    );
  }

  const toggleDetail = async (call: Call) => {
    const key = call.contactId;
    setOpen((o) => ({ ...o, [key]: !o[key] }));
    if (details[key] && details[key].status !== 'error') return;

    setDetails((d) => ({ ...d, [key]: { status: 'loading' } }));
    let detail: Detail;
    try {
      detail = await loadDetail(call);
    } catch {
      detail = { status: 'error' };
    }
    setDetails((d) => ({ ...d, [key]: detail }));
  };

  const visible = expanded ? calls : calls.slice(0, 5);

  return (
    <Card
      title={calls.length > 0 ? `${TITLE} (${calls.length})` : TITLE}
      actions={
        calls.length > 5 && (
          <Button size="sm" onClick={() => $recentCallsExpanded.set(!expanded)} aria-expanded={expanded}>
            {expanded ? 'Show less' : 'Show all'}
            <Icon name="chevronDown" className={`size-4 transition ${expanded ? 'rotate-180' : ''}`} />
          </Button>
        )
      }
    >
      <div id="recentCallList">
        {calls.length === 0 ? (
          <p className="px-4 py-3 text-sm text-secondary-500 dark:text-secondary-400">No calls yet</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-secondary-100 dark:divide-secondary-800">
              {visible.map((call) => {
                const key = call.contactId;
                const detail = open[key] ? details[key] : undefined;
                return (
                  <Fragment key={`${key}-${call.timestamp}`}>
                    <tr
                      className={key ? 'cursor-pointer hover:bg-secondary-50 dark:hover:bg-secondary-800/50' : undefined}
                      onClick={() => key && toggleDetail(call)}
                      title={key ? 'Show details' : undefined}
                    >
                      <td className="px-4 py-2.5 text-secondary-500 tabular-nums dark:text-secondary-400">
                        {formatCallTime(call.timestamp)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">{formatPhoneNumber(call.phoneNumber)}</td>
                    </tr>
                    {detail && (
                      <tr>
                        <td colSpan={2} className="px-4 pb-3">
                          <DetailTable detail={detail} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}
