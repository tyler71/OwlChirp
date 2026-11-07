import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { useStore } from '@nanostores/react';

import { goAvailable } from '../lib/softphone';
import { $helpRequest } from '../lib/stores';
import { Button, Icon } from './ui';

// Popup for agents in a non-routable status when a teammate asks for help.
export default function HelpRequestDialog() {
  const req = useStore($helpRequest);
  const close = () => $helpRequest.set(null);

  return (
    <Dialog open={req !== null} onClose={close} className="relative z-50">
      <div className="fixed inset-0 bg-secondary-900/40 backdrop-blur-xs" aria-hidden />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-sm rounded-lg bg-base-100 p-6 text-base-content shadow-xl ring-1 shadow-secondary-500/10 ring-black/5 dark:bg-secondary-800 dark:shadow-secondary-900 dark:ring-secondary-700">
          <div className="flex items-start gap-3">
            <span className="flex size-10 flex-none items-center justify-center rounded-full bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
              <Icon name="userGroup" className="size-5" />
            </span>
            <div>
              <DialogTitle className="text-base font-semibold">Help requested</DialogTitle>
              {req && (
                <p className="mt-1 text-sm text-secondary-600 dark:text-secondary-300">
                  <span className="font-semibold">{req.name}</span> needs help: {req.queueCount} callers waiting.
                </p>
              )}
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button onClick={close}>Dismiss</Button>
            <Button variant="success" icon="phone" onClick={() => void goAvailable().then(close)}>
              Go Available
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
