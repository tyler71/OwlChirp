import { useStore } from '@nanostores/react';

import { $alert, $config } from '../lib/stores';
import { Button, Icon } from './ui';

export default function AlertSection() {
  const alert = useStore($alert);
  const config = useStore($config);

  if (alert.kind === 'welcome') {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-secondary-200 bg-secondary-50 px-6 py-10 text-center dark:border-secondary-800 dark:bg-secondary-950/40">
        <div>
          <p className="text-lg font-semibold">Thanks for using my program! -Tyler</p>
          <p className="text-sm text-secondary-500 dark:text-secondary-400">If OwlChirp isn't loading, login and refresh</p>
        </div>
        <div className="flex gap-2">
          {config && (
            // A popup (not noopener) lets Firefox grant the CCP frame storage access.
            <Button
              variant="primary"
              onClick={() => window.open(`${config.connectDomain}/login`, 'connect-login', 'width=500,height=700')}
            >
              Login
            </Button>
          )}
          <Button icon="refresh" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    );
  }

  if (!alert.message) return null;

  const warning = alert.kind === 'warning';
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${
        warning
          ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100'
          : 'border-primary-200 bg-primary-50 text-primary-900 dark:border-primary-500/30 dark:bg-primary-500/10 dark:text-primary-100'
      }`}
    >
      <Icon name="exclamation" className={`size-5 ${warning ? 'text-amber-500' : 'text-primary-500'}`} />
      <p className="grow">{alert.message}</p>
      {warning && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => $alert.set({ kind: 'none' })}
          className="opacity-60 hover:opacity-100"
        >
          <Icon name="xMark" className="size-4" />
        </button>
      )}
    </div>
  );
}
