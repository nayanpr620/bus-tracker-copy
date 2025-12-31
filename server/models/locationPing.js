const mongoose = require("mongoose");

/**
 * LocationPing
 * ----------------
 * This collection stores historical GPS pings for analytics,
 * replay, heatmaps, and ML training.
 *
 * ⚠️ NOT used for realtime presence or crowd logic.
 * Realtime logic is handled by Redis.
 */

const LocationPingSchema = new mongoose.Schema({
  userId: { type: String, index: true },
  busId: { type: String, index: true },
  lat: Number,
  lng: Number,
  speed: Number,
  createdAt: { type: Date, default: Date.now, index: true }
});

// Optional: auto-expire after 24 hours (safe to enable later)
// LocationPingSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model("LocationPing", LocationPingSchema);