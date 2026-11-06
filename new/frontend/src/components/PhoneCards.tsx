import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { useStore } from '@nanostores/react';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';

import { $phoneEditMode, $phoneLayout, setPhoneLayout, type PhoneCard, type PhoneColumn, type PhoneLayout } from '../lib/theme';
import CallerTimeline from './CallerTimeline';
import CallFlow from './CallFlow';
import CallPanel from './CallPanel';
import TabbedFunctions from './TabbedFunctions';

const CARDS: Record<PhoneCard, { label: string; render: () => ReactNode; desktopOnly?: boolean }> = {
  call: { label: 'Call', render: () => <CallPanel /> },
  functions: { label: 'Functions', render: () => <TabbedFunctions /> },
  flow: { label: 'Call flow', render: () => <CallFlow />, desktopOnly: true },
  timeline: { label: 'Caller timeline', render: () => <CallerTimeline />, desktopOnly: true },
};

const COLUMN_CLASS: Record<PhoneColumn, string> = {
  left: 'lg:col-span-3',
  right: 'lg:col-span-2',
};

const OTHER: Record<PhoneColumn, PhoneColumn> = { left: 'right', right: 'left' };

/** Moves a card to `index` in `col` (an index into the column before the move). */
function moveCard(layout: PhoneLayout, id: PhoneCard, col: PhoneColumn, index: number): PhoneLayout {
  const from = layout.left.includes(id) ? 'left' : 'right';
  const fromIndex = layout[from].indexOf(id);
  const next: PhoneLayout = { left: layout.left.filter((c) => c !== id), right: layout.right.filter((c) => c !== id) };
  const at = from === col && fromIndex < index ? index - 1 : index;
  next[col].splice(Math.max(0, Math.min(at, next[col].length)), 0, id);
  return next;
}

function sameLayout(a: PhoneLayout, b: PhoneLayout): boolean {
  return a.left.join() === b.left.join() && a.right.join() === b.right.join();
}

type Drop = { col: PhoneColumn; index: number };

/** The Phone tab's cards in two columns, rearranged by dragging their grip. */
export default function PhoneCards() {
  const layout = useStore($phoneLayout);
  const editMode = useStore($phoneEditMode);
  const [dragging, setDragging] = useState<PhoneCard | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);

  const apply = (next: PhoneLayout) => {
    if (!sameLayout(next, layout)) void setPhoneLayout(next);
  };

  // Drop position from the pointer: before the first visible card whose
  // middle is below it, else at the end of the column.
  const dropAt = (e: DragEvent<HTMLDivElement>, col: PhoneColumn): Drop => {
    const cards = [...e.currentTarget.querySelectorAll<HTMLElement>(':scope > [data-card]')];
    for (const el of cards) {
      if (el.offsetParent === null) continue; // hidden (renders nothing / mobile-only)
      const rect = el.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        return { col, index: layout[col].indexOf(el.dataset.card as PhoneCard) };
      }
    }
    return { col, index: layout[col].length };
  };

  const endDrag = () => {
    setDragging(null);
    setDrop(null);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      {(['left', 'right'] as const).map((col) => (
        <div
          key={col}
          className={`flex min-h-12 flex-col gap-6 ${COLUMN_CLASS[col]}`}
          onDragOver={(e) => {
            if (!editMode || !dragging) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const next = dropAt(e, col);
            if (next.col !== drop?.col || next.index !== drop.index) setDrop(next);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (editMode && dragging) apply(moveCard(layout, dragging, col, dropAt(e, col).index));
            endDrag();
          }}
        >
          {layout[col].map((id, i) => (
            <CardSlot
              key={id}
              id={id}
              editMode={editMode}
              dragging={dragging === id}
              dropBefore={drop?.col === col && drop.index === i && dragging !== null}
              canMoveUp={i > 0}
              canMoveDown={i < layout[col].length - 1}
              otherColumn={OTHER[col]}
              onDragStart={() => setDragging(id)}
              onDragEnd={endDrag}
              onMove={(to, index) => apply(moveCard(layout, id, to, index))}
              index={i}
              col={col}
            />
          ))}
          {dragging && drop?.col === col && drop.index === layout[col].length && <DropLine />}
        </div>
      ))}
    </div>
  );
}

function DropLine() {
  return <div className="-my-4 h-1 rounded-full bg-primary-500" aria-hidden />;
}

function CardSlot({
  id,
  col,
  index,
  editMode,
  dragging,
  dropBefore,
  canMoveUp,
  canMoveDown,
  otherColumn,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  id: PhoneCard;
  col: PhoneColumn;
  index: number;
  editMode: boolean;
  dragging: boolean;
  dropBefore: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  otherColumn: PhoneColumn;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (col: PhoneColumn, index: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const card = CARDS[id];

  return (
    <>
      {dropBefore && <DropLine />}
      <div
        ref={ref}
        data-card={id}
        className={`group relative has-[>[data-card-body]:empty]:hidden ${card.desktopOnly ? 'max-lg:hidden' : ''} ${
          dragging ? 'opacity-40' : ''
        } ${editMode ? 'rounded-lg outline-1 outline-offset-2 outline-secondary-300 outline-dashed dark:outline-secondary-600' : ''}`}
      >
        {editMode && (
        <Menu>
          <MenuButton
            draggable
            onDragStart={(e: DragEvent<HTMLButtonElement>) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', id);
              if (ref.current) {
                const rect = ref.current.getBoundingClientRect();
                e.dataTransfer.setDragImage(ref.current, e.clientX - rect.left, e.clientY - rect.top);
              }
              onDragStart();
            }}
            onDragEnd={onDragEnd}
            title={`Move ${card.label} card`}
            aria-label={`Move ${card.label} card`}
            className="absolute -top-3 left-1/2 z-10 flex h-5 w-10 -translate-x-1/2 cursor-grab items-center justify-center rounded-full border border-secondary-200 bg-base-100 text-secondary-400 shadow-xs transition hover:text-secondary-700 active:cursor-grabbing dark:border-secondary-700 dark:bg-secondary-800 dark:hover:text-secondary-200"
          >
            <svg viewBox="0 0 20 8" fill="currentColor" className="h-2 w-5" aria-hidden>
              {[3, 10, 17].flatMap((x) => [<circle key={`${x}a`} cx={x} cy={2} r={1.4} />, <circle key={`${x}b`} cx={x} cy={6} r={1.4} />])}
            </svg>
          </MenuButton>
          <MenuItems
            anchor="bottom"
            className="z-50 mt-1 w-48 rounded-lg border border-secondary-200 bg-base-100 p-1 text-sm shadow-lg focus:outline-none dark:border-secondary-700 dark:bg-secondary-800"
          >
            {canMoveUp && (
              <MenuItem>
                <button type="button" className={MENU_ITEM} onClick={() => onMove(col, index - 1)}>
                  Move up
                </button>
              </MenuItem>
            )}
            {canMoveDown && (
              <MenuItem>
                <button type="button" className={MENU_ITEM} onClick={() => onMove(col, index + 2)}>
                  Move down
                </button>
              </MenuItem>
            )}
            <MenuItem>
              <button type="button" className={MENU_ITEM} onClick={() => onMove(otherColumn, Number.MAX_SAFE_INTEGER)}>
                Move to {otherColumn} column
              </button>
            </MenuItem>
          </MenuItems>
        </Menu>
        )}
        <div data-card-body className="contents">
          {card.render()}
        </div>
      </div>
    </>
  );
}

const MENU_ITEM =
  'block w-full rounded-md px-3 py-1.5 text-left data-focus:bg-secondary-100 dark:data-focus:bg-secondary-700';
