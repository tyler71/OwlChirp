// Actions to take when there is an action
import {incomingCallCallerId} from "../component/callerId";
import {formatPhoneNumber} from "../helper";
import {updateAgentCallList} from "../component/recentCallList";
import {notify, phoneLog} from "../core";

export async function hookIncomingCall(contact) {
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
