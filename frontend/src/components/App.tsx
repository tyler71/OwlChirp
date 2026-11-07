import "amazon-connect-streams";

import {
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Transition,
} from "@headlessui/react";
import { useStore } from "@nanostores/react";
import { useEffect, useState } from "react";
import { VERSION } from "astro:env/client";

import { BASE } from "../lib/const";
import { $queuedCount, loadFlowCalls } from "../lib/flowCalls";
import {
  $agent,
  $agentSnapshot,
  $can,
  $config,
  $features,
  $flowCalls,
  $view,
  $wsStatus,
} from "../lib/stores";
import { stopVoice } from "../lib/voice";
import { stopShare } from "../lib/screenshare";
import "../lib/theme";
import "../lib/pwa";
import Admin from "./Admin";
import AgentStatusMenu from "./AgentStatusMenu";
import Draggable from "./map/Draggable";
import AlertSection from "./AlertSection";
import AskForHelpButton from "./AskForHelpButton";
import CallerIds from "./CallerIds";
import PhoneCards from "./PhoneCards";
import Ccp from "./Ccp";
import DataPanel from "./DataPanel";
import Feed from "./Feed";
import HelpRequestDialog from "./HelpRequestDialog";
import FlowCalls from "./FlowCalls";
import MapView from "./map/MapView";
import MiniCallBar from "./MiniCallBar";
import RecentCallList from "./RecentCallList";
import Settings from "./Settings";
import StatusBar from "./StatusBar";
import SystemLog from "./SystemLog";
import Timeline from "./Timeline";
import UpdateButton from "./UpdateButton";
import { NAV, canView } from "./nav";
import { Icon, stateDotClass } from "./ui";

function Brand() {
  return (
    <a
      href={`${BASE}ccp`}
      className="group inline-flex items-center gap-1 px-2 font-bold text-base-content hover:text-secondary-600 dark:hover:text-secondary-300"
    >
      <img src={`${BASE}favicon.ico`} alt="" className="size-6" />
      <span>OwlChirp</span>
    </a>
  );
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

// Sets the agent Offline (when allowed), ends the Connect session and reloads.
async function signOut(): Promise<void> {
  const agent = $agent.get();
  const config = $config.get();
  const offline = agent
    ?.getAgentStates()
    .find((s) => s.type === connect.AgentStateType.OFFLINE);
  if (agent && offline) {
    await new Promise<void>((resolve) =>
      agent.setState(offline, {
        success: () => resolve(),
        failure: () => resolve(),
      }),
    );
  }
  if (config) {
    await fetch(`${config.connectDomain}/logout`, {
      credentials: "include",
      mode: "no-cors",
    }).catch(() => undefined);
  }
  connect.core.terminate();
  window.location.reload();
}

function UserMenu() {
  const agent = useStore($agentSnapshot);
  if (!agent) return null;

  return (
    <Menu as="div" className="relative w-full">
      <MenuButton className="group relative inline-flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm leading-5 text-base-content">
        <span className="absolute inset-0 scale-50 rounded-lg bg-secondary-200/60 opacity-0 transition ease-out group-hover:scale-100 group-hover:opacity-100 group-active:scale-105 group-active:bg-secondary-200 dark:bg-secondary-700/50 dark:group-active:bg-secondary-700/75" />
        <span className="relative inline-flex items-center gap-2">
          <span className="relative inline-block flex-none">
            <span
              className={`absolute top-0 right-0 -mt-1 -mr-1 size-3 rounded-full border-2 border-base-100 dark:border-secondary-900 ${stateDotClass(agent.stateType)}`}
            />
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary-100 text-xs font-bold text-primary-700 dark:bg-primary-500/20 dark:text-primary-300">
              {initialsOf(agent.name)}
            </span>
          </span>
          <span className="flex grow flex-col text-left">
            <span className="w-40 truncate text-sm font-semibold">
              {agent.name}
            </span>
            <span className="w-40 truncate text-xs font-medium text-secondary-500 dark:text-secondary-400">
              {agent.stateName}
            </span>
            <span className="w-40 truncate text-xs text-secondary-400 dark:text-secondary-500">
              {VERSION}
            </span>
          </span>
        </span>
      </MenuButton>
      <Transition
        enter="transition ease-out duration-100"
        enterFrom="opacity-0 translate-y-4"
        enterTo="opacity-100 translate-y-0"
        leave="transition ease-in duration-75"
        leaveFrom="opacity-100 translate-y-0"
        leaveTo="opacity-0 -translate-y-4"
      >
        <MenuItems
          modal={false}
          className="absolute right-0 bottom-full left-0 z-10 mb-1 origin-bottom rounded-lg shadow-xl shadow-secondary-500/10 focus:outline-hidden dark:shadow-secondary-900"
        >
          <div className="rounded-lg bg-base-100 p-2.5 text-base-content ring-1 ring-black/5 dark:bg-secondary-800 dark:ring-secondary-700">
            <MenuItem>
              {({ focus }) => (
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-medium ${
                    focus ? "bg-secondary-100/60 dark:bg-secondary-700/50" : ""
                  }`}
                >
                  <Icon
                    name="signOut"
                    className={`size-4 ${focus ? "text-secondary-950 dark:text-secondary-50" : "text-secondary-400"}`}
                  />
                  <span className="grow py-1.5">Sign out</span>
                </button>
              )}
            </MenuItem>
          </div>
        </MenuItems>
      </Transition>
    </Menu>
  );
}

// Count of calls waiting in queue, shown on the Flow Calls nav item.
function FlowQueueBadge() {
  const count = useStore($queuedCount);
  const canFlow = useStore($can("flow"));
  const wsStatus = useStore($wsStatus);

  // Seed the store so live flowcall.updated pushes are tracked without opening the view.
  useEffect(() => {
    if (canFlow && wsStatus === "open" && $flowCalls.get() === null) {
      loadFlowCalls().catch((e) => console.error("loadFlowCalls", e));
    }
  }, [canFlow, wsStatus]);

  if (!count) return null;
  return (
    <span
      className="inline-flex rounded-full border border-primary-200 bg-primary-100 px-1.5 py-0.5 text-xs leading-4 font-semibold text-primary-700 dark:border-primary-700 dark:bg-primary-700 dark:text-primary-50"
      aria-label={`${count} in queue`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export default function App() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const agent = useStore($agent);
  const view = useStore($view);
  const features = useStore($features);
  const canMap = !!agent && canView("map", features);
  const fullMap = view === "map" && canMap;

  // Map voice outlives MapView (it keeps running in other sections), so stop
  // it here once the user can't be on the map.
  useEffect(() => {
    if (!canMap) {
      stopVoice();
      stopShare();
    }
  }, [canMap]);
  useEffect(
    () => () => {
      stopVoice();
      stopShare();
    },
    [],
  );

  return (
    <div
      id="page-container"
      className="mx-auto flex min-h-dvh w-full min-w-80 flex-col bg-secondary-100 text-base-content lg:pl-64 dark:bg-secondary-950"
    >
      {/* Page overlay when mobile sidebar is open */}
      <Transition
        appear
        show={mobileSidebarOpen}
        enter="transition ease-out duration-200"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition ease-in duration-100"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
      >
        <div
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-secondary-100/50 backdrop-blur-xs lg:hidden dark:bg-secondary-800/40"
          aria-hidden={!mobileSidebarOpen}
          tabIndex={-1}
        />
      </Transition>

      {/* Page Sidebar */}
      <aside
        id="page-sidebar"
        className={`fixed top-3 bottom-3 z-50 flex w-64 flex-col rounded-lg border border-secondary-200 bg-secondary-100 text-base-content transition-transform duration-300 ease-out lg:top-0 lg:bottom-0 lg:left-0 lg:translate-x-0 lg:rounded-none lg:border-none lg:py-3 dark:border-secondary-800 dark:bg-secondary-900 dark:lg:bg-secondary-950 dark:lg:shadow-none ${
          mobileSidebarOpen
            ? "left-3 translate-x-0 shadow-lg shadow-secondary-200 dark:shadow-secondary-950/50"
            : "left-0 -translate-x-full"
        }`}
        aria-label="Main Sidebar Navigation"
      >
        <div className="flex h-16 flex-none items-center justify-between border-b border-secondary-200/75 px-4 dark:border-secondary-800/75">
          <Brand />
          <div className="flex items-center lg:hidden">
            <button
              onClick={() => setMobileSidebarOpen(false)}
              type="button"
              aria-label="Close sidebar"
              className="group relative inline-flex items-center gap-2 rounded-lg p-2 text-sm leading-5 text-base-content"
            >
              <span className="absolute inset-0 scale-50 rounded-lg bg-secondary-200/60 opacity-0 transition ease-out group-hover:scale-100 group-hover:opacity-100 group-active:scale-105 group-active:bg-secondary-200 dark:bg-secondary-700/50 dark:group-active:bg-secondary-700/75" />
              <Icon name="xMark" className="relative size-4" />
            </button>
          </div>
        </div>

        <div className="grow overflow-y-auto">
          <div className="flex flex-col gap-4 px-4 py-6">
            <nav className="flex flex-col gap-0.5">
              {NAV.filter((item) => canView(item.view, features)).map(
                (item) => {
                  const active = item.view === view;
                  return (
                    <button
                      key={item.view}
                      type="button"
                      onClick={() => {
                        $view.set(item.view);
                        setMobileSidebarOpen(false);
                      }}
                      aria-current={active ? "page" : undefined}
                      className={`group flex items-center gap-2.5 rounded-lg px-2 text-left text-sm hover:bg-secondary-200/60 dark:hover:bg-secondary-700/50 ${
                        active
                          ? "font-semibold text-primary-700 dark:text-primary-400"
                          : "font-medium text-base-content"
                      }`}
                    >
                      <Icon
                        name={item.icon}
                        className={`size-5 ${active ? "text-primary-600 dark:text-primary-400" : "text-secondary-400 group-hover:text-secondary-600 dark:text-secondary-500 dark:group-hover:text-secondary-300"}`}
                      />
                      <span className="grow py-2">{item.label}</span>
                      {item.view === "flow" && <FlowQueueBadge />}
                    </button>
                  );
                },
              )}
            </nav>
          </div>
        </div>

        <div className="flex flex-none flex-col items-stretch gap-2 border-t border-secondary-200/75 p-4 dark:border-secondary-800/75">
          <UserMenu />
          <UpdateButton className="w-full" />
        </div>
      </aside>

      {/* Page Header (mobile) */}
      <header
        id="page-header"
        className="top-0 right-0 left-0 z-30 flex h-16 flex-none items-center backdrop-blur-xs lg:hidden dark:bg-secondary-900/90"
      >
        <div className="container mx-auto flex w-full items-center justify-between px-4">
          <button
            onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
            type="button"
            aria-label="Open sidebar"
            className="group relative inline-flex items-center gap-2 rounded-lg p-2 text-sm leading-5 text-base-content"
          >
            <span className="absolute inset-0 scale-50 rounded-lg bg-secondary-100 opacity-0 transition ease-out group-hover:scale-100 group-hover:opacity-100 group-active:scale-105 group-active:bg-secondary-200 dark:bg-secondary-700/50 dark:group-active:bg-secondary-700/75" />
            <svg
              className="relative inline-block size-5"
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden
            >
              {" "}
              <path
                fillRule="evenodd"
                d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <Brand />
          <span className="flex min-w-9 justify-end">
            <UpdateButton />
          </span>
        </div>
      </header>

      {/* Page Content */}
      <main
        id="page-content"
        className="flex max-w-full flex-auto flex-col lg:my-3 lg:mr-3 lg:rounded-lg lg:border lg:border-secondary-200 lg:pt-0 dark:bg-secondary-900 dark:lg:border-secondary-800"
      >
        <div
          data-map-bounds={fullMap ? "" : undefined}
          className={
            fullMap
              ? "relative flex w-full grow flex-col"
              : "container mx-auto flex w-full grow flex-col gap-1 pl-2 pr-2 lg:p-8 xl:max-w-7xl"
          }
        >
          {/* On the full-screen map the status bar and alerts float over it. */}
          <div
            className={
              fullMap
                ? "pointer-events-none absolute inset-x-2 top-2 z-20 flex flex-col gap-1 pr-12 lg:inset-x-3 lg:top-3"
                : "contents"
            }
          >
            {fullMap ? (
              agent && (
                <Draggable
                  id="status"
                  title="🟢 Status"
                  className="pointer-events-auto flex max-w-full flex-col"
                  panelClassName="w-fit"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <AgentStatusMenu />
                    <AskForHelpButton />
                  </div>
                </Draggable>
              )
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-4">
                {agent && <AgentStatusMenu />}
                {agent && <AskForHelpButton />}
              </div>
            )}

            <div className={fullMap ? "pointer-events-auto" : "contents"}>
              <AlertSection />
            </div>
          </div>
          {/* The CCP iframe carries the softphone, so it stays mounted across views. */}
          <Ccp />

          {view === "settings" && <Settings />}
          {view === "log" && <SystemLog />}
          {view === "calls" && agent && canView(view, features) && (
            <RecentCallList />
          )}
          {view === "feed" && agent && canView(view, features) && <Feed />}
          {view === "flow" && agent && canView(view, features) && <FlowCalls />}
          {view === "timeline" && agent && canView(view, features) && (
            <Timeline />
          )}
          {fullMap && <MapView />}
          {view === "callerids" && canView(view, features) && <CallerIds />}
          {view === "admin" && canView(view, features) && <Admin />}

          {agent && (
            <div className={view === "phone" ? "contents" : "hidden"}>
              <StatusBar />
              <PhoneCards />
              <DataPanel />
            </div>
          )}

          {agent && <MiniCallBar />}
          {agent && <HelpRequestDialog />}
        </div>
      </main>
    </div>
  );
}
