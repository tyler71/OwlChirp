import { useStore } from '@nanostores/react';
import { $updateReady, applyUpdate } from '../lib/pwa';

/** Shown only when a new version is waiting; clicking it reloads onto that version. */
export default function UpdateButton() {
  const ready = useStore($updateReady);
  if (!ready) return null;
  return (
    <button type="button" className="btn btn-primary btn-sm" onClick={() => void applyUpdate()}>
      Update
    </button>
  );
}
