import { useStore } from '@nanostores/react';

import { $agent } from '../lib/stores';
import MetricsTable from './MetricsTable';

// Metrics and call history, shown once the CCP agent is ready.
export default function DataPanel() {
  const agent = useStore($agent);
  if (!agent) return null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <div className="lg:col-span-2">
        <MetricsTable />
      </div>
    </div>
  );
}
