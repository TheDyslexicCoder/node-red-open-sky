const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const flowPath = path.join(__dirname, "..", "OpenSky-Planes-WorldMap.json");
const flowDefinition = JSON.parse(fs.readFileSync(flowPath, "utf8"));

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
});

test("AirLabs enrichment stays disabled when no environment key exists", () => {
    const rt = runtime();
    const result = execute("airlabs-prepare-requests", rt);
    assert.equal(result, null);
    assert.equal(rt.flow.values.airlabsScheduleMeta.enabled, false);
    assert.equal(rt.flow.values.openskyScheduleConfig.airportIata, "MIA");
    assert.equal(rt.flow.values.openskyScheduleConfig.estimatedMonthlyRequests, 720);
    assert.equal(rt.flow.values.openskyScheduleConfig.monthlyRequestCap, 900);
});

test("AirLabs request preparation creates two guarded Miami requests", () => {
    const rt = runtime({ env: { AIRLABS_API_KEY: "test-only-key" } });
    const result = execute("airlabs-prepare-requests", rt);
    assert.equal(result.length, 1);
    assert.equal(result[0].length, 2);
    assert.deepEqual(result[0].map(message => message._airlabsDirection), ["departures", "arrivals"]);
    assert.match(result[0][0].url, /dep_iata=MIA/);
    assert.match(result[0][1].url, /arr_iata=MIA/);
    assert.ok(result[0].every(message => message.url.includes("test-only-key")));
    assert.equal(rt.flow.values.airlabsRequestUsage.count, 2);

    const second = execute("airlabs-prepare-requests", rt);
    assert.equal(second, null, "request guard should prevent another immediate API call");
});

test("AirLabs monthly request guard stops calls before the configured cap is exceeded", () => {
    const month = new Date().toISOString().slice(0, 7);
    const sharedFlow = store({ airlabsRequestUsage: { month, count: 900 } });
    const rt = runtime({ flow: sharedFlow, env: { AIRLABS_API_KEY: "test-only-key" } });
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
                airline_icao: "AAL", airline_iata: "AA", dep_iata: "MIA", dep_icao: "KMIA",
                arr_iata: "JFK", arr_icao: "KJFK", dep_time: "2026-08-30 10:00",
                arr_time: "2026-08-30 13:00", arr_estimated: "2026-08-30 13:20",
                arr_terminal: "8", arr_gate: "42", arr_delayed: 20, status: "active"
            }] }
        }
    });
    assert.equal(execute("airlabs-cache-schedules", departure), null);
    assert.equal(departure.msg.url, undefined);
    assert.equal(sharedFlow.values.airlabsScheduleCache.byFlight.AAL123.destinationIata, "JFK");
    assert.equal(sharedFlow.values.airlabsScheduleCache.byFlight.AA123.arrivalGate, "42");
    assert.doesNotMatch(JSON.stringify(sharedFlow.values.airlabsScheduleCache), /test-only-key/);
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
