import "amazon-connect-streams";
import {CCP_URL, CONNECT_DOMAIN, CONNECT_INSTANCE} from "./const";
import {Notifier} from "./service/Notifier";
import {hookIncomingCall} from "./hook/incomingCall";
import {hookRefresh} from "./hook/refresh";
import {hookInit} from "./hook/init";

import 'bootstrap/dist/css/bootstrap.css';
import "./css/ccp.css";

import Popper from 'popper.js';
import jquery from 'jquery';
window.Popper = Popper;
window.jquery = jquery;

export let notify = new Notifier();
window.notify = notify;
notify.authorize();

let containerDiv = document.querySelector('#ccp');
let statusDiv = document.querySelector('#statusDiv');
let [statusDivA, statusDivB] = statusDiv.children;

export let agentObj;

// Initial loading screen for OwlChirp. We want to
// display a message, provide a login button, provide a refresh button.
let welcomeString = `Thanks for using my program! -Tyler<br>
    <small>If OwlChirp isn't loading, login and refresh</small><br>
    <a href='${CONNECT_DOMAIN}/login' target="_blank"><button type="button" class="btn btn-primary mt-3">Login</button></a><br>
    <button type="button" id="reloadButton" class="btn btn-primary mt-2">Reload</button>`
document.querySelector('#alertSection').innerHTML = welcomeString;
document.querySelector('#reloadButton').addEventListener('click', () => {window.location.reload()})


// Starts the CCP instance.
// The provided hooks are used for the rest of the program.
connect.core.initCCP(containerDiv, {
    ccpUrl: `${CONNECT_DOMAIN}/connect/ccp-v2`, // REQUIRED
    loginPopup: false,                 // optional, defaults to `true`
    loginPopupAutoClose: false,        // optional, defaults to `false`
    // loginOptions: {                   // optional, if provided opens login in new window
    //     autoClose: true,              // optional, defaults to `false`
    //     height: 578,                  // optional, defaults to 578
    //     width: 400,                   // optional, defaults to 433
    //     top: 0,                       // optional, defaults to 0
    //     left: 0                       // optional, defaults to 0
    // },
    softphone: {                      // optional, defaults below apply if not provided
        allowFramedSoftphone: true,   // optional, defaults to false
        disableRingtone: false,       // optional, defaults to false
        // ringtoneUrl: "" // optional, defaults to CCP’s default ringtone if a falsy value is set
    },
    pageOptions: { //optional
        enableAudioDeviceSettings: false, // optional, defaults to 'false'
        enablePhoneTypeSettings: true     // optional, defaults to 'true'
    },
    // shouldAddNamespaceToLogs: false, // optional, defaults to 'false'
    // ccpAckTimeout: 5000,             // optional, defaults to 3000 (ms)
    // ccpSynTimeout: 3000,             // optional, defaults to 1000 (ms)
    // ccpLoadTimeout: 10000            // optional, defaults to 5000 (ms)
});

connect.agent((agent) => {
    // We use the agent object and set it right at the start. We also have a hookInit for all extra code we are running
    agentObj = agent;
    window.agentObj = agentObj;
    hookInit(agent).then(r => console.log(r));
    agent.onRefresh((agent) => {
        hookRefresh(agent);
    })

})


connect.contact((contact) => {

    contact.onConnecting((contact) => {
        // Run our custom code for incoming calls
        hookIncomingCall(contact).then(r => console.log(r))
    });
    // contact.onIncoming((contact) => {
    //     incomingCall(contact)
    // });

    contact.onRefresh((contact) => {
    });

    contact.onAccepted((contact) => {
    });

    contact.onEnded(() => {
    });

    contact.onConnected(() => {
        notify.log("Call has been connected, here is the object")
        notify.log(contact);
    });
});

// ######################## Helper Functions ########################

// Sets the agent to the specified state


