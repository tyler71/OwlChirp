export async function realtimeUpdateHandledIncoming(data) {
    const ALT_LOADING_CLASS = 'spinner-border'
    let handledIncomingElement = document.querySelector('#handledIncoming');
    if (handledIncomingElement.classList.contains(ALT_LOADING_CLASS)) {
        handledIncomingElement.classList.remove(ALT_LOADING_CLASS)
    }
    let handledCalls = data.handled_incoming
    handledIncomingElement.innerHTML = handledCalls;
}