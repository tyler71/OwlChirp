import { useStore } from '@nanostores/react';
import { useState } from 'react';

import { dialNumber, sendDigits } from '../lib/softphone';
import { $contactSnapshot } from '../lib/stores';
import { Button, Card, Icon } from './ui';

const KEYS: [string, string][] = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
  ['*', ''],
  ['0', '+'],
  ['#', ''],
];

const DIGIT = /^[0-9*#+]$/;

// Idle: builds a number to dial. On a call: every key press is sent as DTMF.
export default function DialPad() {
  const contact = useStore($contactSnapshot);
  const [value, setValue] = useState('');
  const onCall = contact?.status === connect.ContactStateType.CONNECTED;
  const busy = contact !== null && !onCall;

  const press = (key: string) => {
    if (onCall) {
      if (key !== '+') void sendDigits(key);
      setValue((v) => v + key);
    } else {
      setValue((v) => v + key);
    }
  };

  const call = () => {
    if (value.trim()) void dialNumber(value).then(() => setValue(''));
  };

  return (
    <Card
      title={onCall ? 'Keypad' : 'Dial'}
      actions={
        value && (
          <button
            type="button"
            onClick={() => setValue('')}
            className="text-xs font-medium text-secondary-500 hover:text-secondary-800 dark:text-secondary-400 dark:hover:text-secondary-200"
          >
            Clear
          </button>
        )
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="relative">
          <input
            type="tel"
            inputMode="tel"
            value={value}
            placeholder={onCall ? 'Tone sent' : 'Enter a number'}
            readOnly={onCall}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (onCall && DIGIT.test(e.key)) {
                e.preventDefault();
                press(e.key);
              } else if (!onCall && e.key === 'Enter') {
                call();
              }
            }}
            className="block w-full rounded-lg border border-secondary-200 px-3 py-2.5 pr-10 text-center font-mono text-lg tracking-wider placeholder:font-sans placeholder:text-sm placeholder:tracking-normal placeholder:text-secondary-400 focus:border-primary-500 focus:ring-3 focus:ring-primary-500/50 focus:outline-none dark:border-secondary-600 dark:bg-secondary-800 dark:focus:border-primary-500"
          />
          {value && !onCall && (
            <button
              type="button"
              aria-label="Backspace"
              onClick={() => setValue((v) => v.slice(0, -1))}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-secondary-400 hover:text-secondary-700 dark:hover:text-secondary-200"
            >
              <Icon name="backspace" />
            </button>
          )}
        </div>

        {/* DialPad */}
        {
          onCall &&
            <div className="grid grid-cols-3 gap-2">
              {KEYS.map(([key, letters]) => (
                  <button
                      key={key}
                      type="button"
                      disabled={busy}
                      onClick={() => press(key)}
                      className="flex flex-col items-center justify-center rounded-lg border border-secondary-200 bg-base-100 py-2.5 transition hover:border-secondary-300 hover:bg-secondary-50 active:bg-secondary-100 disabled:opacity-50 dark:border-secondary-700 dark:bg-secondary-800 dark:hover:border-secondary-600 dark:hover:bg-secondary-700/60"
                  >
                    <span className="text-lg leading-6 font-semibold">{key}</span>
                    <span className="h-3.5 text-[10px] leading-3.5 font-medium tracking-widest text-secondary-400">{letters}</span>
                  </button>
              ))}
            </div>
        }

        {!onCall && (
          <Button variant="success" size="lg" icon="phone" disabled={busy || !value.trim()} onClick={call}>
            Call
          </Button>
        )}
      </div>
    </Card>
  );
}
