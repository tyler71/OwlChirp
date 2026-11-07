import {agentSideline, spinnerToggle} from "../helper";
import {
    HIGH_QUEUE_COUNT_NOTIFICATION_INTERVAL,
    MAX_QUEUE_COUNT,
    MIN_AGENT_STAFFED,
    SIDELINE_NOTIFICATION_INTERVAL,
    SIDELINE_STATUSES,
    STATUS_ON_CONTACT,
    TABLE_ALERT_CLASS
} from "../const";
import {Notifier} from "../service/Notifier";
import {agentObj} from "../core";

export function realtimeUpdateQueueCount(data) {
    let value = data.queue_count
    let queueCountSection = document.querySelector('#queueCount');
    let queueCountValue = document.querySelector('#queueCount > .value');

    spinnerToggle(queueCountValue, false)
    queueCountValue.innerHTML = value;

    value >= MAX_QUEUE_COUNT ? queueCountSection.classList.add(TABLE_ALERT_CLASS)
        : queueCountSection.classList.remove(TABLE_ALERT_CLASS)

    if (value > MAX_QUEUE_COUNT) {
        let queueNotifier = new Notifier("queueCount");
        if (agentSideline()) {
            queueNotifier.show(`Queue Count is ${value}!\nCan you help?`,
                "Callers Waiting", "queueCount", HIGH_QUEUE_COUNT_NOTIFICATION_INTERVAL)
        } else if (agentObj.getState().name.toLowerCase() == STATUS_ON_CONTACT) {
            queueNotifier.show(`Queue Count is ${value}\nWe're asking for help!`,
                "Support Requested", "supportRequest", HIGH_QUEUE_COUNT_NOTIFICATION_INTERVAL)
        }
    }
}

export function realtimeUpdateAvailableCount(data) {
    let availableCount = data.available_count;
    let activeAgentCount = data.active_agent_count;
    let agentCountSection = document.querySelector('#availableAgentCount');
    let agentCountValue = document.querySelector('#availableAgentCount > .value');

    spinnerToggle(agentCountValue, false);
    let sidelineAgents = [];
    for (let userlistElement of data.user_list) {
        if (userlistElement.status.name.toLowerCase() in SIDELINE_STATUSES) {
            sidelineAgents.push(userlistElement)
        }
    }

    agentCountValue.setAttribute("data-toggle", "tooltip")
    agentCountValue.setAttribute("data-placement", "top")
    if (sidelineAgents.length > 0) {
        agentCountValue.innerHTML = `${availableCount}/${activeAgentCount}+${sidelineAgents.length}`
        agentCountValue.setAttribute("title", `${availableCount} able to take a call now, ${activeAgentCount} taking calls. ${sidelineAgents.length} ready to help`)
    } else {
        agentCountValue.setAttribute("title", `${availableCount} able to take a call now, ${activeAgentCount} taking calls.`)
        agentCountValue.innerHTML = `${availableCount}/${activeAgentCount}`
    }

    activeAgentCount <= MIN_AGENT_STAFFED ? agentCountSection.classList.add(TABLE_ALERT_CLASS)
        : agentCountSection.classList.remove(TABLE_ALERT_CLASS)

    if (activeAgentCount < MIN_AGENT_STAFFED) {
        if (agentSideline()) {
            let tag = "availableAgents"
            let notify = new Notifier(tag)
            notify.show(`There are currently ${activeAgentCount} available agents`,
                "Available Agents", tag, SIDELINE_NOTIFICATION_INTERVAL)
        }
    }
}