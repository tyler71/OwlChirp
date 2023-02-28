import {EXCLUDED_STATUSES, LOADING_CLASS, STATUS_AFTERCALL} from "./const";
import {agentObj, notify} from "./core";
import {lastTagNotification} from "./service/Notifier";

export function spinnerToggle(dom, show, spinner = LOADING_CLASS) {
    let ds = dom.classList
    if (show && !ds.contains(spinner)) {
        ds.add(spinner)
    } else if (!show && ds.contains(spinner)) {
        ds.remove(spinner)
    }
}

export function sortPropertyList(array, property, asc = true) {
    asc ? array.sort((a, b) => a[property] - b[property])
        : array.sort((a, b) => b[property] - a[property])
    return array
}

export function formatSecondsToTime(seconds) {
    let date = new Date(0);
    date.setSeconds(seconds);
    let timeString = date.toISOString().substring(11, 19);
    return timeString
}

export function formatPhoneNumber(phone) {
    let fn = String(phone).split(/ /)[0].replace(/\D/g, '');
    if (fn > 10) {
        fn = fn.slice(fn.length - 10)
    }
    let formattedNumber = `(${fn.slice(0, 3)}) ${fn.slice(3, 6)}-${fn.slice(6, 10)}`
    return formattedNumber
}

export async function getAgentRegex(agent) {
    const AGENT_QUEUE_PATTERN = new RegExp('arn:aws:connect:([\\w|\\-]+):(\\w+):instance/([\\w|\\-]+)/queue/agent/([\\w|\\-]+)');

    const agentQueue = agent.getConfiguration().routingProfile.queues.filter(queue => queue.name === null)
    // group[0] all
    // group[1] region
    // group[2] AWS AccountID
    // group[3] Amazon Connect InstanceID
    // group[4] AgentID
    const groups = AGENT_QUEUE_PATTERN.exec(agentQueue[0].queueARN);
    // const agentArn = `arn:aws:connect:${groups[1]}:${groups[2]}:instance/${groups[3]}/agent/${groups[4]}`;
    return groups
}

// Converts milliseconds to minutes
export function ms_to_min(milliseconds) {
    return milliseconds / 1000 / 60;
}

export function setToState(agent, state) {
    let requestedState = agent.getAgentStates().find(listedStates => listedStates.name === state)
    agent.setState(requestedState);
}

// If an agent is on the "SideLine" it means they are not routable, but can be.
export function agentSideline() {
    let state_type = agentObj.getState().type;
    let state_name = agentObj.getState().name.toLowerCase();

    let not_routable =
        state_type === connect.AgentStateType.NOT_ROUTABLE
        || state_name === STATUS_AFTERCALL;
    return not_routable && ! (state_name in EXCLUDED_STATUSES)
}

// Will send notifications if this maxMinutes is reached
export function checkStateDuration(agent, stateName, maxMinutes) {
    let agentStateLength = Math.floor(agent.getStateDuration() / 1000 / 60);
    let notificationTag = "Long Break";

    if (agentStateLength > maxMinutes) {
        notify.show(`Hi ${agent.getName()}! Letting you know you've been on ${stateName} for ${agentStateLength} minutes`,
            stateName, notificationTag, 60, [{
                event: "click",
                handler: () => {
                    let d = new Date();
                    lastTagNotification[notificationTag] = d.setMinutes(d.getMinutes() + 15);
                }
            }])
    }

}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}