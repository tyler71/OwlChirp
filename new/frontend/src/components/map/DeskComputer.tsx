// The desk computer in Office Space: standing at any desk opens a monitor
// with a desktop. The Screen Share icon opens a window to share your screen,
// watch whoever is sharing, or stop your own share; the other icons are
// shortcuts to the rest of Owlchirp. If someone is already sharing, the share
// window opens by itself. Close it with ⏻, Esc or a click outside; it stays
// closed until you step away from the desk and back. Walking away also ends
// your own share (lib/screenshare). Clicking on the computer never takes
// focus from the map canvas, so WASD still walks you away from the desk.
import { useStore } from "@nanostores/react";
import { useEffect, useRef, useState } from "react";

import { BASE } from "../../lib/const";
import { agentName } from "../../lib/helpers";
import {
  $atDesk,
  $myShare,
  $screenSharer,
  $screenStatus,
  $shareError,
  ensureVideo,
  releaseVideo,
  screenshareSupported,
  startShare,
  stopShare,
  watchScreen,
} from "../../lib/screenshare";
import { $features, $view } from "../../lib/stores";
import { NAV, canView } from "../nav";
import { Icon } from "../ui";

function Watching({ sharer }: { sharer: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hasPicture, setHasPicture] = useState(false);

  useEffect(() => {
    setHasPicture(false);
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    watchScreen((frame) => {
      if (c && ctx) {
        if (c.width !== frame.displayWidth || c.height !== frame.displayHeight) {
          c.width = frame.displayWidth;
          c.height = frame.displayHeight;
        }
        ctx.drawImage(frame, 0, 0);
        setHasPicture(true);
      }
      frame.close();
    });
    return () => watchScreen(null);
  }, [sharer]);

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
      <canvas ref={canvas} className="max-h-full max-w-full object-contain" />
      {!hasPicture && (
        <p className="absolute text-sm text-secondary-300">
          Waiting for {agentName(sharer)}'s screen...
        </p>
      )}
    </div>
  );
}

function MyPreview({ stream }: { stream: MediaStream }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        className="max-h-full max-w-full object-contain"
      />
    </div>
  );
}

export default function DeskComputer({ me }: { me: string }) {
  const atDesk = useStore($atDesk);
  const [dismissed, setDismissed] = useState(false);
  // Stepping away from the desk resets the dismissal.
  useEffect(() => {
    if (!atDesk) setDismissed(false);
  }, [atDesk]);
  const open = atDesk && !dismissed;

  useEffect(() => {
    if (!open || !me) return;
    ensureVideo(me);
    return releaseVideo;
  }, [open, me]);

  if (!open) return null;
  return <Computer me={me} onClose={() => setDismissed(true)} />;
}

type Win = "share" | null;

function Computer({ me, onClose }: { me: string; onClose: () => void }) {
  const sharer = useStore($screenSharer);
  const myShare = useStore($myShare);
  const features = useStore($features);
  const [win, setWin] = useState<Win>(() =>
    ($screenSharer.get() && $screenSharer.get() !== me) || $myShare.get()
      ? "share"
      : null,
  );
  // Once you've put the window away yourself, don't push it back this visit.
  const putAway = useRef(false);
  const someoneElse = !!sharer && sharer !== me;
  useEffect(() => {
    if (someoneElse && !putAway.current) setWin("share");
  }, [someoneElse]);

  const hideWin = () => {
    putAway.current = true;
    setWin(null);
  };

  // Esc closes the window first, then the computer.
  const winRef = useRef(win);
  winRef.current = win;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (winRef.current) hideWin();
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shortcuts = NAV.filter(
    (item) => item.view !== "map" && canView(item.view, features),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        // Keep focus on the map canvas so WASD keeps walking (clicks still fire).
        e.preventDefault();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Desk computer"
        className="flex flex-col items-center"
      >
        {/* Monitor */}
        <div className="rounded-2xl bg-neutral-800 p-3 pb-6 shadow-2xl ring-1 ring-black/40">
          <div className="relative h-[72vh] w-[78vw] overflow-hidden rounded-md bg-gradient-to-br from-sky-700 via-indigo-700 to-violet-800 select-none">
            {/* Desktop icons */}
            <div className="absolute top-0 left-0 bottom-10 flex flex-col flex-wrap content-start gap-2 p-3">
              <DesktopIcon
                label="Screen Share"
                onOpen={() => {
                  putAway.current = false;
                  setWin("share");
                }}
                badge={!!sharer}
              >
                <span className="text-3xl leading-none">🖥️</span>
              </DesktopIcon>
              {shortcuts.map((item) => (
                <DesktopIcon
                  key={item.view}
                  label={item.label}
                  onOpen={() => $view.set(item.view)}
                >
                  <Icon name={item.icon} className="size-8 text-white" />
                </DesktopIcon>
              ))}
            </div>

            {win === "share" && (
              <Window
                title={
                  sharer === me && myShare
                    ? "Screen Share — you're sharing"
                    : sharer
                      ? `Screen Share — ${agentName(sharer)}`
                      : "Screen Share"
                }
                actions={
                  sharer === me && myShare ? (
                    <button
                      type="button"
                      onClick={stopShare}
                      className="rounded bg-rose-600 px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-rose-700"
                    >
                      Stop sharing
                    </button>
                  ) : null
                }
                onHide={hideWin}
              >
                <SharePanel me={me} />
              </Window>
            )}

            <Taskbar
              win={win}
              onRestore={() => {
                putAway.current = false;
                setWin("share");
              }}
              onMinimize={hideWin}
              onPower={onClose}
              live={!!sharer}
            />
          </div>
          <div className="mt-2 flex justify-center">
            <span className="size-1.5 rounded-full bg-emerald-400 shadow shadow-emerald-400" />
          </div>
        </div>
        {/* Stand */}
        <div className="h-6 w-20 bg-gradient-to-b from-neutral-700 to-neutral-800" />
        <div className="h-2 w-48 rounded-t-lg bg-neutral-700 shadow-lg" />
      </div>
    </div>
  );
}

function DesktopIcon({
  label,
  onOpen,
  badge,
  children,
}: {
  label: string;
  onOpen: () => void;
  badge?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative flex w-20 flex-col items-center gap-1 rounded-md p-1.5 text-center text-white hover:bg-white/15 focus:bg-white/25 focus:outline-none"
    >
      <span className="flex size-12 items-center justify-center rounded-lg bg-white/10 drop-shadow">
        {children}
      </span>
      <span className="text-[11px] font-medium leading-tight [text-shadow:0_1px_2px_rgb(0_0_0/0.8)]">
        {label}
      </span>
      {badge && (
        <span className="absolute right-2 top-1 rounded bg-rose-600 px-1 text-[9px] font-bold text-white">
          LIVE
        </span>
      )}
    </button>
  );
}

function Window({
  title,
  actions,
  onHide,
  children,
}: {
  title: string;
  actions: React.ReactNode;
  onHide: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="absolute left-28 right-6 top-4 bottom-14 flex flex-col overflow-hidden rounded-lg border border-secondary-300 bg-base-100 shadow-2xl dark:border-secondary-700 dark:bg-secondary-900">
      <div className="flex items-center justify-between gap-3 border-b border-secondary-200 bg-secondary-100 px-3 py-1.5 dark:border-secondary-700 dark:bg-secondary-800">
        <h2 className="truncate text-sm font-semibold">🖥️ {title}</h2>
        <div className="flex items-center gap-1">
          {actions}
          <button
            type="button"
            aria-label="Minimize"
            onClick={onHide}
            className="rounded px-2 py-0.5 text-sm leading-none hover:bg-secondary-200 dark:hover:bg-secondary-700"
          >
            —
          </button>
          <button
            type="button"
            aria-label="Close window"
            onClick={onHide}
            className="rounded px-2 py-0.5 text-sm leading-none hover:bg-rose-600 hover:text-white"
          >
            ✕
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

function Taskbar({
  win,
  onRestore,
  onMinimize,
  onPower,
  live,
}: {
  win: Win;
  onRestore: () => void;
  onMinimize: () => void;
  onPower: () => void;
  live: boolean;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <div className="absolute inset-x-0 bottom-0 flex h-10 items-center gap-2 bg-neutral-900/80 px-2 text-white backdrop-blur">
      <span className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-semibold">
        <img src={`${BASE}favicon.ico`} alt="" className="size-5" />
        OwlChirp OS
      </span>
      <button
        type="button"
        onClick={win ? onMinimize : onRestore}
        className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs hover:bg-white/15 ${
          win ? "bg-white/20" : ""
        }`}
      >
        🖥️ Screen Share
        {live && <span className="size-1.5 rounded-full bg-rose-500" />}
      </button>
      <span className="ml-auto text-xs tabular-nums">{time}</span>
      <button
        type="button"
        aria-label="Turn off computer"
        title="Turn off"
        onClick={onPower}
        className="rounded px-2 py-1 text-sm leading-none hover:bg-rose-600"
      >
        ⏻
      </button>
    </div>
  );
}

function SharePanel({ me }: { me: string }) {
  const sharer = useStore($screenSharer);
  const status = useStore($screenStatus);
  const myShare = useStore($myShare);
  const error = useStore($shareError);
  const [starting, setStarting] = useState(false);

  const share = async () => {
    setStarting(true);
    try {
      await startShare();
    } finally {
      setStarting(false);
    }
  };

  let body;
  if (!screenshareSupported() || status === "unsupported") {
    body = <Notice>Screen sharing isn't supported in this browser.</Notice>;
  } else if (status === "elsewhere") {
    body = <Notice>Screen sharing is open in another tab.</Notice>;
  } else if (status === "error") {
    body = <Notice>You don't have access to screen sharing.</Notice>;
  } else if (status !== "live") {
    body = <Notice>Connecting...</Notice>;
  } else if (sharer === me && myShare) {
    body = <MyPreview stream={myShare} />;
  } else if (sharer && sharer !== me) {
    body = <Watching sharer={sharer} />;
  } else {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-secondary-500 dark:text-secondary-400">
          Nobody is sharing. Share your screen with everyone at a desk.
        </p>
        <button
          type="button"
          disabled={starting || myShare !== null}
          onClick={share}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-primary-700 disabled:opacity-50"
        >
          {starting || myShare ? "Starting..." : "Share your screen"}
        </button>
        <p className="text-xs text-secondary-400">
          Your share stops when you walk away from the desk.
        </p>
      </div>
    );
  }

  return (
    <>
      {error && (
        <p className="border-b border-rose-200 bg-rose-50 px-4 py-1.5 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </p>
      )}
      {body}
    </>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-sm text-secondary-500 dark:text-secondary-400">
      {children}
    </div>
  );
}
