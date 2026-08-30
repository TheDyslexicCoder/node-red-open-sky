# Node-RED OpenSky Live Air Traffic Radar

A ready-to-import Node-RED flow that plots nearby aircraft from the OpenSky Network on an interactive world map.

![OpenSky radar showing live Miami-area aircraft](screenshots/worldmap-live-miami-air-traffic.png)

## What it does

- Shows live aircraft inside a configurable circular search area
- Rotates aircraft icons to their reported direction of travel
- Groups airborne aircraft, rotorcraft, ground traffic, and radar coverage into separate layers
- Displays a cleaner flight card with operator, altitude, speed, distance, category, and last-contact age
- Refreshes the official FAA company, telephony, and ICAO three-letter-designator directory once per day
- Keeps an embedded operator list available if the FAA directory cannot be reached or parsed
- Shows live aircraft count, refresh time, authentication mode, and remaining API credits
- Keeps aircraft visible between updates and removes stale markers after a seven-minute grace period
- Reports API, authentication, rate-limit, and network failures on the map and in Node-RED's Debug sidebar
- Uses anonymous access by default, with optional OAuth credentials read from environment variables

## Requirements

- [Node-RED](https://nodered.org/)
- [`node-red-contrib-web-worldmap`](https://flows.nodered.org/node/node-red-contrib-web-worldmap) 5.8.1 or newer
- Outbound HTTPS access to `opensky-network.org` and, when OAuth is enabled, `auth.opensky-network.org`
- Outbound HTTPS access to `www.faa.gov` for the optional daily operator-directory refresh

The flow export declares the required worldmap package, but you can also install it from **Menu → Manage palette → Install**.

## Quick start

1. Download [`OpenSky-Planes-WorldMap.json`](OpenSky-Planes-WorldMap.json).
2. In Node-RED, choose **Menu → Import → Clipboard** and import the file.
3. Open **Prepare location, auth & request** and edit the three defaults at the top:

   ```js
   const defaultCenterLat = 25.7617;
   const defaultCenterLon = -80.1918;
   const defaultRadiusKm = 150;
   ```

4. Deploy the flow.
5. Open `http://<your-node-red-host>:1880/worldmapplanes`.

The map automatically fits the selected radar area whenever a viewer connects.

## API access and safe credential handling

### Anonymous mode — default

No API key is required for the included setup. OpenSky currently allows anonymous requests to `/api/states/all`, subject to a smaller daily credit allowance. The flow therefore polls every **5 minutes** instead of every 30 seconds.

At the included Miami location and 150 km radius, the bounding box is under 25 square degrees and normally costs one API credit per update. Larger areas can cost more. See OpenSky's current [REST API limits and credit rules](https://openskynetwork.github.io/opensky-api/rest.html#limitations) before increasing the radius or polling frequency.

### Optional OAuth mode

For a larger allowance, create an API client in your OpenSky account and provide both credentials to the Node-RED process as operating-system, service, or Docker environment variables:

```text
OPENSKY_CLIENT_ID=replace_with_your_client_id
OPENSKY_CLIENT_SECRET=replace_with_your_client_secret
```

Restart Node-RED after setting them. The flow automatically:

1. Requests an OAuth2 client-credentials token.
2. Caches the short-lived access token in flow context.
3. Refreshes it shortly before expiration.
4. Falls back to anonymous access if optional authentication fails.

Do **not** paste a client secret into the function node, the exported JSON, a Git commit, a Debug node, or a public screenshot. This repository contains no real credential or placeholder that could be mistaken for one.

OpenSky no longer accepts basic username/password authentication. OAuth2 client credentials are the supported authenticated method; see the official [authentication instructions](https://openskynetwork.github.io/opensky-api/rest.html#authentication).

## Runtime overrides

For automation, set either `flow.openskyRadarOverride`, `global.openskyRadarOverride`, `msg.config`, or direct message properties:

```json
{
  "centerLat": 40.7128,
  "centerLon": -74.006,
  "radiusKm": 150
}
```

Message values have the highest priority. Accepted ranges are:

- Latitude: `-90` to `90`
- Longitude: `-180` to `180`
- Radius: `1` to `500` km

The final validated values are available at `flow.openskyRadarConfig`. Keeping overrides separate from the effective config means changing the three defaults still works after redeploying.

## Visual improvements

The updated flow uses a dark-gray basemap, smaller heading-aware aircraft icons, a dashed search-radius overlay, a persistent radar-center marker, hover tooltips, and a compact status legend. Speed remains in the popup but is no longer sent as a worldmap vector, which removes the long red leader lines that made the original map look crowded.

Aircraft returned in the bounding-box corners are filtered out when they fall outside the selected circular radius. Surface vehicles and fixed obstacles are also excluded.

## Troubleshooting

| What you see | Meaning | What to do |
|---|---|---|
| Map loads but has no aircraft | There may be no recent OpenSky positions in the selected circle | Increase the radius moderately and check the Debug sidebar |
| HTTP 401 | The OAuth access token was rejected or expired | The flow clears it and requests a new token on the next poll |
| HTTP 429 | The current API credit bucket is exhausted | Wait for the refill time shown by OpenSky; do not shorten the poll interval |
| OAuth warning, anonymous fallback | One or both environment variables are missing or invalid | Verify both variables outside the flow and restart Node-RED |
| Connection problem dialog | Node-RED could not reach OpenSky | Check DNS, firewall, proxy, and outbound HTTPS from the Node-RED host |
| Map opens at the wrong place | The flow was not redeployed or another override is active | Check the effective `flow.openskyRadarConfig` value |

## Data notes

OpenSky provides state vectors derived from ADS-B and related surveillance sources. Callsigns, positions, categories, and metadata can be missing or delayed. The flow does not provide airline schedules, passenger status, delays, or guaranteed aircraft identity.

The live state-vector response does not include an operator-name field. On startup and once every 24 hours, the flow downloads the FAA's official [Aircraft Company/Telephony/Three-Letter Designator Encode](https://www.faa.gov/air_traffic/publications/atpubs/cnt_html/chap3_section_1.html) table and caches it in `flow.faaOperatorDirectory`. The embedded list is used only while that directory is unavailable. The last successful refresh metadata is available at `flow.faaOperatorDirectoryMeta`.

Registration-style callsigns, such as a U.S. `N` number, are labeled **Private / general aviation** because a registration identifies an aircraft, not necessarily its current operator. Custom corrections can be supplied with a `global.openskyOperatorOverrides` object such as `{ "XYZ": "Example Aviation" }`; these always take priority over the FAA and fallback values.

Review OpenSky's [API documentation and terms](https://openskynetwork.github.io/opensky-api/) and the FAA source before using the data beyond a personal or educational project.

## License

This project is licensed under the [MIT License](LICENSE).
