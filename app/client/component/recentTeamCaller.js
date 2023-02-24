// Who a number recently called
import {API} from "../const";
import {generateBaseHeader} from "../authentication";
import {sortPropertyList} from "../helper";

export async function updateNumberCallList(phoneNumber) {
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

