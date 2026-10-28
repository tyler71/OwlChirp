import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { useStore } from '@nanostores/react';

import { setAgentState } from '../lib/softphone';
import { $agentSnapshot } from '../lib/stores';
import { Icon, formatElapsed, stateDotClass, useNow } from './ui';

// Agent status picker. While on a call Connect queues the choice as the next
// status, applied once the contact is cleared.
export default function AgentStatusMenu() {
  const agent = useStore($agentSnapshot);
  const now = useNow();
  if (!agent) return null;

  return (
    <Menu as="div" className="relative">
      <MenuButton className="inline-flex items-center gap-2 rounded-lg border border-secondary-200 bg-base-100 px-3 py-2 text-sm leading-5 font-semibold text-secondary-800 hover:border-secondary-300 hover:shadow-xs dark:border-secondary-700 dark:bg-secondary-800 dark:text-secondary-200 dark:hover:border-secondary-600">
        <span className={`size-2.5 rounded-full ${stateDotClass(agent.stateType)}`} />
        <span>{agent.stateName}</span>
        <span className="font-mono text-xs font-medium text-secondary-500 tabular-nums dark:text-secondary-400">
          {formatElapsed(now - agent.stateStartedAt)}
        </span>
        <Icon name="chevronDown" className="size-4 opacity-60" />
      </MenuButton>
      {agent.nextStateName && (
        <p className="absolute top-full right-0 mt-1 text-xs whitespace-nowrap text-secondary-500 dark:text-secondary-400">
          Next: {agent.nextStateName}
        </p>
      )}
      <MenuItems
        anchor="bottom end"
        transition
        className="z-50 mt-1 w-56 origin-top-right rounded-lg bg-base-100 p-1.5 shadow-xl ring-1 shadow-secondary-500/10 ring-black/5 transition duration-100 ease-out focus:outline-hidden data-closed:scale-95 data-closed:opacity-0 dark:bg-secondary-800 dark:shadow-secondary-900 dark:ring-secondary-700"
      >
        {agent.states.map((state) => {
          const current = state.name === agent.stateName || state.name === agent.nextStateName;
          return (
            <MenuItem key={state.agentStateARN}>
              <button
                type="button"
                onClick={() => void setAgentState(state)}
                className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm font-medium data-focus:bg-secondary-100/60 dark:data-focus:bg-secondary-700/50"
              >
                <span className={`size-2 rounded-full ${stateDotClass(state.type)}`} />
                <span className="grow">{state.name}</span>
                {current && <Icon name="check" className="size-4 text-primary-600 dark:text-primary-400" />}
              </button>
            </MenuItem>
          );
        })}
      </MenuItems>
    </Menu>
  );
}
