import {
    CURSOR_HELP_CLASS,
    EXCLUDED_STATUSES,
    LOADING_CLASS,
    SIDELINE_STATUSES,
    STATUS_ERROR,
    STATUS_MISSED_CALL
} from "../const";

export async function realtimeUpdateVisualAgentList(data) {
    let visualAgentList = document.querySelector('#visualAgentList');
    if (visualAgentList.classList.contains(LOADING_CLASS)) {
        visualAgentList.classList.remove(LOADING_CLASS)
    }
    visualAgentList.textContent = null;

    // Ascending
    let sortedUserList = Array.from(data.user_list).sort((a, b) => b.user.first_name < a.user.first_name)
    // let sortedUserList = Array.from(data.user_list).sort((a, b) => b.status.name < a.status.name)

    // Check to see if any other user has an identical first name
    // If so, use two letters instead. We do this by making a string of just first letters.
    // For each user, it strips out all letters but theirs and checks the length. If > 1, it uses the first two letters
    let userListFirstLetters = '';
    for (let f of sortedUserList) {
        userListFirstLetters += f.user.first_name[0]
    }
    for (let user of sortedUserList) {
        let span = document.createElement('span')
        span.classList.add(CURSOR_HELP_CLASS);

        let fl = user.user.first_name[0].toUpperCase()
        let firstLetter = userListFirstLetters.replace(new RegExp(`[^${fl}]`, 'g'), '').length > 1 ? user.user.first_name.slice(0, 2)
            : user.user.first_name[0]

        let sn = user.status.name.toLowerCase()

        if (sn === STATUS_ERROR || sn === STATUS_MISSED_CALL) {
            span.classList.add('visual_list_error')
        } else if (sn === "on call") {
            span.classList.add('visual_list_on_call')
        } else if (sn in SIDELINE_STATUSES) {
            span.classList.add('visual_list_sideline_status')
        } else if (sn in EXCLUDED_STATUSES) {
            span.classList.add('visual_list_excluded_status')
        }

        span.innerHTML = firstLetter

        // Tooltip info
        span.setAttribute("data-toggle", "tooltip")
        span.setAttribute("data-placement", "bottom")
        span.setAttribute("title", `${user.user.first_name} ${user.user.last_name}: ${user.status.name}`)

        visualAgentList.appendChild(span)
    }
}