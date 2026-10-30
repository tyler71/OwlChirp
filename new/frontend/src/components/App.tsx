import 'amazon-connect-streams';

import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react';
import { useStore } from '@nanostores/react';
import { useState } from 'react';

import { $agent, $agentSnapshot, $config, $owlchirpEnabled, $view, type View } from '../lib/stores';
import '../lib/theme';
import AgentStatusMenu from './AgentStatusMenu';
import AlertSection from './AlertSection';
import CallPanel from './CallPanel';
import TabbedFunctions from './TabbedFunctions';
import Ccp from './Ccp';
import DataPanel from './DataPanel';
import Feed from './Feed';
import FlowCalls from './FlowCalls';
import RecentCallList from './RecentCallList';
import Settings from './Settings';
import StatusBar from './StatusBar';
import SystemLog from './SystemLog';
import Timeline from './Timeline';
import { Icon, type IconName, stateDotClass } from './ui';

function Brand() {
  return (
    <a
      href="/ccp"
      className="group inline-flex items-center gap-1 px-2 font-bold text-base-content hover:text-secondary-600 dark:hover:text-secondary-300"
    >
      <img src="/favicon.ico" alt="" className="size-6" />
      <span>OwlChirp</span>
    </a>
  );
}

const NAV: { view: View; label: string; icon: IconName }[] = [
  { view: 'phone', label: 'Phone', icon: 'phone' },
  { view: 'feed', label: 'Feed', icon: 'chat' },
  { view: 'flow', label: 'Flow Calls', icon: 'queue' },
  { view: 'timeline', label: 'Timeline', icon: 'timeline' },
  { view: 'calls', label: 'Recent Calls', icon: 'clock' },
  { view: 'settings', label: 'Settings', icon: 'cog' },
];

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

// Sets the agent Offline (when allowed), ends the Connect session and reloads.
async function signOut(): Promise<void> {
  const agent = $agent.get();
  const config = $config.get();
  const offline = agent?.getAgentStates().find((s) => s.type === connect.AgentStateType.OFFLINE);
  if (agent && offline) {
    await new Promise<void>((resolve) => agent.setState(offline, { success: () => resolve(), failure: () => resolve() }));
  }
  if (config) {
    await fetch(`${config.connectDomain}/logout`, { credentials: 'include', mode: 'no-cors' }).catch(() => undefined);
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
            <span className="w-40 truncate text-sm font-semibold">{agent.name}</span>
            <span className="w-40 truncate text-xs font-medium text-secondary-500 dark:text-secondary-400">
              {agent.stateName}
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
                    focus ? 'bg-secondary-100/60 dark:bg-secondary-700/50' : ''
                  }`}
                >
                  <Icon
                    name="signOut"
                    className={`size-4 ${focus ? 'text-secondary-950 dark:text-secondary-50' : 'text-secondary-400'}`}
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

export default function App() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const agent = useStore($agent);
  const view = useStore($view);
  const owlchirpEnabled = useStore($owlchirpEnabled);

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
            ? 'left-3 translate-x-0 shadow-lg shadow-secondary-200 dark:shadow-secondary-950/50'
            : 'left-0 -translate-x-full'
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
              {NAV.map((item) => {
                const active = item.view === view;
                return (
                  <button
                    key={item.view}
                    type="button"
                    onClick={() => {
                      $view.set(item.view);
                      setMobileSidebarOpen(false);
                    }}
                    aria-current={active ? 'page' : undefined}
                    className={`group flex items-center gap-2.5 rounded-lg px-2 text-left text-sm hover:bg-secondary-200/60 dark:hover:bg-secondary-700/50 ${
                      active
                        ? 'font-semibold text-primary-700 dark:text-primary-400'
                        : 'font-medium text-base-content'
                    }`}
                  >
                    <Icon
                      name={item.icon}
                      className={`size-5 ${active ? 'text-primary-600 dark:text-primary-400' : 'text-secondary-400 group-hover:text-secondary-600 dark:text-secondary-500 dark:group-hover:text-secondary-300'}`}
                    />
                    <span className="grow py-2">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        <div className="flex flex-none items-center border-t border-secondary-200/75 p-4 dark:border-secondary-800/75">
          <UserMenu />
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
            <svg className="relative inline-block size-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden> <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" /></svg>
          </button>
          <Brand />
          <span className="size-9" />
        </div>
      </header>

      {/* Page Content */}
      <main id="page-content"
        className="flex max-w-full flex-auto flex-col lg:my-3 lg:mr-3 lg:rounded-lg lg:border lg:border-secondary-200 lg:pt-0 dark:bg-secondary-900 dark:lg:border-secondary-800"
      >
        <div className="container mx-auto flex w-full grow flex-col gap-1 pl-2 pr-2 lg:p-8 xl:max-w-7xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {agent && <AgentStatusMenu />}
          </div>

          <AlertSection />
          {/* The CCP iframe carries the softphone, so it stays mounted across views. */}
          <Ccp />

          {view === 'settings' && <Settings />}
          {view === 'log' && <SystemLog />}
          {view === 'calls' && agent && <RecentCallList />}
          {view === 'feed' && agent && <Feed />}
          {view === 'flow' && agent && <FlowCalls />}
          {view === 'timeline' && agent && <Timeline />}

          {/* Owlchirp features are gated per agent by the owlchirp feature flag. */}
          {agent && (
            <div className={view === 'phone' ? 'contents' : 'hidden'}>
              <StatusBar />
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
                <div className="flex flex-col gap-6 lg:col-span-3">
                  <CallPanel />
                  <TabbedFunctions />
                </div>
              </div>
              <DataPanel />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
