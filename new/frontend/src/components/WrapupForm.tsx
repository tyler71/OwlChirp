import { useStore } from '@nanostores/react';
import { useEffect, type KeyboardEvent } from 'react';

import {
  $wrapupDraft,
  $wrapupStatus,
  draftFor,
  emptyDraft,
  INCIDENT_MAX_LENGTH,
  isEmptyWrapup,
  MOODS,
  saveDraft,
  THOUGHTS_MAX_LENGTH,
  updateDraft,
} from '../lib/wrapups';
import { Button } from './ui';

const INPUT_CLASS =
  'block w-full rounded-lg border border-secondary-200 bg-base-100 px-3 py-2 text-sm leading-5 placeholder-secondary-400 focus:border-primary-500 focus:ring-3 focus:ring-primary-500/50 focus:outline-none dark:border-secondary-700 dark:bg-secondary-900 dark:placeholder-secondary-500 dark:focus:border-primary-500';

const LABEL_CLASS = 'mb-1 block text-xs font-semibold text-secondary-600 dark:text-secondary-400';

/**
 * Notes for the current contact, shown during the call and in after-call
 * work. Saved with the Save button or ⌘/Ctrl+Enter, and by Finish call.
 */
export default function WrapupForm({ contactId, phoneNumber }: { contactId: string; phoneNumber: string }) {
  useEffect(() => {
    draftFor(contactId, phoneNumber);
  }, [contactId, phoneNumber]);

  const stored = useStore($wrapupDraft);
  const status = useStore($wrapupStatus);
  const draft = stored?.contactId === contactId ? stored : emptyDraft(contactId, phoneNumber);
  const empty = isEmptyWrapup(draft);

  const submitOnShortcut = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void saveDraft();
    }
  };

  return (
    <div className="space-y-3 border-t border-secondary-100 px-4 py-4 dark:border-secondary-800" onKeyDown={submitOnShortcut}>
      <h3 className="text-xs font-semibold tracking-wide text-secondary-500 uppercase dark:text-secondary-400">Call notes</h3>
      <div>
        <label htmlFor={`wrapup-incident-${contactId}`} className={LABEL_CLASS}>
          Incident created
        </label>
        <input
          id={`wrapup-incident-${contactId}`}
          type="text"
          className={INPUT_CLASS}
          placeholder="e.g. INC-1234"
          maxLength={INCIDENT_MAX_LENGTH}
          value={draft.incident}
          onChange={(e) => updateDraft({ incident: e.target.value })}
        />
      </div>

      <div>
        <span id={`wrapup-mood-${contactId}`} className={LABEL_CLASS}>
          Caller was
        </span>
        <div role="group" aria-labelledby={`wrapup-mood-${contactId}`} className="flex gap-2">
          {MOODS.map((m) => {
            const active = draft.mood === m.value;
            return (
              <button
                key={m.value}
                type="button"
                aria-pressed={active}
                title={m.label}
                onClick={() => updateDraft({ mood: active ? '' : m.value })}
                className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg border px-2 py-2 text-xs font-semibold transition ${
                  active
                    ? 'border-primary-300 bg-primary-50 text-primary-800 dark:border-primary-600 dark:bg-primary-500/15 dark:text-primary-200'
                    : 'border-secondary-200 bg-base-100 text-secondary-600 hover:border-secondary-300 dark:border-secondary-700 dark:bg-secondary-800 dark:text-secondary-300 dark:hover:border-secondary-600'
                }`}
              >
                <span className={`text-2xl leading-none transition ${active ? '' : 'opacity-70 grayscale-[40%]'}`} aria-hidden>
                  {m.emoji}
                </span>
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label htmlFor={`wrapup-thoughts-${contactId}`} className={LABEL_CLASS}>
          Thoughts
        </label>
        <textarea
          id={`wrapup-thoughts-${contactId}`}
          rows={3}
          className={`${INPUT_CLASS} resize-y`}
          placeholder="Anything the next agent should know"
          maxLength={THOUGHTS_MAX_LENGTH}
          value={draft.thoughts}
          onChange={(e) => updateDraft({ thoughts: e.target.value })}
        />
      </div>

      {status.error && (
        <p className="text-xs font-medium text-rose-600 dark:text-rose-400" role="alert">
          Couldn't save notes: {status.error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-secondary-500 dark:text-secondary-400">
          {status.saved ? 'Saved · edits update this entry' : 'Also saved when you finish the call'}
        </p>
        <Button size="sm" variant={status.saved ? 'default' : 'primary'} icon={status.saved ? 'check' : undefined} disabled={empty || status.saving || status.saved} onClick={() => void saveDraft()}>
          {status.saving ? 'Saving…' : status.saved ? 'Saved' : 'Save notes'}
        </Button>
      </div>
    </div>
  );
}
