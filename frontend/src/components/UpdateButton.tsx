import { useStore } from '@nanostores/react';
import { $updateReady, applyUpdate } from '../lib/pwa';

/** Shown only when a new version is waiting; clicking it reloads onto that version. */
export default function UpdateButton({ className = '' }: { className?: string }) {
  const ready = useStore($updateReady);
  if (!ready) return null;
  return (
    <button
      type="button"
      className={`btn btn-primary btn-sm ${className}`.trim()}
      onClick={() => void applyUpdate()}
    >
      Update
    </button>
  );
}
