// Small shared UI pieces in the Tailkit style: Heroicons (mini, 20px), buttons,
// cards and a ticking clock for call/status timers.
import { createContext, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { usePhoneLabel } from '../lib/callerId';
import { formatPhoneNumber, incidentUrl } from '../lib/helpers';

const ICONS = {
  phone:
    'M2 3.5A1.5 1.5 0 0 1 3.5 2h1.148a1.5 1.5 0 0 1 1.465 1.175l.513 2.31a1.5 1.5 0 0 1-1.025 1.75l-.97.324a.75.75 0 0 0-.454.965 11.53 11.53 0 0 0 6.29 6.29.75.75 0 0 0 .965-.454l.324-.97a1.5 1.5 0 0 1 1.75-1.025l2.31.513A1.5 1.5 0 0 1 18 14.352V15.5a1.5 1.5 0 0 1-1.5 1.5H15c-7.18 0-13-5.82-13-13V3.5Z',
  pause:
    'M5.75 3a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75V3.75A.75.75 0 0 0 7.25 3h-1.5ZM12.75 3a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75V3.75a.75.75 0 0 0-.75-.75h-1.5Z',
  play: 'M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z',
  microphone:
    'M7 4a3 3 0 0 1 6 0v6a3 3 0 1 1-6 0V4ZM5.5 9.643a.75.75 0 0 0-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-1.5v-1.546A6.001 6.001 0 0 0 16 10v-.357a.75.75 0 0 0-1.5 0V10a4.5 4.5 0 0 1-9 0v-.357Z',
  xMark:
    'M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z',
  swap: 'M13.2 2.24a.75.75 0 0 0 .04 1.06l2.1 1.95H6.75a.75.75 0 0 0 0 1.5h8.59l-2.1 1.95a.75.75 0 1 0 1.02 1.1l3.5-3.25a.75.75 0 0 0 0-1.1l-3.5-3.25a.75.75 0 0 0-1.06.04Zm-6.4 8a.75.75 0 0 0-1.06-.04l-3.5 3.25a.75.75 0 0 0 0 1.1l3.5 3.25a.75.75 0 1 0 1.02-1.1l-2.1-1.95h8.59a.75.75 0 0 0 0-1.5H4.66l2.1-1.95a.75.75 0 0 0 .04-1.06Z',
  userGroup:
    'M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM1.49 15.326a.78.78 0 0 1-.358-.442 3 3 0 0 1 4.308-3.516 6.484 6.484 0 0 0-1.905 3.959c-.023.222-.014.442.025.654a4.97 4.97 0 0 1-2.07-.655ZM16.44 15.98a4.97 4.97 0 0 0 2.07-.654.78.78 0 0 0 .357-.442 3 3 0 0 0-4.308-3.517 6.484 6.484 0 0 1 1.907 3.96 2.32 2.32 0 0 1-.026.654ZM18 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM5.304 16.19a.844.844 0 0 1-.277-.71 5 5 0 0 1 9.947 0 .843.843 0 0 1-.277.71A6.975 6.975 0 0 1 10 18a6.974 6.974 0 0 1-4.696-1.81Z',
  leave:
    'M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25ZM6 10a.75.75 0 0 1 .75-.75h9.546l-1.048-.943a.75.75 0 1 1 1.004-1.114l2.5 2.25a.75.75 0 0 1 0 1.114l-2.5 2.25a.75.75 0 1 1-1.004-1.114l1.048-.943H6.75A.75.75 0 0 1 6 10Z',
  search:
    'M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z',
  refresh:
    'M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0V5.36l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z',
  shield: 'M9.661 2.237a.531.531 0 0 1 .678 0 11.947 11.947 0 0 0 7.078 2.749.5.5 0 0 1 .479.425c.069.52.104 1.05.104 1.59 0 5.162-3.26 9.563-7.834 11.256a.48.48 0 0 1-.332 0C5.26 16.564 2 12.163 2 7c0-.538.035-1.069.104-1.589a.5.5 0 0 1 .48-.425 11.947 11.947 0 0 0 7.077-2.75Zm4.196 5.954a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z',
  user: 'M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.465 14.493a1.23 1.23 0 0 0 .41 1.412A9.957 9.957 0 0 0 10 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 0 0-13.074.003Z',
  queue:
    'M2 4.5A2.5 2.5 0 0 1 4.5 2h11a2.5 2.5 0 0 1 0 5h-11A2.5 2.5 0 0 1 2 4.5ZM2.75 9.083a.75.75 0 0 0 0 1.5h14.5a.75.75 0 0 0 0-1.5H2.75ZM2.75 12.663a.75.75 0 0 0 0 1.5h14.5a.75.75 0 0 0 0-1.5H2.75ZM2.75 16.25a.75.75 0 0 0 0 1.5h14.5a.75.75 0 1 0 0-1.5H2.75Z',
  backspace:
    'M7.22 3.22A.75.75 0 0 1 7.75 3h9A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17h-9a.75.75 0 0 1-.53-.22L.97 10.53a.75.75 0 0 1 0-1.06l6.25-6.25Zm3.06 4a.75.75 0 1 0-1.06 1.06L10.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L12 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L13.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L12 8.94l-1.72-1.72Z',
  chevronDown:
    'M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z',
  check:
    'M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.052-.143Z',
  home: 'M9.293 2.293a1 1 0 0 1 1.414 0l7 7A1 1 0 0 1 17 11h-1v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6H3a1 1 0 0 1-.707-1.707l7-7Z',
  signOut:
    'M17 4.25A2.25 2.25 0 0 0 14.75 2h-5.5A2.25 2.25 0 0 0 7 4.25v2a.75.75 0 0 0 1.5 0v-2a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 .75.75v11.5a.75.75 0 0 1-.75.75h-5.5a.75.75 0 0 1-.75-.75v-2a.75.75 0 0 0-1.5 0v2A2.25 2.25 0 0 0 9.25 18h5.5A2.25 2.25 0 0 0 17 15.75V4.25ZM14 10a.75.75 0 0 0-.75-.75H3.704l1.048-.943a.75.75 0 1 0-1.004-1.114l-2.5 2.25a.75.75 0 0 0 0 1.114l2.5 2.25a.75.75 0 1 0 1.004-1.114l-1.048-.943h9.546A.75.75 0 0 0 14 10Z',
  exclamation:
    'M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  cog: 'M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  chat: 'M3.43 2.524A41.29 41.29 0 0 1 10 2c2.236 0 4.43.18 6.57.524 1.437.231 2.43 1.49 2.43 2.902v5.148c0 1.413-.993 2.67-2.43 2.902a41.102 41.102 0 0 1-3.55.414c-.28.02-.521.18-.643.413l-1.712 3.293a.75.75 0 0 1-1.33 0l-1.713-3.293a.783.783 0 0 0-.642-.413 41.108 41.108 0 0 1-3.55-.414C1.993 13.245 1 11.986 1 10.574V5.426c0-1.413.993-2.67 2.43-2.902Z',
  clock: 'M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z',
  timeline:
    'M15.5 2A1.5 1.5 0 0 0 14 3.5v13a1.5 1.5 0 0 0 1.5 1.5h1a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 16.5 2h-1ZM9.5 6A1.5 1.5 0 0 0 8 7.5v9A1.5 1.5 0 0 0 9.5 18h1a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 10.5 6h-1ZM3.5 10A1.5 1.5 0 0 0 2 11.5v5A1.5 1.5 0 0 0 3.5 18h1A1.5 1.5 0 0 0 6 16.5v-5A1.5 1.5 0 0 0 4.5 10h-1Z',
  map: 'M8.157 2.176a1.5 1.5 0 0 0-1.147 0l-4.084 1.69A1.5 1.5 0 0 0 2 5.25v10.877a1.5 1.5 0 0 0 2.074 1.386l3.51-1.452 4.26 1.762a1.5 1.5 0 0 0 1.146 0l4.083-1.69A1.5 1.5 0 0 0 18 14.75V3.872a1.5 1.5 0 0 0-2.073-1.386l-3.51 1.452-4.26-1.762ZM7.58 5a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-1.5 0v-6.5A.75.75 0 0 1 7.58 5Zm5.59 2.75a.75.75 0 0 0-1.5 0v6.5a.75.75 0 0 0 1.5 0v-6.5Z',
  chevronLeft:
    'M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z',
  chevronRight:
    'M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z',
  externalLink:
    'M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Z M6.194 12.753a.75.75 0 0 0 1.06.053L16.5 4.44v2.81a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0 0 1.5h2.553l-9.056 8.194a.75.75 0 0 0-.053 1.06Z',
} as const;

export type IconName = keyof typeof ICONS | 'keypad' | 'microphoneSlash';

export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  if (name === 'keypad') {
    return (
      <svg viewBox="0 0 20 20" fill="currentColor" className={`inline-block flex-none ${className}`} aria-hidden>
        {[4, 10, 16].flatMap((y) => [4, 10, 16].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.75} />))}
      </svg>
    );
  }
  if (name === 'microphoneSlash') {
    return (
      <svg viewBox="0 0 20 20" fill="currentColor" className={`inline-block flex-none ${className}`} aria-hidden>
        <path fillRule="evenodd" clipRule="evenodd" d={ICONS.microphone} />
        <path d="M3 3l14 14" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={`inline-block flex-none ${className}`} aria-hidden>
      <path fillRule="evenodd" clipRule="evenodd" d={ICONS[name]} />
    </svg>
  );
}

const BUTTON_VARIANTS = {
  default:
    'border-secondary-200 bg-base-100 text-base-content hover:border-secondary-300 hover:shadow-xs active:border-secondary-200 active:shadow-none dark:border-secondary-700 dark:bg-secondary-800 dark:hover:border-secondary-600 dark:active:border-secondary-700',
  active:
    'border-primary-200 bg-primary-50 text-primary-800 hover:border-primary-300 dark:border-primary-700/60 dark:bg-primary-500/15 dark:text-primary-200',
  primary:
    'border-primary-500 bg-primary-500 text-primary-content hover:border-primary-600 hover:bg-primary-600 active:border-primary-700 active:bg-primary-700',
  success:
    'border-emerald-700 bg-emerald-600 text-white hover:border-emerald-600 hover:bg-emerald-500 active:bg-emerald-600',
  danger: 'border-rose-700 bg-rose-600 text-white hover:border-rose-600 hover:bg-rose-500 active:bg-rose-600',
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
};

const BUTTON_SIZES = {
  sm: 'gap-1.5 px-2.5 py-1.5 text-xs',
  md: 'gap-2 px-3 py-2 text-sm',
  lg: 'gap-2 px-5 py-3 text-base',
};

export function Button({ variant = 'default', size = 'md', icon, className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-lg border leading-5 font-semibold transition disabled:pointer-events-none disabled:opacity-50 ${BUTTON_SIZES[size]} ${BUTTON_VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} className={size === 'sm' ? 'size-4' : 'size-5'} />}
      {children}
    </button>
  );
}

/**
 * Set by a container (the Phone tab cards) to let the Card inside it be
 * minimized to its title row. Without it, Cards can't be minimized.
 */
export const CardMinimize = createContext<{ minimized: boolean; toggle: () => void } | null>(null);

export function MinimizeButton({ minimized, toggle }: { minimized: boolean; toggle: () => void }) {
  return (
    <button
      type="button"
      onClick={toggle}
      title={minimized ? 'Expand' : 'Minimize'}
      aria-label={minimized ? 'Expand' : 'Minimize'}
      aria-expanded={!minimized}
      className="-m-1 flex-none rounded-md p-1 text-secondary-400 hover:bg-secondary-100 hover:text-secondary-700 dark:hover:bg-secondary-800 dark:hover:text-secondary-200"
    >
      <Icon name="chevronDown" className={`size-4 transition-transform ${minimized ? '-rotate-90' : ''}`} />
    </button>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  const minimize = useContext(CardMinimize);
  const minimized = minimize?.minimized ?? false;
  return (
    <section
      className={`flex flex-col overflow-hidden rounded-lg border border-secondary-200 bg-base-100 text-base-content dark:border-secondary-800 dark:bg-secondary-900 ${className}`}
    >
      {(title || actions || minimize) && (
        <div
          className={`flex items-center justify-between gap-2 px-4 py-3 ${
            minimized ? '' : 'border-b border-secondary-100 dark:border-secondary-800'
          }`}
        >
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="flex items-center gap-2">
            {!minimized && actions}
            {minimize && <MinimizeButton {...minimize} />}
          </div>
        </div>
      )}
      {!minimized && children}
    </section>
  );
}

// Pagination: Simple (Tailkit a-c-pagination-01), with buttons instead of links.
const PAGE_CLASS =
  'inline-flex items-center justify-center gap-2 border border-secondary-200 px-4 py-2 leading-6 font-semibold text-secondary-800 hover:z-1 hover:border-secondary-300 hover:text-secondary-900 hover:shadow-xs focus:z-1 focus:ring-3 focus:ring-secondary-300/25 active:z-1 active:border-secondary-200 active:shadow-none disabled:pointer-events-none disabled:opacity-50 dark:border-secondary-700 dark:text-secondary-300 dark:hover:border-secondary-600 dark:hover:text-secondary-200 dark:focus:ring-secondary-600/40 dark:active:border-secondary-700';
const PAGE_IDLE_CLASS = 'bg-base-100 dark:bg-secondary-800';
const PAGE_CURRENT_CLASS = 'bg-secondary-100 dark:bg-secondary-700/75';

// First, last and the current page ±1, with 'gap' where pages are skipped.
export function pageItems(page: number, totalPages: number): (number | 'gap')[] {
  const pages = [...new Set([1, page - 1, page, page + 1, totalPages])]
    .filter((p) => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b);
  const items: (number | 'gap')[] = [];
  pages.forEach((p, i) => {
    const prev = pages[i - 1];
    if (prev !== undefined && p - prev === 2) items.push(prev + 1);
    else if (prev !== undefined && p - prev > 2) items.push('gap');
    items.push(p);
  });
  return items;
}

export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  const prev = (
    <Icon name="chevronLeft" className="-mx-1.5 size-5" />
  );
  const next = (
    <Icon name="chevronRight" className="-mx-1.5 size-5" />
  );
  return (
    <div className="text-center dark:text-secondary-100">
      <nav className="flex sm:hidden" aria-label="Pagination">
        <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)} className={`${PAGE_CLASS} ${PAGE_IDLE_CLASS} rounded-lg`}>
          {prev}
        </button>
        <div className="flex grow items-center justify-center px-2 sm:px-4">
          <span>
            Page <span className="font-semibold">{page}</span> of <span className="font-semibold">{totalPages}</span>
          </span>
        </div>
        <button type="button" aria-label="Next page" disabled={page >= totalPages} onClick={() => onChange(page + 1)} className={`${PAGE_CLASS} ${PAGE_IDLE_CLASS} rounded-lg`}>
          {next}
        </button>
      </nav>

      <nav className="hidden sm:inline-flex" aria-label="Pagination">
        <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)} className={`${PAGE_CLASS} ${PAGE_IDLE_CLASS} -mr-px rounded-l-lg`}>
          {prev}
        </button>
        {pageItems(page, totalPages).map((item, i) =>
          item === 'gap' ? (
            <div
              key={`gap-${i}`}
              className="-mr-px flex items-center justify-center border border-secondary-200 bg-base-100 px-4 text-secondary-800 dark:border-secondary-700 dark:bg-secondary-800 dark:text-secondary-300"
            >
              ...
            </div>
          ) : (
            <button
              key={item}
              type="button"
              aria-current={item === page ? 'page' : undefined}
              onClick={() => item !== page && onChange(item)}
              className={`${PAGE_CLASS} ${item === page ? PAGE_CURRENT_CLASS : PAGE_IDLE_CLASS} -mr-px tabular-nums`}
            >
              {item}
            </button>
          ),
        )}
        <button type="button" aria-label="Next page" disabled={page >= totalPages} onClick={() => onChange(page + 1)} className={`${PAGE_CLASS} ${PAGE_IDLE_CLASS} rounded-r-lg`}>
          {next}
        </button>
      </nav>
    </div>
  );
}

// Re-renders every second; returns the current time for elapsed timers.
export function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function stateDotClass(stateType: string): string {
  switch (stateType) {
    case connect.AgentStateType.ROUTABLE:
      return 'bg-emerald-500';
    case connect.AgentStateType.NOT_ROUTABLE:
      return 'bg-amber-500';
    case connect.AgentStateType.OFFLINE:
      return 'bg-secondary-400';
    case connect.AgentStateType.ERROR:
      return 'bg-rose-500';
    default:
      return 'bg-primary-500';
  }
}

/** A phone number shown as its caller ID name when one is saved (and not opted out). */
export function PhoneLabel({ phoneNumber, className }: { phoneNumber: string; className?: string }) {
  const label = usePhoneLabel(phoneNumber);
  return (
    <span className={className} title={formatPhoneNumber(phoneNumber)}>
      {label}
    </span>
  );
}

/** An incident number linked to its ServiceNow search; opens in a new tab. */
export function IncidentLink({ incident, className = '' }: { incident: string; className?: string }) {
  return (
    <a
      href={incidentUrl(incident)}
      target="_blank"
      rel="noopener noreferrer"
      className={`underline decoration-current/40 underline-offset-2 hover:decoration-current ${className}`}
      onClick={(e) => e.stopPropagation()}
      title="Open in ServiceNow"
    >
      {incident}
    </a>
  );
}
