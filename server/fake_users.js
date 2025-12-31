require('dotenv').config();

function seededRandom(seed) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// IMPORTANT:
// Crowd size + speed now vary per bus.
// This enables realistic ETA, seat availability, and ranking.

const axios = require("axios");

// Base users per bus (will be randomized per bus)
const BASE_USERS_PER_BUS = 20; // base, per-bus variability handled below

// Simulation of multiple buses across Indian cities, moving along route polylines
// Posts dense crowd GPS points to /crowd/update for clustering.
// You can tweak INTERVAL_MS via env vars.

const INTERVAL_MS = Number(process.env.INTERVAL_MS || 3000);
const SERVER = process.env.SERVER_URL || "http://localhost:3000";

// Route polylines (must align with server/services/services.js)
const ROUTES = {
  R1: [ // Delhi CP -> DU
    { lat: 28.6315, lng: 77.2167 },
    { lat: 28.6258, lng: 77.2350 },
    { lat: 28.6822, lng: 77.2244 },
    { lat: 28.6894, lng: 77.2100 }
  ],
  R2: [ // Delhi India Gate -> AIIMS
    { lat: 28.6129, lng: 77.2295 },
    { lat: 28.6006, lng: 77.2276 },
    { lat: 28.5889, lng: 77.2200 },
    { lat: 28.5665, lng: 77.2100 }
  ],
  R_MUM1: [ // Mumbai Bandra -> CST
    { lat: 19.0596, lng: 72.8295 },
    { lat: 19.0186, lng: 72.8445 },
    { lat: 18.9824, lng: 72.8175 },
    { lat: 18.9402, lng: 72.8356 }
  ],
  R_BLR1: [ // Bengaluru Whitefield -> Majestic
    { lat: 12.9698, lng: 77.7499 },
    { lat: 12.9569, lng: 77.7011 },
    { lat: 12.9784, lng: 77.6408 },
    { lat: 12.9758, lng: 77.6055 },
    { lat: 12.9783, lng: 77.5723 }
  ],
  R_HYD1: [ // Hyderabad Hitec -> Charminar
    { lat: 17.4474, lng: 78.3762 },
    { lat: 17.4326, lng: 78.4070 },
    { lat: 17.4210, lng: 78.4482 },
    { lat: 17.3940, lng: 78.4605 },
    { lat: 17.3616, lng: 78.4747 }
  ],
  R_CHN1: [ // Chennai Guindy -> Broadway
    { lat: 13.0108, lng: 80.2206 },
    { lat: 13.0232, lng: 80.2306 },
    { lat: 13.0418, lng: 80.2333 },
    { lat: 13.0615, lng: 80.2646 },
    { lat: 13.0878, lng: 80.2785 }
  ],
  R_KOL1: [ // Kolkata Salt Lake -> Howrah
    { lat: 22.5697, lng: 88.4300 },
    { lat: 22.5762, lng: 88.3952 },
    { lat: 22.5667, lng: 88.3700 },
    { lat: 22.5646, lng: 88.3507 },
    { lat: 22.5850, lng: 88.3460 }
  ]
};

// Buses across cities, mapped to routes (busId must be mapped in services.BUS_ROUTE)
const BUSES = [
  // Delhi
  { busId: "BUS_101", routeId: "R1", speedKmh: 18 + seededRandom("SPEED_BUS_101") * 12, t: seededRandom("POS_BUS_101"), crowdPhase: seededRandom("CROWD_BUS_101") > 0.6 ? "PEAK" : "NORMAL" },
  { busId: "BUS_102", routeId: "R1", speedKmh: 18 + seededRandom("SPEED_BUS_102") * 12, t: seededRandom("POS_BUS_102"), crowdPhase: seededRandom("CROWD_BUS_102") > 0.6 ? "PEAK" : "NORMAL" },
  { busId: "BUS_103", routeId: "R1", speedKmh: 18 + seededRandom("SPEED_BUS_103") * 12, t: seededRandom("POS_BUS_103"), crowdPhase: seededRandom("CROWD_BUS_103") > 0.6 ? "PEAK" : "NORMAL" },
  { busId: "BUS_303", routeId: "R1", speedKmh: 18 + seededRandom("SPEED_BUS_303") * 12, t: seededRandom("POS_BUS_303"), crowdPhase: seededRandom("CROWD_BUS_303") > 0.6 ? "PEAK" : "NORMAL" },
  { busId: "BUS_202", routeId: "R2", speedKmh: 18 + seededRandom("SPEED_BUS_202") * 12, t: seededRandom("POS_BUS_202"), crowdPhase: seededRandom("CROWD_BUS_202") > 0.6 ? "PEAK" : "NORMAL" },
  { busId: "BUS_204", routeId: "R2", speedKmh: 18 + seededRandom("SPEED_BUS_204") * 12, t: seededRandom("POS_BUS_204"), crowdPhase: seededRandom("CROWD_BUS_204") > 0.6 ? "PEAK" : "NORMAL" },
  // Mumbai
  { busId: "MUM_101", routeId: "R_MUM1", speedKmh: 18 + seededRandom("SPEED_MUM_101") * 12, t: seededRandom("POS_MUM_101"), crowdPhase: seededRandom("CROWD_MUM_101") > 0.6 ? "PEAK" : "NORMAL" },
  { busId: "MUM_102", routeId: "R_MUM1", speedKmh: 18 + seededRandom("SPEED_MUM_102") * 12, t: seededRandom("POS_MUM_102"), crowdPhase: seededRandom("CROWD_MUM_102") > 0.6 ? "PEAK" : "NORMAL" },
  { busId: "MUM_103", routeId: "R_MUM1", speedKmh: 18 + seededRandom("SPEED_MUM_103") * 12, t: seededRandom("POS_MUM_103"), crowdPhase: seededRandom("CROWD_MUM_103") > 0.6 ? "PEAK" : "NORMAL" },
  { busId: "MUM_201", routeId: "R_MUM1", speedKmh: 18 + seededRandom("SPEED_MUM_201") * 12, t: seededRandom("POS_MUM_201"), crowdPhase: seededRandom("CROWD_MUM_201") > 0.6 ? "PEAK" : "NORMAL" },
  // Bengaluru
  { busId: "BLR_101", routeId: "R_BLR1", speedKmh: 18 + seededRandom("SPEED_BLR_101") * 12, t: seededRandom("POS_BLR_101"), crowdPhase: seededRandom("CROWD_BLR_101") > 0.6 ? "PEAK" : "NORMAL" },
  { busId: "BLR_102", routeId: "R_BLR1", speedKmh: 18 + seededRandom("SPEED_BLR_102") * 12, t: seededRandom("POS_BLR_102"), crowdPhase: seededRandom("CROWD_BLR_102") > 0.6 ? "PEAK" : "NORMAL" },
  { busId: "BLR_103", routeId: "R_BLR1", speedKmh: 18 + seededRandom("SPEED_BLR_103") * 12, t: seededRandom("POS_BLR_103"), crowdPhase: seededRandom("CROWD_BLR_103") > 0.6 ? "PEAK" : "NORMAL" },
  { busId: "BLR_201", routeId: "R_BLR1", speedKmh: 18 + seededRandom("SPEED_BLR_201") * 12, t: seededRandom("POS_BLR_201"), crowdPhase: seededRandom("CROWD_BLR_201") > 0.6 ? "PEAK" : "NORMAL" },
  { busId: "BLR_202", routeId: "R_BLR1", speedKmh: 18 + seededRandom("SPEED_BLR_202") * 12, t: seededRandom("POS_BLR_202"), crowdPhase: seededRandom("CROWD_BLR_202") > 0.6 ? "PEAK" : "NORMAL" },
  // Hyderabad
  { busId: "HYD_101", routeId: "R_HYD1", speedKmh: 18 + seededRandom("SPEED_HYD_101") * 12, t: seededRandom("POS_HYD_101"), crowdPhase: seededRandom("CROWD_HYD_101") > 0.6 ? "PEAK" : "NORMAL" },
  { busId: "HYD_102", routeId: "R_HYD1", speedKmh: 18 + seededRandom("SPEED_HYD_102") * 12, t: seededRandom("POS_HYD_102"), crowdPhase: seededRandom("CROWD_HYD_102") > 0.6 ? "PEAK" : "NORMAL" },
  { busId: "HYD_201", routeId: "R_HYD1", speedKmh: 18 + seededRandom("SPEED_HYD_201") * 12, t: seededRandom("POS_HYD_201"), crowdPhase: seededRandom("CROWD_HYD_201") > 0.6 ? "PEAK" : "NORMAL" },
  // Chennai
  { busId: "CHN_101", routeId: "R_CHN1", speedKmh: 18 + seededRandom("SPEED_CHN_101") * 12, t: seededRandom("POS_CHN_101"), crowdPhase: seededRandom("CROWD_CHN_101") > 0.6 ? "PEAK" : "NORMAL" },
  { busId: "CHN_102", routeId: "R_CHN1", speedKmh: 18 + seededRandom("SPEED_CHN_102") * 12, t: seededRandom("POS_CHN_102"), crowdPhase: seededRandom("CROWD_CHN_102") > 0.6 ? "PEAK" : "NORMAL" },
  { busId: "CHN_201", routeId: "R_CHN1", speedKmh: 18 + seededRandom("SPEED_CHN_201") * 12, t: seededRandom("POS_CHN_201"), crowdPhase: seededRandom("CROWD_CHN_201") > 0.6 ? "PEAK" : "NORMAL" },
  // Kolkata
  { busId: "KOL_101", routeId: "R_KOL1", speedKmh: 18 + seededRandom("SPEED_KOL_101") * 12, t: seededRandom("POS_KOL_101"), crowdPhase: seededRandom("CROWD_KOL_101") > 0.6 ? "PEAK" : "NORMAL" },
  { busId: "KOL_102", routeId: "R_KOL1", speedKmh: 18 + seededRandom("SPEED_KOL_102") * 12, t: seededRandom("POS_KOL_102"), crowdPhase: seededRandom("CROWD_KOL_102") > 0.6 ? "PEAK" : "NORMAL" },
  { busId: "KOL_201", routeId: "R_KOL1", speedKmh: 18 + seededRandom("SPEED_KOL_201") * 12, t: seededRandom("POS_KOL_201"), crowdPhase: seededRandom("CROWD_KOL_201") > 0.6 ? "PEAK" : "NORMAL" }
];

// Stable simulated users per bus (IMPORTANT)
const BUS_USERS = {};

function usersForBus(busId) {
  const seed = busId.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  const variability = seed % 18;
  return Math.max(8, BASE_USERS_PER_BUS + variability);
}

for (const bus of BUSES) {
  const count = usersForBus(bus.busId);

  BUS_USERS[bus.busId] = Array.from({ length: count }).map((_, i) => ({
    userId: `${bus.busId}_user_${i}`,
    jitterLat: (Math.random() - 0.5) * 0.0006,
    jitterLng: (Math.random() - 0.5) * 0.0006
  }));
}

// Utility: total length of polyline in km and interpolate along it
function distanceKm(a, b) {
  const dLat = b.lat - a.lat, dLng = b.lng - a.lng; return Math.sqrt(dLat*dLat + dLng*dLng) * 111;
}
function polylineLength(poly) { let s=0; for (let i=1;i<poly.length;i++) s+=distanceKm(poly[i-1], poly[i]); return s; }
function interpolateAlong(poly, t) {
  // t in [0,1]; loop back when reaching end
  const total = polylineLength(poly);
  let target = (t % 1) * total;
  for (let i=1;i<poly.length;i++) {
    const seg = distanceKm(poly[i-1], poly[i]);
    if (target <= seg) {
      const f = seg === 0 ? 0 : (target / seg);
      const lat = poly[i-1].lat + (poly[i].lat - poly[i-1].lat) * f;
      const lng = poly[i-1].lng + (poly[i].lng - poly[i-1].lng) * f;
      return { lat, lng };
    }
    target -= seg;
  }
  return poly[poly.length-1];
}

async function sendCluster(bus, center) {
  const users = BUS_USERS[bus.busId];
  if (!users) return;

  const phasePenalty = bus.crowdPhase === "PEAK" ? 6 : 2;

  const promises = users.map(u => {
    // Per-user speed noise, bus-level variability
    const speed = Math.max(
      6,
      bus.speedKmh -
        BUS_USERS[bus.busId].length * 0.02 -
        phasePenalty +
        (Math.random() - 0.5) * 2
    );
    return axios.post(`${SERVER}/crowd/update`, {
      userId: u.userId,
      lat: center.lat + u.jitterLat,
      lng: center.lng + u.jitterLng,
      speed,
      busId: bus.busId
    }).catch(() => {});
  });

  await Promise.all(promises);
}

function stepBus(bus) {
  const poly = ROUTES[bus.routeId];
  if (!poly) return null;

  bus.speedKmh = Math.max(
    10,
    bus.speedKmh + (Math.random() - 0.5) * 1.5
  );

  // delta_t per tick based on speed and polyline length translates to fraction of route per interval
  const totalKm = polylineLength(poly);
  // distance per interval: speed (km/h) * (INTERVAL_MS/3600000)
  const dKm = bus.speedKmh * (INTERVAL_MS / 3600000);
  const dT = totalKm > 0 ? (dKm / totalKm) : 0.01;
  if (typeof bus.t !== "number" || !isFinite(bus.t)) {
    bus.t = Math.random();
  }
  bus.t = bus.t + dT;
  if (bus.t >= 1) bus.t = bus.t % 1;
  return interpolateAlong(poly, bus.t);
}

setInterval(async () => {
  for (const bus of BUSES) {
    const center = stepBus(bus);
    if (!center) continue;

    // Send crowd cluster
    await sendCluster(bus, center);
  }
}, INTERVAL_MS);

console.log(
  `Simulator running with ${BUSES.length} buses, variable users per bus, every ${INTERVAL_MS}ms → ${SERVER}`
);
