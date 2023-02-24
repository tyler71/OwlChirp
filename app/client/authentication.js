import {getAgentRegex} from "./helper";
import {agentObj} from "./core";

async function checksum(string, algorithm = 'SHA-256') {
    let textAsBuffer = new TextEncoder().encode(string);
    let hashBuffer = await window.crypto.subtle.digest(algorithm, textAsBuffer);
    let hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

async function hashRequest(agent) {
    let date = new Date();
    date.setUTCHours(0, 0, 0, 0)
    let timestamp = Math.floor(date.getTime() / 1000);


    let agentID = (await getAgentRegex(agent))[4]
    let agentUsername = agent.getConfiguration().username

    return await checksum(`${timestamp}${agentID}${agentUsername}`)
}

export async function generateBaseHeader(hash = true) {
    let baseHeaders = {
        'Content-Type': 'application/json;charset=UTF-8'
    }
    if (hash === true) {
        baseHeaders['X-Api-Key'] = await hashRequest(agentObj);
    }
    return baseHeaders
}
