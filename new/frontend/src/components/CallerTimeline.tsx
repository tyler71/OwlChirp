import { useStore } from '@nanostores/react';

import { flowStage } from '../lib/flowCalls';
import { usePhoneLabel } from '../lib/callerId';
import { agentName } from '../lib/helpers';
import { $contactSnapshot, $isPower, $numberCalls } from '../lib/stores';
import { ConnectLink, StageBadge } from './FlowCalls';
import { dayLabel, timeFormat } from './Timeline';
import { Card } from './ui';

/**
 * Earlier inbound calls from the current contact's number, one entry per call,
 * newest first. Power users only; the Phone tab shows it on desktop widths.
 */
export default function CallerTimeline() {
  const contact = useStore($contactSnapshot);
  const isPower = useStore($isPower);
  const history = useStore($numberCalls);
  const caller = usePhoneLabel(contact?.phoneNumber ?? '');

  if (!isPower || !contact?.phoneNumber || history?.phoneNumber !== contact.phoneNumber) return null;

  const { calls, loading } = history;

  return (
    <Card
      title="Call history"
      actions={
        <span className="text-xs text-secondary-500 dark:text-secondary-400">
          {loading
            ? 'Loading…'
            : `${calls.length} ${calls.length === 1 ? 'call' : 'calls'} from ${caller} · 8 weeks`}
        </span>
      }
    >
      {!loading && !calls.length && (
        <p className="px-4 py-6 text-center text-sm text-secondary-500 dark:text-secondary-400">
          No previous calls from this number.
        </p>
      )}

      {calls.length > 0 && (
        <div className="max-h-[32rem] overflow-y-auto px-4 py-4">
          <div className="relative">
            <div className="absolute top-0 bottom-0 left-0 flex w-8 justify-center" aria-hidden="true">
              <div className="w-1 rounded bg-primary-100 dark:bg-primary-900" />
            </div>
            <ul className="relative space-y-3 pl-8">
              {calls.map((call, i) => {
                const day = dayLabel(call.initiatedAt);
                const newDay = i === 0 || dayLabel(calls[i - 1].initiatedAt) !== day;
                const current = call.contactId === contact.contactId;
                return (
                  <li key={call.contactId} className="relative">
                    <div className="absolute top-0 bottom-0 left-0 mt-3.5 flex w-8 -translate-x-full justify-center">
                      <div
                        className={`size-3 rounded-full ring-3 ring-offset-2 ring-offset-base-100 dark:ring-offset-secondary-900 ${
                          current
                            ? 'bg-emerald-500 ring-emerald-100 dark:bg-emerald-400 dark:ring-emerald-900'
                            : 'bg-primary-500 ring-primary-100 dark:bg-primary-300 dark:ring-primary-900'
                        }`}
                      />
                    </div>
                    {newDay && (
                      <p className="mb-1 text-xs font-semibold tracking-wider text-primary-600 uppercase dark:text-primary-400">
                        {day}
                      </p>
                    )}
                    <div
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                        current
                          ? 'bg-emerald-50 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:ring-emerald-500/30'
                          : 'bg-secondary-50 dark:bg-secondary-800'
                      }`}
                    >
                      <span className="w-16 flex-none text-secondary-500 tabular-nums dark:text-secondary-400">
                        {timeFormat.format(call.initiatedAt)}
                      </span>
                      <span className="min-w-0 grow truncate text-xs text-secondary-600 dark:text-secondary-300">
                        {current ? 'This call' : call.agentUsername ? agentName(call.agentUsername) : call.agentName || call.queueName}
                      </span>
                      <StageBadge stage={flowStage(call)} />
                      <ConnectLink contactId={call.contactId} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}
