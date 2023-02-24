// Documentation 
// https://github.com/amazon-connect/amazon-connect-streams/blob/master/Documentation.md#connectcore

let iframeOptions = [
    "width=350",
    "height=640",
    "scrollbars=no",
    "location=no",
    "status=no",
    "toolbar=no",
]

let ccp = window.open("/ccp", "_blank", iframeOptions.join(','));

window.close()
