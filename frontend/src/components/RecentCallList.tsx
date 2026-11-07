import { useStore } from '@nanostores/react';
import { Fragment, useEffect, useRef, useState } from 'react';

import { useDisplayName } from '../lib/callerId';
import { loadNumberFeed } from '../lib/wrapups';
import { CURSOR_HELP_CLASS, LOADING_CLASS } from '../lib/const';
import { formatCallTime, formatPhoneNumber, formatSecondsToTime, normalizePhoneNumber } from '../lib/helpers';
import { request } from '../lib/realtime';
import { loadCallsPage, totalPages } from '../lib/callHistory';
import { $calls, $callsPage, $can, $config, $view, type Call } from '../lib/stores';
import { Card, Icon, Pagination, PhoneLabel } from './ui';

const TITLE = 'Recent Calls';

type ContactDetail = {
  id: string;
  agent_name: string;
  answered_timestamp: string;
  queue_time: number;
  call_to_queue_time: number;
};

type Detail = { status: 'loading' } | { status: 'error' } | { status: 'ready'; contact: ContactDetail };

// Contact details don't change once a call is over, so keep them across view switches.
const detailCache = new Map<string, Detail>();

// Details for a call the flow poller already recorded (shared with the
// Timeline), so no Connect lookup is needed: menu time runs from initiation to
// enqueue, queue time from enqueue to answer.
function flowDetail(call: Call): ContactDetail | null {
  if (!call.connectedAt) return null;
  const initiated = call.initiatedAt || call.connectedAt;
  return {
    id: call.contactId,
    agent_name: call.agentName ?? '',
    answered_timestamp: new Date(initiated).toISOString(),
    queue_time: call.enqueuedAt ? Math.floor((call.connectedAt - call.enqueuedAt) / 1000) : 0,
    call_to_queue_time: Math.floor(((call.enqueuedAt || call.connectedAt) - initiated) / 1000),
  };
}

async function loadDetail(call: Call): Promise<Detail> {
  const local = flowDetail(call);
  const contact = local ?? (await request<ContactDetail>('calls.detail', { contactId: call.contactId }));
  return { status: 'ready', contact };
}

function useDetail(call: Call): Detail | undefined {
  const key = call.contactId;
  const [detail, setDetail] = useState<Detail | undefined>(() => (key ? detailCache.get(key) : undefined));

  useEffect(() => {
    if (!key) return;
    const cached = detailCache.get(key);
    if (cached && cached.status !== 'error') {
      setDetail(cached);
      return;
    }
    let cancelled = false;
    setDetail({ status: 'loading' });
    loadDetail(call)
      .catch((): Detail => ({ status: 'error' }))
      .then((d) => {
        detailCache.set(key, d);
        if (!cancelled) setDetail(d);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return detail;
}

const ACTION_CLASS =
  'inline-flex items-center gap-1.5 rounded-lg border border-secondary-200 px-2.5 py-1.5 text-xs font-medium text-base-content hover:border-secondary-300 dark:border-secondary-700 dark:hover:border-secondary-600';

function CallCard({ call }: { call: Call }) {
  const config = useStore($config);
  const detail = useDetail(call);
  const canFeed = useStore($can('feed'));
  const showNames = useStore($can('agentNames'));
  const displayName = useDisplayName(call.phoneNumber);

  const jumpToFeed = () => {
    void loadNumberFeed(normalizePhoneNumber(call.phoneNumber));
    $view.set('feed');
  };

  const rows: { key: string; value: React.ReactNode; tooltip?: string }[] = [
    { key: 'Time', value: formatCallTime(call.timestamp) },
  ];
  // The title shows the caller ID name, so keep the number visible here.
  if (displayName) rows.push({ key: 'Phone', value: formatPhoneNumber(call.phoneNumber) });
  if (detail?.status === 'ready') {
    const { contact } = detail;
    if (showNames) rows.push({ key: 'Agent', value: contact.agent_name });
    if (call.queueName) rows.push({ key: 'Queue', value: call.queueName });
    rows.push({ key: 'Answered', value: formatCallTime(contact.answered_timestamp), tooltip: contact.answered_timestamp });
    rows.push({
      key: 'Answer Time',
      value: formatSecondsToTime(contact.call_to_queue_time + contact.queue_time),
      tooltip: `${formatSecondsToTime(contact.call_to_queue_time)} spent in menu + ${formatSecondsToTime(contact.queue_time)} spent in queue`,
    });
  }
  if (call.contactId) rows.push({ key: 'Contact Id', value: call.contactId.split('-')[0], tooltip: call.contactId });

  return (
    <Card
      title={<PhoneLabel phoneNumber={call.phoneNumber} className="tabular-nums" />}
      actions={
        <div className="flex items-center gap-2">
          {canFeed && (
            <button type="button" onClick={jumpToFeed} title="Open feed" className={ACTION_CLASS}>
              <Icon name="chat" className="size-4" />
              <span className="hidden sm:inline">Feed</span>
            </button>
          )}
          {config && call.contactId && (
            <a
              href={`${config.connectDomain}/contact-trace-records/details/${call.contactId}?tx=${encodeURIComponent(config.timeZone)}`}
              target="_blank"
              rel="noreferrer"
              title="Open in Amazon Connect"
              className={ACTION_CLASS}
            >
              <Icon name="externalLink" className="size-4" />
              <span className="hidden sm:inline">Connect</span>
            </a>
          )}
        </div>
      }
    >
      <div className="p-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {rows.map((row) => (
            <Fragment key={row.key}>
              <dt className="text-secondary-500 dark:text-secondary-400">{row.key}</dt>
              <dd className={`font-medium ${row.tooltip ? CURSOR_HELP_CLASS : ''}`} title={row.tooltip}>
                {row.value}
              </dd>
            </Fragment>
          ))}
        </dl>
        {detail?.status === 'loading' && <div className={`mt-2 h-16 ${LOADING_CLASS}`} />}
        {detail?.status === 'error' && (
          <p className="mt-2 text-xs text-secondary-500 dark:text-secondary-400">Details unavailable</p>
        )}
      </div>
    </Card>
  );
}

export default function RecentCallList() {
  const calls = useStore($calls);
  const { page, total } = useStore($callsPage);
  const sectionRef = useRef<HTMLElement>(null);

  const goToPage = (p: number) => {
    sectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    void loadCallsPage(p);
  };

  return (
    <section ref={sectionRef} className="flex flex-col gap-4 py-4">
      <h2 className="text-lg font-semibold">{total ? `${TITLE} (${total})` : TITLE}</h2>
      {calls === null ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`h-40 ${LOADING_CLASS}`} />
          ))}
        </div>
      ) : calls.length === 0 ? (
        <p className="text-sm text-secondary-500 dark:text-secondary-400">No calls yet</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {calls.map((call) => (
            <CallCard key={`${call.contactId}-${call.timestamp}`} call={call} />
          ))}
        </div>
      )}
      <Pagination page={page} totalPages={totalPages(total)} onChange={goToPage} />
    </section>
  );
}
