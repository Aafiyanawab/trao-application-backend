const assert = require("node:assert/strict");
const test = require("node:test");

const {
  configuredOrigins,
  createCorsOptions,
  createOriginGuard,
  createRateLimiter,
} = require("../src/middleware/request-protection.middleware");

test("CORS permits configured frontend origin with session credentials", () => {
  const origins = configuredOrigins({ NODE_ENV: "production", FRONTEND_ORIGIN: "https://app.example.test" });
  const options = createCorsOptions(origins);
  let result;
  options.origin("https://app.example.test", (error, allowed) => { result = { error, allowed }; });
  assert.deepEqual(result, { error: null, allowed: true });
  assert.equal(options.credentials, true);
});

test("CORS denies unconfigured production origins and supports local development origins", () => {
  const production = createCorsOptions(configuredOrigins({ NODE_ENV: "production" }));
  let allowed;
  production.origin("https://attacker.example", (error, value) => { assert.ifError(error); allowed = value; });
  assert.equal(allowed, false);

  const development = createCorsOptions(configuredOrigins({ NODE_ENV: "development" }));
  development.origin("http://localhost:5173", (error, value) => { assert.ifError(error); allowed = value; });
  assert.equal(allowed, true);
});

test("Origin guard rejects foreign state-changing origins but allows absent origins and reads", () => {
  const guard = createOriginGuard(new Set(["https://app.example.test"]));
  let error;
  guard({ method: "POST", headers: { origin: "https://evil.example" } }, {}, (value) => { error = value; });
  assert.equal(error.code, "FORBIDDEN_ORIGIN");
  error = undefined;
  guard({ method: "POST", headers: {} }, {}, (value) => { error = value; });
  assert.equal(error, undefined);
  guard({ method: "GET", headers: { origin: "https://evil.example" } }, {}, (value) => { error = value; });
  assert.equal(error, undefined);
});

test("rate limit rejects requests above its bounded per-key window", () => {
  let time = 1000;
  const limiter = createRateLimiter({ windowMs: 60000, max: 2, key: (req) => req.identity, now: () => time, maxKeys: 2 });
  const request = { identity: "user-1" };
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
  let error;
  for (let index = 0; index < 2; index += 1) limiter(request, response, (value) => { error = value; });
  assert.equal(error, undefined);
  limiter(request, response, (value) => { error = value; });
  assert.equal(error.code, "RATE_LIMITED");
  assert.equal(error.statusCode, 429);
  assert.equal(response.headers["RateLimit-Limit"], "2");
  time += 60001;
  limiter(request, response, (value) => { error = value; });
  assert.equal(error, undefined);
});
