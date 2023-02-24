// Run on first load
import {CallHistory} from "../service/callHistory";
import {updateAgentCallList} from "../component/recentCallList";
import {SetupCallerId} from "../component/callerId";
import {eventSub} from "../service/realtime";
import {phoneLog} from "../core";
import {hookIntervalRefresh} from "./intervalRefresh";

export async function hookInit(agent) {
    // Tracks our call history. Is database backed
    phoneLog = new CallHistory(agent);
    window.phoneLog = phoneLog;

    // Update Agent call list once phoneLog has a phone log
    // After this, it is hooked into incoming calls
    await updateAgentCallList();

    new SetupCallerId();

    await hookIntervalRefresh(agent, 5000);

    // Using Server Sent Events, we subscribe to the endpoint and listen for events.
    // When a change occurs, a "data" object is sent to the function, allowing it to update.
    // It is only run when a change occurs.
    await eventSub('/metrics')

}