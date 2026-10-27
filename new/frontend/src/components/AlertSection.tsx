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
            <a href={`${config.connectDomain}/login`} target="_blank" rel="noreferrer">
              <button type="button" className="btn btn-primary mt-3">
                Login
              </button>
            </a>
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
