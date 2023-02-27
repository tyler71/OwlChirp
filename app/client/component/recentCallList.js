import {API, CURSOR_HELP_CLASS, CONNECT_DOMAIN, TIME_ZONE, LOADING_CLASS} from "../const";
import {generateBaseHeader} from "../authentication";
import {formatPhoneNumber, formatSecondsToTime, spinnerToggle} from "../helper";
import {phoneLog} from "../hook/init";

export async function updateAgentCallList() {
    let callListSection = document.querySelector('#recentCallList');
    let calls = await phoneLog.getLog();
    for (let call of calls) {
        let c_time = new Intl.DateTimeFormat('en-US', {
            weekday: 'short',
            hour: 'numeric',
            minute: 'numeric'
        }).format(new Date(call.timestamp))
        let c_username = call.agent.slice(0, (call.agent.indexOf('@')))
    }
    let newSection = createRecentCallList(calls, "Recent Calls", 'recentCallList', 'click');
    spinnerToggle(callListSection, false);
    callListSection.parentNode.replaceChild(newSection, callListSection);
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
                    contactIdLink.href = `${CONNECT_DOMAIN}/contact-trace-records/details/${subTableJson["id"]}?tx=${TIME_ZONE}`;
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

