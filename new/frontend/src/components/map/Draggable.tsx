// A panel floating over the map that can be dragged by its grip and shrunk
// down to its title with the grip's minimize button. It stays at
// its usual CSS spot plus a saved offset, kept inside the nearest
// [data-map-bounds] ancestor (the viewport if there is none).
import { useStore } from "@nanostores/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  $mapPanelOffsets,
  $mapPanelsMinimized,
  setPanelMinimized,
  setPanelOffset,
  type MapPanelId,
  type PanelOffset,
} from "../../lib/map";

const ZERO: PanelOffset = { x: 0, y: 0 };

function boundsOf(el: HTMLElement): DOMRect {
  const b = el.parentElement?.closest("[data-map-bounds]");
  return b
    ? b.getBoundingClientRect()
    : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
}

/** Keep an element whose untransformed rect is `base` inside `bounds`. */
function clamp(off: PanelOffset, base: DOMRect, bounds: DOMRect): PanelOffset {
  const fit = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(v, Math.max(lo, hi)));
  return {
    x: Math.round(
      fit(off.x, bounds.left - base.left, bounds.right - base.right),
    ),
    y: Math.round(
      fit(off.y, bounds.top - base.top, bounds.bottom - base.bottom),
    ),
  };
}

/** The element's rect without its drag offset. */
function baseRect(el: HTMLElement, off: PanelOffset): DOMRect {
  const r = el.getBoundingClientRect();
  return new DOMRect(r.left - off.x, r.top - off.y, r.width, r.height);
}

const GRIP_BUTTON =
  "pointer-events-auto flex h-3.5 w-5 shrink-0 items-center justify-center rounded-tr-lg text-[10px] leading-none text-secondary-600 hover:bg-secondary-400/80 hover:text-secondary-900 dark:text-secondary-300 dark:hover:bg-secondary-600/80 dark:hover:text-white";

/**
 * `className` always applies (position); `panelClassName` only while expanded
 * (size), so a minimized panel shrinks to fit its title.
 */
export default function Draggable({
  id,
  title,
  className = "",
  panelClassName = "",
  children,
}: {
  id: MapPanelId;
  title: ReactNode;
  className?: string;
  panelClassName?: string;
  children: ReactNode;
}) {
  const saved = useStore($mapPanelOffsets)[id] ?? ZERO;
  const minimized = !!useStore($mapPanelsMinimized)[id];
  const [live, setLive] = useState<PanelOffset | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    px: number;
    py: number;
    start: PanelOffset;
    base: DOMRect;
    bounds: DOMRect;
  } | null>(null);
  const liveRef = useRef<PanelOffset | null>(null);
  const move = (o: PanelOffset) => {
    liveRef.current = o;
    setLive(o);
  };
  const off = live ?? saved;

  // Pull the panel back on-screen when the map or the panel changes size.
  const savedRef = useRef(saved);
  savedRef.current = saved;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const refit = () => {
      if (drag.current) return;
      const cur = savedRef.current;
      const next = clamp(cur, baseRect(el, cur), boundsOf(el));
      if (next.x !== cur.x || next.y !== cur.y) setPanelOffset(id, next);
    };
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    const b = el.parentElement?.closest("[data-map-bounds]");
    if (b) ro.observe(b);
    window.addEventListener("resize", refit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", refit);
    };
  }, [id]);

  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    if (liveRef.current) setPanelOffset(id, liveRef.current);
    liveRef.current = null;
    setLive(null);
  };

  return (
    <div
      ref={ref}
      className={`${className} ${minimized ? "w-max" : panelClassName}`}
      style={
        off.x || off.y
          ? { transform: `translate(${off.x}px, ${off.y}px)` }
          : undefined
      }
    >
      <div className="flex shrink-0">
        <div
          role="separator"
          aria-label="Drag to move this panel. Double-click to put it back."
          title="Drag to move · double-click to reset"
          // Keep focus on the map canvas so walking doesn't stop.
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            const el = ref.current;
            if (!el || e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = {
              px: e.clientX,
              py: e.clientY,
              start: off,
              base: baseRect(el, off),
              bounds: boundsOf(el),
            };
            move(off);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            move(
              clamp(
                {
                  x: d.start.x + e.clientX - d.px,
                  y: d.start.y + e.clientY - d.py,
                },
                d.base,
                d.bounds,
              ),
            );
          }}
          onPointerUp={end}
          onPointerCancel={end}
          onLostPointerCapture={end}
          onDoubleClick={() => setPanelOffset(id, null)}
          className={`pointer-events-auto flex h-3.5 min-w-10 flex-1 touch-none items-center justify-center rounded-tl-lg bg-secondary-300/80 text-[9px] leading-none tracking-[0.3em] text-secondary-600 select-none hover:bg-secondary-400/80 dark:bg-secondary-700/80 dark:text-secondary-300 dark:hover:bg-secondary-600/80 ${
            live ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          ••••
        </div>
        <button
          type="button"
          tabIndex={-1}
          aria-label={minimized ? "Restore panel" : "Minimize panel"}
          title={minimized ? "Restore" : "Minimize"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setPanelMinimized(id, !minimized)}
          className={`${GRIP_BUTTON} bg-secondary-300/80 dark:bg-secondary-700/80`}
        >
          {minimized ? "▢" : "–"}
        </button>
      </div>
      {minimized ? (
        <button
          type="button"
          tabIndex={-1}
          title="Restore"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setPanelMinimized(id, false)}
          className="pointer-events-auto rounded-b-lg border border-t-0 border-secondary-200 bg-base-100/90 px-3 py-1.5 text-left text-sm font-semibold whitespace-nowrap shadow-lg backdrop-blur-sm hover:bg-secondary-100 dark:border-secondary-800 dark:bg-secondary-900/90 dark:hover:bg-secondary-800"
        >
          {title}
        </button>
      ) : (
        children
      )}
    </div>
  );
}
