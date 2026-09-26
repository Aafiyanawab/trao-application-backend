const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createCoverageScheduleService,
} = require("../src/services/coverage-schedule.service");
const { validateGeneratedInterviewKit } = require("../src/services/generated-kit-validation.service");
const { checkCoverage } = require("../src/services/coverage.service");
const { allocateSchedule } = require("../src/services/schedule.service");
const { AppError } = require("../src/utils/errors");

function requirements() {
  return [
    { id: "r1", text: "AWS experience", kind: "technical", priority: "must" },
    { id: "r2", text: "Terraform experience", kind: "technical", priority: "must" },
    { id: "r3", text: "Docker knowledge", kind: "technical", priority: "nice" },
  ];
}

function generationContext(requirementList = requirements()) {
  return {
    company: { name: "Acme", url: "https://acme.example", summary: "" },
    role: {
      requested_role: "Cloud Engineer",
      matching_role_found: false,
      job_source: "user_provided",
      job_url: null,
      job_title: null,
      public_jd: null,
      user_jd: "AWS and Terraform experience required.",
    },
    requirements: requirementList,
    research: { sources: [], pages_used: [], research_gaps: [], warnings: [] },
  };
}

function question(id, text, requirementIds, difficulty = 2) {
  return {
    id,
    question: text,
    category: "technical",
    difficulty,
    rationale: "Targets an explicit JD requirement.",
    requirement_ids: requirementIds,
  };
}

function flashcard(id, front, back, requirementIds) {
  return { id, front, back, requirement_ids: requirementIds };
}

function kit({ questions = [], cards = [], interviewerQuestions = [], tips = [], followups = [] } = {}) {
  return {
    technical_questions: questions,
    non_technical_questions: [],
    interviewer_questions: interviewerQuestions,
    interview_tips: tips,
    follow_up_guidance: followups,
    flashcards: cards,
  };
}

function dependencies({ generatedKits, coverage = checkCoverage, schedule = allocateSchedule, validate = validateGeneratedInterviewKit }) {
  const events = [];
  const calls = { generate: [], validate: [], coverage: [], schedule: [] };
  const service = createCoverageScheduleService({
    generate: async (...args) => {
      calls.generate.push(args);
      events.push("generate");
      const result = generatedKits.shift();
      if (result instanceof Error) throw result;
      return result;
    },
    validate: (generated, options) => {
      calls.validate.push({ generated, options });
      events.push("validate");
      return validate(generated, options);
    },
    coverage: (input, passes) => {
      calls.coverage.push({ input, passes });
      events.push(`coverage-${passes}`);
      return coverage(input, passes);
    },
    schedule: (questions, reqs, days) => {
      calls.schedule.push({ questions, requirements: reqs, days });
      events.push("schedule");
      return schedule(questions, reqs, days);
    },
  });
  return { run: service.generateWithCoverageAndSchedule, calls, events };
}

function assertKitWithOneMustCovered() {
  return kit({
    questions: [question("q1", "How do you use AWS?", ["r1"])],
    cards: [flashcard("f1", "AWS?", "Amazon Web Services.", ["r1"])],
  });
}

test("sends initial generated material to deterministic coverage", async () => {
  const first = assertKitWithOneMustCovered();
  const deps = dependencies({ generatedKits: [first] });

  const result = await deps.run({ generationContext: generationContext([requirements()[0]]), daysAvailable: 2 });

  assert.equal(deps.calls.generate.length, 1);
  assert.deepEqual(deps.calls.coverage[0].input.role.requirements, [requirements()[0]]);
  assert.deepEqual(deps.calls.coverage[0].input.questions, first.technical_questions);
  assert.equal(result.coverage.all_must_requirements_covered, true);
});

test("does not run a second pass when all musts are covered, even if a nice requirement is uncovered", async () => {
  const firstPass = kit({
    questions: [
      question("q1", "How do you use AWS?", ["r1"]),
      question("q2", "How do you use Terraform?", ["r2"]),
    ],
  });
  const deps = dependencies({ generatedKits: [firstPass] });
  const result = await deps.run({ generationContext: generationContext(), daysAvailable: 3 });

  assert.equal(deps.calls.generate.length, 1);
  assert.equal(deps.calls.coverage.length, 1);
  assert.equal(deps.calls.schedule.length, 1);
  assert.deepEqual(result.coverage.uncovered_nice_requirement_ids, ["r3"]);
});

test("runs exactly one focused second pass for uncovered must requirements", async () => {
  const initial = assertKitWithOneMustCovered();
  const repair = kit({
    questions: [question("q2", "How do you manage Terraform state?", ["r2"], 3)],
    cards: [flashcard("f2", "Terraform state?", "State tracks managed infrastructure.", ["r2"])],
  });
  const deps = dependencies({ generatedKits: [initial, repair] });
  const context = generationContext();

  const result = await deps.run({ generationContext: context, candidateContext: { skills: ["AWS"] }, daysAvailable: 4 });

  assert.equal(deps.calls.generate.length, 2);
  assert.equal(deps.calls.validate.length, 2);
  assert.equal(deps.calls.coverage.length, 2);
  assert.deepEqual(deps.events.slice(0, 7), ["generate", "validate", "coverage-1", "generate", "validate", "coverage-2", "schedule"]);
  assert.equal(deps.calls.generate[1][0], context);
  assert.deepEqual(deps.calls.generate[1][3].secondPass.uncovered_must_requirement_ids, ["r2"]);
  assert.deepEqual(deps.calls.generate[1][3].secondPass.existing_material.technical_questions, initial.technical_questions);
  assert.deepEqual(result.coverage.uncovered_must_requirement_ids, []);
  assert.deepEqual(result.coverage.requirements, requirements());
  assert.equal(result.coverage.passes, 2);
});

test("preserves first-pass material and appends second-pass material in order", async () => {
  const initial = kit({
    questions: [question("q1", "How do you use AWS?", ["r1"])],
    cards: [flashcard("f1", "AWS?", "Amazon Web Services.", ["r1"])],
    interviewerQuestions: ["What does success look like?"],
  });
  const repair = kit({
    questions: [question("q2", "How do you manage Terraform state?", ["r2"])],
    cards: [flashcard("f2", "Terraform state?", "State tracks infrastructure.", ["r2"])],
    interviewerQuestions: [" what   does SUCCESS look like? ", "How is infrastructure managed?"],
  });
  const deps = dependencies({ generatedKits: [initial, repair] });
  const result = await deps.run({ generationContext: generationContext(), daysAvailable: 2 });

  assert.deepEqual(result.kit.technical_questions.map((item) => item.id), ["q1", "q2"]);
  assert.deepEqual(result.kit.flashcards.map((item) => item.id), ["f1", "f2"]);
  assert.deepEqual(result.kit.interviewer_questions, ["What does success look like?", "How is infrastructure managed?"]);
});

test("does not merge duplicate question IDs or normalized question content", async () => {
  const first = kit({ questions: [question("q1", "How do you use AWS?", ["r1"])] });
  const repair = kit({ questions: [
    question("q1", "A different question with duplicate ID", ["r2"]),
    question("q2", "  HOW   DO YOU USE aws? ", ["r2"]),
    question("q3", "How do you manage Terraform state?", ["r2"]),
  ] });
  const deps = dependencies({ generatedKits: [first, repair] });
  const result = await deps.run({ generationContext: generationContext(), daysAvailable: 2 });

  assert.deepEqual(result.kit.technical_questions.map((item) => item.id), ["q1", "q3"]);
});

test("does not merge duplicate flashcard IDs or normalized front/back content", async () => {
  const first = kit({
    questions: [question("q1", "How do you use AWS?", ["r1"])],
    cards: [flashcard("f1", "AWS?", "Amazon Web Services.", ["r1"])],
  });
  const repair = kit({
    questions: [question("q2", "How do you manage Terraform state?", ["r2"])],
    cards: [
      flashcard("f1", "Different front", "Different back", ["r2"]),
      flashcard("f2", " aws? ", "amazon   web services.", ["r2"]),
      flashcard("f3", "Terraform state?", "State tracks infrastructure.", ["r2"]),
    ],
  });
  const deps = dependencies({ generatedKits: [first, repair] });
  const result = await deps.run({ generationContext: generationContext(), daysAvailable: 2 });

  assert.deepEqual(result.kit.flashcards.map((item) => item.id), ["f1", "f3"]);
});

test("validates the second-pass kit before coverage and merge", async () => {
  const initial = assertKitWithOneMustCovered();
  const invalidRepair = kit({ questions: [question("q2", "Missing ID", ["r999"])] });
  const deps = dependencies({ generatedKits: [initial, invalidRepair] });

  await assert.rejects(
    deps.run({ generationContext: generationContext(), daysAvailable: 1 }),
    (error) => error.code === "INVALID_GENERATED_KIT",
  );
  assert.equal(deps.calls.validate.length, 2);
  assert.equal(deps.calls.coverage.length, 1);
  assert.equal(deps.calls.schedule.length, 0);
});

test("reports must requirements still uncovered after one repair and does not schedule", async () => {
  const initial = assertKitWithOneMustCovered();
  const repair = kit({ questions: [question("q2", "Another AWS question", ["r1"])] });
  const deps = dependencies({ generatedKits: [initial, repair] });
  const result = await deps.run({ generationContext: generationContext(), daysAvailable: 3 });

  assert.deepEqual(result.coverage.uncovered_must_requirement_ids, ["r2"]);
  assert.equal(result.schedule, null);
  assert.equal(result.warnings[0].code, "MUST_REQUIREMENTS_UNCOVERED");
  assert.equal(deps.calls.generate.length, 2);
  assert.equal(deps.calls.coverage.length, 2);
  assert.equal(deps.calls.schedule.length, 0);
});

test("uses the existing allocator only after final coverage and passes final questions", async () => {
  const initial = assertKitWithOneMustCovered();
  const repair = kit({ questions: [question("q2", "How do you manage Terraform state?", ["r2"])] });
  const deps = dependencies({ generatedKits: [initial, repair] });
  const result = await deps.run({ generationContext: generationContext(), daysAvailable: 2 });

  assert.equal(deps.events.at(-2), "coverage-2");
  assert.equal(deps.events.at(-1), "schedule");
  assert.deepEqual(deps.calls.schedule[0].questions.map((item) => item.id), ["q1", "q2"]);
  assert.deepEqual(deps.calls.schedule[0].requirements, requirements());
  assert.equal(result.schedule.days_available, 2);
});

test("propagates initial generation errors without coverage", async () => {
  const failure = new AppError("Gemini failed", "GEMINI_API_ERROR", 502);
  const deps = dependencies({ generatedKits: [failure] });

  await assert.rejects(
    deps.run({ generationContext: generationContext(), daysAvailable: 1 }),
    (error) => error === failure,
  );
  assert.equal(deps.calls.coverage.length, 0);
});

test("propagates second-pass generation errors without retrying", async () => {
  const failure = new AppError("Repair failed", "GEMINI_API_ERROR", 502);
  const deps = dependencies({ generatedKits: [assertKitWithOneMustCovered(), failure] });

  await assert.rejects(
    deps.run({ generationContext: generationContext(), daysAvailable: 1 }),
    (error) => error === failure,
  );
  assert.equal(deps.calls.generate.length, 2);
  assert.equal(deps.calls.validate.length, 1);
});

test("propagates coverage and schedule errors", async () => {
  const coverageError = new AppError("Coverage failed", "VALIDATION_ERROR", 400);
  const coverageDeps = dependencies({ generatedKits: [assertKitWithOneMustCovered()], coverage: () => { throw coverageError; } });
  await assert.rejects(
    coverageDeps.run({ generationContext: generationContext([requirements()[0]]), daysAvailable: 2 }),
    (error) => error === coverageError,
  );

  const scheduleError = new AppError("Schedule failed", "VALIDATION_ERROR", 400);
  const scheduleDeps = dependencies({ generatedKits: [assertKitWithOneMustCovered()], schedule: () => { throw scheduleError; } });
  await assert.rejects(
    scheduleDeps.run({ generationContext: generationContext([requirements()[0]]), daysAvailable: 2 }),
    (error) => error === scheduleError,
  );
});

test("supports no candidate, GitHub, or certifications and handles an empty requirement list", async () => {
  const emptyRequirementsKit = kit();
  const deps = dependencies({ generatedKits: [emptyRequirementsKit] });
  const result = await deps.run({ generationContext: generationContext([]), daysAvailable: 2 });

  assert.equal(deps.calls.generate.length, 1);
  assert.equal(deps.calls.generate[0][1], undefined);
  assert.equal(deps.calls.generate[0][2], undefined);
  assert.deepEqual(result.coverage.uncovered_requirement_ids, []);
  assert.deepEqual(result.schedule.days.map((day) => day.question_ids), [[], []]);
});

test("does not mutate generation context or generated material", async () => {
  const context = generationContext();
  const initial = assertKitWithOneMustCovered();
  const repair = kit({ questions: [question("q2", "How do you manage Terraform state?", ["r2"])] });
  const contextBefore = structuredClone(context);
  const initialBefore = structuredClone(initial);
  const repairBefore = structuredClone(repair);
  const deps = dependencies({ generatedKits: [initial, repair] });

  await deps.run({ generationContext: context, daysAvailable: 2 });

  assert.deepEqual(context, contextBefore);
  assert.deepEqual(initial, initialBefore);
  assert.deepEqual(repair, repairBefore);
});

test("produces deterministic integrated coverage and schedule output", async () => {
  const createRun = () => {
    const deps = dependencies({
      generatedKits: [
        assertKitWithOneMustCovered(),
        kit({ questions: [question("q2", "How do you manage Terraform state?", ["r2"])] }),
      ],
    });
    return deps.run({ generationContext: generationContext(), daysAvailable: 3 });
  };

  assert.deepEqual(await createRun(), await createRun());
});
