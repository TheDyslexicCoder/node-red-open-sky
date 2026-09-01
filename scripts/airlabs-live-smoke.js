const https = require("node:https");

const apiKey = String(process.env.AIRLABS_API_KEY || "").trim();
const centerLat = Number(process.env.AIRLABS_TEST_LAT || 25.7617);
const centerLon = Number(process.env.AIRLABS_TEST_LON || -80.1918);
const radiusKm = Number(process.env.AIRLABS_TEST_RADIUS_KM || 150);

if (!apiKey) {
    console.error("AIRLABS_API_KEY is not set. Configure it in the environment before running this opt-in test.");
    process.exit(1);
}
if (![centerLat, centerLon, radiusKm].every(Number.isFinite) || radiusKm <= 0 || radiusKm > 500) {
    console.error("AIRLABS_TEST_LAT, AIRLABS_TEST_LON, and AIRLABS_TEST_RADIUS_KM must describe a valid radar area.");
    process.exit(1);
}

const latDelta = radiusKm / 111.32;
const safeCos = Math.max(Math.abs(Math.cos(centerLat * Math.PI / 180)), 0.05);
const lonDelta = Math.min(180, radiusKm / (111.32 * safeCos));
const south = Math.max(-90, centerLat - latDelta);
const north = Math.min(90, centerLat + latDelta);
const west = Math.max(-180, centerLon - lonDelta);
const east = Math.min(180, centerLon + lonDelta);
const bbox = [south, west, north, east].map(value => value.toFixed(5)).join(",");
const fields = [
    "hex", "flight_icao", "flight_iata", "flight_number",
    "airline_icao", "airline_iata", "dep_icao", "dep_iata",
    "arr_icao", "arr_iata", "status", "updated"
].join(",");

function requestJson(url) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, { timeout: 20000, headers: { "User-Agent": "node-red-open-sky-live-smoke/1.0" } }, response => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", chunk => { body += chunk; });
            response.on("end", () => {
                try {
                    resolve({ statusCode: response.statusCode, headers: response.headers, body: JSON.parse(body) });
                } catch (error) {
                    reject(new Error("A provider returned invalid JSON."));
                }
            });
        });
        request.on("timeout", () => request.destroy(new Error("Provider request timed out.")));
        request.on("error", reject);
    });
}

function distanceKm(lat1, lon1, lat2, lon2) {
    const toRad = value => value * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function main() {
    const airlabsUrl = "https://airlabs.co/api/v9/flights?bbox=" + encodeURIComponent(bbox) +
        "&_fields=" + encodeURIComponent(fields) + "&api_key=" + encodeURIComponent(apiKey);
    const openSkyUrl = "https://opensky-network.org/api/states/all?lamin=" + south.toFixed(5) +
        "&lomin=" + west.toFixed(5) + "&lamax=" + north.toFixed(5) + "&lomax=" + east.toFixed(5);
    const [airlabs, openSky] = await Promise.all([requestJson(airlabsUrl), requestJson(openSkyUrl)]);

    if (airlabs.statusCode < 200 || airlabs.statusCode >= 300) throw new Error("AirLabs returned HTTP " + airlabs.statusCode + ".");
    if (airlabs.body && airlabs.body.error) throw new Error("AirLabs returned code " + String(airlabs.body.error.code || "unknown") + ".");
    if (openSky.statusCode < 200 || openSky.statusCode >= 300) throw new Error("OpenSky returned HTTP " + openSky.statusCode + ".");

    const rows = Array.isArray(airlabs.body.response) ? airlabs.body.response : (Array.isArray(airlabs.body) ? airlabs.body : []);
    const byHex = new Map();
    rows.forEach(row => {
        const hex = String(row.hex || "").trim().toUpperCase();
        if (hex) byHex.set(hex, row);
    });
    const states = Array.isArray(openSky.body.states) ? openSky.body.states.filter(row => {
        const lon = Number(row && row[5]);
        const lat = Number(row && row[6]);
        return Number.isFinite(lat) && Number.isFinite(lon) && distanceKm(centerLat, centerLon, lat, lon) <= radiusKm;
    }) : [];
    let hexMatches = 0;
    let routeMatches = 0;
    states.forEach(row => {
        const match = byHex.get(String(row[0] || "").trim().toUpperCase());
        if (!match) return;
        hexMatches++;
        if (match.dep_iata && match.arr_iata) routeMatches++;
    });
    const returnedFields = Array.from(new Set(rows.flatMap(row => Object.keys(row)))).sort();
    console.log(JSON.stringify({
        endpoint: "AirLabs v9 real-time flights + OpenSky state vectors",
        center: { lat: centerLat, lon: centerLon, radiusKm },
        airlabsRows: rows.length,
        openSkyAircraftInCircle: states.length,
        hexMatches,
        routeMatches,
        providerCreditsRemaining: airlabs.headers["x-rate-limit-remaining"] || null,
        returnedFields
    }, null, 2));
}

main().catch(error => {
    console.error("Live-route smoke test failed: " + error.message);
    process.exitCode = 1;
});
