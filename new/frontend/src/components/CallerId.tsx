import { useStore } from '@nanostores/react';
import { useEffect, useRef } from 'react';

import { saveCallerId } from '../lib/callerId';
import { formatPhoneNumber } from '../lib/helpers';
import { $callerId } from '../lib/stores';

const EDITING_CLASSES = ['ring-2', 'ring-primary-500', 'bg-base-100', 'dark:bg-secondary-800'];

// Click to rename the current caller; blur saves it.
export default function CallerId() {
  const callerId = useStore($callerId);
  const ref = useRef<HTMLDivElement>(null);
  const editing = useRef(false);

  const display = callerId ? callerId.name || formatPhoneNumber(callerId.phoneNumber) : '';

  // contentEditable content is managed directly so React doesn't fight the caret.
  useEffect(() => {
    if (ref.current && !editing.current) {
      ref.current.textContent = display;
    }
  }, [display]);

  const startEdit = () => {
    if (!callerId || !ref.current) return;
    editing.current = true;
    ref.current.contentEditable = 'true';
    ref.current.classList.add(...EDITING_CLASSES);
    ref.current.focus();
  };

  const finishEdit = async () => {
    const el = ref.current;
    if (!el || !editing.current) return;
    editing.current = false;
    el.contentEditable = 'false';
    el.classList.remove(...EDITING_CLASSES);

    const name = (el.textContent ?? '').trim();
    if (callerId && name.length > 0 && name !== display) {
      await saveCallerId(callerId.phoneNumber, name);
    } else {
      el.textContent = display;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      ref.current?.blur();
    } else if (e.key === 'Escape' && ref.current) {
      ref.current.textContent = display;
      ref.current.blur();
    }
  };

  return (
    <div className="min-w-0 flex-none basis-48">
      <div
        ref={ref}
        className="cursor-text truncate rounded-md px-2 py-1 text-sm font-semibold text-base-content outline-none empty:before:font-normal empty:before:text-secondary-400 empty:before:content-['No_caller'] hover:bg-base-100 dark:hover:bg-secondary-800"
        contentEditable={false}
        suppressContentEditableWarning
        spellCheck={false}
        title={callerId ? formatPhoneNumber(callerId.phoneNumber) : undefined}
        onClick={startEdit}
        onBlur={finishEdit}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
