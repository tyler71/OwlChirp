import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';

import { agentName } from '../lib/helpers';
import { onEvent } from '../lib/realtime';
import { $agent, FEATURES, PRESETS, type Feature } from '../lib/stores';
import { listUsers, resetFeatures, setFeatures, type ManagedUser } from '../lib/users';
import { Button, Icon } from './ui';

const INPUT_CLASS =
  'block w-full rounded-lg border border-secondary-200 bg-white px-3 py-2 text-sm leading-5 placeholder-secondary-400 focus:border-primary-500 focus:ring-3 focus:ring-primary-500/50 focus:outline-none disabled:opacity-50 dark:border-secondary-700 dark:bg-secondary-800 dark:focus:border-primary-500';

const TH_CLASS =
  'border-b-2 border-secondary-200/50 px-3 pb-4 text-left font-semibold text-secondary-900 dark:border-secondary-700 dark:text-secondary-50';

const CUSTOM = 'custom';

// Admins always keep Admin on their own row so they can't lock themselves out.
const SELF_KEEPS: Feature = 'admin';

// The preset whose features match list exactly, or CUSTOM.
function presetOf(list: Feature[]): string {
  const match = PRESETS.find((p) => p.features.length === list.length && p.features.every((f) => list.includes(f)));
  return match?.key ?? CUSTOM;
}

function toggled(list: Feature[], feature: Feature, on: boolean): Feature[] {
  return on ? [...list, feature] : list.filter((f) => f !== feature);
}

type Loaded = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function matches(u: ManagedUser, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || u.username.toLowerCase().includes(q);
}

function SourceBadge({ source }: { source: ManagedUser['source'] }) {
  if (source === 'hardcoded') {
    return (
      <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
        Built-in
      </span>
    );
  }
  return source === 'db' ? (
    <span className="inline-flex rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700 dark:bg-primary-500/20 dark:text-primary-300">
      Custom
    </span>
  ) : (
    <span className="inline-flex rounded-full bg-secondary-100 px-2 py-0.5 text-xs font-semibold text-secondary-600 dark:bg-secondary-700 dark:text-secondary-300">
      Default
    </span>
  );
}

// Every Connect user and the features they have. Users nobody has set up
// ("Default") get Phone and Settings only.
export default function AdminUsers() {
  const agent = useStore($agent);
  const me = agent?.getConfiguration().username;
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listUsers()
      .then((list) => {
        if (cancelled) return;
        setUsers(list);
        setLoaded({ status: 'ready' });
      })
      .catch((e: unknown) => !cancelled && setLoaded({ status: 'error', message: errorMessage(e) }));
    return () => {
      cancelled = true;
    };
  }, []);

  // Changes by any admin, including this one, arrive as events.
  useEffect(
    () =>
      onEvent<ManagedUser>('permission.updated', (updated) => {
        setUsers((list) => list.map((u) => (u.username === updated.username ? updated : u)));
      }),
    [],
  );

  async function change(username: string, action: () => Promise<ManagedUser>): Promise<void> {
    setSaving(username);
    try {
      await action();
    } catch (e) {
      alert(`Failed to update ${agentName(username)}: ${errorMessage(e)}`);
    } finally {
      setSaving(null);
    }
  }

  const visible = users.filter((u) => matches(u, query));

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-secondary-200 bg-base-100 text-base-content dark:border-secondary-800 dark:bg-secondary-900">
      <div className="bg-secondary-50 px-5 py-4 dark:bg-secondary-800/50">
        <h3 className="mb-1 font-semibold">Users</h3>
        <h4 className="text-sm font-medium text-secondary-500 dark:text-secondary-400">
          Choose the features each user has. Phone and Settings are always available. Pick a preset to fill in a row, then fine-tune with the checkboxes.
        </h4>
      </div>

      <div className="border-b border-secondary-100 p-5 dark:border-secondary-800">
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center text-secondary-500">
            <Icon name="search" />
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by username..."
            aria-label="Search users"
            className={`${INPUT_CLASS} pl-10`}
          />
        </div>
      </div>

      <div className="grow p-5">
        {loaded.status === 'loading' ? (
          <p className="text-sm text-secondary-500 dark:text-secondary-400">Loading users...</p>
        ) : loaded.status === 'error' ? (
          <p className="text-sm text-rose-600 dark:text-rose-400">Failed to load users: {loaded.message}</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-secondary-500 dark:text-secondary-400">
            {users.length === 0 ? 'No users found' : 'No users match your search'}
          </p>
        ) : (
          <div className="min-w-full overflow-x-auto">
            <table className="min-w-full align-middle text-sm whitespace-nowrap">
              <thead>
                <tr>
                  <th className={`${TH_CLASS} pl-0`}>Name</th>
                  <th className={TH_CLASS}>Preset</th>
                  {FEATURES.map((f) => (
                    <th key={f.key} className={`${TH_CLASS} text-center`} title={f.detail}>
                      {f.label}
                    </th>
                  ))}
                  <th className={TH_CLASS}>Source</th>
                  <th className={`${TH_CLASS} pr-0 text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => {
                  const self = u.username === me;
                  const locked = !self && u.source === 'hardcoded';
                  const busy = saving === u.username;
                  const lockedTitle = locked ? 'This user is always an admin' : undefined;
                  const keep = (list: Feature[]) => (self && !list.includes(SELF_KEEPS) ? [...list, SELF_KEEPS] : list);
                  const canReset =
                    (u.source === 'db' && !self) || (self && u.source === 'hardcoded' && u.features.length < FEATURES.length);
                  const preset = presetOf(u.features);
                  return (
                    <tr key={u.username} className="border-b border-secondary-100 dark:border-secondary-700/50">
                      <td className="py-3 pr-3">
                        <div className="font-medium">
                          {agentName(u.username)}
                          {self && <span className="ml-1.5 text-xs text-secondary-500 dark:text-secondary-400">(you)</span>}
                        </div>
                        <div className="text-xs text-secondary-500 dark:text-secondary-400">{u.username}</div>
                      </td>
                      <td className="p-3">
                        <select
                          value={preset}
                          disabled={locked || busy}
                          title={lockedTitle}
                          onChange={(e) => {
                            const p = PRESETS.find((x) => x.key === e.target.value);
                            if (p) void change(u.username, () => setFeatures(u.username, keep(p.features)));
                          }}
                          aria-label={`Preset for ${u.username}`}
                          className={`${INPUT_CLASS} w-32`}
                        >
                          {PRESETS.map((p) => (
                            <option key={p.key} value={p.key}>
                              {p.label}
                            </option>
                          ))}
                          {preset === CUSTOM && (
                            <option value={CUSTOM} disabled>
                              Custom
                            </option>
                          )}
                        </select>
                      </td>
                      {FEATURES.map((f) => {
                        const kept = self && f.key === SELF_KEEPS;
                        return (
                          <td key={f.key} className="p-3 text-center">
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm checkbox-primary"
                              checked={u.features.includes(f.key)}
                              disabled={locked || kept || busy}
                              title={kept ? "You can't remove your own admin access" : (lockedTitle ?? f.detail)}
                              aria-label={`${f.label} for ${u.username}`}
                              onChange={(e) =>
                                void change(u.username, () =>
                                  setFeatures(u.username, keep(toggled(u.features, f.key, e.target.checked))),
                                )
                              }
                            />
                          </td>
                        );
                      })}
                      <td className="p-3">
                        <SourceBadge source={u.source} />
                      </td>
                      <td className="py-3 pl-3 text-right">
                        {canReset && (
                          <Button
                            size="sm"
                            icon="refresh"
                            disabled={busy}
                            title={self ? 'Restore all features' : 'Remove all features (Phone and Settings only)'}
                            onClick={() => void change(u.username, () => resetFeatures(u.username))}
                          >
                            Reset
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
