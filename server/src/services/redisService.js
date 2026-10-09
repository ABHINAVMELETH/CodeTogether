const Redis = require("ioredis");

const redisUrl =
  process.env.REDIS_URL ||
  "redis://localhost:6379";

/*
 * =========================================================
 * PUBLISHER
 * =========================================================
 *
 * Used to publish messages to Redis.
 */

const redisPublisher =
  new Redis(redisUrl);

/*
 * =========================================================
 * SUBSCRIBER
 * =========================================================
 *
 * IMPORTANT:
 * Redis connections that are subscribed to channels
 * cannot be used normally for other Redis commands.
 *
 * Therefore we keep a separate connection.
 */

const redisSubscriber =
  new Redis(redisUrl);

/*
 * =========================================================
 * CONNECTION LOGGING
 * =========================================================
 */

redisPublisher.on("connect", () => {
  console.log(
    "Redis publisher connected"
  );
});

redisSubscriber.on("connect", () => {
  console.log(
    "Redis subscriber connected"
  );
});

redisPublisher.on("error", (error) => {
  console.error(
    "Redis publisher error:",
    error
  );
});

redisSubscriber.on("error", (error) => {
  console.error(
    "Redis subscriber error:",
    error
  );
});

/*
 * =========================================================
 * PUBLISH
 * =========================================================
 */

const publish = async (
  channel,
  message
) => {
  await redisPublisher.publish(
    channel,
    JSON.stringify(message)
  );
};

/*
 * =========================================================
 * CLOSE
 * =========================================================
 */

const closeRedis = async () => {
  await Promise.all([
    redisPublisher.quit(),
    redisSubscriber.quit(),
  ]);
};

module.exports = {
  redisPublisher,
  redisSubscriber,
  publish,
  closeRedis,
};