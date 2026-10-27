import { useStore } from '@nanostores/react';
import { useEffect, useRef } from 'react';

import { initCcp } from '../lib/ccp';
import { $agent } from '../lib/stores';

export default function Ccp() {
  const agent = useStore($agent);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      initCcp(ref.current).catch((e) => console.error('CCP init failed', e));
    }
  }, []);

  // The CCP iframe must exist (but stays hidden) until the agent logs in.
  return <div id="ccp" ref={ref} className={agent ? undefined : 'hide'} />;
}
