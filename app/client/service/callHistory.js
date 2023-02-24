// ######## User Local Call History ########################
import {API} from "../const";
import {generateBaseHeader} from "../authentication";
import {sleep, sortPropertyList} from "../helper";

export function CallHistory(agent) {
    this.agent = agent;
    this.username = agent.getConfiguration().username;
    this.searchParams = new URLSearchParams({
        username: this.username,
        max_records: "10",
    });
    this.log = undefined;

    console.log("AAAAA - About to make query")
    this._refreshCalls = async () => {
        let req_status = false
        let req = undefined;
        while (req_status !== true) {
            await sleep(1000);
            req = await fetch(API + '/calls/agent?' + this.searchParams, {
                method: 'GET',
                headers: await generateBaseHeader(),
            })
            req_status = req.ok
        }
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
        if (!req.ok) {
            console.error(req)
        }

        while (this.log.length > 50) {
            this.log.pop()
        }
    }

    this.getLog = async (asc = false) => {
        let log = this.log === undefined ? await this._refreshCalls() : this.log
        return sortPropertyList(log, "timestamp", asc)
    }
}
