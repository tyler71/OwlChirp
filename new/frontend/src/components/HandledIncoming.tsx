import { useStore } from '@nanostores/react';

import { $metrics } from '../lib/stores';

export default function HandledIncoming() {
  const handled = useStore($metrics, { keys: ['handled_incoming'] }).handled_incoming;

  return (
    <div
      id="handledIncoming"
      className={handled === undefined ? 'spinner-border noselect' : 'noselect'}
      title="Calls handled today"
    >
      {handled}
    </div>
  );
}
