const assert = require("node:assert/strict");
const test = require("node:test");

const { validateKitStructure } = require("../src/utils/kit-validator");

function validKit() {
  return {
    source: {
      company: "Acme",
      company_url: "https://acme.example",
      role: "Senior Engineer",
      location: "Remote",
      jd_chars: 1200,
      researched_at: "2026-09-26T00:00:00.000Z",
      pages_used: ["https://acme.example/about"],
    },
    company_brief: {
      summary: "An engineering company.",
      what_they_do: "Builds useful software.",
      sources: ["https://acme.example/about"],
    },
    role: {
      title: "Senior Engineer",
      seniority: "Senior",
      responsibilities: ["Build software"],
      requirements: [
        {
          id: "r1",
          text: "Experience with Node.js",
          kind: "technical",
          priority: "must",
        },
      ],
    },
    questions: [
      {
        id: "q1",
        requirement_ids: ["r1"],
        category: "technical",
        prompt: "How do you use Node.js?",
        answer_outline: "Discuss practical experience.",
        difficulty: 2,
      },
    ],
    flashcards: [
      {
        id: "f1",
        front: "Node.js",
        back: "A JavaScript runtime.",
        requirement_ids: ["r1"],
      },
    ],
    schedule: {
      days_available: 1,
      days: [
        {
          day: 1,
          focus: "Node.js practice",
          question_ids: ["q1"],
          minutes: 30,
        },
      ],
    },
    coverage: {
      uncovered_requirement_ids: [],
      passes: 2,
    },
  };
}

function assertValidationError(kit, expectedPath) {
  assert.throws(
    () => validateKitStructure(kit),
    (error) => {
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.statusCode, 400);
      assert.ok(Array.isArray(error.details));
      if (expectedPath) {
        assert.ok(error.details.some((detail) => detail.path === expectedPath));
      }
      return true;
    },
  );
}

test("accepts a valid kit", () => {
  const kit = validKit();
  assert.equal(validateKitStructure(kit), kit);
});

test("rejects a missing required field", () => {
  const kit = validKit();
  delete kit.company_brief.what_they_do;
  assertValidationError(kit, "company_brief.what_they_do");
});

test("rejects an invalid requirement kind", () => {
  const kit = validKit();
  kit.role.requirements[0].kind = "other";
  assertValidationError(kit, "role.requirements[0].kind");
});

test("rejects an invalid requirement priority", () => {
  const kit = validKit();
  kit.role.requirements[0].priority = "required";
  assertValidationError(kit, "role.requirements[0].priority");
});

test("rejects an invalid question difficulty", () => {
  const kit = validKit();
  kit.questions[0].difficulty = 4;
  assertValidationError(kit, "questions[0].difficulty");
});

test("rejects a question referencing a nonexistent requirement", () => {
  const kit = validKit();
  kit.questions[0].requirement_ids = ["missing"];
  assertValidationError(kit, "questions[0].requirement_ids[0]");
});

test("rejects a flashcard referencing a nonexistent requirement", () => {
  const kit = validKit();
  kit.flashcards[0].requirement_ids = ["missing"];
  assertValidationError(kit, "flashcards[0].requirement_ids[0]");
});

test("rejects a schedule referencing a nonexistent question", () => {
  const kit = validKit();
  kit.schedule.days[0].question_ids = ["missing"];
  assertValidationError(kit, "schedule.days[0].question_ids[0]");
});

test("rejects non-integer schedule minutes", () => {
  const kit = validKit();
  kit.schedule.days[0].minutes = 30.5;
  assertValidationError(kit, "schedule.days[0].minutes");
});

test("rejects an invalid coverage requirement ID", () => {
  const kit = validKit();
  kit.coverage.uncovered_requirement_ids = ["missing"];
  assertValidationError(kit, "coverage.uncovered_requirement_ids[0]");
});

test("rejects duplicate requirement IDs", () => {
  const kit = validKit();
  kit.role.requirements.push({
    id: "r1",
    text: "Another requirement",
    kind: "domain",
    priority: "nice",
  });
  assertValidationError(kit, "role.requirements[1].id");
});
