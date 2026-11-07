import {API} from "../const";
import {generateBaseHeader} from "../authentication";
import {EventStreamContentType, fetchEventSource} from "@microsoft/fetch-event-source";
import {sleep} from "../helper";
import {realtimeUpdateVisualAgentList} from "../component/realtimeUpdateVisualAgentList";
import {realtimeUpdateAvailableCount, realtimeUpdateQueueCount} from "../component/realtimeStatsTable";
import {realtimeUpdateHandledIncoming} from "../component/realtimeHandledIncoming";


export async function eventSub(endpoint) {
    let events = {
        'queue_count': [realtimeUpdateQueueCount],
        'available_count': [realtimeUpdateAvailableCount, realtimeUpdateVisualAgentList],
        'handled_incoming': [realtimeUpdateHandledIncoming],
    }
    let subObj = await asyncSubscribe(API + `${endpoint}`, (r) => {
        let data = JSON.parse(r.data)
        for (let [key, _] of Object.entries(data)) {
            if (events.hasOwnProperty(key)) {
                for (let event of events[key]) {
                    event(data);
                }
            }
        }
    })
    return subObj
}

async function asyncSubscribe(url, callback, retry = false) {
    class RetriableError extends Error {
    }

    class FatalError extends Error {
    }

    const alertSection = document.querySelector('#alertSection');
    const FAIL_MESSAGE = "Realtime metrics paused; restoring...";
    let retryTimeSeconds = 2;
    let maxRetryTimeSeconds = 30;

    async function createConnection() {
        let res = await fetchEventSource(url, {
            headers: await generateBaseHeader(),
            openWhenHidden: true,
            onmessage(ev) {
                callback(ev)
            },
            onopen(response) {
                if (response.ok && response.headers.get('content-type') === EventStreamContentType) {
                    if (alertSection.textContent === FAIL_MESSAGE) {
                        alertSection.textContent = '';
                        alertSection.classList.remove("bg-warning");
                        retryTimeSeconds = 2;
                    }
                }
            },
            onerror(err) {
                alertSection.textContent = FAIL_MESSAGE
                alertSection.classList.add("bg-warning");
                throw new FatalError();
            },
            onclose() {
                throw new FatalError();
            }
        })

        return res
    }

    while (true) {
        try {
            await createConnection()
        } catch (error) {
            await sleep(retryTimeSeconds * 1000)
            retryTimeSeconds *= 1.2
            if (retryTimeSeconds > maxRetryTimeSeconds) {
                retryTimeSeconds = maxRetryTimeSeconds
            }
        }
    }
}

// ######## Realtime Available Agent Count ########################

// ######## Event Subscribe         ########################

// Not in use anymore as it cannot use authentication headers
function Subscribe(url, callback, reconnect = 100000) {
    this.url = url;
    this.callback = callback;
    this.reconnectTimeout = reconnect;
    this.initTimeout = 10000;
    this.lastUpdate = null;
    this.eventSource = new EventSource(this.url);

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

    this._regenerateEventSource().then(r => console.log(r));


    setInterval(() => {
        if (Date.now() - this.lastUpdate > this.reconnectTimeout) {
            this.reconnectTimeout = this.reconnectTimeout >= 1000000 ? 1000000 : this.reconnectTimeout * 1.5
            this._regenerateEventSource(this.eventSource).then(r => console.log(r))
        }

    }, this.reconnectTimeout);

    this.eventSource.addEventListener('error', e => {
        console.log(e);
        this._regenerateEventSource(this.eventSource).then(r => console.log(r));
    })
}

