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
- Uses the public-domain OurAirports directory to select the nearest scheduled-service airport inside the radar radius
- Optionally adds cached routes, schedules, status, delays, terminals, and gates for that airport from AirLabs
- Keeps live tracking independent, so missing credentials or a schedule-provider outage cannot stop the radar
- Shows live aircraft count, refresh time, authentication mode, and remaining API credits
- Keeps aircraft visible between updates and removes stale markers after a seven-minute grace period
- Reports a credential-free health summary every five minutes and sends failures to a separate errors-only Debug node
- Uses anonymous access by default, with optional OAuth credentials read from environment variables

## Requirements

- [Node-RED](https://nodered.org/)
- [`node-red-contrib-web-worldmap`](https://flows.nodered.org/node/node-red-contrib-web-worldmap) 5.8.1 or newer
- Outbound HTTPS access to `opensky-network.org` and, when OAuth is enabled, `auth.opensky-network.org`
- Outbound HTTPS access to `www.faa.gov` for the optional daily operator-directory refresh
- Outbound HTTPS access to `davidmegginson.github.io` for the weekly public airport-directory refresh
- Optional outbound HTTPS access to `airlabs.co` for airport schedules

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

## Location-aware airport schedules

The radar is not hardcoded to Miami. It downloads the public-domain [OurAirports data](https://ourairports.com/data/) once per week, keeps only scheduled-service airports with IATA codes, and selects the nearest one inside the current OpenSky radius. A Miami center normally selects a Miami-area airport; Chicago and San Francisco centers make their own selections from the same coordinates.

The radar works without OurAirports or AirLabs. OurAirports needs no API key. When AirLabs enrichment is enabled, the flow downloads one departure board and one arrival board for the selected airport, minimizes the response, and reuses that cache for matching live aircraft. It does **not** make one schedule request per aircraft.

Create or activate an [AirLabs](https://airlabs.co/) account, then provide the key to the Node-RED process through an environment variable:

```text
AIRLABS_API_KEY=replace_with_a_new_private_key
```

Leave `AIRLABS_AIRPORT_IATA` unset for automatic location-aware selection. To deliberately pin a particular airport, add an optional three-character code such as `AIRLABS_AIRPORT_IATA=MIA`.

Never paste an AirLabs key into this JSON, a Function node, GitHub, a Debug message, or a screenshot. Treat any key shared in a chat, issue, or commit as exposed: revoke it and create a replacement before use.

The included free-tier defaults are deliberately conservative:

- The flow checks every 10 minutes but calls AirLabs only when the two-hour guard has elapsed.
- Each refresh uses two requests: one departure board and one arrival board for the selected airport.
- A 120-minute refresh interval is approximately **720 requests per 30-day month**.
- A separate monthly guard stops automatic calls at 900 requests by default, leaving headroom under a stated 1,000-request plan.
- Each direction is limited to 50 schedule records.
- Current schedule data is retained between live five-minute OpenSky polls, while the airport directory refreshes only weekly.
- If AirLabs fails, the last successful schedule may remain visible for up to 12 hours and is clearly marked as cached.
- The cache is held in Node-RED flow context and does not survive a Node-RED restart unless you configure persistent context storage.

AirLabs currently documents a limited free plan, but quotas, available fields, registration access, and terms can change. Confirm the current [AirLabs schedule documentation](https://airlabs.co/docs/schedules) and account limits before shortening the refresh interval.

Only flights connected to the selected airport can receive schedule details. Aircraft merely passing through the radar circle, private aircraft, and flights missing a matching published designator continue to show their OpenSky and FAA information without a guessed schedule. Automatic selection never chooses an airport outside the configured radar radius.

The world-map URL remains `http://<your-node-red-host>:1880/worldmapplanes`; moving the center does not require a new URL or a separate flow.

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

Optional schedule settings can be overridden with `global.openskyScheduleOverride`, `flow.openskyScheduleOverride`, or `msg.scheduleConfig`:

```json
{
  "airportIata": "",
  "refreshMinutes": 120,
  "maxRecords": 50,
  "monthlyRequestCap": 900
}
```

An empty `airportIata` uses the nearest scheduled-service airport inside the current circle. Set a three-character IATA code only when you intentionally want a manual override. Accepted schedule ranges are 15 to 1,440 minutes and 1 to 50 records per direction. Reducing the interval can exceed a free API quota quickly.

The monthly counter is stored in `flow.airlabsRequestUsage` and resets when the UTC month changes. The effective radar settings, airport selection, minimized schedule cache, and safe status metadata are available at `flow.openskyRadarConfig`, `flow.openskyScheduleConfig`, `flow.airlabsScheduleCache`, and `flow.airlabsScheduleMeta`. The minimized public airport list and refresh metadata are in `flow.ourAirportsDirectory` and `flow.ourAirportsMeta`. No API key is stored in those values.

## Visual improvements

The updated flow uses a dark-gray basemap, smaller heading-aware aircraft icons, a dashed search-radius overlay, a persistent radar-center marker, hover tooltips, and a compact status legend. Speed remains in the popup but is no longer sent as a worldmap vector, which removes the long red leader lines that made the original map look crowded.

Aircraft returned in the bounding-box corners are filtered out when they fall outside the selected circular radius. Surface vehicles and fixed obstacles are also excluded.

## Debug output

An empty **Errors only (empty is healthy)** Debug node means no handled failure has occurred. It was intentionally quiet in earlier versions, which could make a working flow look inactive.

The separate **System health (safe, every 5 min)** Debug node now confirms routine activity. It reports the radar center and radius, aircraft count, directory refresh counts, selected airport, schedule-cache status, and monthly AirLabs request count. It never includes OAuth credentials, API keys, authorization headers, or request URLs.

## Troubleshooting

| What you see | Meaning | What to do |
|---|---|---|
| Map loads but has no aircraft | There may be no recent OpenSky positions in the selected circle | Increase the radius moderately and check the Debug sidebar |
| HTTP 401 | The OAuth access token was rejected or expired | The flow clears it and requests a new token on the next poll |
| HTTP 429 | The current API credit bucket is exhausted | Wait for the refill time shown by OpenSky; do not shorten the poll interval |
| OAuth warning, anonymous fallback | One or both environment variables are missing or invalid | Verify both variables outside the flow and restart Node-RED |
| Connection problem dialog | Node-RED could not reach OpenSky | Check DNS, firewall, proxy, and outbound HTTPS from the Node-RED host |
| Map opens at the wrong place | The flow was not redeployed or another override is active | Check the effective `flow.openskyRadarConfig` value |
| Waiting for airport directory | The weekly OurAirports download has not completed yet | Confirm outbound HTTPS access to `davidmegginson.github.io`; cached data is reused when available |
| No scheduled airport in radar radius | No scheduled-service airport with an IATA code is inside the selected circle | Increase the radius moderately or deliberately set `AIRLABS_AIRPORT_IATA` |
| AirLabs disabled • airport selected | Automatic airport selection works, but optional schedule enrichment is not configured | Set a new `AIRLABS_API_KEY` outside the flow and restart Node-RED |
| AirLabs schedule error | The key is inactive, waitlisted, invalid, rate-limited, or the response changed | Check `flow.airlabsScheduleMeta` and the Debug sidebar without exposing the key |
| AirLabs monthly request guard reached | The configured safety cap has been reached | Wait for the next UTC month or deliberately raise `monthlyRequestCap` after checking the account quota |
| AirLabs unavailable • cached schedules active | A refresh failed, but the previous minimized response is still within its 12-hour stale window | Live OpenSky tracking continues; check the provider later |
| Aircraft has no route or schedule | It does not match the selected airport board or a published flight designator | This is expected for pass-through, private, and unmatched flights |

## Data notes

OpenSky provides state vectors derived from ADS-B and related surveillance sources. Callsigns, positions, categories, and metadata can be missing or delayed. The flow does not provide airline schedules, passenger status, delays, or guaranteed aircraft identity.

The live state-vector response does not include an operator-name field. On startup and once every 24 hours, the flow downloads the FAA's official [Aircraft Company/Telephony/Three-Letter Designator Encode](https://www.faa.gov/air_traffic/publications/atpubs/cnt_html/chap3_section_1.html) table and caches it in `flow.faaOperatorDirectory`. The embedded list is used only while that directory is unavailable. The last successful refresh metadata is available at `flow.faaOperatorDirectoryMeta`.

Registration-style callsigns, such as a U.S. `N` number, are labeled **Private / general aviation** because a registration identifies an aircraft, not necessarily its current operator. Custom corrections can be supplied with a `global.openskyOperatorOverrides` object such as `{ "XYZ": "Example Aviation" }`; these always take priority over the FAA and fallback values.

AirLabs schedule information is optional third-party data and may be incomplete, delayed, or unavailable. Scheduled and estimated times shown in the popup are the local times returned for their respective airports. The popup identifies AirLabs as the source and shows the cache age; stale data is never presented as live.

OurAirports provides airport reference data, not operational schedules. AirLabs complements it with optional schedule information; neither provider replaces OpenSky's live state vectors. If either enrichment source fails, OpenSky aircraft tracking continues.

Review OpenSky's [API documentation and terms](https://openskynetwork.github.io/opensky-api/), the FAA source, and the current AirLabs plan terms before using the data beyond a personal or educational project.

## Validation tests

The repository includes dependency-free tests for node wiring, Function-node syntax, OurAirports CSV parsing, Miami/Chicago/San Francisco selection, radius enforcement, disabled-provider behavior, the two-request guard, schedule minimization, secret removal, cache matching, health output, and stale-data expiry:

```bash
npm test
```

The tests use fictional schedule responses and a test-only credential string. They never require or contact AirLabs.

## License

This project is licensed under the [MIT License](LICENSE).
