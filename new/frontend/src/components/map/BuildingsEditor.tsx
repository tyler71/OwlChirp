// Buildings on the Map and the numbers they match. Every building is placed
// in the next free lot, which is kept so the town looks the same each time.
import { useStore } from '@nanostores/react';
import { useState, type FormEvent } from 'react';

import {
  $buildings,
  $highlightBuilding,
  createBuilding,
  deleteBuilding,
  formatPattern,
  updateBuilding,
  type MapBuilding,
} from '../../lib/map';
import { Button } from '../ui';
import { BUILDING_STYLES } from './sprites';
import { LOTS } from './world';

const MAX_NAME_LENGTH = 30;
const INPUT_CLASS =
  'block w-full rounded-lg border border-secondary-200 bg-white px-3 py-2 text-sm leading-5 placeholder-secondary-400 focus:border-primary-500 focus:ring-3 focus:ring-primary-500/50 dark:border-secondary-600 dark:bg-secondary-800 dark:placeholder-secondary-400 dark:focus:border-primary-500';
const TH_CLASS =
  'border-b-2 border-secondary-200/50 px-3 pb-3 text-left font-semibold text-secondary-900 dark:border-secondary-700 dark:text-secondary-50';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function splitPatterns(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function StyleSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label="Building style"
      className={`${INPUT_CLASS} sm:w-32`}
    >
      {BUILDING_STYLES.map((s, i) => (
        <option key={s.label} value={i}>
          {s.label}
        </option>
      ))}
    </select>
  );
}

function Row({ building }: { building: MapBuilding }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(building.name);
  const [patterns, setPatterns] = useState('');
  const [style, setStyle] = useState(building.style);
  const [error, setError] = useState('');

  function startEdit() {
    setName(building.name);
    setPatterns(building.patterns.map(formatPattern).join(', '));
    setStyle(building.style);
    setError('');
    setEditing(true);
  }

  async function save() {
    try {
      await updateBuilding({ id: building.id, name: name.trim(), patterns: splitPatterns(patterns), style });
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function remove() {
    if (!confirm(`Delete building "${building.name}"? Its lot becomes free.`)) return;
    try {
      await deleteBuilding(building.id);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <tr
      className="border-b border-secondary-100 align-top last:border-0 dark:border-secondary-800"
      onMouseEnter={() => $highlightBuilding.set(building.id)}
      onMouseLeave={() => $highlightBuilding.set(null)}
    >
      {editing ? (
        <>
          <td className="py-2 pr-3">
            <input value={name} maxLength={MAX_NAME_LENGTH} onChange={(e) => setName(e.target.value)} aria-label="Name" className={INPUT_CLASS} />
          </td>
          <td className="p-2">
            <input
              value={patterns}
              onChange={(e) => setPatterns(e.target.value)}
              aria-label="Numbers"
              placeholder="206-256-*, 425-555-0100"
              className={INPUT_CLASS}
            />
            {error && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          </td>
          <td className="p-2">
            <StyleSelect value={style} onChange={setStyle} />
          </td>
          <td className="py-2 pl-3 text-right whitespace-nowrap">
            <Button size="sm" variant="primary" icon="check" onClick={() => void save()}>
              Save
            </Button>{' '}
            <Button size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </td>
        </>
      ) : (
        <>
          <td className="py-3 pr-3 font-medium">{building.name}</td>
          <td className="p-3">
            <div className="flex flex-wrap gap-1">
              {building.patterns.length === 0 ? (
                <span className="text-secondary-400">No numbers</span>
              ) : (
                building.patterns.map((p) => (
                  <span key={p} className="rounded-md bg-secondary-100 px-1.5 py-0.5 font-mono text-xs dark:bg-secondary-800">
                    {formatPattern(p)}
                  </span>
                ))
              )}
            </div>
            {error && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          </td>
          <td className="p-3">{BUILDING_STYLES[building.style]?.label}</td>
          <td className="py-2 pl-3 text-right whitespace-nowrap">
            <Button size="sm" onClick={startEdit}>
              Edit
            </Button>{' '}
            <Button size="sm" variant="danger" icon="xMark" onClick={() => void remove()} aria-label={`Delete ${building.name}`} />
          </td>
        </>
      )}
    </tr>
  );
}

export default function BuildingsEditor() {
  const buildings = useStore($buildings) ?? [];
  const [name, setName] = useState('');
  const [patterns, setPatterns] = useState('');
  const [style, setStyle] = useState(0);
  const [error, setError] = useState('');
  const full = buildings.length >= LOTS.length;

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    try {
      await createBuilding(name.trim(), splitPatterns(patterns), style);
      setName('');
      setPatterns('');
      setStyle((buildings.length + 1) % BUILDING_STYLES.length);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-secondary-200 bg-base-100 dark:border-secondary-800 dark:bg-secondary-900">
      <div className="flex flex-col gap-1 border-b border-secondary-100 px-5 py-4 dark:border-secondary-800">
        <h2 className="font-semibold">Buildings</h2>
        <p className="text-sm text-secondary-500 dark:text-secondary-400">
          Calls from a building's numbers start there on the map. End a number with * to match every number that
          starts with it, e.g. 206-256-*. When numbers overlap, an exact number wins, then the longest prefix.{' '}
          {buildings.length} of {LOTS.length} lots used.
        </p>
      </div>
      <form onSubmit={onAdd} className="flex flex-col gap-2 border-b border-secondary-100 px-5 py-4 sm:flex-row sm:items-start dark:border-secondary-800">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_NAME_LENGTH}
          placeholder="Building name"
          aria-label="Building name"
          className={`${INPUT_CLASS} sm:w-48`}
        />
        <input
          value={patterns}
          onChange={(e) => setPatterns(e.target.value)}
          placeholder="Numbers, e.g. 206-256-*, 425-555-0100"
          aria-label="Numbers"
          className={`${INPUT_CLASS} sm:grow`}
        />
        <StyleSelect value={style} onChange={setStyle} />
        <Button type="submit" variant="primary" icon="check" disabled={full}>
          Add
        </Button>
      </form>
      {(error || full) && (
        <p className="border-b border-secondary-100 px-5 py-2 text-sm text-rose-600 dark:border-secondary-800 dark:text-rose-400">
          {error || 'Every lot is taken. Delete a building to free one.'}
        </p>
      )}
      <div className="overflow-x-auto p-5">
        {buildings.length === 0 ? (
          <p className="text-sm text-secondary-500 dark:text-secondary-400">No buildings yet. Calls will arrive from the edge of town.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th className={`${TH_CLASS} pl-0`}>Name</th>
                <th className={TH_CLASS}>Numbers</th>
                <th className={TH_CLASS}>Style</th>
                <th className={`${TH_CLASS} pr-0`} />
              </tr>
            </thead>
            <tbody>
              {buildings.map((b) => (
                <Row key={b.id} building={b} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
