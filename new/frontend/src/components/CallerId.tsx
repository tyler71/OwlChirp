import { useStore } from '@nanostores/react';
import { useEffect, useRef } from 'react';

import { saveCallerId } from '../lib/callerId';
import { formatPhoneNumber } from '../lib/helpers';
import { $callerId } from '../lib/stores';

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
    ref.current.classList.add('inEdit');
    ref.current.focus();
  };

  const finishEdit = async () => {
    const el = ref.current;
    if (!el || !editing.current) return;
    editing.current = false;
    el.contentEditable = 'false';
    el.classList.remove('inEdit');

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
    <div id="callerIdContainer">
      <div
        id="callerId"
        ref={ref}
        contentEditable={false}
        suppressContentEditableWarning
        spellCheck={false}
        title={callerId ? formatPhoneNumber(callerId.phoneNumber) : undefined}
        data-toggle="tooltip"
        data-placement="top"
        onClick={startEdit}
        onBlur={finishEdit}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
