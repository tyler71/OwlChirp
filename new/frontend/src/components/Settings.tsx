import { useStore } from '@nanostores/react';

import { $theme, setTheme, THEMES, type ThemeChoice } from '../lib/theme';
import { Card, Icon } from './ui';

function ThemeTile({ choice, selected }: { choice: ThemeChoice; selected: boolean }) {
  // Each tile carries its own data-theme so it previews that theme's colors.
  const previewTheme = choice === 'system' ? undefined : choice;
  return (
    <button
      type="button"
      data-theme={previewTheme}
      onClick={() => void setTheme(choice)}
      aria-pressed={selected}
      className={`overflow-hidden rounded-lg border text-left transition hover:-translate-y-0.5 hover:shadow-md ${
        selected
          ? 'border-primary-500 ring-2 ring-primary-500'
          : 'border-secondary-200 dark:border-secondary-700'
      }`}
    >
      <div className="flex items-center gap-2 bg-base-100 px-3 py-2.5 text-base-content">
        <span className="grow truncate text-sm font-semibold capitalize">{choice}</span>
        {choice === 'system' ? (
          <span className="text-xs opacity-60">Follows OS</span>
        ) : (
          <span className="flex gap-1">
            {['bg-primary', 'bg-secondary', 'bg-accent', 'bg-neutral'].map((c) => (
              <span key={c} className={`h-4 w-2 rounded-sm ${c}`} />
            ))}
          </span>
        )}
        {selected && <Icon name="check" className="size-4 text-primary-500" />}
      </div>
    </button>
  );
}

export default function Settings() {
  const theme = useStore($theme);
  return (
    <Card title="Appearance">
      <div className="flex flex-col gap-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">Theme</h3>
          <p className="text-xs text-secondary-500 dark:text-secondary-400">Saved to your account.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {(['system', ...THEMES] as ThemeChoice[]).map((t) => (
            <ThemeTile key={t} choice={t} selected={t === theme} />
          ))}
        </div>
      </div>
    </Card>
  );
}
