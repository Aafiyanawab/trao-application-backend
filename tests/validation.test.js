const assert = require("node:assert/strict");
const test = require("node:test");

const {
  validateEmail,
  validatePassword,
  validateRegisterPayload,
  validateLoginPayload,
} = require("../src/utils/validation");

test("email and password limits accept the boundary and reject oversized values", () => {
  assert.equal(validateEmail(`${"a".repeat(242)}@example.com`).length, 254);
  assert.throws(() => validateEmail(`${"a".repeat(243)}@example.com`), (error) => error.code === "VALIDATION_ERROR");
  assert.equal(validatePassword("p".repeat(1024)).length, 1024);
  assert.throws(() => validatePassword("p".repeat(1025)), (error) => error.code === "VALIDATION_ERROR");
  assert.throws(() => validateRegisterPayload({ email: "a@example.com", password: "p".repeat(1025) }), (error) => error.code === "VALIDATION_ERROR");
  assert.throws(() => validateLoginPayload({ email: "a@example.com", password: "p".repeat(1025) }), (error) => error.code === "VALIDATION_ERROR");
});
