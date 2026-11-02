import { Icon } from './ui';

const TH_CLASS =
  'border-b-2 border-secondary-200/50 px-3 pb-4 text-left font-semibold text-secondary-900 dark:border-secondary-700 dark:text-secondary-50';

// true = full access, false = hidden, string = access with a caveat.
type Access = boolean | string;

// Mirrors VIEW_PERMISSION in App.tsx and the $isPower/$isAdmin checks in
// components; update both together.
const FEATURES: { name: string; detail: string; standard: Access; power: Access; admin: Access }[] = [
  { name: 'Phone', detail: 'Softphone, dial pad, quick connects, status', standard: true, power: true, admin: true },
  { name: 'Settings', detail: 'Theme and personal preferences', standard: true, power: true, admin: true },
  { name: 'Feed', detail: 'Team call wrapups', standard: false, power: 'No author names', admin: 'With agent names' },
  { name: 'Flow Calls', detail: 'Live calls in flow and queue, queue badge', standard: false, power: true, admin: 'Plus agent column' },
  { name: 'Timeline', detail: 'Call volume over time', standard: false, power: true, admin: 'Plus agent names' },
  { name: 'Recent Calls', detail: 'Call history', standard: false, power: 'Own calls', admin: "All agents' calls" },
  { name: 'Caller history', detail: 'Past calls from the active caller', standard: false, power: true, admin: true },
  { name: 'Caller IDs', detail: 'Manage outbound caller IDs', standard: false, power: false, admin: true },
  { name: 'Admin', detail: 'This page and user permissions', standard: false, power: false, admin: true },
];

const LEVELS = [
  { key: 'standard', label: 'Standard' },
  { key: 'power', label: 'Power' },
  { key: 'admin', label: 'Admin' },
] as const;

function AccessCell({ access }: { access: Access }) {
  if (access === false) {
    return (
      <span className="text-secondary-400 dark:text-secondary-600" aria-label="Not available">
        —
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon name="check" className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      {typeof access === 'string' ? (
        <span className="text-xs text-secondary-600 dark:text-secondary-300">{access}</span>
      ) : (
        <span className="sr-only">Available</span>
      )}
    </span>
  );
}

// Reference of what each permission level unlocks, shown above the user list.
export default function AdminPermissions() {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-secondary-200 bg-base-100 text-base-content dark:border-secondary-800 dark:bg-secondary-900">
      <div className="bg-secondary-50 px-5 py-4 dark:bg-secondary-800/50">
        <h3 className="mb-1 font-semibold">Permission levels</h3>
        <h4 className="text-sm font-medium text-secondary-500 dark:text-secondary-400">
          What each level can see. Each level includes everything from the level below it.
        </h4>
      </div>

      <div className="p-5">
        <div className="min-w-full overflow-x-auto">
          <table className="min-w-full align-middle text-sm whitespace-nowrap">
            <thead>
              <tr>
                <th className={`${TH_CLASS} pl-0`}>Feature</th>
                {LEVELS.map((l) => (
                  <th key={l.key} className={TH_CLASS}>
                    {l.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((f) => (
                <tr key={f.name} className="border-b border-secondary-100 dark:border-secondary-700/50">
                  <td className="py-3 pr-3">
                    <div className="font-medium">{f.name}</div>
                    <div className="text-xs text-secondary-500 dark:text-secondary-400">{f.detail}</div>
                  </td>
                  {LEVELS.map((l) => (
                    <td key={l.key} className="p-3">
                      <AccessCell access={f[l.key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
