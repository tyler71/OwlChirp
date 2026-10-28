import { useStore } from '@nanostores/react';

import { LOADING_CLASS } from '../lib/const';
import { $metrics } from '../lib/stores';

export default function HandledIncoming() {
  const handled = useStore($metrics, { keys: ['handled_incoming'] }).handled_incoming;

  return (
    <div
      className={`flex min-w-10 flex-none cursor-help items-center justify-center rounded-lg bg-base-100 px-2.5 py-1 text-sm font-bold tabular-nums select-none ring-1 ring-secondary-200 dark:bg-secondary-800 dark:ring-secondary-700 ${
        handled === undefined ? `h-7 ${LOADING_CLASS}` : ''
      }`}
      title="Calls handled today"
    >
      {handled}
    </div>
  );
}
