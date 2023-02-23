import "amazon-connect-streams";
import {fetchEventSource} from "@microsoft/fetch-event-source";


let notify = new Notifier();
notify.authorize();

const API = '/api';

const SPS_CONNECT_DOMAIN = new URL('https://sps-connect-poc.my.connect.aws');
const TIME_ZONE = 'America/Los_Angeles';

const TABLE_INFO_CLASS = 'table-info';
const TABLE_ALERT_CLASS = 'table-warning';
const TABLE_DANGER_CLASS = 'table-danger';
const CURSOR_HELP_CLASS = 'helpCursor';

// Sideline statuses can receive notifications.
// Excluded statuses are not notified
const SIDELINE_STATUSES = {"quick break": 1, "on a project": 1, "ticket break": 1, "missed": 1}
const EXCLUDED_STATUSES = {"offline": 1, "on contact": 1, "in a meeting": 1, "lunch": 1};
const BREAK_STATUSES = {"quick break": 10, "aftercallwork": 10, "lunch": 65, "missedcallagent": 5}

const MAX_QUEUE_COUNT = 1;
const MIN_AGENT_STAFFED = 1;

const LOADING_CLASS = 'alert-secondary'


let containerDiv = document.querySelector('#ccp');
let statusDiv = document.querySelector('#statusDiv');
let [statusDivA, statusDivB] = statusDiv.children;
let phoneLog;

let agentObj;

let lastTagNotification = {};
let sidelineNotificationInterval = 300;

// Starts the CCP instance.
// The provided hooks are used for the rest of the program.
const INSTANCE_URL = "https://sps-connect-poc.my.connect.aws/connect/ccp-v2";
connect.core.initCCP(containerDiv, {
    ccpUrl: INSTANCE_URL,             // REQUIRED
    loginPopup: true,                 // optional, defaults to `true`
    loginPopupAutoClose: true,        // optional, defaults to `false`
    loginOptions: {                   // optional, if provided opens login in new window
        autoClose: true,              // optional, defaults to `false`
        height: 578,                  // optional, defaults to 578
        width: 400,                   // optional, defaults to 433
        top: 0,                       // optional, defaults to 0
        left: 0                       // optional, defaults to 0
    },
    softphone: {                      // optional, defaults below apply if not provided
        allowFramedSoftphone: true,   // optional, defaults to false
        disableRingtone: false,       // optional, defaults to false
        // ringtoneUrl: "" // optional, defaults to CCP’s default ringtone if a falsy value is set
    },
    pageOptions: { //optional
        enableAudioDeviceSettings: false, // optional, defaults to 'false'
        enablePhoneTypeSettings: true     // optional, defaults to 'true'
    },
    shouldAddNamespaceToLogs: false, // optional, defaults to 'false'
    ccpAckTimeout: 5000,             // optional, defaults to 3000 (ms)
    ccpSynTimeout: 3000,             // optional, defaults to 1000 (ms)
    ccpLoadTimeout: 10000            // optional, defaults to 5000 (ms)
});

connect.agent((agent) => {
    // We use the agent object and set it right at the start. We also have a hookInit for all extra code we are running
    agentObj = agent;
    hookInit(agent).then(r => console.log(r));

    agent.onRefresh((agent) => {
        hookRefresh(agent);
    })

})


connect.contact((contact) => {

    contact.onConnecting((contact) => {
        // Run our custom code for incoming calls
        hookIncomingCall(contact).then(r => console.log(r))
    });
    // contact.onIncoming((contact) => {
    //     incomingCall(contact)
    // });

    contact.onRefresh((contact) => {
    });

    contact.onAccepted((contact) => {
    });

    contact.onEnded(() => {
    });

    contact.onConnected(() => {
        notify.log("Call has been connected, here is the object")
        notify.log(contact);
    });
});

// ######################## Event Hooks ########################

// Run on first load
async function hookInit(agent) {
    // Tracks our call history. Is database backed
    phoneLog = new callHistory(agent);

    // Using Server Sent Events, we subscribe to the endpoint and listen for events.
    // When a change occurs, a "data" object is sent to the function, allowing it to update.
    // It is only run when a change occurs.
    let metricEventSub = await eventSub('/metrics', {
        'queue_count': [_realtimeUpdateQueueCount],
        'available_count': [_realtimeUpdateAvailableCount, _realtimeUpdateVisualAgentList],
        'handled_incoming': [_realtimeUpdateHandledIncoming],
    })

    // Update Agent call list once phoneLog has a phone log
    // After this, it is hooked into incoming calls
    await updateAgentCallList();

    new SetupCallerId();

    await hookIntervalRefresh(agent, 5000);

}

// Is periodically refreshed automatically when there is an agent change
function hookRefresh(agent) {
}

// Refreshed on an interval
async function hookIntervalRefresh(agent, interval = 30000) {
    function actions(agent) {
        let stateName = agent.getState().name.toLowerCase();
        checkStateDuration(agent, stateName, BREAK_STATUSES[stateName]);
    }

    setInterval(() => {
        actions(agent)
    }, interval);
}

// Actions to take when there is an action
async function hookIncomingCall(contact) {
    notify.log("Incoming Call, here is the contact object");
    notify.log(contact);
    let phoneNumber = contact.getActiveInitialConnection().getEndpoint().phoneNumber;
    let contactId = contact.getContactId();

    await incomingCallCallerId(phoneNumber);

    notify.show(`Incoming Call from ${formatPhoneNumber(phoneNumber)}`,
        "Incoming Call", "incomingCall", 0);
    // [{name:'click', handler:() => { contact.accept() }}])

    await incomingCallCallerId(phoneNumber);

    // Update the recent calls for this number
    // await updateNumberCallList(phoneNumber);

    // Put this below updateNumberCallList so that a users most recent call is
    // not the current call
    await phoneLog.add(contactId, phoneNumber);

    // Agent's recent calls
    await updateAgentCallList();

}

// ######################## Function Constructors ##################

// ######## HTML5 Notifier          ########################
function Notifier(namespace = "") {
    this.namespace = namespace;
    this.list = [];
    this.id = 1;

    this.log = (msg) => {
        console.log(msg)
    }
    this.compatible = () => {
        if (typeof Notification === 'undefined') {
            this.log("Notifications are not available for your browser.");
            return false;
        }
        return true;
    }
    this.authorize = () => {
        if (this.compatible()) {
            Notification.requestPermission((permission) => {
                this.log(`Permission to display: ${permission}`);
            });
        }
    }
    this.show = (message, title = "Notification", tag = this.id, interval = 0, events = []) => {
        if (this.compatible()) {
            if (interval > 0) {
                let now = Date.now();
                let secondsSinceNotify = (now - lastTagNotification[tag]) / 1000;
                if (isNaN(secondsSinceNotify) || secondsSinceNotify > interval) {
                    let notification = this._show(message, title, tag, events)
                    if (tag !== this.id) {
                        lastTagNotification[tag] = now;
                    }
                }
            } else {
                let notification = this._show(message, title, tag, events)
            }
        }
        this.id++;
    }

    this._show = (message, title, tag, events) => {
        if (this.compatible()) {
            this.list[tag] = new Notification(`${this.namespace} ${title}`, {
                body: message,
                tag: tag,
                lang: "en-US",
                dir: "auto",
            });

            // Available events for notifications: clicked, showed, errored, closed
            // events should look like: [{name: 'clicked', handler: (e) => {console.log("Hello World")}}]
            if (events.length > 0) {
                for (let event of events) {
                    notify.log("Event handler")
                    notify.log(event)
                    this.list[tag].addEventListener(event.name, event.handler);
                }
            }
            return this.list[tag]; // Not used currently

        }
    }
    this.logEvent = (id, event) => {
        this.log(`Notification # ${id} ${event}`);
    }
}


// ######## User Local Call History ########################

async function eventSub(endpoint, events) {
    let subObj = await asyncSubscribe(API + `${endpoint}`, (r) => {
        let data = JSON.parse(r.data)
        for (let [key, value] of Object.entries(data)) {
            if (events.hasOwnProperty(key)) {
                for (let event of events[key]) {
                    event(data);
                }
            }
        }
    })
    return subObj
}

// ######## User Local Call History ########################
function callHistory(agent) {
    this.agent = agent;
    this.username = agent.getConfiguration().username;
    this.searchParams = new URLSearchParams({
        username: this.username,
        max_records: "10",
    });
    this.log = undefined;

    this._refreshCalls = async () => {
        let req = await fetch(API + '/calls/agent?' + this.searchParams, {
            method: 'GET',
            headers: await generateBaseHeader(),
        })
        let res = await req.json();
        let result = res === undefined ? [] : res

        this.log = result;
        return result;
    }

    this.add = async (contactId, phoneNumber) => {
        let logItem = {
            contactId: contactId,
            phoneNumber: phoneNumber,
            timestamp: Date.now(),
            agent: this.username,
        }
        this.log.push(logItem);

        let req = await fetch(API + '/calls/agent', {
            method: 'POST',
            headers: await generateBaseHeader(),
            body: JSON.stringify(logItem),
        })
        while (this.log.length > 50) {
            this.log.pop()
        }
    }

    this.getLog = async (asc = false) => {
        let log = this.log === undefined ? await this._refreshCalls() : this.log
        return sortPropertyList(log, "timestamp", asc)
    }
}

async function asyncSubscribe(url, callback) {
    let res = await fetchEventSource(url, {
        headers: await generateBaseHeader(),
        onmessage(ev) {
            callback(ev)
        }
    })
    return res
}

// ######## Event Subscribe         ########################

function Subscribe(url, callback, reconnect = 100000) {
    this.url = url;
    this.callback = callback;
    this.reconnectTimeout = reconnect;
    this.initTimeout = 10000;
    this.lastUpdate = null;
    // this.eventSource = new EventSource(this.url);
    this.eventSource = fetchEventSource(this.url)

    // TODO: Need to figure out a way to add headers to EventSource for security
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

    this._regenerateEventSource();


    setInterval(() => {
        if (Date.now() - this.lastUpdate > this.reconnectTimeout) {
            this.reconnectTimeout = this.reconnectTimeout >= 1000000 ? 1000000 : this.reconnectTimeout * 1.5
            this._regenerateEventSource(this.eventSource)
        }

    }, this.reconnectTimeout);

    this.eventSource.addEventListener('error', e => {
        console.log(e);
        this._regenerateEventSource(this.eventSource);
    })
}


// ######################## Realtime Status Sections ########################
// Takes functions starting with realtime and use them here
// Events are sent from the server to this endpoint using Server Sent Events (SSE)
// We can add as many functions as needed here. Only when something is changed for that
//  Server will something change

// ######## Realtime Queue Count ########################
function _realtimeUpdateQueueCount(data) {
    let value = data.queue_count
    let queueCountSection = document.querySelector('#queueCount');
    let queueCountValue = document.querySelector('#queueCount > .value');

    spinnerToggle(queueCountValue, false)
    queueCountValue.innerHTML = value;

    value >= MAX_QUEUE_COUNT ? queueCountSection.classList.add(TABLE_ALERT_CLASS)
        : queueCountSection.classList.remove(TABLE_ALERT_CLASS)

    if (value > MAX_QUEUE_COUNT) {
        if (agentSideline()) {
            let queueNotifier = new Notifier("queueCount");
            queueNotifier.show(`Queue Count is ${value}!\nCan you help?`,
                "Callers Waiting", "queueCount", sidelineNotificationInterval)
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
                "Available Agents", tag, sidelineNotificationInterval)
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

        if (sn in SIDELINE_STATUSES) {
            span.classList.add('visual_list_sideline_status')
        } else if (sn in EXCLUDED_STATUSES) {
            span.classList.add('visual_list_excluded_status')
        } else if (sn === "on call") {
            span.classList.add('visual_list_on_call')
        }

        span.innerHTML = firstLetter

        // Tooltip info
        span.setAttribute("data-toggle", "tooltip")
        span.setAttribute("data-placement", "bottom")
        span.setAttribute("title", `${user.user.first_name} ${user.user.last_name}: ${user.status.name}`)

        visualAgentList.appendChild(span)
    }
}

// ######## Agents recent call list ########################
async function updateAgentCallList() {
    let callListSection = document.querySelector('#recentCallList');
    let convertedCalls = [];
    let calls = await phoneLog.getLog();
    for (let call of calls) {
        let c_time = new Intl.DateTimeFormat('en-US', {
            weekday: 'short',
            hour: 'numeric',
            minute: 'numeric'
        }).format(new Date(call.timestamp))
        let c_username = call.agent.slice(0, (call.agent.indexOf('@')))
        convertedCalls.push(`${formatPhoneNumber(call.phoneNumber)} ${c_time}`)
    }
    // let newSection = createCollapseList(convertedCalls, true, 'dblclick', 'agentCallList');
    let newSection = createRecentCallList(calls, "Recent Calls", 'recentCallList', 'click');
    spinnerToggle(callListSection, false);
    callListSection.parentNode.replaceChild(newSection, callListSection);
}

async function getAgentRegex() {
    const AGENT_QUEUE_PATTERN = new RegExp('arn:aws:connect:([\\w|\\-]+):(\\w+):instance/([\\w|\\-]+)/queue/agent/([\\w|\\-]+)');

    const agentQueue = agentObj.getConfiguration().routingProfile.queues.filter(queue => queue.name === null)
    // group[0] all
    // group[1] region
    // group[2] AWS AccountID
    // group[3] Amazon Connect InstanceID
    // group[4] AgentID
    const groups = AGENT_QUEUE_PATTERN.exec(agentQueue[0].queueARN);
    // const agentArn = `arn:aws:connect:${groups[1]}:${groups[2]}:instance/${groups[3]}/agent/${groups[4]}`;
    return groups
}

async function checksum(string, algorithm = 'SHA-256') {
    let textAsBuffer = new TextEncoder().encode(string);
    let hashBuffer = await window.crypto.subtle.digest(algorithm, textAsBuffer);
    let hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

async function hashRequest() {
    let date = new Date();
    date.setUTCHours(0, 0, 0, 0)
    let timestamp = Math.floor(date.getTime() / 1000);


    let agentID = (await getAgentRegex())[4]
    let agentUsername = agentObj.getConfiguration().username

    return await checksum(`${timestamp}${agentID}${agentUsername}`)
}


// ######## Who a phone number called recently ########################

async function updateNumberCallList(phoneNumber) {
    let numberListSection = document.querySelector('#numberCallList');
    // let phoneNumber = contact.getActiveInitialConnection().getEndpoint().phoneNumber;
    let convertedCalls = [];

    let searchParams = new URLSearchParams({
        phone_number: phoneNumber,
        max_records: "10",
    });
    const url = API + '/calls/number?' + searchParams;
    const res = await fetch(url, {headers: await generateBaseHeader()});
    if (res.ok) {
        const numberCallList = await res.json();
        let sortedNumberCallList = sortPropertyList(numberCallList, "timestamp", false);
        for (let call of sortedNumberCallList) {
            let c_time = new Intl.DateTimeFormat('en-US', {
                weekday: 'short',
                hour: 'numeric',
                minute: 'numeric'
            }).format(new Date(call.timestamp))
            let c_username = call.agent.slice(0, (call.agent.indexOf('@')))
            convertedCalls.push(`Called ${c_username} ${c_time}`)
        }
        let newSection = createCollapseList(convertedCalls, true, 'dblclick', 'numberCallList');
        numberListSection.parentNode.replaceChild(newSection, numberListSection);
    } else {
        this.log("updateNumberCallList: Unable to update")
    }


}

// ######################## Helper Functions ########################

// Sets the agent to the specified state
function setToState(agent, state) {
    let requestedState = agent.getAgentStates().find(listedStates => listedStates.name === state)
    agent.setState(requestedState);
}

// If an agent is on the "SideLine" it means they are not routable, but can be.
function agentSideline() {
    let not_routable = agentObj.getState().type === connect.AgentStateType.NOT_ROUTABLE;
    return not_routable && !agentObj.getState().name.toLowerCase() in EXCLUDED_STATUSES

}

// Will send notifications if this maxMinutes is reached
function checkStateDuration(agent, stateName, maxMinutes) {
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

// Converts milliseconds to minutes
function ms_to_min(milliseconds) {
    return milliseconds / 1000 / 60;
}

async function generateBaseHeader(hash = true) {
    // let baseHeaders = new Headers();
    let baseHeaders = {
        'Content-Type': 'application/json;charset=UTF-8'
    }
    if (hash === true) {
        baseHeaders['X-Api-Key'] = await hashRequest();
    }
    return baseHeaders
}


function sortPropertyList(array, property, asc = true) {
    asc ? array.sort((a, b) => a[property] - b[property])
        : array.sort((a, b) => b[property] - a[property])
    return array
}

function spinnerToggle(dom, show, spinner = LOADING_CLASS) {
    let ds = dom.classList
    if (show && !ds.contains(spinner)) {
        ds.add(spinner)
    } else if (!show && ds.contains(spinner)) {
        ds.remove(spinner)
    }
}

function formatPhoneNumber(phone) {
    let fn = String(phone).split(/ /)[0].replace(/\D/g, '');
    if (fn > 10) {
        fn = fn.slice(fn.length - 10)
    }
    let formattedNumber = `(${fn.slice(0, 3)}) ${fn.slice(3, 6)}-${fn.slice(6, 10)}`
    return formattedNumber
}

function formatSecondsToTime(seconds) {
    let date = new Date(0);
    date.setSeconds(seconds);
    let timeString = date.toISOString().substring(11, 19);
    return timeString
}

function createCollapseList(array, collapsed = false, action = "click", id = null) {
    let parentHide = "collapsed"
    let childHide = "hide"

    let ul = document.createElement('ul');
    ul.classList.add('list-group')
    if (id !== null) ul.id = id;

    if (array.length > 0) {
        for (let row of array) {
            let li = document.createElement('li');
            li.classList.add('list-group-item')
            li.innerHTML = row;
            li.setAttribute('data-data', row);
            ul.appendChild(li);
        }
        if (collapsed === true) {
            Array.from(ul.children).slice(1).forEach(e => e.classList.add(childHide));
            ul.children[0].classList.add(parentHide);
        }

        ul.addEventListener(action, (e) => {
            if (e.target.classList.contains(parentHide)) {
                for (let item of ul.children) {
                    item.classList.remove(childHide);
                    e.target.classList.remove(parentHide);
                }
            } else {
                let firstItem = ul.children[0]
                for (let item of ul.children) {
                    item === firstItem ? item.classList.add(parentHide) : item.classList.add(childHide)
                }

            }
        })
    }
    return ul;
}

function createRecentCallList(array, title = "List", id = null, action = "click") {
    const HEADER_EXPANDED = 'expanded';
    const PARENT_HIDE = 'collapsed';
    const CHILD_HIDE = 'hide';

    let box = document.createElement('div');
    if (id !== null) {
        box.id = id;
    }

    let boxCaption = document.createElement("div");
    let listHeader = document.createElement('h2');
    boxCaption.appendChild(listHeader);
    boxCaption.classList.add("listTitle");
    boxCaption.classList.add("noselect");
    boxCaption.addEventListener(action, (e) => {
        let table = e.target.parentElement.nextElementSibling.children[0].children[0];
        let rows = table.children;
        if (rows.length > 0) {
            if (rows[0].classList.contains(PARENT_HIDE)) {
                listHeader.innerHTML = `${title} (${rows.length})`
                listHeader.classList.add(HEADER_EXPANDED);
                for (let row of rows) {
                    row.classList.remove(CHILD_HIDE);
                    rows[0].classList.remove(PARENT_HIDE);
                }
            } else {
                listHeader.innerHTML = `${title} (${rows.length})`
                listHeader.classList.remove(HEADER_EXPANDED);
                let firstRow = rows[0];
                for (let row of rows) {
                    row === firstRow ? row.classList.add(PARENT_HIDE) : row.classList.add(CHILD_HIDE);
                }
            }
        }
    })


    let boxList = document.createElement("div");
    boxList.classList.add("list");

    let table = document.createElement('table');
    let tbody = document.createElement('tbody');

    table.classList.add("table");
    table.classList.add("table-striped");
    table.classList.add("table-hover");
    tbody.addEventListener('dblclick', async (e) => {
        let row = e.target.parentElement;
        if (row.nodeName === 'TR' && row.parentElement === tbody) {
            // We'll dynamically create a sub table for relevant information about this call.
            // There will also be a link to the contact page as well
            // Double-clicking again will collapse this list
            if (row.classList.contains("expandedData")) {
                if (row.children[2] !== undefined) {
                    let subTable = row.children[2]
                    if (subTable.classList.contains("hide")) {
                        subTable.classList.remove("hide")
                    } else {
                        subTable.classList.add("hide")
                    }
                }
            } else {
                row.classList.add("expandedData");
                let searchParams = new URLSearchParams({
                    contact_id: row.dataset.contactid,
                });
                let subTableDataUrl = API + '/calls/detail?' + searchParams;
                let subTableReq = await fetch(subTableDataUrl, {headers: await generateBaseHeader()})
                if (subTableReq.ok) {
                    let subTable = document.createElement('table');
                    subTable.classList.add("table")
                    subTable.classList.add("subTable")
                    let subTableBody = document.createElement('tbody');
                    subTable.appendChild(subTableBody);
                    row.appendChild(subTable);

                    subTable.classList.add(LOADING_CLASS)
                    let subTableJson = await subTableReq.json()
                    subTable.classList.remove(LOADING_CLASS)

                    // Generate the structure for the contact id url
                    let contactIdLink = document.createElement('a')
                    contactIdLink.href = `${SPS_CONNECT_DOMAIN}contact-trace-records/details/${subTableJson["id"]}?tx=${TIME_ZONE}`;
                    contactIdLink.target = "_blank"
                    contactIdLink.textContent = subTableJson["id"].split("-")[0]

                    let c_time = new Intl.DateTimeFormat('en-US', {
                        weekday: 'short',
                        hour: 'numeric',
                        minute: 'numeric'
                    }).format(new Date(subTableJson["answered_timestamp"]))
                    let subTableData = {
                        "Name": {value: subTableJson["agent_name"]},
                        "Answered": {
                            value: c_time,
                            tooltip: subTableJson["answered_timestamp"]
                        },
                        "Answer Time": {
                            value: formatSecondsToTime(subTableJson["call_to_queue_time"] + subTableJson["queue_time"]),
                            tooltip: `${formatSecondsToTime(subTableJson["call_to_queue_time"])} spent in menu + ${formatSecondsToTime(subTableJson["queue_time"])} spent in queue`
                        },
                        "Id": {value: contactIdLink.outerHTML},
                    }
                    for (let [key, value] of Object.entries(subTableData)) {
                        let subTableRow = document.createElement("tr")
                        let subTableKey = document.createElement('td');
                        let subTableValue = document.createElement('td');
                        subTableKey.innerHTML = key;
                        subTableValue.innerHTML = value.value;
                        if (value.tooltip !== undefined) {
                            subTableRow.classList.add(CURSOR_HELP_CLASS);
                            subTableRow.setAttribute("data-toggle", "tooltip")
                            subTableRow.setAttribute("data-placement", "top")
                            subTableRow.setAttribute("title", value.tooltip)
                        }
                        subTableRow.appendChild(subTableKey);
                        subTableRow.appendChild(subTableValue);
                        subTableBody.append(subTableRow);
                    }
                }
            }
        }
    });
    table.appendChild(tbody);

    boxList.appendChild(table);

    box.appendChild(boxCaption);
    box.appendChild(boxList);


    for (let obj of array) {
        let tr = document.createElement('tr');
        let ts = document.createElement('td');
        let pn = document.createElement('td');
        pn.innerHTML = formatPhoneNumber(obj.phoneNumber);

        let c_time = new Intl.DateTimeFormat('en-US', {
            weekday: 'short',
            hour: 'numeric',
            minute: 'numeric'
        }).format(new Date(obj.timestamp))
        ts.innerHTML = c_time;

        tr.setAttribute('data-contactid', obj.contactId);
        tr.appendChild(ts);
        tr.appendChild(pn);
        tbody.appendChild(tr);
    }
    if (tbody.children.length > 0) {
        listHeader.innerHTML = `${title} (${tbody.children.length})`
        Array.from(tbody.children).slice(1).forEach(e => e.classList.add(CHILD_HIDE));
        tbody.children[0].classList.add(PARENT_HIDE);
    } else {
        listHeader.innerHTML = `${title}`
    }

    return box;
}

function SetupCallerId() {
    this.callerId = document.querySelector('#callerId');
    this.callerId.setAttribute("data-toggle", "tooltip")
    this.callerId.setAttribute("data-placement", "top")

    this.oldNick = ""

    // Start editing the field
    this.callerId.addEventListener('click', (e) => {
        e.target.contentEditable = true;
        e.target.classList.add("inEdit");
        this.oldNick = e.target.innerHTML;
    });
    // Click away from the field to save it
    this.callerId.addEventListener('blur', async (e) => {
        e.target.contentEditable = false;
        e.target.classList.remove("inEdit");

        if (e.target.innerHTML !== this.oldNick) {
            let updateCallerId = await fetch(API + '/calls/callerid', {
                method: "PUT",
                headers: await generateBaseHeader(),
                body: JSON.stringify({
                    phone_number: this.callerId.dataset.phoneNumber,
                    name: this.callerId.innerHTML,
                })
            })
            if (!updateCallerId.ok) {
                console.error("Failed to update caller Id, network error")
            }
        }
    })
}

async function incomingCallCallerId(phoneNumber) {
    let callerId = document.querySelector('#callerId');
    callerId.setAttribute('data-phone-number', phoneNumber);

    let searchParams = new URLSearchParams({phone_number: phoneNumber});
    let res = await fetch(API + '/calls/callerid?' + searchParams, {
        headers: await generateBaseHeader(),
    });
    if (res.ok) {
        let data = await res.json();
        callerId.innerHTML = data.name;
        this.callerId.setAttribute("title", formatPhoneNumber(phoneNumber))
    } else {
        callerId.innerHTML = formatPhoneNumber(phoneNumber)
    }
}
