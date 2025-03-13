# web-data-tag

A lightweight JavaScript library for securely sending data to Google Tag Manager (GTM) servers while respecting user consent preferences.

## Features

- User consent verification before sending any analytics data
- Support for both modern browsers (fetch API) and legacy browsers (XMLHttpRequest)
- Data layer integration for GTM compatibility
- Multiple data transmission methods (POST requests, pixels, beacons)
- Cookie handling with proper sequencing
- Small footprint with minified version available

## Installation

Include the script in your HTML:

```html
<!-- Full version -->
<script src="ga4-web-tag.js"></script>

<!-- OR minified version -->
<script src="ga4-web-tag.min.js"></script>
```

## Usage

### Basic Example

```javascript
// Get data from GTM container
const data = dataTagGetData('GTM-XXXXXX');

// Send data to GTM server
dataTagSendData(
  data,                         // Data to send
  'https://gtm-server.example.com', // GTM server domain
  '/collect',                   // Request path
  true,                         // Enable data layer event
  'myDataLayerVariable',        // Data layer variable name
  false,                        // Wait for cookies
  true,                         // Use fetch instead of XHR
  'Google Analytics'            // Consent key
);
```

### API Reference

#### dataTagGetData(containerId)

Retrieves data from the GTM container.

- **containerId**: (string) The GTM container ID
- **Returns**: (Object) Data object containing document, screen, and data model information

#### dataTagSendData(data, gtmServerDomain, requestPath, dataLayerEventName, dataLayerVariableName, waitForCookies, useFetchInsteadOfXHR, consentKey)

Sends data to the GTM server if user consent has been granted.

- **data**: (Object) The data to send
- **gtmServerDomain**: (string) The GTM server domain
- **requestPath**: (string) The request path
- **dataLayerEventName**: (boolean|string) Enable/set data layer event name
- **dataLayerVariableName**: (string) Data layer variable name
- **waitForCookies**: (boolean) Whether to wait for cookies to be set
- **useFetchInsteadOfXHR**: (boolean) Whether to use fetch API instead of XHR
- **consentKey**: (string) The key used to check user consent in the data layer

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Legacy browsers with XMLHttpRequest support
