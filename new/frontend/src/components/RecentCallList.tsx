import { useStore } from '@nanostores/react';
import { useState } from 'react';

import { apiFetch } from '../lib/auth';
import { getCallerIdName } from '../lib/callerId';
import { API, CURSOR_HELP_CLASS, LOADING_CLASS } from '../lib/const';
import { formatCallTime, formatPhoneNumber, formatSecondsToTime } from '../lib/helpers';
import { $calls, $config, $recentCallsExpanded, type Call } from '../lib/stores';

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
    return <table className={`table subTable ${LOADING_CLASS}`}><tbody /></table>;
  }
  if (detail.status === 'error') {
    return (
      <table className="table subTable">
        <tbody><tr><td>Details unavailable</td></tr></tbody>
      </table>
    );
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
      >
        {contact.id.split('-')[0]}
      </a>
    ) : (
      contact.id.split('-')[0]
    ),
  });

  return (
    <table className="table subTable">
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.key}
            className={row.tooltip ? CURSOR_HELP_CLASS : undefined}
            data-toggle={row.tooltip ? 'tooltip' : undefined}
            data-placement={row.tooltip ? 'top' : undefined}
            title={row.tooltip}
          >
            <td>{row.key}</td>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
    return <div id="recentCallList" className={LOADING_CLASS} />;
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

  const visible = expanded ? calls : calls.slice(0, 1);

  return (
    <div id="recentCallList">
      <div className="listTitle noselect" onClick={() => calls.length > 0 && $recentCallsExpanded.set(!expanded)}>
        <h2 className={expanded ? 'expanded' : undefined}>
          {calls.length > 0 ? `${TITLE} (${calls.length})` : TITLE}
        </h2>
      </div>
      <div className="list">
        <table className="table table-striped table-hover">
          <tbody>
            {visible.map((call, i) => (
              <tr
                key={`${call.contactId}-${call.timestamp}`}
                className={!expanded && i === 0 ? 'collapsed' : undefined}
                onDoubleClick={() => call.contactId && toggleDetail(call)}
              >
                <td>{formatCallTime(call.timestamp)}</td>
                <td>{formatPhoneNumber(call.phoneNumber)}</td>
                {open[call.contactId] && details[call.contactId] && (
                  <td>
                    <DetailTable detail={details[call.contactId]} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
