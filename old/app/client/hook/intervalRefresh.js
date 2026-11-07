// Refreshed on an interval
import {BREAK_STATUSES} from "../const";
import {checkStateDuration} from "../helper";

export async function hookIntervalRefresh(agent, interval = 30000) {
    function actions(agent) {
        let stateName = agent.getState().name.toLowerCase();
        checkStateDuration(agent, stateName, BREAK_STATUSES[stateName]);
    }

    setInterval(() => {
        actions(agent)
    }, interval);
}
