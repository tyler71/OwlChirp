import { useStore } from '@nanostores/react';
import { useEffect, useRef } from 'react';

import { initCcp } from '../lib/ccp';
import { $storageAccess } from '../lib/stores';

// Host for the Amazon Connect CCP iframe. It only carries softphone audio and
// signalling, so it stays rendered but off-screen (display:none can stall the
// iframe). It's shown only when Connect's storage-access banner needs a click.
export default function Ccp() {
  const storageAccess = useStore($storageAccess);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      initCcp(ref.current).catch((e) => console.error('CCP init failed', e));
    }
  }, []);

  const visible = storageAccess === 'needed' || storageAccess === 'denied';
  return (
    <div
      id="ccp"
      ref={ref}
      aria-hidden={!visible}
      className={
        visible
          ? 'mx-auto h-[480px] w-full max-w-sm overflow-hidden rounded-lg border border-secondary-200 dark:border-secondary-800'
          : 'pointer-events-none fixed top-0 -left-[10000px] h-[480px] w-[320px] opacity-0'
      }
    />
  );
}
