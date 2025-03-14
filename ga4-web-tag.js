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
 * Sends data to the GTM Server Side Container.
 * @param {Object} data - The data to send.
 * @param {string} gtmServerDomain - The GTM server domain.
 * @param {string} requestPath - The request path.
 * @param {string} [ucEventName] - The data layer event name.
 * @param {string} [ucDataLayerVariableName] - The data layer variable name.
 * @param {boolean} [alwaysPostData] - Whether to always send data or not.
 * @param {string} consentKey - The key for the target consent value in UC.
 */
function ucTransmitData(data, gtmServerDomain, requestPath, ucEventName, ucDataLayerVariableName, alwaysPostData, consentKey) {
  ucEventName = ucEventName || 'page_view_response';
  ucDataLayerVariableName = ucDataLayerVariableName || 'dataLayer';
  consentKey = consentKey || 'Google Analytics';

  // We can move on if we always want to send data.
  var currentDataLayer = (typeof window !== 'undefined' && window.dataLayer) || (typeof dataLayer !== 'undefined' && dataLayer) || [];
  var okToSend = consentKey;
  // Do not send anything if they have not consented to a service.
  if (currentDataLayer.length > 0) {
    currentDataLayer.forEach(function (layer) {
      if (typeof layer === 'object') {
        Object.keys(layer).forEach(function (key) {
          data[key] = layer[key];
          if (key === consentKey) {
            okToSend = layer[key];
          }
        });
      }
    });
  }
  // Get outta here if we don't have consent to send data.
  if (!okToSend) {
    console.warn('User has not consented to Google Analytics');
    return;
  }

  var dataString = JSON.stringify(data);
  var dataReplacements = { transport_url: gtmServerDomain };
  var eventDataLayerData = {};
  var setCookieRunningCount = 0;

  /**
   * Replaces template variables in a string with values from an object.
   * @param {string} a - The template string containing variables in format ${variableName}
   * @param {Object} b - An object containing variable names as keys and their values
   * @returns {string} The string with all template variables replaced with their values
   */
  var ucReplaceTemplateVariables = function (a, b) {
      return a.replace(/\$\{([^\}]+)\}/g, function (c, d) {
        return b[d] || c;
      });
    },
    xhr = null,
    sendPixel = function (url) {
      var img = new Image(1, 1);
      if (url.startsWith(((gtmServerDomain.charAt(gtmServerDomain.length - 1) === '/') ? gtmServerDomain.slice(0, -1) : gtmServerDomain) + '/_set_cookie')) {
        setCookieRunningCount++;
        img.onload = img.onerror = function () {
          img.onload = img.onerror = null;
          setCookieRunningCount--;
          if ((!xhr || xhr.readyState === 4) // server container must be finished to be sure no more cookies will be received
            && ucEventName && ucDataLayerVariableName // data tag configured to push event
            && (setCookieRunningCount === 0) // all cookies already set
          ) {
            ucPushEventToDataLayer();
          }
        };
      }
      img.src = url;
    };

  /**
   * Sends a beacon request to the specified URL using Navigator.sendBeacon API if available,
   * falling back to image pixel if sendBeacon fails or is not supported.
   * @param {string} url - The URL to send the beacon request to.
   */
  var ucSendBeaconRequest = function (url) {
    var sendBeaconResult;
    try {
      sendBeaconResult = navigator.sendBeacon && navigator.sendBeacon(url);
    } catch (e) {}
    sendBeaconResult || sendPixel(url);
  };

  /**
   * Pushes the collected event data to the specified data layer.
   * Adds the event name to the event data and ensures the data layer exists.
   */
  var ucPushEventToDataLayer = function () {
    window[ucDataLayerVariableName] = window[ucDataLayerVariableName] || [];
    eventDataLayerData.event = ucEventName;
    window[ucDataLayerVariableName].push(eventDataLayerData);
  };

  /**
   * Processes event data from GTM server responses, handling pixels, beacons, and response data.
   * @param {Object} event - The event object containing instructions from the GTM server
   * @param {Array} [event.send_pixel] - Array of URLs to load as image pixels
   * @param {Array} [event.send_beacon] - Array of URLs to send as beacon requests
   * @param {Object} [event.response] - Response data to be added to the data layer
   * @param {number} [event.response.status_code] - HTTP status code
   * @param {string|Object} [event.response.body] - Response body content
   */
  var ucProcessResponseEvent = function (event) {
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
          ucSendBeaconRequest(sendBeaconArr[i]);
        }
      }

      if (typeof event.response === 'object') {
        var status = event.response.status_code || 0,
          body = event.response.body || {},
          parsedBody = ucParseJsonResponse(body);

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
  };

  // Post the data.
  // Make a POST request to the GTM server
  fetch(gtmServerDomain + requestPath, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
    },
    credentials: 'include',    // Include cookies in the request for cross-domain requests
    keepalive: true,           // Ensure request completes even if page unloads
    body: dataString,
  })
    .then(function (response) {
      // Process the response text when it's available
      response.text().then(function (responseText) {
        // Replace any template variables in the response with actual values
        if (responseText) {
          responseText = ucReplaceTemplateVariables(responseText, dataReplacements);
        }

        // Handle Server-Side GTM event stream format responses
        if (responseText && responseText.startsWith('event: message\ndata: ')) {
          // Split response into individual events (separated by double newlines)
          responseText
            .split('\n\n')
            .filter(function (eventString) {
              return eventString;  // Filter out empty strings
            })
            .forEach(function (eventString) {
              try {
                // Parse each event by removing the event prefix and converting to JSON
                const event = JSON.parse(eventString.replace('event: message\ndata: ', ''));
                // Process the event data (set cookies, send pixels, etc.)
                ucProcessResponseEvent(event);
              } catch (error) {
                console.error('Error processing response data:', error);
              }
            });
        }

        // Push data to dataLayer if configured to do so
        if (ucEventName && ucDataLayerVariableName) { // data tag configured to push event
          if (!responseText || !responseText.startsWith('event: message\ndata: ')) {
            // Handle legacy/non-event-stream responses
            eventDataLayerData = ucParseJsonResponse(responseText);
            eventDataLayerData.status = response.status;
            ucPushEventToDataLayer();
          } else if (
            setCookieRunningCount === 0  // Only push to dataLayer once all cookies are set
          ) {
            ucPushEventToDataLayer();
          }
        }
      });
    })
    .catch(function (error) {
      // Log any network errors that occur during the request
      console.error(error);
    });
}
