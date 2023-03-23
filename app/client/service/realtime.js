import {
    API,
    CURSOR_HELP_CLASS,
    EXCLUDED_STATUSES,
    HIGH_QUEUE_COUNT_NOTIFICATION_INTERVAL,
    LOADING_CLASS,
    MAX_QUEUE_COUNT,
    MIN_AGENT_STAFFED,
    SIDELINE_NOTIFICATION_INTERVAL,
    SIDELINE_STATUSES,
    STATUS_ERROR,
    STATUS_MISSED_CALL,
    STATUS_ON_CONTACT,
    TABLE_ALERT_CLASS
} from "../const";
import {generateBaseHeader} from "../authentication";
import {EventStreamContentType, fetchEventSource} from "@microsoft/fetch-event-source";
import {agentSideline, sleep, spinnerToggle} from "../helper";
import {Notifier} from "./Notifier";
import {agentObj} from "../core";


export async function eventSub(endpoint) {
    let events = {
        'queue_count': [_realtimeUpdateQueueCount],
        'available_count': [_realtimeUpdateAvailableCount, _realtimeUpdateVisualAgentList],
        'handled_incoming': [_realtimeUpdateHandledIncoming],
    }
    let subObj = await asyncSubscribe(API + `${endpoint}`, (r) => {
        let data = JSON.parse(r.data)
        for (let [key, _] of Object.entries(data)) {
            if (events.hasOwnProperty(key)) {
                for (let event of events[key]) {
                    event(data);
                }
            }
        }
    })
    return subObj
}

async function asyncSubscribe(url, callback, retry = false) {
    class RetriableError extends Error { }

    class FatalError extends Error { }

    const alertSection = document.querySelector('#alertSection');
    const FAIL_MESSAGE = "Realtime metrics paused; restoring...";
    let retryTimeSeconds = 2;
    let maxRetryTimeSeconds = 30;

    async function createConnection() {
        let res = await fetchEventSource(url, {
            headers: await generateBaseHeader(),
            openWhenHidden: true,
            onmessage(ev) {
                callback(ev)
            },
            onopen(response) {
                if (response.ok && response.headers.get('content-type') === EventStreamContentType) {
                    if (alertSection.textContent === FAIL_MESSAGE) {
                        alertSection.textContent = '';
                        alertSection.classList.remove("bg-warning");
                        retryTimeSeconds = 2;
                    }
                }
            },
            onerror(err) {
                alertSection.textContent = FAIL_MESSAGE
                alertSection.classList.add("bg-warning");
                throw new FatalError();
            },
            onclose() {
                throw new FatalError();
            }
        })

        return res
    }

    while (true) {
        try {
            await createConnection()
        } catch (error) {
            await sleep(retryTimeSeconds * 1000)
            retryTimeSeconds *= 1.2
            if(retryTimeSeconds > maxRetryTimeSeconds) {
                retryTimeSeconds = maxRetryTimeSeconds
            }
        }
    }
}

    function _realtimeUpdateQueueCount(data) {
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

// ######## Realtime Available Agent Count ########################

    function _realtimeUpdateAvailableCount(data) {
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

    async function _realtimeUpdateHandledIncoming(data) {
        const ALT_LOADING_CLASS = 'spinner-border'
        let handledIncomingElement = document.querySelector('#handledIncoming');
        if (handledIncomingElement.classList.contains(ALT_LOADING_CLASS)) {
            handledIncomingElement.classList.remove(ALT_LOADING_CLASS)
        }
        let handledCalls = data.handled_incoming
        handledIncomingElement.innerHTML = handledCalls;
    }

    async function _realtimeUpdateVisualAgentList(data) {
        let visualAgentList = document.querySelector('#visualAgentList');
        if (visualAgentList.classList.contains(LOADING_CLASS)) {
            visualAgentList.classList.remove(LOADING_CLASS)
        }
        visualAgentList.textContent = null;

        // Ascending
        let sortedUserList = Array.from(data.user_list).sort((a, b) => b.user.first_name < a.user.first_name)

        // Check to see if any other user has an identical first name
        // If so, use two letters instead. We do this by making a string of just first letters.
        // For each user, it strips out all letters but theirs and checks the length. If > 1, it uses the first two letters
        let userListFirstLetters = '';
        for (let f of sortedUserList) {
            userListFirstLetters += f.user.first_name[0]
        }
        for (let user of sortedUserList) {
            let span = document.createElement('span')
            span.classList.add(CURSOR_HELP_CLASS);

            let fl = user.user.first_name[0].toUpperCase()
            let firstLetter = userListFirstLetters.replace(new RegExp(`[^${fl}]`, 'g'), '').length > 1 ? user.user.first_name.slice(0, 2)
                : user.user.first_name[0]

            let sn = user.status.name.toLowerCase()

            if (sn === STATUS_ERROR || sn === STATUS_MISSED_CALL) {
                span.classList.add('visual_list_error')
            } else if (sn === "on call") {
                span.classList.add('visual_list_on_call')
            } else if (sn in SIDELINE_STATUSES) {
                span.classList.add('visual_list_sideline_status')
            } else if (sn in EXCLUDED_STATUSES) {
                span.classList.add('visual_list_excluded_status')
            }

            span.innerHTML = firstLetter

            // Tooltip info
            span.setAttribute("data-toggle", "tooltip")
            span.setAttribute("data-placement", "bottom")
            span.setAttribute("title", `${user.user.first_name} ${user.user.last_name}: ${user.status.name}`)

            visualAgentList.appendChild(span)
        }
    }

// ######## Event Subscribe         ########################

// Not in use anymore as it cannot use authentication headers
    function Subscribe(url, callback, reconnect = 100000) {
        this.url = url;
        this.callback = callback;
        this.reconnectTimeout = reconnect;
        this.initTimeout = 10000;
        this.lastUpdate = null;
        this.eventSource = new EventSource(this.url);

        this._regenerateEventSource = async (eventSource = undefined) => {
            if (eventSource !== undefined && eventSource.toString() === "[object EventSource]") {
                eventSource.close();
            }
            // If no data sent in 10 seconds, close and retry, extend by 1.5x
            setTimeout(() => {
                if (this.lastUpdate === null) {
                    this._regenerateEventSource(this.eventSource);
                    this.initTimeout *= 1.5;
                }
            }, this.initTimeout)

            // Generate the new EventSource.
            this.eventSource = new EventSource(this.url);
            this.eventSource.addEventListener('message', response => {
                this.reconnectTimeout = this.reconnectTimeout <= 300000 ? 300000 : this.reconnectTimeout * 0.7
                this.lastUpdate = Date.now();
                this.callback(response);
            })

        }

        this._regenerateEventSource().then(r => console.log(r));


        setInterval(() => {
            if (Date.now() - this.lastUpdate > this.reconnectTimeout) {
                this.reconnectTimeout = this.reconnectTimeout >= 1000000 ? 1000000 : this.reconnectTimeout * 1.5
                this._regenerateEventSource(this.eventSource).then(r => console.log(r))
            }

        }, this.reconnectTimeout);

        this.eventSource.addEventListener('error', e => {
            console.log(e);
            this._regenerateEventSource(this.eventSource).then(r => console.log(r));
        })
    }

