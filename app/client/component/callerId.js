import {generateBaseHeader} from "../authentication";
import {API} from "../const";
import {formatPhoneNumber} from "../helper";

export function SetupCallerId() {
    this.callerId = document.querySelector('#callerId');
    this.callerId.setAttribute("data-toggle", "tooltip")
    this.callerId.setAttribute("data-placement", "top")

    this.oldNick = ""

    // Start editing the field
    this.callerId.addEventListener('click', (e) => {
        e.target.contentEditable = true;
        e.target.classList.add("inEdit");
        this.oldNick = e.target.textContent;
        // navigator.clipboard.writeText(e.target.textContent)
    });
    // Click away from the field to save it
    this.callerId.addEventListener('blur', async (e) => {
        e.target.contentEditable = false;
        e.target.classList.remove("inEdit");

        if (e.target.textContent !== this.oldNick && e.target.textContent.length > 0) {
            let updateCallerId = await fetch(API + '/calls/callerid', {
                method: "PUT",
                headers: await generateBaseHeader(),
                body: JSON.stringify({
                    phone_number: this.callerId.dataset.phoneNumber,
                    name: this.callerId.textContent,
                })
            })
            if (!updateCallerId.ok) {
                console.error("Failed to update caller Id, network error")
            }
        } else {
            e.target.textContent = this.oldNick
        }
    })
}

export async function incomingCallCallerId(phoneNumber) {
    let callerId = document.querySelector('#callerId');
    callerId.setAttribute('data-phone-number', phoneNumber);

    let name = await getCallerIdName(phoneNumber)
    callerId.textContent = name ? name : formatPhoneNumber(phoneNumber)
    callerId.setAttribute("title", formatPhoneNumber(phoneNumber))
}

export async function getCallerIdName(phoneNumber) {
    let searchParams = new URLSearchParams({phone_number: phoneNumber});
    let res = await fetch(API + '/calls/callerid?' + searchParams, {
        headers: await generateBaseHeader(),
    });
    let name = ''
    if (res.ok) {
        let data = await res.json();
        name = data.name;
    } else {
        name = null
    }
    return name
}