var ucDataLayerName = 'uc_data_layer_variable';
var ucEventData = {};
var ucEventName = 'uc_data_tag_event';

/**
 * Parses the response string to JSON.
 * @param {string} str - The response string.
 * @returns {Object} The parsed JSON object or the original string in a 'body' property.
 */
function ucParseJsonResponse(str) {
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
function ucReplaceTemplateVars(a, b) {
  return a.replace(/\$\{([^\}]+)\}/g, function (c, d) {
    return b[d] || c;
  });
}

/**
 * Sends a tracking pixel request.
 * @param {string} url - The URL to send the request to.
 */
function ucSendImagePixel(url) {
  var img = new Image(1, 1);
  if (url.startsWith(((gtmServerDomain.charAt(gtmServerDomain.length - 1) === '/') ? gtmServerDomain.slice(0, -1) : gtmServerDomain) + '/_set_cookie')) {
    ucPendingCookies++;
    img.onload = img.onerror = function () {
      img.onload = img.onerror = null;
      ucPendingCookies--;
      if ((!xhr || xhr.readyState === 4) // server container must be finished to be sure no more cookies will be received
        && ucEventName && ucDataLayerName // data tag configured to push event
        && waitForCookies // data tag configured to wait for cookies
        && (ucPendingCookies === 0) // all cookies already set
      ) {
        ucPushEventToDataLayer();
      }
    };
  }
  img.src = url;
}

/**
 * Sends a beacon request or falls back to sending a pixel request.
 * @param {string} url - The URL to send the request to.
 */
function ucSendNavigatorBeacon(url) {
  var sendBeaconResult;
  try {
    sendBeaconResult = navigator.sendBeacon && navigator.sendBeacon(url);
  } catch (e) {
  }
  sendBeaconResult || ucSendImagePixel(url);
}

/**
 * Pushes event data to the data layer.
 */
function ucPushEventToDataLayer() {
  window[ucDataLayerName] = window[ucDataLayerName] || [];
  ucEventData.event = ucEventName;
  window[ucDataLayerName].push(ucEventData);
}

/**
 * Processes response data from an event.
 * @param {Object} event - The event containing response data.
 */
function ucHandleResponseEvent(event) {
  if (event) {
    var sendPixelArr = event.send_pixel || [],
      i;
    if (Array.isArray(sendPixelArr)) {
      for (i = 0; i < sendPixelArr.length; i++) {
        ucSendImagePixel(sendPixelArr[i]);
      }
    }

    var sendBeaconArr = event.send_beacon || [];
    if (Array.isArray(sendBeaconArr)) {
      for (i = 0; i < sendBeaconArr.length; i++) {
        ucSendNavigatorBeacon(sendBeaconArr[i]);
      }
    }

    if (typeof event.response === 'object') {
      var status = event.response.status_code || 0,
        body = event.response.body || {},
        parsedBody = ucParseJsonResponse(body);

      // merge parsedBody into ucEventData instead of assignment
      // (just in case multiple responses will be supported by gtm in the future)
      for (var key in parsedBody) {
        if (parsedBody.hasOwnProperty(key)) {
          ucEventData[key] = parsedBody[key];
        }
      }
      ucEventData.status = status;
    }
  }
}

/**
 * Sends a POST request using the Fetch API.
 * @param {string} gtmServerDomain - The GTM server domain.
 * @param {string} requestPath - The request path.
 * @param {string} stringifiedData - The stringified data to send.
 * @param {Object} replacements - The replacements object.
 * @param {string} ucEventName - The data layer event name.
 * @param {string} ucDataLayerName - The data layer variable name.
 * @param {boolean} waitForCookies - Whether to wait for cookies.
 * @param {number} ucPendingCookies - The count of running set cookie operations.
 * @param {Object} ucEventData - The event data layer data.
 */
function ucSendFetchRequest(gtmServerDomain, requestPath, stringifiedData, replacements, ucEventName, ucDataLayerName, waitForCookies, ucPendingCookies, ucEventData) {
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
          responseText = ucReplaceTemplateVars(responseText, replacements);
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
                ucHandleResponseEvent(event);
              } catch (error) {
                console.error('Error processing response data:', error);
              }
            });
        }
        if (ucEventName && ucDataLayerName) { // data tag configured to push event
          if (!responseText || !responseText.startsWith('event: message\ndata: ')) { // old protocol
            ucEventData = ucParseJsonResponse(responseText);
            ucEventData.status = response.status;
            ucPushEventToDataLayer();
          } else if (
            !waitForCookies // data tag configured to push event instantly
            || (ucPendingCookies === 0) // no cookies received or all cookies already set
          ) {
            ucPushEventToDataLayer();
          }
        }
      });
    })
    .catch(function (error) {
      console.error(error);
    });
}

/**
 * Sends data to the GTM Server Side Container.
 * @param {Object} data - The data to send.
 * @param {string} gtmServerDomain - The GTM server domain.
 * @param {string} requestPath - The request path.
 * @param {string} [ucEventName] - The data layer event name.
 * @param {string} [ucDataLayerName] - The data layer variable name.
 * @param {boolean} [waitForCookies] - Whether to wait for cookies.
 * @param {boolean} [alwaysPostData] - Whether to always send data or not.
 * @param {string} consentKey - The key for the target consent value in UC.
 */
function ucTransmitData(data, gtmServerDomain, requestPath, ucEventName, ucDataLayerName, waitForCookies, alwaysPostData, consentKey) {
  ucEventName = ucEventName || false;
  ucDataLayerName = ucDataLayerName || 'data_layer_variable';
  waitForCookies = waitForCookies || false;
  consentKey = consentKey || 'Google Analytics';

  var stringifiedData = JSON.stringify(data);
  var replacements = { transport_url: gtmServerDomain };
  var ucPendingCookies = 0;
  var okToSend = alwaysPostData;
  // We can move on if we always want to send data.
  if (!okToSend) {
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
  }

  if (!okToSend) {
    console.warn('User has not consented to Google Analytics');
    return;
  }

  ucSendFetchRequest(gtmServerDomain, requestPath, stringifiedData, replacements, ucEventName, ucDataLayerName, waitForCookies, ucPendingCookies, ucEventData);
}
