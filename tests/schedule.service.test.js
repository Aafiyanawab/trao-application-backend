const assert = require("node:assert/strict");
const test = require("node:test");

const { allocateSchedule } = require("../src/services/schedule.service");

function requirement(id, priority = "must") {
  return { id, priority };
}

function question(id, requirementIds, difficulty) {
  return { id, requirement_ids: requirementIds, difficulty };
}

function flattenQuestionIds(schedule) {
  return schedule.days.flatMap((day) => day.question_ids);
}

test("allocates a 1-day schedule", () => {
  const schedule = allocateSchedule(
    [question("q1", ["r1"], 2)],
    [requirement("r1")],
    1,
  );

  assert.equal(schedule.days_available, 1);
  assert.equal(schedule.days.length, 1);
  assert.deepEqual(schedule.days[0].question_ids, ["q1"]);
});

test("allocates a balanced multi-day schedule", () => {
  const schedule = allocateSchedule(
    [
      question("q1", ["r1"], 1),
      question("q2", ["r2"], 2),
      question("q3", ["r3"], 3),
      question("q4", ["r4"], 1),
    ],
    [requirement("r1"), requirement("r2"), requirement("r3"), requirement("r4")],
    2,
  );

  assert.equal(schedule.days.length, 2);
  assert.deepEqual(schedule.days.map((day) => day.question_ids.length), [2, 2]);
});

test("supports a 60-day schedule", () => {
  const schedule = allocateSchedule([question("q1", ["r1"], 1)], [requirement("r1")], 60);

  assert.equal(schedule.days.length, 60);
  assert.deepEqual(schedule.days[0].question_ids, ["q1"]);
  assert.equal(schedule.days[59].question_ids.length, 0);
});

test("returns exactly the requested number of day entries", () => {
  const schedule = allocateSchedule([], [], 7);

  assert.equal(schedule.days.length, 7);
  assert.deepEqual(schedule.days.map((day) => day.day), [1, 2, 3, 4, 5, 6, 7]);
});

test("uses integer minutes for every day", () => {
  const schedule = allocateSchedule(
    [question("q1", ["r1"], 1), question("q2", ["r2"], 3)],
    [requirement("r1"), requirement("r2")],
    2,
  );

  assert.ok(schedule.days.every((day) => Number.isInteger(day.minutes)));
  assert.deepEqual(schedule.days.map((day) => day.minutes), [60, 30]);
});

test("includes only valid question IDs in the schedule", () => {
  const questions = [question("q1", ["r1"], 2), question("q2", ["r2"], 1)];
  const schedule = allocateSchedule(questions, [requirement("r1"), requirement("r2")], 2);

  assert.deepEqual(new Set(flattenQuestionIds(schedule)), new Set(["q1", "q2"]));
});

test("places every must requirement in the schedule", () => {
  const questions = [
    question("q1", ["r1"], 1),
    question("q2", ["r2", "r3"], 2),
  ];
  const requirements = [requirement("r1"), requirement("r2"), requirement("r3")];
  const schedule = allocateSchedule(questions, requirements, 2);
  const scheduledQuestions = new Map(questions.map((item) => [item.id, item]));
  const coveredIds = new Set(
    flattenQuestionIds(schedule).flatMap((id) => scheduledQuestions.get(id).requirement_ids),
  );

  assert.deepEqual(coveredIds, new Set(["r1", "r2", "r3"]));
});

test("places harder questions earlier", () => {
  const schedule = allocateSchedule(
    [question("easy", ["r1"], 1), question("hard", ["r2"], 3)],
    [requirement("r1"), requirement("r2")],
    2,
  );

  assert.deepEqual(schedule.days[0].question_ids, ["hard"]);
  assert.deepEqual(schedule.days[1].question_ids, ["easy"]);
});

test("places higher-priority material before nice material", () => {
  const schedule = allocateSchedule(
    [question("nice", ["r-nice"], 3), question("must", ["r-must"], 1)],
    [requirement("r-must", "must"), requirement("r-nice", "nice")],
    2,
  );

  assert.deepEqual(schedule.days[0].question_ids, ["must"]);
  assert.deepEqual(schedule.days[1].question_ids, ["nice"]);
});

test("produces deterministic output for identical input", () => {
  const questions = [
    question("q1", ["r1"], 2),
    question("q2", ["r2"], 3),
    question("q3", ["r3"], 1),
  ];
  const requirements = [requirement("r1"), requirement("r2"), requirement("r3")];

  assert.deepEqual(
    allocateSchedule(questions, requirements, 2),
    allocateSchedule(questions, requirements, 2),
  );
});

test("does not mutate questions or requirements", () => {
  const questions = [question("q1", ["r1"], 2), question("q2", ["r2"], 1)];
  const requirements = [requirement("r1"), requirement("r2")];
  const beforeQuestions = structuredClone(questions);
  const beforeRequirements = structuredClone(requirements);

  allocateSchedule(questions, requirements, 2);

  assert.deepEqual(questions, beforeQuestions);
  assert.deepEqual(requirements, beforeRequirements);
});

test("handles an empty question set when there are no requirements", () => {
  const schedule = allocateSchedule([], [], 3);

  assert.deepEqual(schedule.days.map((day) => day.question_ids), [[], [], []]);
  assert.deepEqual(schedule.days.map((day) => day.minutes), [0, 0, 0]);
});

test("rejects malformed input with a structured validation error", () => {
  assert.throws(
    () => allocateSchedule([{ id: "q1", requirement_ids: ["r1"], difficulty: 2 }], [requirement("r1")], 0),
    (error) => error.code === "VALIDATION_ERROR" && error.statusCode === 400,
  );
});

test("rejects a must requirement with no covering question", () => {
  assert.throws(
    () => allocateSchedule([], [requirement("r1")], 1),
    (error) => error.code === "VALIDATION_ERROR" && error.statusCode === 400,
  );
});
