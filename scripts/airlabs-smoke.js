const https = require("node:https");

const apiKey = String(process.env.AIRLABS_API_KEY || "").trim();
const airportIata = String(process.env.AIRLABS_TEST_AIRPORT || "MIA").trim().toUpperCase();

if (!apiKey) {
    console.error("AIRLABS_API_KEY is not set. Configure it in the environment before running this opt-in test.");
    process.exit(1);
}
if (!/^[A-Z0-9]{3}$/.test(airportIata)) {
    console.error("AIRLABS_TEST_AIRPORT must be a three-character IATA code.");
    process.exit(1);
}

const fields = [
    "flight_icao", "flight_iata", "flight_number", "airline_icao", "airline_iata",
    "cs_airline_iata", "cs_flight_iata", "cs_flight_number",
    "dep_iata", "dep_icao", "dep_terminal", "dep_gate",
    "dep_time", "dep_estimated", "dep_actual", "dep_delayed",
    "arr_iata", "arr_icao", "arr_terminal", "arr_gate", "arr_baggage",
    "arr_time", "arr_estimated", "arr_actual", "arr_delayed", "status"
].join(",");

function requestBoard(direction) {
    const airportParam = direction === "departures" ? "dep_iata" : "arr_iata";
    const url = new URL("https://airlabs.co/api/v9/schedules");
    url.searchParams.set(airportParam, airportIata);
    url.searchParams.set("limit", "1");
    url.searchParams.set("_fields", fields);
    url.searchParams.set("api_key", apiKey);

    return new Promise((resolve, reject) => {
        const request = https.get(url, { timeout: 10000 }, response => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", chunk => { body += chunk; });
            response.on("end", () => {
                let parsed;
                try {
                    parsed = JSON.parse(body);
                } catch {
                    reject(new Error(direction + " returned non-JSON data (HTTP " + response.statusCode + ")."));
                    return;
                }
                if (parsed && parsed.error) {
                    const code = String(parsed.error.code || "unknown_api_error").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 80);
                    reject(new Error(direction + " failed with AirLabs code " + code + "."));
                    return;
                }
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(direction + " returned HTTP " + response.statusCode + "."));
                    return;
                }
                const rows = Array.isArray(parsed && parsed.response)
                    ? parsed.response
                    : (Array.isArray(parsed) ? parsed : null);
                if (!rows) {
                    reject(new Error(direction + " did not return a documented schedule-list shape."));
                    return;
                }
                resolve({ direction, rows: rows.length, sampleFields: rows[0] ? Object.keys(rows[0]).sort() : [] });
            });
        });
        request.on("timeout", () => request.destroy());
        request.on("error", () => reject(new Error(direction + " request could not be completed within 10 seconds.")));
    });
}

Promise.all([requestBoard("departures"), requestBoard("arrivals")])
    .then(results => {
        console.log(JSON.stringify({
            ok: true,
            endpoint: "AirLabs v9 schedules",
            airportIata,
            requestsUsed: 2,
            results
        }, null, 2));
    })
    .catch(error => {
        console.error("AirLabs smoke test failed: " + error.message);
        process.exitCode = 1;
    });
