require('dotenv').config();
const S = require("./services/services");
const express = require("express");
const http = require("http");
const cors = require("cors");

const mongoose = require("mongoose");
const { Server } = require("socket.io");

const redis = require("./redis"); // redis client
const { detectBus } = require("./cluster");

// -------------------------------
// Config for crowd and capacity
// -------------------------------
const TOTAL_CAPACITY = Number(process.env.TOTAL_CAPACITY || 60);
const PASSENGERS_PER_REPORT = 2;

// ⬇️ THIS WAS MISSING / TOO LOW
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// ⬇️ middleware must come AFTER app
app.use(cors());
app.use(express.json());
const path = require('path');
app.use(express.static(path.join(__dirname, '../client')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// -------------------------------
// In-memory live bus state
// -------------------------------
const LIVE_BUS = {};

// -------------------------------
// MongoDB Connection
// -------------------------------
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/bus_tracker";

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB error:", err));

// -------------------------------
// Basic health check
// -------------------------------
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

const User = require('./models/User');

// -------------------------------
// Auth API
// -------------------------------
app.post("/auth/signup", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    // Check existing
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: "User already exists" });

    const user = await User.create({ email, password });
    res.json({ success: true, user: { id: user._id, email: user.email, name: user.name } });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Signup failed" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || user.password !== password) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    res.json({ success: true, user: { id: user._id, email: user.email, name: user.name } });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// -------------------------------
// Routes API (USED BY FRONTEND)
// -------------------------------
app.get("/routes", (req, res) => {
  try {
    const routes = S.listRoutes();
    res.json(routes);
  } catch (err) {
    console.error("Error loading routes:", err);
    res.status(500).json({ error: "Failed to load routes" });
  }
});

// -------------------------------
// Discover Buses API (USED BY FRONTEND)
// Computes ETA to user-selected pickup/drop stops using bus state from simulation
// -------------------------------
app.get("/discover", (req, res) => {
  const { routeId, pickupId, dropId } = req.query;

  if (!routeId || !pickupId || !dropId) {
    return res.status(400).json({ error: "routeId, pickupId and dropId required" });
  }

  try {
    const route = S.getRoute(routeId);
    if (!route || !route.stops) {
      return res.json([]);
    }

    const pickupStop = route.stops.find(s => s.id === pickupId);
    const dropStop = route.stops.find(s => s.id === dropId);

    if (!pickupStop || !dropStop) {
      return res.json([]);
    }

    // Get buses for this route
    const buses = Object.keys(LIVE_BUS)
      .filter(busId => S.BUS_ROUTE[busId] === routeId)
      .map(busId => {
        const data = LIVE_BUS[busId];
        if (!data || !data.lat || !data.lng) return null;

        // Get bus current position
        const busPoint = { lat: data.lat, lng: data.lng };

        // Project bus and stops onto route
        const busProj = S.projectAlongPolyline(route.polyline, busPoint);
        const pickupProj = S.projectAlongPolyline(route.polyline, pickupStop);
        const dropProj = S.projectAlongPolyline(route.polyline, dropStop);

        // Check if bus has already passed the pickup
        const busPosKm = busProj.distanceFromStartKm;
        const pickupPosKm = pickupProj.distanceFromStartKm;
        const dropPosKm = dropProj.distanceFromStartKm;

        // Bus has passed pickup if its position is ahead of pickup on route
        const hasPassed = busPosKm > pickupPosKm + 0.1; // 100m buffer

        // Distance remaining to pickup (negative if passed)
        const distanceToPickupKm = pickupPosKm - busPosKm;
        const distanceToDropKm = dropPosKm - busPosKm;

        // Bus-specific speed with delay factor applied
        // Use delayFactor based speed which is stable, not instantaneous speed
        const effectiveSpeed = Math.max(10, (data.targetSpeed || 25) * (data.delayFactor || 1.0));

        // ETA calculations
        let etaToPickupMin = 0;
        let etaToDestMin = 0;

        if (!hasPassed && distanceToPickupKm > 0) {
          // Bus is approaching pickup
          etaToPickupMin = (distanceToPickupKm / effectiveSpeed) * 60;
        }

        if (distanceToDropKm > 0) {
          etaToDestMin = (distanceToDropKm / effectiveSpeed) * 60;
        }

        // Determine status
        let status = data.delayType || 'ON_TIME';
        if (hasPassed) {
          status = 'PASSED';
        } else if (data.speed === 0 && data.dwellUntil > Date.now()) {
          status = 'AT_STOP';
        } else if (distanceToPickupKm > 0 && distanceToPickupKm < 0.1) {
          status = 'ARRIVING';
        }

        return {
          busId,
          routeId,
          lat: data.lat,
          lng: data.lng,
          t: data.t || 0,
          speed: Math.round(data.speed || 0),
          crowd: data.crowd || 0,
          seatsRemaining: data.seatsRemaining || 0,

          // Reliability from simulation
          reliability: data.reliability || 50,

          // ETA - show actual value, not 0 for all
          etaToPickupMin: Number(Math.max(0, etaToPickupMin).toFixed(1)),
          etaToDestMin: Number(Math.max(0, etaToDestMin).toFixed(1)),
          distanceToPickupKm: Number(Math.max(0, distanceToPickupKm).toFixed(2)),

          // Has the bus passed the pickup?
          hasPassed,

          // Status based on delay type and position
          status,
          delayType: data.delayType || 'ON_TIME',

          trustLevel: data.trustLevel || 'Medium',
          trustConfidence: 70,
          nearestStop: data.nearestStop || null,
          nearestStopId: data.nearestStopId || null,
          currentStopIndex: data.currentStopIndex || 0,
          totalStops: route.stops.length,
          lastUpdated: data.lastUpdated || Date.now()
        };
      })
      .filter(b => b !== null);

    // Rank buses - reliability now affects ranking
    const ranked = S.rankBuses(buses);
    return res.json(ranked);
  } catch (err) {
    console.error("Discover error:", err);
    res.status(500).json({ error: "Failed to fetch buses" });
  }
});

// -------------------------------
// Redis Presence Helpers
// -------------------------------
const BUS_PRESENCE_TTL = 120; // seconds
const MIN_CROWD_REPORTS = 5; // quorum for crowd aggregation
const REPORT_TTL = 600; // seconds (10 minutes)

function calculateTrust(reportCount) {
  if (reportCount >= 10) {
    return { trustLevel: "High", trustConfidence: Math.min(95, 50 + reportCount * 5) };
  }
  if (reportCount >= 5) {
    return { trustLevel: "Medium", trustConfidence: Math.min(70, 40 + reportCount * 4) };
  }
  return { trustLevel: "Low", trustConfidence: 20 };
}

async function markUserInsideBus({ userId, busId }) {
  const key = `presence:bus:${busId}`;
  await redis.sadd(key, userId);
  await redis.expire(key, BUS_PRESENCE_TTL);
}

async function getBusUserCount(busId) {
  const key = `presence:bus:${busId}`;
  return await redis.scard(key);
}

async function hasUserReported(busId, userId) {
  return await redis.sismember(`reports:bus:${busId}`, userId);
}

async function markUserReported(busId, userId) {
  const key = `reports:bus:${busId}`;
  await redis.sadd(key, userId);
  await redis.expire(key, REPORT_TTL);
}

async function getReportCount(busId) {
  return await redis.scard(`reports:bus:${busId}`);
}

// -------------------------------
// Check if user is inside a bus (STEP 1)
// -------------------------------
app.get("/presence/check", async (req, res) => {
  const { userId, busId } = req.query;

  if (!userId || !busId) {
    return res.status(400).json({ inside: false });
  }

  try {
    const key = `presence:bus:${busId}`;
    const isInside = await redis.sismember(key, userId);
    res.json({ inside: Boolean(isInside) });
  } catch (err) {
    console.error("Presence check error:", err);
    res.status(500).json({ inside: false });
  }
});

app.post("/crowd/update", async (req, res) => {
  const { userId, lat, lng, speed, busId } = req.body;
  if (!userId || !busId || typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "Invalid GPS payload" });
  }

  // 1️⃣ Mark presence in Redis
  await markUserInsideBus({ userId, busId });

  // Reject crowd influence if user speed mismatches bus speed too much
  if (LIVE_BUS[busId]?.speed) {
    const speedDiff = Math.abs((speed || 0) - LIVE_BUS[busId].speed);
    if (speedDiff > 25) {
      return res.json({ ok: true, status: "speed_mismatch_ignored" });
    }
  }

  // Prevent duplicate reports from same user
  const alreadyReported = await hasUserReported(busId, userId);
  if (alreadyReported) {
    return res.json({ ok: true, status: "already_reported" });
  }
  await markUserReported(busId, userId);

  // 2️⃣ Count presence + reports
  const insideCount = await getBusUserCount(busId);
  const reportCount = await getReportCount(busId);

  // 🚨 ALWAYS update basic bus GPS so /discover works
  if (!LIVE_BUS[busId]) {
    LIVE_BUS[busId] = {
      reportsCount: 0,
      trustLevel: "Low",
      trustConfidence: 20
    };
  }

  LIVE_BUS[busId].lat = lat;
  LIVE_BUS[busId].lng = lng;
  LIVE_BUS[busId].speed = speed || 20;
  LIVE_BUS[busId].lastUpdated = Date.now();

  // ⛔ Crowd logic ONLY after quorum
  if (reportCount < MIN_CROWD_REPORTS) {
    return res.json({
      ok: true,
      status: "gps_updated_waiting_for_crowd",
      insideCount,
      reportCount
    });
  }

  // 3️⃣ Collect recent GPS points (in-memory only)
  if (!LIVE_BUS[busId].__users) LIVE_BUS[busId].__users = [];

  LIVE_BUS[busId].__users.push({
    lat,
    lng,
    speed: speed || 0
  });

  // Keep last 50 points only
  if (LIVE_BUS[busId].__users.length > 50) {
    LIVE_BUS[busId].__users.shift();
  }

  // Prevent stale accumulation
  if (LIVE_BUS[busId].__users.length === 1) {
    LIVE_BUS[busId].__usersStartTs = Date.now();
  }

  // 4️⃣ Detect bus location via clustering
  const det = detectBus(
    LIVE_BUS[busId].__users.map(u => ({
      lat: u.lat,
      lng: u.lng,
      speed: u.speed
    }))
  );

  if (!det) {
    return res.json({ ok: true, insideCount, detected: false });
  }

  const routeId = S.BUS_ROUTE[busId];
  const route = S.getRoute(routeId);

  if (!route || !route.stops || route.stops.length === 0) {
    // Skip update safely if route missing
    return res.json({ ok: true, insideCount, detected: false });
  }

  // projectAlongPolyline returns distance info, not lat/lng
  // so we keep detected lat/lng as authoritative
  const busPoint = {
    lat: det.lat,
    lng: det.lng
  };

  // 5️⃣ Update LIVE_BUS state with projected coordinates
  const pickup = route.stops[0];
  const drop = route.stops[route.stops.length - 1];

  const etaToPickupMin = S.etaAlongRouteMinutes(route, busPoint, pickup, det.speed);
  const etaToDestMin = S.etaAlongRouteMinutes(route, busPoint, drop, det.speed);

  // Find nearest stop
  const nearestStop = S.findNearestStop(route, busPoint.lat, busPoint.lng);

  // Crowd derived from quorum, not raw presence
  const passengers = Math.min(
    TOTAL_CAPACITY,
    Math.round(reportCount * PASSENGERS_PER_REPORT)
  );

  const crowdPercent = Math.min(
    100,
    Math.round((passengers / TOTAL_CAPACITY) * 100)
  );
  const seatsRemaining = Math.max(0, TOTAL_CAPACITY - passengers);

  const trust = calculateTrust(reportCount);

  LIVE_BUS[busId].lat = busPoint.lat;
  LIVE_BUS[busId].lng = busPoint.lng;
  LIVE_BUS[busId].speed = det.speed;
  LIVE_BUS[busId].crowd = crowdPercent;
  LIVE_BUS[busId].seatsRemaining = seatsRemaining;
  LIVE_BUS[busId].etaToPickupMin = etaToPickupMin;
  LIVE_BUS[busId].etaToDestMin = etaToDestMin;
  LIVE_BUS[busId].trustLevel = trust.trustLevel;
  LIVE_BUS[busId].trustConfidence = trust.trustConfidence;
  LIVE_BUS[busId].reportsCount = reportCount;
  LIVE_BUS[busId].nearestStop = nearestStop ? nearestStop.name : null;
  LIVE_BUS[busId].lastUpdated = Date.now();

  const update = {
    busId,
    ...LIVE_BUS[busId],
    routeId
  };

  // 6️⃣ Emit live updates for ALL buses on the route
  const routeBuses = Object.entries(LIVE_BUS)
    .filter(([id]) => S.BUS_ROUTE[id] === routeId)
    .map(([busId, data]) => ({
      busId,
      ...data,
      routeId
    }));

  io.emit(`route:${routeId}`, routeBuses);

  res.json({ ok: true, insideCount, detected: true });
});

// NOTE: Booking APIs removed - this is now a pure tracking app (Where Is My Bus style)

const PORT = process.env.PORT || 3000;
const { startSimulation } = require('./simulation');

// Export the app for Vercel serverless function
module.exports = app;

// Only listen if not running in production/Vercel (or if script is executed directly)
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`✅ Smart Transit backend running on http://localhost:${PORT}`);
    startSimulation(LIVE_BUS, io);
  });
} else {
  // If required as a module (e.g. by Vercel), we still need to start the simulation
  // However, Vercel functions scale to 0, so background simulation WONT WORK reliably.
  // We start it anyway for best-effort.
  startSimulation(LIVE_BUS, io);
}
