import { useEffect, useState, type FormEvent } from "react";

import {
  deleteCallerId,
  listCallerIds,
  saveCallerId,
  type SavedCallerId,
} from "../lib/callerId";
import { CALLER_IDS_PAGE_SIZE } from "../lib/const";
import { formatPhoneNumber, normalizePhoneNumber } from "../lib/helpers";
import { onEvent } from "../lib/realtime";
import { Button, Icon, Pagination } from "./ui";

const MAX_NAME_LENGTH = 30;

const INPUT_CLASS =
  "block w-full rounded-lg border border-secondary-200 bg-white px-3 py-2 text-sm leading-5 placeholder-secondary-400 focus:border-primary-500 focus:ring-3 focus:ring-primary-500/50 focus:outline-none dark:border-secondary-700 dark:bg-secondary-800 dark:focus:border-primary-500";

const TH_CLASS =
  "border-b-2 border-secondary-200/50 px-3 pb-4 text-left font-semibold text-secondary-900 dark:border-secondary-700 dark:text-secondary-50";

type Loaded =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready" };

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function byName(a: SavedCallerId, b: SavedCallerId): number {
  return (
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
    a.phoneNumber.localeCompare(b.phoneNumber)
  );
}

function matches(c: SavedCallerId, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  return (
    c.name.toLowerCase().includes(q) ||
    (digits !== "" && c.phoneNumber.includes(digits))
  );
}

// Admin view of every phone number → caller ID name mapping.
export default function CallerIds() {
  const [callerIds, setCallerIds] = useState<SavedCallerId[]>([]);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [addError, setAddError] = useState("");
  const [editing, setEditing] = useState<{
    phoneNumber: string;
    draft: string;
  } | null>(null);
  const [editError, setEditError] = useState("");
  // A new search starts back at the first page.
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [query]);

  useEffect(() => {
    let cancelled = false;
    listCallerIds()
      .then((list) => {
        if (cancelled) return;
        setCallerIds(list);
        setLoaded({ status: "ready" });
      })
      .catch(
        (e: unknown) =>
          !cancelled &&
          setLoaded({ status: "error", message: errorMessage(e) }),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  // Changes by any agent, including this one, arrive as events.
  useEffect(() => {
    const offUpdated = onEvent<SavedCallerId>("callerid.updated", (saved) => {
      setCallerIds((list) =>
        [
          ...list.filter((c) => c.phoneNumber !== saved.phoneNumber),
          saved,
        ].sort(byName),
      );
    });
    const offDeleted = onEvent<{ phoneNumber: string }>(
      "callerid.deleted",
      ({ phoneNumber }) => {
        setCallerIds((list) =>
          list.filter((c) => c.phoneNumber !== phoneNumber),
        );
      },
    );
    return () => {
      offUpdated();
      offDeleted();
    };
  }, []);

  async function onAdd(e: FormEvent): Promise<void> {
    e.preventDefault();
    const phoneNumber = normalizePhoneNumber(phone);
    const trimmed = name.trim();
    if (!phoneNumber || !trimmed) {
      setAddError("Phone number and name are required");
      return;
    }
    if (!(await saveCallerId(phoneNumber, trimmed))) {
      setAddError("Failed to save caller ID");
      return;
    }
    setAddError("");
    setPhone("");
    setName("");
  }

  // Enter and blur both commit; clearing `editing` first makes the second a no-op.
  async function commitEdit(c: SavedCallerId): Promise<void> {
    if (editing?.phoneNumber !== c.phoneNumber) return;
    const draft = editing.draft;
    setEditing(null);
    const trimmed = draft.trim();
    if (!trimmed || trimmed === c.name) return;
    if (await saveCallerId(c.phoneNumber, trimmed)) {
      setEditError("");
    } else {
      setEditError("Failed to rename caller ID");
      setEditing({ phoneNumber: c.phoneNumber, draft });
    }
  }

  async function onDelete(c: SavedCallerId): Promise<void> {
    if (
      !confirm(
        `Delete caller ID "${c.name}" for ${formatPhoneNumber(c.phoneNumber)}?`,
      )
    )
      return;
    try {
      await deleteCallerId(c.phoneNumber);
    } catch (e) {
      alert(`Failed to delete caller ID: ${errorMessage(e)}`);
    }
  }

  const visible = callerIds.filter((c) => matches(c, query));
  const totalPages = Math.max(
    1,
    Math.ceil(visible.length / CALLER_IDS_PAGE_SIZE),
  );
  // Clamp so deleting the last row on the final page steps back a page.
  const current = Math.min(page, totalPages);
  const pageRows = visible.slice(
    (current - 1) * CALLER_IDS_PAGE_SIZE,
    current * CALLER_IDS_PAGE_SIZE,
  );

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-secondary-200 bg-base-100 text-base-content dark:border-secondary-800 dark:bg-secondary-900">
      <div className="flex flex-col gap-3 bg-secondary-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:bg-secondary-800/50">
        <div>
          <h3 className="mb-1 font-semibold">Caller IDs</h3>
          <h4 className="text-sm font-medium text-secondary-500 dark:text-secondary-400">
            {query.trim() && `${visible.length} of `}
            {callerIds.length} {callerIds.length === 1 ? "mapping" : "mappings"}
          </h4>
        </div>
        <form
          onSubmit={onAdd}
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
        >
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone number"
            aria-label="Phone number"
            className={`${INPUT_CLASS} sm:w-40`}
          />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_NAME_LENGTH}
            placeholder="Name"
            aria-label="Name"
            className={`${INPUT_CLASS} sm:w-48`}
          />
          <Button
            type="submit"
            variant="primary"
            icon="check"
            className="gap-1.5"
          >
            Add
          </Button>
        </form>
      </div>
      {addError && (
        <p className="border-b border-secondary-100 px-5 py-2 text-sm text-rose-600 dark:border-secondary-800 dark:text-rose-400">
          {addError}
        </p>
      )}

      <div className="border-b border-secondary-100 p-5 dark:border-secondary-800">
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center text-secondary-500">
            <Icon name="search" />
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or number..."
            aria-label="Search caller IDs"
            className={`${INPUT_CLASS} pl-10`}
          />
        </div>
      </div>

      <div className="grow p-5">
        {loaded.status === "loading" ? (
          <p className="text-sm text-secondary-500 dark:text-secondary-400">
            Loading caller IDs...
          </p>
        ) : loaded.status === "error" ? (
          <p className="text-sm text-rose-600 dark:text-rose-400">
            Failed to load caller IDs: {loaded.message}
          </p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-secondary-500 dark:text-secondary-400">
            {callerIds.length === 0
              ? "No caller IDs saved yet"
              : "No caller IDs match your search"}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="min-w-full overflow-x-auto">
              <table className="min-w-full align-middle text-sm whitespace-nowrap">
                <thead>
                  <tr>
                    <th className={`${TH_CLASS} pl-0`}>Name</th>
                    <th className={TH_CLASS}>Phone</th>
                    <th className={`${TH_CLASS} pr-0 text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((c) => (
                    <tr
                      key={c.phoneNumber}
                      className="border-b border-secondary-100 dark:border-secondary-700/50"
                    >
                      <td className="py-3 pr-3 font-medium">
                        {editing?.phoneNumber === c.phoneNumber ? (
                          <input
                            type="text"
                            value={editing.draft}
                            onChange={(e) =>
                              setEditing({
                                phoneNumber: c.phoneNumber,
                                draft: e.target.value,
                              })
                            }
                            onFocus={(e) => e.target.select()}
                            onBlur={() => void commitEdit(c)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void commitEdit(c);
                              } else if (e.key === "Escape") {
                                setEditing(null);
                              }
                            }}
                            maxLength={MAX_NAME_LENGTH}
                            autoFocus
                            aria-label="Name"
                            className={`${INPUT_CLASS} -my-2 sm:w-48`}
                          />
                        ) : (
                          <button
                            type="button"
                            title="Click to rename"
                            onClick={() =>
                              setEditing({
                                phoneNumber: c.phoneNumber,
                                draft: c.name,
                              })
                            }
                            className="-mx-2 cursor-text rounded-md px-2 py-1 text-left hover:bg-base-100 dark:hover:bg-secondary-800"
                          >
                            {c.name}
                          </button>
                        )}
                      </td>
                      <td
                        className="p-3 text-secondary-500 dark:text-secondary-400"
                        title={c.phoneNumber}
                      >
                        {formatPhoneNumber(c.phoneNumber)}
                      </td>
                      <td className="py-3 pl-3 text-right">
                        <Button
                          size="sm"
                          variant="danger"
                          icon="xMark"
                          onClick={() => onDelete(c)}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {editError && (
              <p className="text-sm text-rose-600 dark:text-rose-400">
                {editError}
              </p>
            )}
            <Pagination
              page={current}
              totalPages={totalPages}
              onChange={setPage}
            />
          </div>
        )}
      </div>
    </div>
  );
}
