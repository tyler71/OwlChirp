import { useStore } from '@nanostores/react';
import { useEffect, useRef } from 'react';

import { initCcp } from '../lib/ccp';
import { $agent, $storageAccess } from '../lib/stores';

export default function Ccp() {
  const agent = useStore($agent);
  const storageAccess = useStore($storageAccess);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      initCcp(ref.current).catch((e) => console.error('CCP init failed', e));
    }
  }, []);

  // The CCP iframe must exist (but stays hidden) until the agent logs in. It's
  // shown early when Connect's storage-access banner needs a click.
  const visible = agent || storageAccess === 'needed' || storageAccess === 'denied';
  return <div id="ccp" ref={ref} className={visible ? undefined : 'hide'} />;
}
