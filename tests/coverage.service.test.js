const assert = require("node:assert/strict");
const test = require("node:test");

const { checkCoverage } = require("../src/services/coverage.service");

function kit(requirements, questions = [], passes = 1) {
  return {
    role: { requirements },
    questions,
    coverage: { passes },
  };
}

function requirement(id, priority = "must") {
  return { id, priority };
}

function question(id, requirementIds) {
  return { id, requirement_ids: requirementIds };
}

test("reports all must requirements covered", () => {
  const result = checkCoverage(
    kit([requirement("r1"), requirement("r2", "nice")], [question("q1", ["r1"])]),
  );

  assert.deepEqual(result.uncovered_requirement_ids, ["r2"]);
  assert.equal(result.all_must_requirements_covered, true);
  assert.equal(result.passes, 1);
});

test("reports one uncovered must requirement", () => {
  const result = checkCoverage(kit([requirement("r1"), requirement("r2")], [question("q1", ["r1"])]));

  assert.deepEqual(result.uncovered_requirement_ids, ["r2"]);
  assert.equal(result.all_must_requirements_covered, false);
});

test("reports multiple uncovered must requirements", () => {
  const result = checkCoverage(
    kit([requirement("r1"), requirement("r2"), requirement("r3")], [question("q1", ["r1"])], 2),
  );

  assert.deepEqual(result.uncovered_requirement_ids, ["r2", "r3"]);
  assert.equal(result.all_must_requirements_covered, false);
  assert.equal(result.passes, 2);
});

test("reports an uncovered nice requirement without failing must coverage", () => {
  const result = checkCoverage(kit([requirement("r1", "nice")], []));

  assert.deepEqual(result.uncovered_requirement_ids, ["r1"]);
  assert.equal(result.all_must_requirements_covered, true);
});

test("handles multiple questions covering the same requirement", () => {
  const result = checkCoverage(
    kit([requirement("r1")], [question("q1", ["r1"]), question("q2", ["r1"])]),
  );

  assert.deepEqual(result.covered_requirement_ids, ["r1"]);
  assert.deepEqual(result.uncovered_requirement_ids, []);
});

test("handles a question covering multiple requirements", () => {
  const result = checkCoverage(
    kit([requirement("r1"), requirement("r2")], [question("q1", ["r1", "r2"])]),
  );

  assert.deepEqual(result.covered_requirement_ids, ["r1", "r2"]);
  assert.equal(result.all_must_requirements_covered, true);
});

test("preserves requirement order in uncovered IDs", () => {
  const result = checkCoverage(
    kit(
      [requirement("r3"), requirement("r1"), requirement("r2")],
      [question("q1", ["r1"])],
    ),
  );

  assert.deepEqual(result.uncovered_requirement_ids, ["r3", "r2"]);
});

test("handles empty requirements", () => {
  const result = checkCoverage(kit([], []));

  assert.deepEqual(result.uncovered_requirement_ids, []);
  assert.deepEqual(result.covered_requirement_ids, []);
  assert.equal(result.all_must_requirements_covered, true);
});

test("handles empty questions", () => {
  const result = checkCoverage(kit([requirement("r1")], []));

  assert.deepEqual(result.uncovered_requirement_ids, ["r1"]);
  assert.equal(result.all_must_requirements_covered, false);
});

test("does not mutate the input kit", () => {
  const input = kit([requirement("r1")], [question("q1", ["r1"])]);
  const before = structuredClone(input);

  checkCoverage(input, 3);

  assert.deepEqual(input, before);
});

test("rejects malformed coverage input with a structured validation error", () => {
  assert.throws(
    () => checkCoverage({ role: { requirements: [] } }),
    (error) => error.code === "VALIDATION_ERROR" && error.statusCode === 400,
  );
});
