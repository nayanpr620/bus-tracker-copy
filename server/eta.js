// Accurate distance using Haversine formula (meters → km)
function distanceKm(aLat, aLng, bLat, bLng) {
  if (
    aLat == null || aLng == null ||
    bLat == null || bLng == null
  ) return 0;

  const toRad = d => (d * Math.PI) / 180;

  const R = 6371; // Earth radius in km
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);

  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ETA calculation with realistic guards
function calculateETA(aLat, aLng, bLat, bLng, speedKmh = 25) {
  const km = distanceKm(aLat, aLng, bLat, bLng);

  // If already at destination
  if (km < 0.03) return 0.5; // ~30m → arriving

  // Clamp speed (bus reality)
  const speed = Math.min(60, Math.max(5, speedKmh || 25));

  const minutes = (km / speed) * 60;

  // Safety clamp
  if (!isFinite(minutes) || minutes < 0) return 0;

  return Number(minutes.toFixed(1));
}

module.exports = { calculateETA, distanceKm };