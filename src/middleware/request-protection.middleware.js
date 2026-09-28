const { AppError } = require("../utils/errors");

const DEVELOPMENT_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function configuredOrigins(env = process.env) {
  const configured = (env.FRONTEND_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (configured.length) return new Set(configured);
  if (env.NODE_ENV !== "production") return new Set(DEVELOPMENT_ORIGINS);
  return new Set();
}

function createCorsOptions(origins = configuredOrigins()) {
  return {
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    origin(origin, callback) {
      if (!origin) return callback(null, false);
      return callback(null, origins.has(origin));
    },
  };
}

function createOriginGuard(origins = configuredOrigins()) {
  return function originGuard(req, res, next) {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || req.headers.origin === undefined) {
      return next();
    }
    if (!origins.has(req.headers.origin)) {
      return next(new AppError("Request origin is not allowed", "FORBIDDEN_ORIGIN", 403));
    }
    return next();
  };
}

function createRateLimiter({ windowMs, max, key, now = Date.now, maxKeys = 10000 }) {
  const buckets = new Map();
  return function rateLimiter(req, res, next) {
    const current = now();
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= current) buckets.delete(bucketKey);
    }
    const identity = key(req);
    if (!identity) return next(new AppError("Request limit exceeded", "RATE_LIMITED", 429));
    let bucket = buckets.get(identity);
    if (!bucket || bucket.resetAt <= current) bucket = { count: 0, resetAt: current + windowMs };
    bucket.count += 1;
    buckets.delete(identity);
    buckets.set(identity, bucket);
    while (buckets.size > maxKeys) buckets.delete(buckets.keys().next().value);
    res.setHeader?.("RateLimit-Limit", String(max));
    res.setHeader?.("RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      return next(new AppError("Too many requests; try again later", "RATE_LIMITED", 429));
    }
    return next();
  };
}

function requestIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function requestUser(req) {
  return req.user?._id?.toString?.() || "";
}

module.exports = {
  configuredOrigins,
  createCorsOptions,
  createOriginGuard,
  createRateLimiter,
  requestIp,
  requestUser,
};
