// Modular services scaffolding for Smart Transit MVP
// This file encapsulates route/geo, tracking, ETA, crowd, ranking, and booking utilities.
// Step 1: Provide in-memory demo data and pure functions.
// Step 2 (next commit): Wire into server/index.js routes and sockets.

const { calculateETA, distanceKm } = require("../eta");

// ---------------- Route Service ----------------
const ROUTES = [
  {
    id: "R_UK_DEL",
    name: "Haldwani → Anand Vihar",
    stops: [
      { id: "S1", name: "Haldwani Bus Stop", lat: 29.2183, lng: 79.5130 },
      { id: "S2", name: "Rudrapur Bus Depot", lat: 28.9740, lng: 79.4050 },
      { id: "S3", name: "Around Bilaspur via bypass", lat: 28.8850, lng: 79.2800 },
      { id: "S4", name: "Outside Bilaspur", lat: 28.8800, lng: 79.2700 },
      { id: "S5", name: "Arrived Rampur", lat: 28.8100, lng: 79.0250 },
      { id: "S6", name: "Rampur Bus stand", lat: 28.8030, lng: 79.0250 },
      { id: "S7", name: "Moradabad Bypass - Delhi Hi...", lat: 28.8350, lng: 78.7700 }, // Approx bypass
      { id: "S8", name: "Teerthanker Mahaveer Unive...", lat: 28.8250, lng: 78.6600 },
      { id: "S9", name: "Joya", lat: 28.8400, lng: 78.5000 },
      { id: "S10", name: "Haldiram’s - Gajraula", lat: 28.8350, lng: 78.2350 },
      { id: "S11", name: "Garh Ganga", lat: 28.8000, lng: 78.1000 },
      { id: "S12", name: "Gharmuktesar", lat: 28.7800, lng: 78.0500 },
      { id: "S13", name: "Hapur Bypass", lat: 28.7100, lng: 77.7800 },
      { id: "S14", name: "New Bus Stand, Pilkhuwa", lat: 28.7050, lng: 77.6550 },
      { id: "S15", name: "Dasna", lat: 28.6750, lng: 77.5250 },
      { id: "S16", name: "Delhi - Moradabad - kashipur...", lat: 28.6600, lng: 77.4500 }, // Approx highway segment
      { id: "S17", name: "JAYPEE INSTITUTE OF INFO...", lat: 28.6300, lng: 77.3700 }, // Noida/border area approx
      { id: "S18", name: "ISBT Anand Vihar", lat: 28.6469, lng: 77.3160 },
      { id: "S19", name: "Point 22", lat: 28.6450, lng: 77.3150 } // Just a bit further to finish
    ],
    // Simplified polyline following the general path
    polyline: [
      { lat: 29.2183, lng: 79.5130 }, // Haldwani
      { lat: 28.9740, lng: 79.4050 }, // Rudrapur
      { lat: 28.8850, lng: 79.2800 }, // Bilaspur Area
      { lat: 28.8030, lng: 79.0250 }, // Rampur
      { lat: 28.8386, lng: 78.7733 }, // Moradabad Bypass
      { lat: 28.8350, lng: 78.2350 }, // Gajraula
      { lat: 28.7800, lng: 78.0500 }, // Gharmuktesar
      { lat: 28.7306, lng: 77.7759 }, // Hapur
      { lat: 28.7050, lng: 77.6550 }, // Pilkhuwa
      { lat: 28.6750, lng: 77.5250 }, // Dasna
      { lat: 28.6469, lng: 77.3160 }  // Anand Vihar
    ]
  }
];

// Single bus assignment
const BUS_ROUTE = {
  BUS_UK04: "R_UK_DEL"
};

function listRoutes() { return ROUTES.map(({ id, name, stops, polyline }) => ({ id, name, stops, polyline })); }
function getRoute(routeId) { return ROUTES.find(r => r.id === routeId) || null; }

function findNearestStop(route, lat, lng) {
  return route.stops
    .map(s => ({ s, d: distanceKm(lat, lng, s.lat, s.lng) }))
    .sort((a, b) => a.d - b.d)[0]?.s || null;
}

function projectAlongPolyline(polyline, point) {
  let best = {
    lat: polyline[0].lat,
    lng: polyline[0].lng,
    distanceFromStartKm: 0,
    totalKm: 0,
    minDist: Infinity
  };

  let travelled = 0;
  let total = 0;

  // compute total length
  for (let i = 1; i < polyline.length; i++) {
    total += distanceKm(
      polyline[i - 1].lat,
      polyline[i - 1].lng,
      polyline[i].lat,
      polyline[i].lng
    );
  }

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];

    const ax = a.lat, ay = a.lng;
    const bx = b.lat, by = b.lng;
    const px = point.lat, py = point.lng;

    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;

    const abLenSq = abx * abx + aby * aby;
    const t = abLenSq === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));

    const projLat = ax + abx * t;
    const projLng = ay + aby * t;

    const d = distanceKm(px, py, projLat, projLng);

    if (d < best.minDist) {
      best = {
        lat: projLat,
        lng: projLng,
        distanceFromStartKm: travelled + distanceKm(ax, ay, projLat, projLng),
        totalKm: total,
        minDist: d
      };
    }

    travelled += distanceKm(ax, ay, bx, by);
  }

  return best;
}

// ---------------- Tracking Service ----------------
function smoothSpeed(prevSpeed, newSpeed, alpha = 0.4) {
  if (prevSpeed == null) return newSpeed;
  return alpha * newSpeed + (1 - alpha) * prevSpeed;
}

function computeHeadingDeg(prev, curr) {
  // simple bearing calculation
  const y = Math.sin((curr.lng - prev.lng)) * Math.cos(curr.lat);
  const x = Math.cos(prev.lat) * Math.sin(curr.lat) - Math.sin(prev.lat) * Math.cos(curr.lat) * Math.cos(curr.lng - prev.lng);
  let brng = Math.atan2(y, x) * 180 / Math.PI;
  if (brng < 0) brng += 360; return brng;
}

// ---------------- ETA Service ----------------
function etaToPointMinutes(from, to, speedKmh = 25) {
  return calculateETA(from.lat, from.lng, to.lat, to.lng, speedKmh);
}

function etaAlongRouteMinutes(route, busPoint, stopPoint, speedKmh = 25) {
  const busProj = projectAlongPolyline(route.polyline, busPoint);
  const stopProj = projectAlongPolyline(route.polyline, stopPoint);

  const remainingKm = Math.max(
    0,
    stopProj.distanceFromStartKm - busProj.distanceFromStartKm
  );

  const speed = Math.max(5, speedKmh || 25);
  return Number(((remainingKm / speed) * 60).toFixed(1));
}

// ---------------- Ranking Service ----------------
// Government-grade bus ranking with reliability priority
// Weights: ETA 35%, Reliability 25%, Crowd 20%, Speed 10%, Freshness 10%

function computeBusScore(bus) {
  // If bus has passed pickup, give it a terrible score equivalent to "do not show"
  if (bus.hasPassed || bus.status === 'PASSED') {
    return -9999;
  }

  // Normalize values to 0-100 scale

  // ETA: Lower ETA = higher score (max 35 points)
  // Cap at 30 min for normalization
  const eta = Math.min(30, bus.etaToPickupMin || 30);
  const etaNorm = Math.max(0, 100 - (eta / 30) * 100);

  // Reliability: Higher = better (max 25 points)
  // This is CRITICAL - reliable buses should be preferred
  const reliabilityNorm = bus.reliability || 50;

  // Crowd: Lower = better (max 20 points)
  const crowdNorm = Math.max(0, 100 - (bus.crowd || 50));

  // Speed: Consider if bus is moving (max 10 points)
  const speedNorm = bus.speed > 0 ? Math.min(100, bus.speed * 3) : 40;

  // Freshness: Recent update = better (max 10 points)
  const ageMs = Date.now() - (bus.lastUpdated || 0);
  const freshnessNorm = ageMs < 5000 ? 100 : ageMs < 15000 ? 80 : ageMs < 30000 ? 50 : 20;

  // Weighted sum
  const score =
    etaNorm * 0.35 +
    reliabilityNorm * 0.25 +
    crowdNorm * 0.20 +
    speedNorm * 0.10 +
    freshnessNorm * 0.10;

  return Math.round(score);
}

function rankBuses(buses) {
  if (!buses || buses.length === 0) return [];

  // Compute scores
  const scored = buses.map(b => ({
    ...b,
    score: computeBusScore(b)
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Find best in each category
  const fastestIdx = scored.reduce((best, b, i) =>
    (b.etaToPickupMin || 999) < (scored[best].etaToPickupMin || 999) ? i : best, 0);
  const leastCrowdedIdx = scored.reduce((best, b, i) =>
    (b.crowd || 100) < (scored[best].crowd || 100) ? i : best, 0);
  const mostSeatsIdx = scored.reduce((best, b, i) =>
    (b.seatsRemaining || 0) > (scored[best].seatsRemaining || 0) ? i : best, 0);

  // Assign labels
  return scored.map((b, i) => {
    const labels = [];

    if (i === 0) labels.push("BEST CHOICE");
    if (i === fastestIdx && !labels.includes("BEST CHOICE")) labels.push("FASTEST");
    if (i === leastCrowdedIdx && labels.length === 0) labels.push("LESS CROWDED");
    if (i === mostSeatsIdx && labels.length === 0) labels.push("MOST SEATS");

    return {
      ...b,
      rank: i + 1,
      label: labels[0] || (b.status === "ON TIME" ? "ON TIME" : "AVAILABLE")
    };
  });
}

function labelFor(b) {
  const labels = [];
  if ((b.etaToDestMin || 999) < 20) labels.push("Fastest");
  if ((b.fullness || 0) < 40) labels.push("Less crowded");
  if ((b.delayMin || 0) < 3) labels.push("On-time");
  return labels[0] || "Recommended";
}

module.exports = {
  // data
  ROUTES,
  BUS_ROUTE,
  // route helpers
  listRoutes,
  getRoute,
  findNearestStop,
  projectAlongPolyline,
  // tracking helpers
  smoothSpeed,
  computeHeadingDeg,
  // eta helpers
  etaToPointMinutes,
  etaAlongRouteMinutes,
  // ranking
  rankBuses,
  // Additional exports needed by index.js
  distanceKm
};
