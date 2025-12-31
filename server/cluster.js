const clustering = require("density-clustering");
const dbscan = new clustering.DBSCAN();

// --- CONFIG (bus-scale reality) ---
const EPS_METERS = 25;      // max distance between passengers
const MIN_POINTS = 5;      // minimum users to detect a bus
const EARTH_RADIUS = 6371000;

// Convert lat/lng to meters (local projection)
function toMeters(lat, lng, refLat) {
  const x = (lng * Math.PI / 180) * EARTH_RADIUS * Math.cos(refLat * Math.PI / 180);
  const y = (lat * Math.PI / 180) * EARTH_RADIUS;
  return [x, y];
}

// Haversine distance (meters)
function distanceMeters(a, b) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
}

function detectBus(users) {
  if (!users || users.length < MIN_POINTS) return null;

  // Reference latitude for projection
  const refLat = users[0].lat;

  // Convert all users to meter space
  const points = users.map(u => toMeters(u.lat, u.lng, refLat));

  // Run DBSCAN in meters
  const clusters = dbscan.run(points, EPS_METERS, MIN_POINTS);
  if (!clusters.length) return null;

  // Pick the LARGEST cluster (real bus)
  const mainCluster = clusters.reduce((a, b) =>
    b.length > a.length ? b : a
  );

  const busUsers = mainCluster.map(i => users[i]);

  // Average position
  const avgLat =
    busUsers.reduce((s, u) => s + u.lat, 0) / busUsers.length;
  const avgLng =
    busUsers.reduce((s, u) => s + u.lng, 0) / busUsers.length;

  // Average speed (ignore outliers)
  const speeds = busUsers
    .map(u => u.speed || 0)
    .filter(s => s >= 3 && s <= 80);

  const avgSpeed =
    speeds.reduce((a, s) => a + s, 0) / Math.max(1, speeds.length);

  // Spatial spread (confidence)
  const spread =
    busUsers.reduce((max, u) => {
      const d = distanceMeters({ lat: avgLat, lng: avgLng }, u);
      return Math.max(max, d);
    }, 0);

  const confidence =
    spread < 10 ? "High" :
    spread < 20 ? "Medium" :
    "Low";

  return {
    lat: Number(avgLat.toFixed(6)),
    lng: Number(avgLng.toFixed(6)),
    speed: Math.max(5, Number(avgSpeed.toFixed(1))),
    crowdCount: busUsers.length,
    confidence,
    spreadMeters: Math.round(spread)
  };
}

module.exports = { detectBus };