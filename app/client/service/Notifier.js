// ######## HTML5 Notifier          ########################
export let lastTagNotification = {};

export function Notifier(namespace = "") {
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
            }).then(r => console.log(r));
        }
    }
    this.show = (message, title = "Notification", tag = this.id, interval = 0, events = []) => {
        if (this.compatible()) {
            if (interval > 0) {
                let now = Date.now();
                let secondsSinceNotify = (now - lastTagNotification[tag]) / 1000;
                if (isNaN(secondsSinceNotify) || secondsSinceNotify > interval) {
                    this._show(message, title, tag, events)
                    if (tag !== this.id) {
                        lastTagNotification[tag] = now;
                    }
                }
            } else {
                this._show(message, title, tag, events)
            }
        }
        this.id++;
    }

    this._show = (message, title, tag, events) => {
        if (this.compatible()) {
            this.list[tag] = new Notification(`${title}`, {
                body: message,
                tag: tag,
                lang: "en-US",
                dir: "auto",
            });

            // Available events for notifications: clicked, showed, errored, closed
            // events should look like: [{name: 'clicked', handler: (e) => {console.log("Hello World")}}]
            if (events.length > 0) {
                for (let event of events) {
                    this.log("Event handler")
                    this.log(event)
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

