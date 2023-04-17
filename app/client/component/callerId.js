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
                    name: this.callerId.textContent,
                })
            })
            if (!updateCallerId.ok) {
                console.error("Failed to update caller Id, network error")
            }
        }
    })
}

export async function incomingCallCallerId(phoneNumber) {
    let callerId = document.querySelector('#callerId');
    callerId.setAttribute('data-phone-number', phoneNumber);

    let searchParams = new URLSearchParams({phone_number: phoneNumber});
    let res = await fetch(API + '/calls/callerid?' + searchParams, {
        headers: await generateBaseHeader(),
    });
    if (res.ok) {
        let data = await res.json();
        callerId.innerHTML = data.name;
    } else {
        callerId.innerHTML = formatPhoneNumber(phoneNumber)
    }
    callerId.setAttribute("title", formatPhoneNumber(phoneNumber))
}
