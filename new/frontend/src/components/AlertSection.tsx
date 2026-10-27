import { useStore } from '@nanostores/react';

import { $alert, $config } from '../lib/stores';

export default function AlertSection() {
  const alert = useStore($alert);
  const config = useStore($config);

  if (alert.kind === 'welcome') {
    return (
      <div id="alertSection">
        Thanks for using my program! -Tyler
        <br />
        <small>If OwlChirp isn't loading, login and refresh</small>
        <br />
        {config && (
          <>
            {/* A popup (not noopener) lets Firefox grant the CCP frame storage access. */}
            <button
              type="button"
              className="btn btn-primary mt-3"
              onClick={() => window.open(`${config.connectDomain}/login`, 'connect-login', 'width=500,height=700')}
            >
              Login
            </button>
            <br />
          </>
        )}
        <button type="button" className="btn btn-primary mt-2" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }

  return (
    <div id="alertSection" className={alert.kind === 'warning' ? 'bg-warning' : undefined}>
      {alert.message}
    </div>
  );
}
