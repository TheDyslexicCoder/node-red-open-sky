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

### Changing the OpenSky polling interval in Node-RED

The default is five minutes. To change it entirely in the Node-RED editor:

1. Double-click the **OpenSky Nearby Planes Radar** flow tab.
2. Open **Environment Variables**, click **Add**, name it `OPENSKY_POLL_SECONDS`, and enter the desired number of seconds (`300` is the default when it is absent).
3. Double-click the **Poll every 5 min (anonymous-safe default)** Inject node.
4. Set **Repeat → interval** to the same value, click **Done**, optionally rename the node, and **Deploy**.

Use the same value in both places. `OPENSKY_POLL_SECONDS` keeps marker expiry and health information aligned with the Inject schedule; the Inject node controls how often the HTTP request actually starts.

For the included 150 km Miami bounding box, each poll normally costs one `/states/all` credit:

| Interval | Polls per day | Practical OpenSky tier |
|---|---:|---|
| 5 minutes | 288 | Anonymous-safe under the documented 400-credit daily allowance |
| 1 minute | 1,440 | Requires an authenticated Standard account or higher |
| 20 seconds | 4,320 | Exceeds Standard's 4,000 daily credits; use an eligible higher tier or your own receiver data |

Anonymous state vectors have 10-second time resolution and authenticated state vectors have 5-second resolution. Twenty-second polling can therefore return newer positions, but it is not sustainable on the Anonymous or Standard daily allowance. A `429 Too Many Requests` response means the current bucket is exhausted; restore a slower interval and wait for the provider's retry window.

### Optional OAuth mode

For a larger allowance, create an API client in your OpenSky account. To configure it entirely in Node-RED, double-click the **OpenSky Nearby Planes Radar** flow tab, open **Environment Variables**, and add both of these private values:

```text
OPENSKY_CLIENT_ID=replace_with_your_client_id
OPENSKY_CLIENT_SECRET=replace_with_your_client_secret
```

Click **Done** and **Deploy**. The next poll should change `radar.authMode` from `Anonymous` to `Authenticated`. The health Debug also reports `creditsRemaining` from OpenSky's live `X-Rate-Limit-Remaining` response header, the estimated cost per poll, and the configured polling interval.

Operating-system, service, and Docker environment variables remain supported for share-safe deployments. The flow automatically:

1. Requests an OAuth2 client-credentials token.
2. Caches the short-lived access token in flow context.
3. Refreshes it shortly before expiration.
4. Falls back to anonymous access if optional authentication fails.

Do **not** paste a client secret into a Function node, Git commit, Debug node, or public screenshot. Flow-level Environment Variables are convenient on a private Node-RED installation, but clear their private values before exporting or publishing the flow.

OpenSky no longer accepts basic username/password authentication. OAuth2 client credentials are the supported authenticated method; see the official [authentication instructions](https://openskynetwork.github.io/opensky-api/rest.html#authentication).

## Location-aware airport schedules

The radar is not hardcoded to Miami. It downloads the public-domain [OurAirports data](https://ourairports.com/data/) once per week, keeps only scheduled-service airports with IATA codes, and selects the nearest one inside the current OpenSky radius. A Miami center normally selects a Miami-area airport; Chicago and San Francisco centers make their own selections from the same coordinates.

The radar works without OurAirports or AirLabs. OurAirports needs no API key. When AirLabs enrichment is enabled, the flow downloads one departure board and one arrival board for the selected airport, minimizes the response, and reuses that cache for matching live aircraft. It does **not** make one schedule request per aircraft.

The integration is intentionally limited to the parts of AirLabs used by this flow: the current v9 authentication, endpoint, field-selection, Schedules response, pagination/limit, and common-error documentation. Other AirLabs endpoints—Real-Time Flights, Flight Information, Routes, Delays, and Alerts—are not called. OpenSky remains the source for live positions.

Create or activate an [AirLabs](https://airlabs.co/) account. The simplest Raspberry Pi/Node-RED setup requires no terminal:

1. In the Node-RED editor, double-click the **OpenSky Nearby Planes Radar** flow tab at the top of the workspace.
2. Open the **Environment Variables** section and click **Add**.
3. Enter `AIRLABS_API_KEY` as the name and paste the private key into its value field.
4. Do not add `AIRLABS_AIRPORT_IATA` for automatic airport selection. To pin one airport, add it as a second variable with a three-character IATA value.
5. Click **Done**, then **Deploy**.
6. Click the Inject button beside **Check whether selected airport needs refresh**.
7. Open **AirLabs status (safe, every 5 min)** in the Debug sidebar. A working configuration shows `enabled: true`, a selected airport, schedule records, and `monthlyRequestsUsed: 2` after the first two responses complete.

The Function node named **Prepare safe schedule requests** should retain this line—users do not need to edit the function:

```javascript
const apiKey = env.get("AIRLABS_API_KEY");
```

For deployments managed outside the Node-RED editor, the same variable can instead be supplied to the Node-RED process:

```text
AIRLABS_API_KEY=replace_with_a_new_private_key
```

Leave `AIRLABS_AIRPORT_IATA` unset for automatic location-aware selection. To deliberately pin a particular airport, add an optional three-character code such as `AIRLABS_AIRPORT_IATA=MIA`.

Never hard-code an AirLabs key in a Function node, GitHub, a Debug message, or a screenshot. A flow-level Environment Variable is convenient on a private Node-RED installation, but its value can be included when the flow is exported. Clear the value before exporting or publishing the JSON. Treat any key shared in a chat, issue, or commit as exposed: revoke it and create a replacement before use.

The included free-tier defaults are deliberately conservative:

- The flow checks every 10 minutes but calls AirLabs only when the two-hour guard has elapsed.
- Each refresh uses two requests: one departure board and one arrival board for the selected airport.
- A 120-minute refresh interval is approximately **720 requests per 30-day month**.
- A separate monthly guard stops automatic calls at 900 requests by default, leaving headroom under a stated 1,000-request plan.
- Each direction is limited to 50 schedule records.
- Current schedule data is retained between live five-minute OpenSky polls, while the airport directory refreshes only weekly.
- If AirLabs fails, the last successful schedule may remain visible for up to 6 hours and is clearly marked as cached.
- The cache is held in Node-RED flow context and does not survive a Node-RED restart unless you configure persistent context storage.

AirLabs documents a maximum 50 records per free-key schedule request and a schedule horizon of up to 10 hours. A busy airport can therefore have more flights than this flow caches. Core free-plan fields include flight number, origin, destination, and scheduled times; gates, terminals, estimates, actual times, delays, status, ICAO fields, and codeshares can be missing or plan-dependent. The popup omits unavailable values instead of inventing them. Confirm the current [AirLabs introduction and error documentation](https://airlabs.co/docs/) and [Schedules documentation](https://airlabs.co/docs/schedules), plus the limits shown in your account dashboard, before changing the refresh interval or monthly guard.

Only flights connected to the selected airport can receive schedule details. Aircraft merely passing through the radar circle, private aircraft, and flights missing a matching published designator continue to show their OpenSky and FAA information without a guessed schedule. Automatic selection never chooses an airport outside the configured radar radius.

The world-map URL remains `http://<your-node-red-host>:1880/worldmapplanes`; moving the center does not require a new URL or a separate flow.

### Why five-minute positions and two-hour schedules work together

The two clocks serve different data:

1. **Every five minutes, OpenSky is queried for current aircraft positions.** Only aircraft still inside the exact circle become map markers.
2. **Every two hours, AirLabs refreshes the selected airport's timetable.** The two responses can contain up to 50 departures and 50 arrivals, extending up to 10 hours ahead.
3. **On every OpenSky update, each current marker is matched against the cached timetable.** The resolver tries the broadcast ICAO callsign, its known IATA equivalent, and documented AirLabs codeshare flight numbers.
4. **The schedule cache never creates or preserves an aircraft marker.** If a plane leaves the circle, it is absent from the next OpenSky result and its marker expires after the normal seven-minute grace period. Its unused timetable row may remain cached for another aircraft or update.

This saves requests, but it is not universal route coverage. A flight using the selected airport may receive a route and schedule. An overflight or a flight using another nearby airport usually will not. Covering every visible aircraft would require more airport boards or per-flight/route calls and a larger API budget.

### First-deployment verification

With `AIRLABS_API_KEY` entered in the flow's **Environment Variables**, deploy the flow and click **Check whether selected airport needs refresh**. The startup OurAirports download can also trigger the first AirLabs refresh after the directory is ready; it does not wait for the ten-minute schedule tick.

To verify the active key and current account entitlement before deploying, run the opt-in smoke test from this repository:

```bash
AIRLABS_TEST_AIRPORT=MIA npm run test:airlabs
```

Set `AIRLABS_API_KEY` in the terminal environment first; do not paste the key into the command, repository, or script. The smoke test uses exactly two AirLabs requests—one departure and one arrival request with `limit=1`—and prints only the airport, counts, and returned field names. It never prints the key or request URL.

In the **System health (safe, every 5 min)** Debug output, confirm:

- `airports.selectedIata` is the expected airport and `distanceKm` is within the radius.
- `schedules.enabled` and `schedules.ready` are `true`.
- `schedules.updatedAt` is populated and `monthlyRequestsUsed` begins at `2`.
- `schedules.records` is greater than zero for an active major-airport board.

The general health message appears automatically after startup and every five minutes. You can also click the **Report safe health every 5 min** Inject node to check immediately. The dedicated **AirLabs status (safe, every 5 min)** Debug stream shows only the selected airport, cache state, request count, quota guard, and sanitized errors. If AirLabs rejects the request, **Errors only (empty is healthy)** reports a sanitized code such as `unknown_api_key`, `wrong_params`, or `month_limit_exceeded`; none of these outputs prints the key or request URL.

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

The separate **System health (safe, every 5 min)** Debug node now confirms routine activity. It reports the radar center and radius, aircraft count, OpenSky authentication mode, live credits remaining, estimated cost per poll, polling interval, directory refresh counts, selected airport, schedule-cache status, and monthly AirLabs request count. It never includes OAuth credentials, API keys, authorization headers, or request URLs.

The dedicated **AirLabs status (safe, every 5 min)** Debug node isolates schedule diagnostics: whether AirLabs is enabled, the selected airport, cached record and match-key counts, cache age, refresh interval, monthly usage, quota guard, and sanitized error information. Click **Report safe AirLabs status every 5 min** to request this report immediately.

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
| AirLabs disabled • airport selected | Automatic airport selection works, but the Function node cannot read the key | Double-click the flow tab, enter `AIRLABS_API_KEY` under Environment Variables, click Done and Deploy, then click the schedule-refresh Inject node |
| AirLabs schedule error | The key is inactive, expired, invalid, rate-limited, the parameters were rejected, or the response changed | Check the sanitized `lastErrorCode` in `flow.airlabsScheduleMeta` and the errors-only Debug node |
| AirLabs monthly request guard reached | The configured safety cap has been reached | Wait for the next UTC month or deliberately raise `monthlyRequestCap` after checking the account quota |
| AirLabs unavailable • cached schedules active | A refresh failed, but the previous minimized response is still within its 6-hour stale window | Live OpenSky tracking continues; check the provider later |
| Aircraft has no route or schedule | It does not match the selected airport board or a published flight designator | This is expected for pass-through, private, and unmatched flights |

## Data notes

OpenSky provides state vectors derived from ADS-B and related surveillance sources. Callsigns, positions, categories, and metadata can be missing or delayed. The flow does not provide airline schedules, passenger status, delays, or guaranteed aircraft identity.

The live state-vector response does not include an operator-name field. On startup and once every 24 hours, the flow downloads the FAA's official [Aircraft Company/Telephony/Three-Letter Designator Encode](https://www.faa.gov/air_traffic/publications/atpubs/cnt_html/chap3_section_1.html) table and caches it in `flow.faaOperatorDirectory`. The embedded list is used only while that directory is unavailable. The last successful refresh metadata is available at `flow.faaOperatorDirectoryMeta`.

Registration-style callsigns, such as a U.S. `N` number, are labeled **Private / general aviation** because a registration identifies an aircraft, not necessarily its current operator. Custom corrections can be supplied with a `global.openskyOperatorOverrides` object such as `{ "XYZ": "Example Aviation" }`; these always take priority over the FAA and fallback values.

AirLabs schedule information is optional third-party data and may be incomplete, delayed, or unavailable. Scheduled and estimated times shown in the popup are the local times returned for their respective airports. The popup identifies AirLabs as the source and shows the cache age; stale data is never presented as live.

OurAirports provides airport reference data, not operational schedules. AirLabs complements it with optional schedule information; neither provider replaces OpenSky's live state vectors. If either enrichment source fails, OpenSky aircraft tracking continues.

Review OpenSky's [API documentation and terms](https://openskynetwork.github.io/opensky-api/), the FAA source, and the current AirLabs plan terms before using the data beyond a personal or educational project.

## Validation tests

The repository includes dependency-free tests for node wiring, Function-node syntax, OurAirports CSV parsing, Miami/Chicago/San Francisco selection, radius enforcement, disabled-provider behavior, the two-request guard, documented AirLabs request fields and error codes, direct and wrapped response shapes, codeshare matching, correct departure/arrival gates, schedule minimization, secret removal, aircraft-marker expiry, health output, and stale-data expiry:

```bash
npm test
```

The tests use fictional schedule responses and a test-only credential string. They never require or contact AirLabs.

`npm run test:airlabs` is separate and opt-in because it contacts AirLabs and consumes two real requests. It requires `AIRLABS_API_KEY` in the environment.

## License

This project is licensed under the [MIT License](LICENSE).
