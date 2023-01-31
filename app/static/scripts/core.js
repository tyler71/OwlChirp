let notify = new Notifier();
notify.authorize();

const API = '/api';

const SPS_CONNECT_DOMAIN = new URL('https://sps-connect-poc.my.connect.aws');
const TIME_ZONE = 'America/Los_Angeles';

const TABLE_INFO_CLASS = 'table-info';
const TABLE_ALERT_CLASS = 'table-warning';
const TABLE_DANGER_CLASS = 'table-danger';

const SIDELINE_STATUSES = {"quick break": 1, "on a project": 1, "ticket break": 1};
const EXCLUDED_STATUSES = {"offline": 1, "on contact": 1, "in a meeting": 1, "lunch": 1};
const BREAK_STATUSES = {"quick break": 20, "aftercallwork": 20, "lunch": 70};

const LOADING_SPINNER = 'spinner-border'

let JSON_HEADERS = new Headers();
JSON_HEADERS.append('Content-Type', 'application/json;charset=UTF-8');

let queueCountAlert = 1;
let containerDiv = document.querySelector('#ccp');
let statusDiv = document.querySelector('#statusDiv');
let [statusDivA, statusDivB] = statusDiv.children;
let phoneLog;

let agentObj;

let lastTagNotification = {};
let sidelineNotificationInterval = 60;


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
        // ringtoneUrl: "https://TLCCP.tyler71.repl.co/static/ringtone/Intellection-Rob_Cosh-rt.mp3" // optional, defaults to CCP’s default ringtone if a falsy value is set
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
    agentObj = agent;
    hookInit(agent).then(r => console.log(r));

    agent.onRefresh((agent) => {
        hookRefresh(agent);
    })

})


connect.contact((contact) => {

    contact.onConnecting((contact) => {
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
    phoneLog = new callHistory(agent);
    let metricEventSub = eventSub('/metrics', {
        'queue_count': _realtimeUpdateQueueCount,
        'available_count': _realtimeUpdateAvailableCount,
        'handled_incoming': _realtimeUpdateHandledIncoming,
    })

    // Update Agent call list once phoneLog has a phone log
    // After this, it is hooked into incoming calls
    await updateAgentCallList();

    new SetupCallerId();

    await hookIntervalRefresh(agent, 30000);

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

function eventSub(endpoint, events) {
    let subObj = new Subscribe(API + `${endpoint}`, (r) => {
        let data = JSON.parse(r.data)
        for (let [key, value] of Object.entries(data)) {
            if (events.hasOwnProperty(key)) {
                events[key](data);
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
            headers: JSON_HEADERS,
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
            headers: JSON_HEADERS,
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


// ######## Event Subscribe         ########################

function Subscribe(url, callback, reconnect = 300000) {
    this.url = url;
    this.callback = callback;
    this.reconnectTimeout = reconnect;
    this.lastUpdate = Date.now();
    this.eventSource = new EventSource(this.url);

    this._regenerateEventSource = (eventSource = undefined) => {
        if (eventSource !== undefined && eventSource.toString() === "[object EventSource]") {
            eventSource.close();
        }
        this.eventSource = new EventSource(this.url);
        this.eventSource.addEventListener('message', response => {
            this.lastUpdate = Date.now();
            this.callback(response);
        })

    }

    this._regenerateEventSource();

    setInterval(() => {
        if (Date.now() - this.lastUpdate > this.reconnectTimeout) {
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

    if (value >= queueCountAlert) {
        if (agentSideline()) {
            let queueNotifier = new Notifier("queueCount");
            queueNotifier.show(`Queue Count is ${value}!\nCan you help?`,
                "Callers Waiting", "queueCount", sidelineNotificationInterval)
        }
        queueCountSection.classList.add(TABLE_ALERT_CLASS)
    } else {
        queueCountSection.classList.remove(TABLE_ALERT_CLASS)
    }
}

// ######## Realtime Available Agent Count ########################
function _realtimeUpdateAvailableCount(data) {
    let availableCount = data.available_count;
    let activeAgentCount = data.active_agent_count;
    let agentCountSection = document.querySelector('#availableAgentCount');
    let agentCountValue = document.querySelector('#availableAgentCount > .value');

    spinnerToggle(agentCountValue, false);
    // TODO : Should not count currently connected calls as on call : Test if done
    let sidelineAgents = [];
    for (let userlistElement of data.user_list) {
        if (userlistElement.status.name.toLowerCase() in SIDELINE_STATUSES) {
            sidelineAgents.push(userlistElement)
        }
    }
    sidelineAgents.length > 0 ? agentCountValue.innerHTML = `${availableCount}/${activeAgentCount}+${sidelineAgents.length}` :
        agentCountValue.innerHTML = `${availableCount}/${activeAgentCount}`

    if (activeAgentCount <= 1) {
        agentCountSection.classList.add(TABLE_ALERT_CLASS);
        if (agentSideline()) {
            let tag = "availableAgents"
            let notify = new Notifier(tag)
            notify.show(`There are currently ${activeAgentCount} available agents`,
                "Available Agents", tag, sidelineNotificationInterval)
        }
    } else {
        agentCountSection.classList.remove(TABLE_ALERT_CLASS);
    }
}

async function _realtimeUpdateHandledIncoming(data) {
    let handledIncomingElement = document.querySelector('#handledIncoming');
    if (handledIncomingElement.classList.contains(LOADING_SPINNER)) {
        handledIncomingElement.classList.remove(LOADING_SPINNER)
    }
    let handledCalls = data.handled_incoming
    handledIncomingElement.innerHTML = handledCalls;
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
    const res = await fetch(url, {headers: JSON_HEADERS});
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
    let availableState = agent.getAgentStates().find(listedStates => listedStates.name === state)
    agent.setState(availableState);
}

// If an agent is on the "SideLine" it means they are not routable, but can be.
function agentSideline() {
    let not_routable = agentObj.getState().type === connect.AgentStateType.NOT_ROUTABLE;
    return not_routable && !agentObj.getState().name.toLowerCase() in EXCLUDED_STATUSES

}

// Will send notifications if this maxMinutes is reached
function checkStateDuration(agent, stateName, maxMinutes) {
    let agentStateLength = Math.floor(agent.getStateDuration() / 1000 / 60);
    let notificationTag = "long-break";

    if (agentStateLength > maxMinutes) {
        notify.show(`Hi ${agent.getName()}! Letting you know you've been on ${stateName} for ${agentStateLength} minutes`,
            stateName, notificationTag, 60)
    }

}

// Converts milliseconds to minutes
function ms_to_min(milliseconds) {
    return milliseconds / 1000 / 60;
}

function sortPropertyList(array, property, asc = true) {
    asc ? array.sort((a, b) => a[property] - b[property])
        : array.sort((a, b) => b[property] - a[property])
    return array
}

function spinnerToggle(dom, show, spinner = LOADING_SPINNER) {
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
                listHeader.innerHTML = `˅ ${title} (${rows.length}) ˅`
                for (let row of rows) {
                    row.classList.remove(CHILD_HIDE);
                    rows[0].classList.remove(PARENT_HIDE);
                }
            } else {
                listHeader.innerHTML = `˂ ${title} (${rows.length}) ˃`
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
                let subTableReq = await fetch(subTableDataUrl, {headers: JSON_HEADERS})
                if (subTableReq.ok) {
                    let subTable = document.createElement('table');
                    subTable.classList.add("table")
                    subTable.classList.add("subTable")
                    let subTableBody = document.createElement('tbody');
                    subTable.appendChild(subTableBody);
                    row.appendChild(subTable);

                    subTable.classList.add(LOADING_SPINNER)
                    let subTableJson = await subTableReq.json()
                    subTable.classList.remove(LOADING_SPINNER)

                    // Generate the structure for the contact id url
                    let contactIdLink = document.createElement('a')
                    contactIdLink.href = `${SPS_CONNECT_DOMAIN}contact-trace-records/details/${subTableJson["id"]}?tx=${TIME_ZONE}`;
                    contactIdLink.target = "_blank"
                    contactIdLink.textContent = subTableJson["id"].split("-")[0]

                    let subTableData = {
                        "Name": subTableJson["agent_name"],
                        "Answered": subTableJson["answered_timestamp"],
                        "Id": contactIdLink.outerHTML,
                    }
                    for (let [key, value] of Object.entries(subTableData)) {
                        let subTableRow = document.createElement("tr")
                        let subTableKey = document.createElement('td');
                        let subTableValue = document.createElement('td');
                        subTableKey.innerHTML = key;
                        subTableValue.innerHTML = value;
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
        listHeader.innerHTML = `˂ ${title} (${tbody.children.length}) ˃`
        Array.from(tbody.children).slice(1).forEach(e => e.classList.add(CHILD_HIDE));
        tbody.children[0].classList.add(PARENT_HIDE);
    } else {
        listHeader.innerHTML = `˂ ${title} ˃`
    }

    return box;
}

function SetupCallerId() {
    this.callerId = document.querySelector('#callerId');
    this.oldNick = ""

    this.callerId.addEventListener('dblclick', (e) => {
        e.target.contentEditable = true;
        e.target.classList.add("inEdit");
        this.oldNick = e.target.innerHTML;
    });
    this.callerId.addEventListener('blur', async (e) => {
        e.target.contentEditable = false;
        e.target.classList.remove("inEdit");

        if (e.target.innerHTML !== this.oldNick) {
            let updateCallerId = await fetch(API + '/calls/callerid', {
                method: "PUT",
                headers: JSON_HEADERS,
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
        headers: JSON_HEADERS,
    });
    if (res.ok) {
        let data = await res.json();
        callerId.innerHTML = data.name;
    } else {
        callerId.innerHTML = formatPhoneNumber(phoneNumber)
    }
}