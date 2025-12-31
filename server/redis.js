const Redis = require("ioredis");

const redis = new Redis(process.env.REDIS_URL || {
  host: "127.0.0.1",
  port: 6379
});

redis.on("connect", () => {
  console.log("✅ Redis connected");
});

module.exports = redis;