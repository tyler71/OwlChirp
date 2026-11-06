// A row of radio buttons, used by the Map's menu bar and Design panel.
import type { ReactNode } from 'react';

// Fixed-width labels so a panel's rows line up.
export const ROW_LABEL = 'w-12 shrink-0';

export default function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  row,
}: {
  label: string;
  row?: boolean;
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs font-semibold text-secondary-500 uppercase dark:text-secondary-400 ${row ? ROW_LABEL : ''}`}>{label}</span>
      <div role="radiogroup" aria-label={label} className="inline-flex overflow-hidden rounded-lg border border-secondary-200 dark:border-secondary-700">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            tabIndex={-1}
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className={`border-r border-secondary-200 px-2.5 py-1.5 text-xs font-semibold last:border-r-0 dark:border-secondary-700 ${
              o.value === value
                ? 'bg-primary-500 text-primary-content'
                : 'bg-base-100 text-secondary-700 hover:bg-secondary-100 dark:bg-secondary-800 dark:text-secondary-200 dark:hover:bg-secondary-700'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
