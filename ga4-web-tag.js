/**
 * Polyfill for String.startsWith()
 */
if (!String.prototype.startsWith) {
    Object.defineProperty(String.prototype, 'startsWith', {
        value: function (search, rawPos) {
            var pos = rawPos > 0 ? rawPos | 0 : 0;
            return this.substring(pos, pos + search.length) === search;
        },
    });
}

var dataLayerVariableName = 'uc_data_layer_variable';
var eventDataLayerData = {};
var dataLayerEventName = 'uc_data_tag_event';

/**
 * Parses the response string to JSON.
 * @param {string} str - The response string.
 * @returns {Object} The parsed JSON object or the original string in a 'body' property.
 */
function dataTagParseResponse(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return {
            'body': str,
        };
    }
}

/**
 * Replaces variables in a string with values from an object.
 * @param {string} a - The string containing variables to replace.
 * @param {Object} b - The object containing replacement values.
 * @returns {string} The string with replaced variables.
 */
function replaceVariable(a, b) {
    return a.replace(/\$\{([^\}]+)\}/g, function (c, d) {
        return b[d] || c;
    });
}

/**
 * Sends a tracking pixel request.
 * @param {string} url - The URL to send the request to.
 */
function sendPixel(url) {
    var img = new Image(1, 1);
    if (url.startsWith(((gtmServerDomain.charAt(gtmServerDomain.length - 1) === '/') ? gtmServerDomain.slice(0, -1) : gtmServerDomain) + '/_set_cookie')) {
        setCookieRunningCount++;
        img.onload = img.onerror = function () {
            img.onload = img.onerror = null;
            setCookieRunningCount--;
            if ((!xhr || xhr.readyState === 4) // server container must be finished to be sure no more cookies will be received
                && dataLayerEventName && dataLayerVariableName // data tag configured to push event
                && waitForCookies // data tag configured to wait for cookies
                && (setCookieRunningCount === 0) // all cookies already set
            ) {
                pushToDataLayer();
            }
        };
    }
    img.src = url;
}

/**
 * Sends a beacon request or falls back to sending a pixel request.
 * @param {string} url - The URL to send the request to.
 */
function sendBeacon(url) {
    var sendBeaconResult;
    try {
        sendBeaconResult = navigator.sendBeacon && navigator.sendBeacon(url);
    } catch (e) {
    }
    sendBeaconResult || sendPixel(url);
}

/**
 * Creates an iterator for an array.
 * @param {Array} a - The array to iterate over.
 * @returns {Function} The iterator function.
 */
function fallbackIterator(a) {
    var b = 0;
    return function () {
        return b < a.length ? {
            done: !1,
            value: a[b++],
        } : {
            done: !0,
        };
    };
}

/**
 * Pushes event data to the data layer.
 */
function pushToDataLayer() {
    window[dataLayerVariableName] = window[dataLayerVariableName] || [];
    eventDataLayerData.event = dataLayerEventName;
    window[dataLayerVariableName].push(eventDataLayerData);
}

/**
 * Processes response data from an event.
 * @param {Object} event - The event containing response data.
 */
function processResponseDataEvent(event) {
    if (event) {
        var sendPixelArr = event.send_pixel || [],
            i;
        if (Array.isArray(sendPixelArr)) {
            for (i = 0; i < sendPixelArr.length; i++) {
                sendPixel(sendPixelArr[i]);
            }
        }

        var sendBeaconArr = event.send_beacon || [];
        if (Array.isArray(sendBeaconArr)) {
            for (i = 0; i < sendBeaconArr.length; i++) {
                sendBeacon(sendBeaconArr[i]);
            }
        }

        if (typeof event.response === 'object') {
            var status = event.response.status_code || 0,
                body = event.response.body || {},
                parsedBody = dataTagParseResponse(body);

            // merge parsedBody into eventDataLayerData instead of assignment
            // (just in case multiple responses will be supported by gtm in the future)
            for (var key in parsedBody) {
                if (parsedBody.hasOwnProperty(key)) {
                    eventDataLayerData[key] = parsedBody[key];
                }
            }
            eventDataLayerData.status = status;
        }
    }
}

/**
 * Sends a POST request using the Fetch API.
 * @param {string} gtmServerDomain - The GTM server domain.
 * @param {string} requestPath - The request path.
 * @param {string} stringifiedData - The stringified data to send.
 * @param {Object} replacements - The replacements object.
 * @param {string} dataLayerEventName - The data layer event name.
 * @param {string} dataLayerVariableName - The data layer variable name.
 * @param {boolean} waitForCookies - Whether to wait for cookies.
 * @param {number} setCookieRunningCount - The count of running set cookie operations.
 * @param {Object} eventDataLayerData - The event data layer data.
 */
function sendPostRequest(gtmServerDomain, requestPath, stringifiedData, replacements, dataLayerEventName, dataLayerVariableName, waitForCookies, setCookieRunningCount, eventDataLayerData) {
    fetch(gtmServerDomain + requestPath, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain',
        },
        credentials: 'include',
        keepalive: true,
        body: stringifiedData,
    })
        .then(function (response) {
            response.text().then(function (responseText) {
                if (responseText) {
                    responseText = replaceVariable(responseText, replacements);
                }
                if (responseText && responseText.startsWith('event: message\ndata: ')) {
                    responseText
                        .split('\n\n')
                        .filter(function (eventString) {
                            return eventString;  // Filter out empty strings
                        })
                        .forEach(function (eventString) {
                            try {
                                var event = JSON.parse(eventString.replace('event: message\ndata: ', ''));
                                processResponseDataEvent(event);
                            } catch (error) {
                                console.error('Error processing response data:', error);
                            }
                        });
                }
                if (dataLayerEventName && dataLayerVariableName) { // data tag configured to push event
                    if (!responseText || !responseText.startsWith('event: message\ndata: ')) { // old protocol
                        eventDataLayerData = dataTagParseResponse(responseText);
                        eventDataLayerData.status = response.status;
                        pushToDataLayer();
                    } else if (
                        !waitForCookies // data tag configured to push event instantly
                        || (setCookieRunningCount === 0) // no cookies received or all cookies already set
                    ) {
                        pushToDataLayer();
                    }
                }
            });
        })
        .catch(function (error) {
            console.error(error);
        });
}

/**
 * Sends a POST request using XMLHttpRequest.
 * @param {string} gtmServerDomain - The GTM server domain.
 * @param {string} requestPath - The request path.
 * @param {string} stringifiedData - The stringified data to send.
 * @param {Object} replacements - The replacements object.
 * @param {string} dataLayerEventName - The data layer event name.
 * @param {string} dataLayerVariableName - The data layer variable name.
 * @param {boolean} waitForCookies - Whether to wait for cookies.
 * @param {number} setCookieRunningCount - The count of running set cookie operations.
 * @param {Object} eventDataLayerData - The event data layer data.
 */
function sendPostRequestXHR(gtmServerDomain, requestPath, stringifiedData, replacements, dataLayerEventName, dataLayerVariableName, waitForCookies, setCookieRunningCount, eventDataLayerData) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', gtmServerDomain + requestPath);
    xhr.setRequestHeader('Content-type', 'text/plain');
    xhr.withCredentials = true;

    xhr.onprogress = function (progress) {
        if ((xhr.status === 200) && xhr.responseText.startsWith('event: message\ndata: ')) {
            response += xhr.responseText.substring(loaded);
            loaded = progress.loaded;

            for (var replacedResponse = replaceVariable(response, replacements), nextSeparationPos = replacedResponse.indexOf('\n\n'); -1 !== nextSeparationPos;) {
                var parsedData;
                a: {
                    var iterableLines;
                    var lines = replacedResponse.substring(0, nextSeparationPos).split('\n'),
                        linesIterator = 'undefined' != typeof Symbol && Symbol.iterator && lines[Symbol.iterator];
                    if (linesIterator) {
                        iterableLines = linesIterator.call(lines);
                    } else if ('number' == typeof lines.length) {
                        iterableLines = {
                            next: fallbackIterator(lines),
                        };
                    } else {
                        throw Error(String(lines) + ' is not an iterable or ArrayLike');
                    }
                    var eventNameLine = iterableLines.next().value,
                        eventDataLine = iterableLines.next().value;
                    if (eventNameLine.startsWith('event: message') && eventDataLine.startsWith('data: ')) {
                        try {
                            parsedData = JSON.parse(eventDataLine.substring(eventDataLine.indexOf(':') + 1));
                            break a;
                        } catch (e) {
                        }
                    }
                    parsedData =
                        void 0;
                }
                processResponseDataEvent(parsedData);
                replacedResponse = replacedResponse.substring(nextSeparationPos + 2);
                nextSeparationPos = replacedResponse.indexOf('\n\n');
            }
        }
    };
    xhr.onload = function () {
        if (xhr.status.toString()[0] !== '2') {
            console.error(xhr.status + '> ' + xhr.statusText);
        }

        if (dataLayerEventName && dataLayerVariableName) { // data tag configured to push event
            if (!xhr.responseText.startsWith('event: message\ndata: ')) { // old protocol
                eventDataLayerData = dataTagParseResponse(xhr.responseText);
                eventDataLayerData.status = xhr.status;
                pushToDataLayer();
            } else if (
                !waitForCookies // data tag configured to push event instantly
                || (setCookieRunningCount === 0) // no cookies received or all cookies already set
            ) {
                pushToDataLayer();
            }
        }
    };
    xhr.send(stringifiedData);
}

/**
 * Sends data to the GTM Server Side Container.
 * @param {Object} data - The data to send.
 * @param {string} gtmServerDomain - The GTM server domain.
 * @param {string} requestPath - The request path.
 * @param {string} [dataLayerEventName] - The data layer event name.
 * @param {string} [dataLayerVariableName] - The data layer variable name.
 * @param {boolean} [waitForCookies] - Whether to wait for cookies.
 * @param {boolean} [useFetchInsteadOfXHR] - Whether to use Fetch API instead of XHR.
 * @param {string} consentKey - The key for the target consent value in UC.
 */
function dataTagSendData(data, gtmServerDomain, requestPath, dataLayerEventName, dataLayerVariableName, waitForCookies, useFetchInsteadOfXHR, consentKey) {
    dataLayerEventName = dataLayerEventName || false;
    dataLayerVariableName = dataLayerVariableName || 'data_layer_variable';
    waitForCookies = waitForCookies || false;
    consentKey = consentKey || 'Google Analytics';

    var stringifiedData = JSON.stringify(data);
    var replacements = {transport_url: gtmServerDomain};
    var setCookieRunningCount = 0;
    var okToSend = false;

    var currentDataLayer = (typeof window !== 'undefined' && window.dataLayer) || (typeof dataLayer !== 'undefined' && dataLayer) || [];
    // Do not send anything if they have not consented to a service.
    if (currentDataLayer && currentDataLayer.length > 0) {
        currentDataLayer.forEach(function (layer) {
            if (typeof layer === 'object') {
                Object.keys(layer).forEach(function (key) {
                    if (key === consentKey) {
                        okToSend = layer[key];
                    }
                });
            }
        });
    }

    if (!okToSend) {
        console.warn('User has not consented to Google Analytics');
        return;
    }

    if (useFetchInsteadOfXHR) {
        sendPostRequest(gtmServerDomain, requestPath, stringifiedData, replacements, dataLayerEventName, dataLayerVariableName, waitForCookies, setCookieRunningCount, eventDataLayerData);
    } else {
        sendPostRequestXHR(gtmServerDomain, requestPath, stringifiedData, replacements, dataLayerEventName, dataLayerVariableName, waitForCookies, setCookieRunningCount, eventDataLayerData)
    }
}

/**
 * Retrieves data from the GTM container.
 * @param {string} containerId - The container ID.
 * @returns {Object} The data tag data.
 */
function dataTagGetData(containerId) {
    window.dataTagData = {
        document: {
            characterSet: window.document.characterSet,
        },
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        screen: {
            width: window.screen.width,
            height: window.screen.height,
        },
        dataModel: window.google_tag_manager[containerId].dataLayer.get({
            split: function () {
                return [];
            },
        }),
    };

    return window.dataTagData;
}
