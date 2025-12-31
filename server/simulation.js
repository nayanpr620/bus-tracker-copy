/**
 * Government-Grade Bus Simulation Engine v2.0
 * 
 * Features:
 * - Per-bus unique ETA based on actual route position
 * - Smooth ETA decay every tick
 * - Varied bus statuses (ON_TIME, SLOW, DELAYED)
 * - Dynamic reliability scoring
 * - Route-aware movement along polyline
 */

const S = require("./services/services");

// Config
const INTERVAL_MS = 2000; // Update every 2 seconds for smooth decay
const TOTAL_CAPACITY = 60;

// Seeded random for consistent bus attributes
function seededRandom(seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = ((hash << 5) - hash) + seed.charCodeAt(i);
        hash |= 0;
    }
    const x = Math.sin(hash) * 10000;
    return x - Math.floor(x);
}

// Compute total length of polyline in km
function polylineLength(polyline) {
    let total = 0;
    for (let i = 1; i < polyline.length; i++) {
        total += S.distanceKm(
            polyline[i - 1].lat, polyline[i - 1].lng,
            polyline[i].lat, polyline[i].lng
        );
    }
    return total;
}

// Interpolate position along polyline given t (0..1)
function interpolateAlongPolyline(polyline, t) {
    const totalLen = polylineLength(polyline);
    let targetDist = t * totalLen;

    for (let i = 1; i < polyline.length; i++) {
        const segLen = S.distanceKm(
            polyline[i - 1].lat, polyline[i - 1].lng,
            polyline[i].lat, polyline[i].lng
        );

        if (targetDist <= segLen) {
            const f = segLen === 0 ? 0 : targetDist / segLen;
            return {
                lat: polyline[i - 1].lat + (polyline[i].lat - polyline[i - 1].lat) * f,
                lng: polyline[i - 1].lng + (polyline[i].lng - polyline[i - 1].lng) * f
            };
        }
        targetDist -= segLen;
    }
    return polyline[polyline.length - 1];
}

// Get distance from bus position to a stop along route
function distanceToStopKm(bus, route, stopId) {
    const polyline = route.polyline;
    const totalLen = polylineLength(polyline);

    const stop = route.stops.find(s => s.id === stopId);
    if (!stop) return 999;

    const stopProj = S.projectAlongPolyline(polyline, stop);
    const stopT = totalLen > 0 ? stopProj.distanceFromStartKm / totalLen : 1;

    // Remaining distance along route
    // If bus is past stop (t > stopT), distance is 0 (or large if next loop)
    if (bus.t > stopT) return 0;

    // (stopT - busT) * totalLen
    return (stopT - bus.t) * totalLen;
}

// Compute ETA in minutes (with smooth decay)
// Kept for backward compat or specific usage, but updated logic is in computeBusIntelligence generally
function computeETAMinutes(distanceKm, speedKmh, delayFactor = 1.0) {
    const effectiveSpeed = Math.max(5, speedKmh * delayFactor);
    const etaMinutes = (distanceKm / effectiveSpeed) * 60;
    return Math.max(0, etaMinutes);
}

// Initialize bus with unique attributes and delay characteristics
function initializeBus(busId, routeId, busIndex = 0, totalBusesOnRoute = 1) {
    const route = S.getRoute(routeId);
    if (!route) return null;

    const totalRouteKm = polylineLength(route.polyline);

    // Seeded random values for this bus - each bus is unique
    const rSpeed = seededRandom(`speed_${busId}`);
    const rCrowd = seededRandom(`crowd_${busId}`);
    const rReliability = seededRandom(`rel_${busId}`);
    const rPosition = seededRandom(`pos_${busId}`);

    // Spread buses across FIRST 60% of route
    // This ensures buses are approaching stops, not past them
    // Bus 0: 0-15%, Bus 1: 15-30%, Bus 2: 30-45%, Bus 3: 45-60%
    const segmentSize = 0.15;
    const basePosition = busIndex * segmentSize;
    const randomOffset = rPosition * segmentSize * 0.8; // 80% of segment as variance
    const startT = Math.min(0.60, basePosition + randomOffset);

    // Initialize distance based on startT
    // remaining is from current pos to end (1.0)
    const remainingKm = Math.max(0, (1 - startT) * totalRouteKm);

    // Guarantee distribution of delay types using busIndex
    // This ensures variety on each route - not all ON_TIME or all DELAYED
    let delayType, delayFactor, baseReliability;
    const delayCategory = busIndex % 3; // 0, 1, or 2

    if (delayCategory === 0) {
        // ON_TIME buses - reliable, fast
        delayType = 'ON_TIME';
        delayFactor = 0.95 + rReliability * 0.1; // 0.95-1.05x speed
        baseReliability = 80 + rReliability * 20; // 80-100%
    } else if (delayCategory === 1) {
        // SLOW buses - moderate
        delayType = 'SLOW';
        delayFactor = 0.7 + rReliability * 0.15; // 0.7-0.85x speed
        baseReliability = 55 + rReliability * 25; // 55-80%
    } else {
        // DELAYED buses - problematic
        delayType = 'DELAYED';
        delayFactor = 0.45 + rReliability * 0.2; // 0.45-0.65x speed
        baseReliability = 40 + rReliability * 20; // 40-60%
    }

    // Base speed assignment (km/h)
    const baseSpeed = 25 + rSpeed * 20; // 25-45 km/h

    return {
        busId,
        routeId,

        // Persistent State for ETA
        totalRouteKm,
        remainingKm,

        t: startT, // Position along route (0-1) - Derived/Synced

        speed: baseSpeed,
        targetSpeed: baseSpeed, // Target speed to return to

        delayType,
        delayFactor,
        baseReliability: Math.round(baseReliability),
        reliability: Math.round(baseReliability),
        crowd: Math.floor(5 + rCrowd * 45), // 5-50%
        passengers: Math.floor(3 + rCrowd * 25),
        currentStopIndex: 0,
        dwellUntil: 0,
        dwellCount: 0,
        speedHistory: [], // Track speed for reliability
        updateCount: 0, // For freshness tracking
        lastUpdated: Date.now(),
        startedAt: Date.now()
    };
}

// Step bus forward with realistic movement
function stepBus(bus, route) {
    const polyline = route.polyline;
    const now = Date.now();

    // 1. Calculate Time Delta
    const deltaTimeSec = (now - bus.lastUpdated) / 1000;
    if (deltaTimeSec <= 0) return bus;

    // Check if dwelling at stop
    if (bus.dwellUntil && now < bus.dwellUntil) {
        bus.speed = 0;
        bus.lastUpdated = now;
        bus.updateCount++;
        return bus;
    }
    bus.dwellUntil = 0;

    // 2. Determine Speed
    // Apply delay factor to speed
    let currentSpeed = bus.targetSpeed * bus.delayFactor;

    // Add some natural speed variation
    const speedVariation = (Math.random() - 0.5) * 4;
    currentSpeed = Math.max(10, Math.min(55, currentSpeed + speedVariation));
    bus.speed = currentSpeed;

    // Track speed history for reliability calculation
    bus.speedHistory.push(currentSpeed);
    if (bus.speedHistory.length > 20) bus.speedHistory.shift();

    // 3. Move: Reduce remaining distance
    // distance = speed (km/h) * time (h)
    const distanceTraveled = (bus.speed / 3600) * deltaTimeSec;

    bus.remainingKm = Math.max(0, bus.remainingKm - distanceTraveled);

    // 4. Update t (position on map)
    // t = 1 - (remaining / total)
    if (bus.totalRouteKm > 0) {
        bus.t = 1 - (bus.remainingKm / bus.totalRouteKm);
    } else {
        bus.t = 0;
    }

    // Loop back when reaching end
    if (bus.remainingKm <= 0.05) { // < 50m to end
        bus.remainingKm = bus.totalRouteKm;
        bus.t = 0;
        bus.currentStopIndex = 0;
        bus.dwellCount = 0;
    }

    // Get position on polyline
    const pos = interpolateAlongPolyline(polyline, bus.t);
    bus.lat = pos.lat;
    bus.lng = pos.lng;

    // Check if near a stop - dwell logic
    // We can use the simple distance check or re-calculate
    const nearestStop = S.findNearestStop(route, bus.lat, bus.lng);
    if (nearestStop) {
        const distToStop = S.distanceKm(bus.lat, bus.lng, nearestStop.lat, nearestStop.lng);

        // Within 50 meters of stop
        if (distToStop < 0.05) {
            const stopIndex = route.stops.findIndex(s => s.id === nearestStop.id);
            if (stopIndex >= 0 && stopIndex !== bus.lastDwellStop) {
                bus.lastDwellStop = stopIndex;
                bus.currentStopIndex = stopIndex;
                bus.dwellCount++;

                // Dwell time varies by delay type
                let dwellTime = 5000;
                if (bus.delayType === 'DELAYED') {
                    dwellTime = 10000 + Math.random() * 10000; // 10-20 seconds
                } else if (bus.delayType === 'SLOW') {
                    dwellTime = 7000 + Math.random() * 5000; // 7-12 seconds
                } else {
                    dwellTime = 4000 + Math.random() * 4000; // 4-8 seconds
                }

                bus.dwellUntil = now + dwellTime;
                bus.speed = 0;

                // Crowd changes at stops
                const delta = Math.floor((Math.random() - 0.4) * 8);
                bus.passengers = Math.max(2, Math.min(55, bus.passengers + delta));
                bus.crowd = Math.round((bus.passengers / TOTAL_CAPACITY) * 100);
            }
        }

        bus.nearestStop = nearestStop.name;
        bus.nearestStopId = nearestStop.id;
    }

    // CALC HEADING
    // Calculate heading based on movement
    if (bus.lat && bus.lng && (bus.prevLat !== bus.lat || bus.prevLng !== bus.lng)) {
        if (bus.prevLat) {
            bus.heading = S.computeHeadingDeg(
                { lat: bus.prevLat, lng: bus.prevLng },
                { lat: bus.lat, lng: bus.lng }
            );
        }
        bus.prevLat = bus.lat;
        bus.prevLng = bus.lng;
    }

    bus.seatsRemaining = Math.max(0, TOTAL_CAPACITY - bus.passengers);
    bus.lastUpdated = now;
    bus.updateCount++;

    return bus;
}

// Compute comprehensive bus intelligence
function computeBusIntelligence(bus, route, pickupId, dropId) {
    const firstStop = route.stops[0];
    const lastStop = route.stops[route.stops.length - 1];
    const totalLen = bus.totalRouteKm;

    // Calculate actual remaining distances
    // For destination: It's simply the remainingKm state!
    const distToDest = bus.remainingKm;

    // For pickup: We need projected T of pickup
    const pickupStop = route.stops.find(s => s.id === pickupId) || firstStop;
    const stopProj = S.projectAlongPolyline(route.polyline, pickupStop);
    const pickupT = totalLen > 0 ? stopProj.distanceFromStartKm / totalLen : 0;

    // Distance to pickup is (pickupT - busT) * totalLen
    // If negative, we passed it.
    let distToPickup = (pickupT - bus.t) * totalLen;
    if (distToPickup < 0) distToPickup = 0; // passed

    // Calculate ETA
    // Calculate ETA
    // ETA = Distance / Speed * 60
    // Use TARGET speed (stable) instead of instantaneous speed (jittery)
    const stableSpeed = Math.max(10, bus.targetSpeed * bus.delayFactor);

    bus.etaToPickupMin = (distToPickup / stableSpeed) * 60;
    bus.etaToDestMin = (distToDest / stableSpeed) * 60;

    bus.distanceToPickupKm = distToPickup;
    bus.totalStops = route.stops.length;

    // Determine status based on delay type and ETA
    if (bus.speed === 0 && bus.dwellUntil > 0) {
        bus.status = "AT_STOP";
    } else if (distToPickup > 0 && distToPickup < 0.2) {
        bus.status = "ARRIVING";
    } else if (distToPickup === 0 && bus.t > pickupT + 0.02) {
        bus.status = "PASSED";
    } else if (bus.delayType === 'DELAYED') {
        bus.status = "DELAYED";
    } else if (bus.delayType === 'SLOW') {
        bus.status = "SLOW";
    } else {
        bus.status = "ON_TIME";
    }

    // Calculate dynamic reliability
    const ageMs = Date.now() - bus.lastUpdated;

    // Speed consistency score (based on variance)
    let speedConsistency = 100;
    if (bus.speedHistory.length > 5) {
        const avgSpeed = bus.speedHistory.reduce((a, b) => a + b, 0) / bus.speedHistory.length;
        const variance = bus.speedHistory.reduce((sum, s) => sum + Math.pow(s - avgSpeed, 2), 0) / bus.speedHistory.length;
        speedConsistency = Math.max(0, 100 - Math.sqrt(variance) * 5);
    }

    // Punctuality score (based on delay type)
    let punctualityScore = bus.delayType === 'ON_TIME' ? 100 :
        bus.delayType === 'SLOW' ? 70 : 40;

    // Freshness score
    let freshnessScore = ageMs < 5000 ? 100 : ageMs < 15000 ? 80 : ageMs < 30000 ? 50 : 20;

    // Dwell behavior score (stopping at stops = reliable)
    let dwellScore = Math.min(100, bus.dwellCount * 20);

    // Weighted reliability
    bus.reliability = Math.round(
        speedConsistency * 0.25 +
        punctualityScore * 0.35 +
        freshnessScore * 0.20 +
        dwellScore * 0.20
    );

    // Trust level
    if (ageMs < 10000) {
        bus.trustLevel = "High";
        bus.trustConfidence = 95;
    } else if (ageMs < 30000) {
        bus.trustLevel = "Medium";
        bus.trustConfidence = 70;
    } else {
        bus.trustLevel = "Low";
        bus.trustConfidence = 40;
    }

    return bus;
}

// Main simulation loop
function startSimulation(LIVE_BUS, io) {
    console.log("🚀 Starting Government-Grade Bus Simulation v2.0...");

    // Group buses by route first
    const busesPerRoute = {};
    Object.entries(S.BUS_ROUTE).forEach(([busId, routeId]) => {
        if (!busesPerRoute[routeId]) busesPerRoute[routeId] = [];
        busesPerRoute[routeId].push(busId);
    });

    // Initialize all buses with proper spacing
    Object.entries(busesPerRoute).forEach(([routeId, busIds]) => {
        const totalOnRoute = busIds.length;
        busIds.forEach((busId, index) => {
            LIVE_BUS[busId] = initializeBus(busId, routeId, index, totalOnRoute);
        });
    });

    console.log(`   Initialized ${Object.keys(LIVE_BUS).length} buses across all routes`);

    // Log initial positions for debugging
    Object.values(LIVE_BUS).forEach(bus => {
        if (bus.routeId === 'R1') {
            console.log(`   ${bus.busId}: pos=${(bus.t * 100).toFixed(1)}%, remaining=${bus.remainingKm.toFixed(2)}km`);
        }
    });

    // Simulation tick - runs every INTERVAL_MS
    setInterval(() => {
        const routeBuses = {};

        Object.values(LIVE_BUS).forEach(bus => {
            const route = S.getRoute(bus.routeId);
            if (!route) return;

            // Step bus forward
            stepBus(bus, route);

            // Compute intelligence
            computeBusIntelligence(bus, route, route.stops[0].id, route.stops[route.stops.length - 1].id);

            // Group for emission
            if (!routeBuses[bus.routeId]) routeBuses[bus.routeId] = [];
            routeBuses[bus.routeId].push({
                busId: bus.busId,
                routeId: bus.routeId,
                lat: bus.lat,
                lng: bus.lng,
                heading: bus.heading || 0,
                t: bus.t,
                speed: Math.round(bus.speed),
                crowd: bus.crowd,
                seatsRemaining: bus.seatsRemaining,
                reliability: bus.reliability,
                etaToPickupMin: Number(bus.etaToPickupMin.toFixed(1)),
                etaToDestMin: Number(bus.etaToDestMin.toFixed(1)),
                distanceToPickupKm: Number((bus.distanceToPickupKm || 0).toFixed(2)),
                status: bus.status,
                delayType: bus.delayType,
                nearestStop: bus.nearestStop,
                nearestStopId: bus.nearestStopId,
                currentStopIndex: bus.currentStopIndex || 0,
                totalStops: bus.totalStops || route.stops.length,
                trustLevel: bus.trustLevel,
                trustConfidence: bus.trustConfidence,
                lastUpdated: bus.lastUpdated
            });
        });

        // Emit updates per route
        Object.keys(routeBuses).forEach(routeId => {
            io.emit(`route:${routeId}`, routeBuses[routeId]);
        });

    }, INTERVAL_MS);
}

module.exports = {
    startSimulation,
    interpolateAlongPolyline,
    polylineLength,
    computeETAMinutes,
    distanceToStopKm
};
