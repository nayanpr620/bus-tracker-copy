const redis = require("./redis");

const USER_TTL = 20; // seconds (user must ping every ~5–10s)

async function markUserInsideBus({ userId, busId }) {
  const userKey = `user:${userId}:bus`;
  const busKey = `bus:${busId}:users`;

  // Remove user from old bus if exists
  const oldBus = await redis.get(userKey);
  if (oldBus && oldBus !== busId) {
    await redis.srem(`bus:${oldBus}:users`, userId);
  }

  // Add user to bus set
  await redis.sadd(busKey, userId);

  // Map user -> bus
  await redis.set(userKey, busId, "EX", USER_TTL);

  // Expire bus set automatically if empty
  await redis.expire(busKey, USER_TTL + 5);
}

async function getBusUserCount(busId) {
  return redis.scard(`bus:${busId}:users`);
}

async function hasUserReported(busId, userId) {
  return redis.sismember(`bus:${busId}:reported`, userId);
}

async function markUserReported(busId, userId) {
  await redis.sadd(`bus:${busId}:reported`, userId);
  await redis.expire(`bus:${busId}:reported`, 600); // 10 min window
}

module.exports = {
  markUserInsideBus,
  getBusUserCount,
  hasUserReported,
  markUserReported
};