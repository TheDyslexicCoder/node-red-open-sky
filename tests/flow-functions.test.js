const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const flowPath = path.join(__dirname, "..", "OpenSky-Planes-WorldMap.json");
const flowDefinition = JSON.parse(fs.readFileSync(flowPath, "utf8"));
const airlabsSmokeTestPath = path.join(__dirname, "..", "scripts", "airlabs-smoke.js");

function extractRequestedFields(source) {
    const match = source.match(/const fields = \[([\s\S]*?)\]\.join\(","\);/);
    assert.ok(match, "missing AirLabs fields list");
    return Array.from(match[1].matchAll(/"([a-z_]+)"/g), item => item[1]);
}

function store(initial = {}) {
    const values = { ...initial };
    return {
        get(key) { return values[key]; },
        set(key, value) { values[key] = value; },
        values
    };
}

function findFunction(id) {
    const node = flowDefinition.find(item => item.id === id);
    assert.ok(node, `Missing function node ${id}`);
    return new Function("msg", "node", "flow", "global", "env", "context", node.func);
}

function runtime(options = {}) {
    const status = [];
    const warnings = [];
    const errors = [];
    return {
        msg: options.msg || {},
        node: {
            status(value) { status.push(value); },
            warn(value) { warnings.push(value); },
            error(value) { errors.push(value); }
        },
        flow: options.flow || store(),
        global: options.global || store(),
        env: { get(key) { return (options.env || {})[key]; } },
        context: options.context || store(),
        status,
        warnings,
        errors
    };
}

function execute(id, rt) {
    return findFunction(id)(rt.msg, rt.node, rt.flow, rt.global, rt.env, rt.context);
}

test("flow is structurally complete and every Function node compiles", () => {
    const ids = new Set(flowDefinition.map(node => node.id));
    assert.equal(ids.size, flowDefinition.length);
    for (const node of flowDefinition) {
        for (const output of node.wires || []) {
            for (const target of output) assert.ok(ids.has(target), `${node.id} references missing ${target}`);
        }
        if (node.type === "function") {
            assert.doesNotThrow(() => new Function("msg", "node", "flow", "global", "env", "context", node.func));
        }
    }
    const smokeSource = fs.readFileSync(airlabsSmokeTestPath, "utf8");
    assert.doesNotThrow(() => new Function(smokeSource));
    assert.match(smokeSource, /const retainedLimit = 50;/);
    assert.match(smokeSource, /providerRows/);
    assert.match(smokeSource, /retainedRows/);
    const prepareSource = flowDefinition.find(node => node.id === "airlabs-prepare-requests").func;
    assert.deepEqual(extractRequestedFields(smokeSource), extractRequestedFields(prepareSource));
});

const airportDirectory = [
    { iata: "MIA", ident: "KMIA", name: "Miami International Airport", municipality: "Miami", lat: 25.7959, lon: -80.2870 },
    { iata: "MDW", ident: "KMDW", name: "Chicago Midway International Airport", municipality: "Chicago", lat: 41.7868, lon: -87.7522 },
    { iata: "ORD", ident: "KORD", name: "Chicago O'Hare International Airport", municipality: "Chicago", lat: 41.9742, lon: -87.9073 },
    { iata: "SFO", ident: "KSFO", name: "San Francisco International Airport", municipality: "San Francisco", lat: 37.6213, lon: -122.3790 },
    { iata: "DEN", ident: "KDEN", name: "Denver International Airport", municipality: "Denver", lat: 39.8561, lon: -104.6737 }
];

test("OurAirports CSV is parsed, minimized, and cached", () => {
    const header = "ident,type,name,latitude_deg,longitude_deg,municipality,scheduled_service,iata_code";
    const rows = [
        'KMIA,large_airport,"Miami, International ""Test"" Airport",25.7959,-80.2870,Miami,yes,MIA'
    ];
    for (let index = 0; index < 1100; index++) {
        const code = index.toString(36).toUpperCase().padStart(3, "0");
        rows.push(`K${code},medium_airport,"Scheduled Airport ${index} ${"x".repeat(75)}",10.${index},-70.${index},City,yes,${code}`);
    }
    rows.push("KZZZ,small_airport,No scheduled service,20,-80,City,no,ZZZ");
    const rt = runtime({ msg: { statusCode: 200, payload: [header, ...rows].join("\n") } });
    const result = execute("ourairports-cache", rt);
    assert.ok(Array.isArray(result));
    assert.equal(result[1], null);
    assert.ok(rt.flow.values.ourAirportsDirectory.length > 1000);
    assert.equal(rt.flow.values.ourAirportsDirectory.find(airport => airport.iata === "MIA").name, 'Miami, International "Test" Airport');
    assert.equal(rt.flow.values.ourAirportsDirectory.some(airport => airport.iata === "ZZZ"), false);
    assert.equal(rt.flow.values.ourAirportsMeta.count, rt.flow.values.ourAirportsDirectory.length);
});

test("AirLabs enrichment selects Miami from the radar center and stays disabled without a key", () => {
    const rt = runtime({ flow: store({
        openskyRadarConfig: { centerLat: 25.7617, centerLon: -80.1918, radiusKm: 150 },
        ourAirportsDirectory: airportDirectory
    }) });
    const result = execute("airlabs-prepare-requests", rt);
    assert.equal(result, null);
    assert.equal(rt.flow.values.airlabsScheduleMeta.enabled, false);
    assert.equal(rt.flow.values.openskyScheduleConfig.airportIata, "MIA");
    assert.equal(rt.flow.values.openskyScheduleConfig.selectionMode, "nearest-in-radius");
    assert.ok(rt.flow.values.openskyScheduleConfig.airportDistanceKm < 150);
    assert.equal(rt.flow.values.openskyScheduleConfig.estimatedMonthlyRequests, 720);
    assert.equal(rt.flow.values.openskyScheduleConfig.monthlyRequestCap, 900);
});

test("AirLabs request preparation follows Chicago and creates only two guarded requests", () => {
    const rt = runtime({
        flow: store({
            openskyRadarConfig: { centerLat: 41.8781, centerLon: -87.6298, radiusKm: 150 },
            ourAirportsDirectory: airportDirectory
        }),
        env: { AIRLABS_API_KEY: "test-only-key" }
    });
    const result = execute("airlabs-prepare-requests", rt);
    assert.equal(result.length, 1);
    assert.equal(result[0].length, 2);
    assert.deepEqual(result[0].map(message => message._airlabsDirection), ["departures", "arrivals"]);
    assert.match(result[0][0].url, /dep_iata=MDW/);
    assert.match(result[0][1].url, /arr_iata=MDW/);
    assert.ok(result[0].every(message => message.url.includes("test-only-key")));
    const requestUrl = new URL(result[0][0].url);
    assert.equal(requestUrl.pathname, "/api/v9/schedules");
    assert.equal(requestUrl.searchParams.get("limit"), "50");
    const requestedFields = new Set(requestUrl.searchParams.get("_fields").split(","));
    for (const documentedField of [
        "flight_iata", "flight_icao", "cs_airline_iata", "cs_flight_iata", "cs_flight_number",
        "dep_iata", "dep_time", "dep_delayed", "arr_iata", "arr_time", "arr_delayed", "status"
    ]) assert.ok(requestedFields.has(documentedField), `missing documented field ${documentedField}`);
    assert.equal(requestedFields.has("cs_flight_icao"), false);
    assert.equal(requestedFields.has("updated"), false);
    assert.equal(rt.flow.values.airlabsRequestUsage.count, 2);

    const second = execute("airlabs-prepare-requests", rt);
    assert.equal(second, null, "request guard should prevent another immediate API call");
});

test("automatic airport selection follows San Francisco and respects the radius", () => {
    const sf = runtime({
        flow: store({
            openskyRadarConfig: { centerLat: 37.7749, centerLon: -122.4194, radiusKm: 150 },
            ourAirportsDirectory: airportDirectory
        }),
        env: { AIRLABS_API_KEY: "test-only-key" }
    });
    const selected = execute("airlabs-prepare-requests", sf);
    assert.match(selected[0][0].url, /dep_iata=SFO/);

    const noAirport = runtime({
        flow: store({
            openskyRadarConfig: { centerLat: 0, centerLon: 0, radiusKm: 25 },
            ourAirportsDirectory: airportDirectory
        }),
        env: { AIRLABS_API_KEY: "test-only-key" }
    });
    assert.equal(execute("airlabs-prepare-requests", noAirport), null);
    assert.equal(noAirport.flow.values.openskyScheduleConfig.airportIata, "");
    assert.match(noAirport.flow.values.airlabsScheduleMeta.message, /inside the radar radius/);
});

test("a deliberate IATA override works without the public airport directory", () => {
    const rt = runtime({ env: { AIRLABS_API_KEY: "test-only-key", AIRLABS_AIRPORT_IATA: "MIA" } });
    const result = execute("airlabs-prepare-requests", rt);
    assert.match(result[0][0].url, /dep_iata=MIA/);
    assert.equal(rt.flow.values.openskyScheduleConfig.selectionMode, "manual");
});

test("moving the radar clears schedules cached for the previous airport", () => {
    const sharedFlow = store({
        openskyRadarConfig: { centerLat: 37.7749, centerLon: -122.4194, radiusKm: 150 },
        ourAirportsDirectory: airportDirectory,
        airlabsLastAirportIata: "MIA",
        airlabsLastRequestAt: Date.now(),
        airlabsScheduleCache: {
            airportIata: "MIA",
            byFlight: { AAL123: { originIata: "MIA", destinationIata: "JFK" } },
            staleUntil: Date.now() + 60_000
        }
    });
    const rt = runtime({ flow: sharedFlow });
    assert.equal(execute("airlabs-prepare-requests", rt), null);
    assert.equal(sharedFlow.values.openskyScheduleConfig.airportIata, "SFO");
    assert.deepEqual(sharedFlow.values.airlabsScheduleCache, {});
    assert.equal(sharedFlow.values.airlabsLastRequestAt, 0);
});

test("AirLabs monthly request guard stops calls before the configured cap is exceeded", () => {
    const month = new Date().toISOString().slice(0, 7);
    const sharedFlow = store({ airlabsRequestUsage: { month, count: 900 } });
    const rt = runtime({ flow: sharedFlow, env: { AIRLABS_API_KEY: "test-only-key", AIRLABS_AIRPORT_IATA: "MIA" } });
    const result = execute("airlabs-prepare-requests", rt);
    assert.equal(result, null);
    assert.equal(sharedFlow.values.airlabsRequestUsage.count, 900);
    assert.equal(sharedFlow.values.airlabsScheduleMeta.quotaGuardActive, true);
});

test("AirLabs responses are minimized, indexed, and stripped of request secrets", () => {
    const sharedFlow = store({
        openskyScheduleConfig: { airportIata: "MIA", refreshMinutes: 120, maxRecords: 50, estimatedMonthlyRequests: 720 }
    });
    const departure = runtime({
        flow: sharedFlow,
        msg: {
            statusCode: 200,
            url: "https://airlabs.co/api/v9/schedules?api_key=test-only-key",
            _airlabsDirection: "departures",
            _airlabsConfig: sharedFlow.values.openskyScheduleConfig,
            payload: { response: [{
                flight_icao: "AAL123", flight_iata: "AA123", flight_number: "123",
                cs_airline_iata: "BA", cs_flight_iata: "BA2421", cs_flight_number: "2421",
                airline_icao: "AAL", airline_iata: "AA", dep_iata: "MIA", dep_icao: "KMIA",
                dep_terminal: "D", dep_gate: "D12", arr_iata: "JFK", arr_icao: "KJFK", dep_time: "2026-08-30 10:00",
                arr_time: "2026-08-30 13:00", arr_estimated: "2026-08-30 13:20",
                arr_terminal: "8", arr_gate: "42", arr_delayed: 20, status: "active"
            }] }
        }
    });
    assert.equal(execute("airlabs-cache-schedules", departure), null);
    assert.equal(departure.msg.url, undefined);
    assert.equal(sharedFlow.values.airlabsScheduleCache.byFlight.AAL123.destinationIata, "JFK");
    assert.equal(sharedFlow.values.airlabsScheduleCache.byFlight.AA123.arrivalGate, "42");
    assert.equal(sharedFlow.values.airlabsScheduleCache.byFlight.BA2421.codeshareAirlineIata, "BA");
    assert.equal(sharedFlow.values.airlabsScheduleMeta.records, 1);
    assert.ok(sharedFlow.values.airlabsScheduleCache.staleUntil - sharedFlow.values.airlabsScheduleCache.fetchedAt <= 6 * 60 * 60 * 1000);
    assert.equal(sharedFlow.values.airlabsScheduleCache.byFlight.AAL123.codeshareFlightIcao, undefined);
    assert.equal(sharedFlow.values.airlabsScheduleCache.byFlight.AAL123.providerUpdated, undefined);
    assert.doesNotMatch(JSON.stringify(sharedFlow.values.airlabsScheduleCache), /test-only-key/);
});

test("AirLabs direct-array responses are accepted", () => {
    const sharedFlow = store({
        openskyScheduleConfig: { airportIata: "SFO", refreshMinutes: 120, maxRecords: 50, estimatedMonthlyRequests: 720 }
    });
    const rt = runtime({
        flow: sharedFlow,
        msg: {
            statusCode: 200,
            _airlabsDirection: "arrivals",
            _airlabsConfig: sharedFlow.values.openskyScheduleConfig,
            payload: [{ flight_iata: "UA100", dep_iata: "ORD", arr_iata: "SFO", arr_time: "2026-08-30 13:00" }]
        }
    });
    assert.equal(execute("airlabs-cache-schedules", rt), null);
    assert.equal(sharedFlow.values.airlabsScheduleCache.byFlight.UA100.originIata, "ORD");
});

test("AirLabs provider pages larger than the configured limit are capped locally", () => {
    const cfg = { airportIata: "MIA", refreshMinutes: 120, maxRecords: 50, estimatedMonthlyRequests: 720 };
    const rows = Array.from({ length: 100 }, (_, index) => ({
        flight_iata: "AA" + String(index + 1),
        flight_icao: "AAL" + String(index + 1),
        dep_iata: "MIA",
        arr_iata: "JFK"
    }));
    const sharedFlow = store({ openskyScheduleConfig: cfg });
    const rt = runtime({
        flow: sharedFlow,
        msg: {
            statusCode: 200,
            _airlabsDirection: "departures",
            _airlabsConfig: cfg,
            payload: { request: { has_more: true, total_items: 562 }, response: rows }
        }
    });
    assert.equal(execute("airlabs-cache-schedules", rt), null);
    assert.equal(sharedFlow.values.airlabsScheduleCache.boards.departures.length, 50);
    assert.equal(sharedFlow.values.airlabsScheduleMeta.records, 50);
    assert.equal(sharedFlow.values.airlabsScheduleCache.byFlight.AA51, undefined);
});

test("all documented AirLabs API errors become safe actionable Debug messages", () => {
    const codes = [
        "unknown_api_key", "expired_api_key", "unknown_method", "wrong_params", "not_found",
        "minute_limit_exceeded", "hour_limit_exceeded", "month_limit_exceeded", "internal_error"
    ];
    for (const code of codes) {
        const sharedFlow = store();
        const rt = runtime({
            flow: sharedFlow,
            msg: {
                statusCode: 200,
                url: "https://airlabs.co/api/v9/schedules?api_key=test-only-key",
                _airlabsDirection: "departures",
                payload: { error: { code, message: "provider message" } }
            }
        });
        const result = execute("airlabs-cache-schedules", rt);
        assert.equal(result.payload.errorCode, code);
        assert.equal(sharedFlow.values.airlabsScheduleMeta.lastErrorCode, code);
        assert.equal(rt.msg.url, undefined);
        assert.doesNotMatch(JSON.stringify(result), /test-only-key/);
    }
});

test("AirLabs transport failures discard the failed request URL", () => {
    const sharedFlow = store();
    const rt = runtime({
        flow: sharedFlow,
        msg: {
            url: "https://airlabs.co/api/v9/schedules?api_key=test-only-key",
            error: { message: "connection failed" }
        }
    });
    const result = execute("airlabs-safe-error", rt);
    assert.equal(result.payload.message, "The schedule request could not be completed.");
    assert.equal(sharedFlow.values.airlabsScheduleMeta.lastErrorCode, "network_error");
    assert.doesNotMatch(JSON.stringify(result), /test-only-key|api_key/);
});

test("matching live aircraft receive cached route and schedule rows", () => {
    const now = Date.now();
    const schedule = {
        originIata: "MIA", destinationIata: "JFK", departureScheduled: "2026-08-30 10:00",
        arrivalEstimated: "2026-08-30 13:20", arrivalDelayMinutes: 20,
        arrivalTerminal: "8", arrivalGate: "42", status: "active"
    };
    const sharedFlow = store({
        faaOperatorDirectory: { AAL: { company: "AMERICAN AIRLINES, INC.", telephony: "AMERICAN" } },
        airlabsScheduleCache: {
            byFlight: { AAL123: schedule, AA123: schedule }, fetchedAt: now,
            expiresAt: now + 60_000, staleUntil: now + 60_000
        }
    });
    const rt = runtime({
        flow: sharedFlow,
        msg: {
            payload: {
                name: "AAL123 · a1b2c3",
                popup: "<div><span style='color:#64748b'>Operator</span><b style='color:#0f172a'>Not identified</b></div>"
            }
        }
    });
    execute("operator-label-resolver", rt);
    const popup = rt.msg.payload.popup;
    assert.match(popup, /American Airlines/);
    assert.match(popup, /MIA → JFK/);
    assert.match(popup, /Flight status/);
    assert.match(popup, /20 min/);
    assert.match(popup, /Terminal 8 • Gate 42/);
    assert.match(popup, /Schedule source/);
});

test("departure-board matches display the selected airport departure gate", () => {
    const now = Date.now();
    const schedule = {
        originIata: "MIA", destinationIata: "JFK", boardDirection: "departures",
        departureTerminal: "D", departureGate: "D12", arrivalTerminal: "8", arrivalGate: "42"
    };
    const rt = runtime({
        flow: store({
            airlabsScheduleCache: {
                byFlight: { AAL123: schedule, AA123: schedule }, fetchedAt: now,
                expiresAt: now + 60_000, staleUntil: now + 60_000
            }
        }),
        msg: { payload: {
            name: "AAL123 · a1b2c3",
            popup: "<div><span style='color:#64748b'>Operator</span><b style='color:#0f172a'>Not identified</b></div>"
        } }
    });
    execute("operator-label-resolver", rt);
    assert.match(rt.msg.payload.popup, /Departure/);
    assert.match(rt.msg.payload.popup, /Terminal D • Gate D12/);
    assert.doesNotMatch(rt.msg.payload.popup, /Terminal 8 • Gate 42/);
});

test("documented AirLabs codeshare IATA flights match an OpenSky ICAO callsign", () => {
    const now = Date.now();
    const schedule = { originIata: "MIA", destinationIata: "LHR", codeshareFlightIata: "BA2421" };
    const rt = runtime({
        flow: store({
            airlabsScheduleCache: {
                byFlight: { BA2421: schedule }, fetchedAt: now,
                expiresAt: now + 60_000, staleUntil: now + 60_000
            }
        }),
        msg: { payload: {
            name: "BAW2421 · a1b2c3",
            popup: "<div><span style='color:#64748b'>Operator</span><b style='color:#0f172a'>Not identified</b></div>"
        } }
    });
    execute("operator-label-resolver", rt);
    assert.match(rt.msg.payload.popup, /MIA → LHR/);
});

test("expired schedule data is not added to aircraft popups", () => {
    const sharedFlow = store({
        airlabsScheduleCache: {
            byFlight: { AAL123: { originIata: "MIA", destinationIata: "JFK" } },
            fetchedAt: 0, expiresAt: 0, staleUntil: Date.now() - 1
        }
    });
    const rt = runtime({
        flow: sharedFlow,
        msg: {
            payload: {
                name: "AAL123 · a1b2c3",
                popup: "<div><span style='color:#64748b'>Operator</span><b style='color:#0f172a'>Not identified</b></div>"
            }
        }
    });
    execute("operator-label-resolver", rt);
    assert.doesNotMatch(rt.msg.payload.popup, /MIA → JFK/);
});

test("OpenSky aircraft outside the circular radius are discarded", () => {
    function state(icao24, callsign, lat, lon) {
        const row = Array(18).fill(null);
        row[0] = icao24;
        row[1] = callsign;
        row[2] = "United States";
        row[4] = Math.floor(Date.now() / 1000);
        row[5] = lon;
        row[6] = lat;
        row[7] = 1000;
        row[8] = false;
        row[9] = 100;
        row[10] = 90;
        row[13] = 1000;
        row[17] = 3;
        return row;
    }
    const sharedFlow = store({ openskyRadarConfig: { centerLat: 25.7617, centerLon: -80.1918, radiusKm: 150, pollSeconds: 300 } });
    const rt = runtime({
        flow: sharedFlow,
        msg: {
            statusCode: 200,
            _openskyAuthMode: "anonymous",
            headers: { "x-rate-limit-remaining": "399" },
            payload: { states: [
                state("a1b2c3", "AAL123", 25.8, -80.3),
                state("d4e5f6", "DAL456", 29.5, -80.3)
            ] }
        }
    });
    const result = execute("3c0b81a6774da40c", rt);
    assert.equal(result[0].length, 1);
    assert.equal(result[0][0].payload.ttl, 420);
    assert.equal(sharedFlow.values.openskyRadarStatus.aircraftCount, 1);
    assert.equal(sharedFlow.values.openskyRadarStatus.creditsRemaining, 399);
});

test("cached schedules never keep an aircraft marker after it leaves the radius", () => {
    const now = Date.now();
    const sharedFlow = store({
        openskyRadarConfig: { centerLat: 25.7617, centerLon: -80.1918, radiusKm: 150, pollSeconds: 300 },
        airlabsScheduleCache: {
            byFlight: { AAL123: { originIata: "MIA", destinationIata: "JFK" } },
            fetchedAt: now, expiresAt: now + 60_000, staleUntil: now + 60_000
        }
    });
    const rt = runtime({
        flow: sharedFlow,
        msg: { statusCode: 200, _openskyAuthMode: "anonymous", payload: { states: [] } }
    });
    const result = execute("3c0b81a6774da40c", rt);
    assert.equal(result[0].length, 0);
    assert.ok(sharedFlow.values.airlabsScheduleCache.byFlight.AAL123, "the reusable lookup may remain cached");
});

test("the periodic health summary is nonempty and contains no credentials", () => {
    const sharedFlow = store({
        openskyRadarConfig: { centerLat: 37.7749, centerLon: -122.4194, radiusKm: 150, authConfigured: true, estimatedCreditCost: 1, pollSeconds: 60 },
        openskyRadarStatus: { aircraftCount: 12, airborne: 11, grounded: 1, updatedAt: "2026-08-30T12:00:00.000Z", authMode: "Authenticated", creditsRemaining: 3850 },
        faaOperatorDirectoryMeta: { count: 6500, updatedAt: "2026-08-30T01:00:00.000Z" },
        ourAirportsMeta: { count: 3000, updatedAt: "2026-08-30T02:00:00.000Z" },
        openskyScheduleConfig: { airportIata: "SFO", airportName: "San Francisco International Airport", airportDistanceKm: 18, selectionMode: "nearest-in-radius", monthlyRequestCap: 900 },
        airlabsScheduleMeta: { enabled: true, ready: true, records: 42 },
        airlabsRequestUsage: { month: "2026-08", count: 24 }
    });
    const rt = runtime({ flow: sharedFlow, env: { AIRLABS_API_KEY: "must-not-appear" } });
    const result = execute("system-health-summary", rt);
    assert.equal(result.payload.radar.aircraftCount, 12);
    assert.equal(result.payload.radar.authMode, "Authenticated");
    assert.equal(result.payload.radar.creditsRemaining, 3850);
    assert.equal(result.payload.radar.estimatedCreditCostPerPoll, 1);
    assert.equal(result.payload.radar.pollSeconds, 60);
    assert.equal(result.payload.airports.selectedIata, "SFO");
    assert.equal(result.payload.schedules.monthlyRequestsUsed, 24);
    assert.doesNotMatch(JSON.stringify(result), /must-not-appear|api_key|secret/i);
});

test("the flow tab exposes editor-based AirLabs and polling configuration", () => {
    const tab = flowDefinition.find(node => node.type === "tab");
    assert.deepEqual(tab.env, []);
    assert.match(tab.info, /Environment Variables/);
    assert.match(tab.info, /AIRLABS_API_KEY/);
    assert.match(tab.info, /OPENSKY_POLL_SECONDS/);
});

test("OpenSky polling metadata follows the editor environment value", () => {
    for (const seconds of [20, 60, 300]) {
        const rt = runtime({ env: { OPENSKY_POLL_SECONDS: String(seconds) } });
        const result = execute("f11a5f6d0e8f2c33", rt);
        assert.equal(result[0].openskyConfig.pollSeconds, seconds);
        assert.equal(rt.flow.values.openskyRadarConfig.pollSeconds, seconds);
    }

    const invalid = runtime({ env: { OPENSKY_POLL_SECONDS: "10" } });
    assert.equal(execute("f11a5f6d0e8f2c33", invalid), null);
    assert.match(invalid.errors[0], /between 20 and 3600/);
});

test("the dedicated AirLabs status is useful and credential-free", () => {
    const now = Date.now();
    const rt = runtime({
        env: { AIRLABS_API_KEY: "must-not-appear" },
        flow: store({
            openskyScheduleConfig: {
                airportIata: "MIA", airportName: "Miami International Airport",
                airportDistanceKm: 10.5, selectionMode: "nearest-in-radius",
                refreshMinutes: 120, estimatedMonthlyRequests: 720, monthlyRequestCap: 900
            },
            airlabsScheduleMeta: { enabled: true, ready: true, records: 50, matchKeys: 72 },
            airlabsScheduleCache: { fetchedAt: now - 60_000 },
            airlabsRequestUsage: { month: "2026-08", count: 2 }
        })
    });
    const result = execute("airlabs-health-summary", rt);
    assert.equal(result.payload.enabled, true);
    assert.equal(result.payload.selectedAirport, "MIA");
    assert.equal(result.payload.records, 50);
    assert.equal(result.payload.monthlyRequestsUsed, 2);
    assert.doesNotMatch(JSON.stringify(result), /must-not-appear|api_key|request url/i);
});
