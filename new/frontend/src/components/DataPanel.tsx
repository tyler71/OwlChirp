import { useStore } from '@nanostores/react';

import { $agent } from '../lib/stores';
import MetricsTable from './MetricsTable';
import RecentCallList from './RecentCallList';

// Metrics and call history, shown once the CCP agent is ready.
export default function DataPanel() {
  const agent = useStore($agent);

  return (
    <div id="data" className={agent ? undefined : 'hide'}>
      {agent && (
        <>
          <MetricsTable />
          <div id="statusDiv">
            <div id="statusA">
              <RecentCallList />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
