// Map section: the town canvas, who's around, and (with Map buildings) the
// buildings editor.
import { useStore } from "@nanostores/react";
import { useEffect, useState } from "react";

import { $queuedCount, loadFlowCalls } from "../../lib/flowCalls";
import { agentName } from "../../lib/helpers";
import {
  $mapMode,
  $mapPlayers,
  $mapSize,
  $myUsername,
  loadMapState,
  setPanelMinimized,
  type MapSize,
} from "../../lib/map";
import {
  $agent,
  $can,
  $flowCalls,
  $metrics,
  $wsStatus,
} from "../../lib/stores";
import { startVoice } from "../../lib/voice";
import { STATUS_EMOJI, statusClass } from "../VisualAgentList";
import BuildingsEditor from "./BuildingsEditor";
import DesignPanel from "./DesignPanel";
import Draggable from "./Draggable";
import MapCanvas from "./MapCanvas";
import MapToolbar from "./MapToolbar";
import useMapShortcuts from "./useMapShortcuts";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function WhoIsHere({ me }: { me: string }) {
  const players = useStore($mapPlayers) ?? {};
  const { user_list: users = [] } = useStore($metrics, { keys: ["user_list"] });
  const [open, setOpen] = useState(false);
  const statusOf = new Map(
    users.map((u) => [u.user.username.toLowerCase(), u.status.name]),
  );

  const names = Object.keys(players).sort((a, b) =>
    a === me ? -1 : b === me ? 1 : a.localeCompare(b),
  );
  return (
    <div
      onMouseDown={(e) => e.preventDefault()}
      className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-secondary-200 bg-base-100/90 shadow-lg backdrop-blur-sm dark:border-secondary-800 dark:bg-secondary-900/90"
    >
      <button
        type="button"
        tabIndex={-1}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between gap-2 px-3 py-2 text-sm font-semibold hover:bg-secondary-100 dark:hover:bg-secondary-800"
      >
        <span>👥 On the map ({names.length})</span>
        <span aria-hidden className="text-xs">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <ul className="flex flex-col divide-y divide-secondary-100 overflow-y-auto border-t border-secondary-100 text-sm dark:divide-secondary-800 dark:border-secondary-800">
          {names.map((name) => {
            const status = statusOf.get(name.toLowerCase()) ?? "Offline";
            const label = name === me ? "You" : agentName(name);
            return (
              <li
                key={name}
                className="flex items-center justify-between gap-2 px-3 py-1.5"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-medium">{label}</span>
                  {players[name]?.scene === "office" && (
                    <span
                      title="In Office Space, inside Techline HQ"
                      className="shrink-0 rounded bg-secondary-100 px-1 text-xs dark:bg-secondary-800"
                    >
                      🏢 Office
                    </span>
                  )}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(status)}`}
                >
                  {STATUS_EMOJI[status.toLowerCase()]} {status}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Outer frame: where the map sits in the page. */
const FRAME: Record<MapSize, string> = {
  fill: "h-[calc(100dvh-4rem)] lg:h-[calc(100dvh-1.5rem-2px)] lg:rounded-lg",
  // Room at the top for App's floating status bar.
  medium:
    "flex h-[calc(100dvh-4rem)] items-center justify-center p-2 pt-14 lg:h-[calc(100dvh-1.5rem-2px)]",
};

const BORDERED =
  "max-h-full max-w-full rounded-lg border-2 border-secondary-300 shadow-lg dark:border-secondary-700";

/** Inner box holding the canvas and everything floating over it. */
const BOX: Record<MapSize, string> = {
  fill: "size-full",
  medium: `h-[600px] w-[960px] ${BORDERED}`,
};

export default function MapView() {
  const agent = useStore($agent);
  const wsStatus = useStore($wsStatus);
  const players = useStore($mapPlayers);
  const canEdit = useStore($can("mapEdit"));
  const [error, setError] = useState("");
  const me = agent?.getConfiguration().username ?? "";

  useEffect(() => $myUsername.set(me), [me]);
  useMapShortcuts();
  // Voice starts the first time the Map is opened and keeps running in other
  // sections; App stops it on logout or when the map feature goes away.
  useEffect(() => {
    if (me) startVoice(me);
  }, [me]);
  // Leave design tools when the page closes.
  useEffect(() => () => $mapMode.set("walk"), []);

  useEffect(() => {
    if (wsStatus !== "open") return;
    loadMapState()
      .then(() => setError(""))
      .catch((e) => setError(errorMessage(e)));
    // Queue glow and pulses need flow calls even without the Flow feature.
    if ($flowCalls.get() === null)
      loadFlowCalls().catch((e) => console.error("loadFlowCalls", e));
  }, [wsStatus]);

  // One side panel at a time.
  const [panel, setPanel] = useState<"" | "buildings" | "design">("");
  const buildingsOpen = panel === "buildings";
  const designOpen = panel === "design";
  const toggle = (p: "buildings" | "design") => {
    // Opening the design panel shows it even if it was left minimized.
    if (p === "design" && panel !== p) setPanelMinimized("design", false);
    setPanel(panel === p ? "" : p);
  };
  const size = useStore($mapSize);
  // The bordered box sits below the status bar; otherwise it floats over the map.
  const top = size === "medium" ? "top-2" : "top-14";
  // Sized to its content (so it can be dragged up and down) but no taller than the space below `top`.
  const designMaxH =
    size === "medium" ? "max-h-[calc(100%-1rem)]" : "max-h-[calc(100%-4rem)]";

  // Bottom right, under the minimap.
  const toolbar = (
    <Draggable
      id="toolbar"
      title="🧰 Map menu"
      className="pointer-events-auto flex flex-col"
      panelClassName="max-w-md"
    >
      <MapToolbar
        buildingsOpen={buildingsOpen}
        onToggleBuildings={canEdit ? () => toggle("buildings") : undefined}
        designOpen={designOpen}
        onToggleDesign={me ? () => toggle("design") : undefined}
      />
    </Draggable>
  );

  return (
    // Fills the content area (or a bordered box in it); everything else floats over the map.
    <div
      data-map-bounds
      className={`relative w-full overflow-hidden ${FRAME[size]}`}
    >
      <div className={`relative overflow-hidden ${BOX[size]}`}>
        {players === null || !me ? (
          <div className="flex size-full items-center justify-center bg-secondary-200 text-sm text-secondary-500 dark:bg-secondary-800">
            Loading map...
          </div>
        ) : (
          <MapCanvas me={me}>{toolbar}</MapCanvas>
        )}
        {/* Until the canvas loads there's no minimap, so the menu bar sits in the corner on its own. */}
        {(players === null || !me) && (
          <div className="pointer-events-none absolute right-2 bottom-2 z-10 max-w-[calc(100%-1rem)]">
            {toolbar}
          </div>
        )}
        <div
          className={`pointer-events-none absolute inset-x-2 ${top} bottom-2 flex flex-col items-start gap-2 pr-12`}
        >
          {error && (
            <p className="pointer-events-auto rounded-lg bg-rose-600/90 px-3 py-1.5 text-sm text-white shadow">
              Couldn't load the map: {error}
            </p>
          )}
          <Draggable
            id="who"
            title="👥 On the map"
            className="pointer-events-auto mt-auto flex flex-col"
            panelClassName="max-h-[60%] w-64"
          >
            <WhoIsHere me={me} />
          </Draggable>
        </div>
        {canEdit && buildingsOpen && (
          <div
            className={`absolute ${top} right-12 bottom-2 w-[min(28rem,calc(100%-4rem))] overflow-y-auto rounded-lg shadow-xl`}
          >
            <BuildingsEditor />
          </div>
        )}
        {designOpen && me && (
          <Draggable
            id="design"
            title="🎨 Design"
            className={`absolute ${top} right-12 flex flex-col rounded-lg`}
            panelClassName={`${designMaxH} w-[min(24rem,calc(100%-4rem))] shadow-xl`}
          >
            <div className="min-h-0 flex-1 overflow-y-auto rounded-b-lg">
              <DesignPanel
                key={me}
                username={me}
                onClose={() => setPanel("")}
              />
            </div>
          </Draggable>
        )}
      </div>
    </div>
  );
}
