const assert = require("node:assert/strict");
const test = require("node:test");

const { errorHandler } = require("../src/middleware/error.middleware");
const { AppError } = require("../src/utils/errors");

function response() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("returns safe structured Gemini failures with their useful AppError message", () => {
  const res = response();
  const previousError = console.error;
  console.error = () => {};
  try {
    errorHandler(new AppError("Gemini could not generate interview content", "GEMINI_API_ERROR", 502), {}, res, () => {});
  } finally {
    console.error = previousError;
  }

  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, {
    error: { code: "GEMINI_API_ERROR", message: "Gemini could not generate interview content" },
  });
});

test("preserves structured validation errors and details", () => {
  const res = response();
  const details = [{ path: "body.daysAvailable", message: "must be an integer" }];
  errorHandler(new AppError("Generation input is invalid", "VALIDATION_ERROR", 400, details), {}, res, () => {});

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body.error, {
    code: "VALIDATION_ERROR",
    message: "Generation input is invalid",
    details,
  });
});

test("does not expose raw internal error messages or stack traces", () => {
  const res = response();
  const secret = "GEMINI_API_KEY=secret-value";
  const error = new Error(`${secret}\ninternal provider stack`);
  error.code = "EINTERNAL";
  error.statusCode = 502;
  error.details = { credential: secret };
  const previousError = console.error;
  console.error = () => {};
  try {
    errorHandler(error, {}, res, () => {});
  } finally {
    console.error = previousError;
  }

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
  });
  assert.equal(JSON.stringify(res.body).includes(secret), false);
  assert.equal(JSON.stringify(res.body).includes("internal provider stack"), false);
});
