const assert = require("node:assert/strict");
const test = require("node:test");

process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/trao-test";

const { createKitsController } = require("../src/controllers/kits.controller");
const { requireAuth } = require("../src/middleware/auth.middleware");
const kitsRoutes = require("../src/routes/kits.routes");
const { AppError } = require("../src/utils/errors");

const validKitId = "65a000000000000000000001";

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function generationContext() {
  return {
    company: { name: "Acme", url: "https://acme.example" },
    role: { requested_role: "Engineer" },
    requirements: [{ id: "r1" }],
  };
}

function completePipelineResult() {
  return {
    kit: { technical_questions: [], non_technical_questions: [], interviewer_questions: [], interview_tips: [], follow_up_guidance: [], flashcards: [] },
    coverage: { all_must_requirements_covered: true },
    schedule: { days: [] },
    warnings: [],
  };
}

function builderKit() {
  return {
    technical_questions: [
      { id: "q1", question: "Original generated question?", category: "technical", difficulty: 1, rationale: "Original rationale.", requirement_ids: ["r1"], origin: "generated", edited: false },
      { id: "q2", question: "Edited generated question?", category: "technical", difficulty: 2, rationale: "Edited rationale.", requirement_ids: ["r1"], origin: "generated", edited: true },
      { id: "q3", question: "User written question?", category: "technical", difficulty: 2, rationale: "User rationale.", requirement_ids: ["r1"], origin: "user", edited: true },
    ],
    non_technical_questions: [],
    interviewer_questions: ["What does success look like?"],
    interview_tips: ["Use examples."],
    follow_up_guidance: ["Explain your reasoning."],
    flashcards: [
      { id: "f1", front: "Original front?", back: "Original back.", requirement_ids: ["r1"], origin: "generated", edited: false },
      { id: "f2", front: "Edited front?", back: "Edited back.", requirement_ids: ["r1"], origin: "generated", edited: true },
      { id: "f3", front: "User front?", back: "User back.", requirement_ids: ["r1"], origin: "user", edited: true },
    ],
  };
}

function builderHarness({ generateSection, now = () => new Date("2026-02-01T00:00:01.000Z") } = {}) {
  const userId = "session-user";
  const document = {
    id: validKitId,
    title: "Acme â€” Engineer",
    company: {
      name: "Acme", url: "https://acme.example", summary: "Current summary.",
      what_they_do: "Builds tools.", products_services: "Platform.", industry_domain: "Software.", careers_information: "Hiring.",
    },
    role: { requested_role: "Engineer", matching_role_found: false, job_source: "user_provided", user_jd: "Build APIs." },
    requirements: [{ id: "r1", text: "Build APIs", kind: "technical", priority: "must" }],
    research: { sources: [], pages_used: [], research_gaps: [], warnings: [] },
    kit: builderKit(),
    coverage: { requirements: [{ id: "r1", text: "Build APIs", kind: "technical", priority: "must" }], covered_requirement_ids: ["r1"], uncovered_requirement_ids: [], uncovered_must_requirement_ids: [], uncovered_nice_requirement_ids: [], all_must_requirements_covered: true, passes: 1 },
    schedule: { days_available: 2, days: [{ day: 1, focus: "Practice", question_ids: ["q1"], minutes: 30 }, { day: 2, focus: "Review", question_ids: ["q2", "q3"], minutes: 45 }] },
    warnings: [],
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
  };
  const writes = [];
  const service = {
    getKitForUser: async (requestedUserId, kitId) => {
      if (requestedUserId !== userId || kitId !== validKitId) throw new AppError("Not found", "NOT_FOUND", 404);
      return structuredClone(document);
    },
    updateKitForUser: async (requestedUserId, kitId, changes, expectedUpdatedAt) => {
      if (requestedUserId !== userId || kitId !== validKitId) throw new AppError("Not found", "NOT_FOUND", 404);
      if (expectedUpdatedAt.getTime() !== document.updatedAt.getTime()) throw new AppError("Conflict", "KIT_UPDATE_CONFLICT", 409);
      writes.push({ userId: requestedUserId, kitId, changes: structuredClone(changes) });
      Object.assign(document, structuredClone(changes), { updatedAt: now() });
      return structuredClone(document);
    },
    createKitForUser: async () => null,
    listKitsForUser: async () => [],
  };
  const controller = createKitsController({
    service,
    generate: async () => completePipelineResult(),
    generateSection,
    createItemId: (() => { let id = 0; return () => `user-item-${++id}`; })(),
    now,
  });
  return { controller, document, writes, userId };
}

function builderRequest(userId, body = {}, extras = {}) {
  return {
    user: { _id: userId },
    params: { id: validKitId, itemId: extras.itemId, flashcardId: extras.flashcardId },
    query: extras.query ?? {},
    body,
  };
}

function generatedSection(section) {
  return {
    technical_questions: section === "technical_questions"
      ? [{ id: "q-new", question: "New generated question?", category: "technical", difficulty: 2, rationale: "Generated rationale.", requirement_ids: ["r1"] }]
      : [],
    non_technical_questions: section === "non_technical_questions"
      ? [{ id: "n-new", question: "New generated behavioral question?", category: "behavioral", difficulty: 1, rationale: "Generated rationale.", requirement_ids: ["r1"] }]
      : [],
    interviewer_questions: [],
    interview_tips: [],
    follow_up_guidance: [],
    flashcards: section === "flashcards"
      ? [{ id: "f-new", front: "New generated front?", back: "New generated back.", requirement_ids: ["r1"] }]
      : [],
  };
}

test("POST creates a kit through the existing pipeline and binds ownership to the session user", async () => {
  const calls = { pipeline: [], create: [] };
  const saved = { id: validKitId, title: "Acme — Engineer" };
  const controller = createKitsController({
    generate: async (input) => { calls.pipeline.push(input); return completePipelineResult(); },
    service: {
      createKitForUser: async (...args) => { calls.create.push(args); return saved; },
      listKitsForUser: async () => [],
      getKitForUser: async () => saved,
    },
  });
  const context = generationContext();
  const res = response();

  await controller.createKit({
    user: { _id: "session-user-1" },
    body: { generationContext: context, daysAvailable: 4, userId: "attacker-user" },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { kit: saved });
  assert.deepEqual(calls.pipeline[0], {
    generationContext: context,
    candidateContext: undefined,
    githubContext: undefined,
    daysAvailable: 4,
  });
  assert.equal(calls.create[0][0], "session-user-1");
  assert.equal(calls.create[0][1].generationContext, context);
  assert.equal(Object.hasOwn(calls.create[0][1], "userId"), false);
});

test("does not persist when generation fails or the final result is incomplete", async () => {
  let writes = 0;
  const service = {
    createKitForUser: async () => { writes += 1; },
    listKitsForUser: async () => [],
    getKitForUser: async () => null,
  };
  const failed = createKitsController({
    service,
    generate: async () => { throw new AppError("Generation failed", "GEMINI_API_ERROR", 502); },
  });
  await assert.rejects(
    failed.createKit({ user: { _id: "user-1" }, body: { generationContext: generationContext(), daysAvailable: 2 } }, response()),
    (error) => error.code === "GEMINI_API_ERROR",
  );

  const incomplete = createKitsController({
    service,
    generate: async () => ({ ...completePipelineResult(), schedule: null }),
  });
  await assert.rejects(
    incomplete.createKit({ user: { _id: "user-1" }, body: { generationContext: generationContext(), daysAvailable: 2 } }, response()),
    (error) => error.code === "INCOMPLETE_KIT" && error.statusCode === 422,
  );
  assert.equal(writes, 0);
});

test("list and get use the authenticated user's identity", async () => {
  const calls = [];
  const controller = createKitsController({
    generate: async () => completePipelineResult(),
    service: {
      createKitForUser: async () => null,
      listKitsForUser: async (userId) => { calls.push(["list", userId]); return []; },
      getKitForUser: async (...args) => { calls.push(["get", ...args]); return { id: validKitId }; },
    },
  });
  const res = response();
  await controller.listKits({ user: { _id: "session-user-2" }, query: { userId: "attacker" } }, res);
  assert.deepEqual(res.body, { items: [] });
  await controller.getKit({ user: { _id: "session-user-2" }, params: { id: validKitId }, body: { userId: "attacker" } }, res);
  assert.deepEqual(calls, [["list", "session-user-2"], ["get", "session-user-2", validKitId]]);
});

test("kit routes retain the session authentication middleware and reject missing sessions", async () => {
  assert.equal(kitsRoutes.stack[0].handle, requireAuth);
  let middlewareError;
  await requireAuth({ headers: {} }, {}, (error) => { middlewareError = error; });
  assert.ok(middlewareError instanceof AppError);
  assert.equal(middlewareError.code, "UNAUTHORIZED");
  assert.equal(middlewareError.statusCode, 401);
});

test("edits questions, flashcards, and brief while preserving unrelated content", async () => {
  const { controller, document, writes, userId } = builderHarness();
  const originalFlashcards = structuredClone(document.kit.flashcards);
  const res = response();

  await controller.updateKit(builderRequest(userId, {
    operation: "edit", section: "technical_questions", itemId: "q1", changes: { question: "Updated question?" },
  }), res);
  assert.equal(res.body.kit.kit.technical_questions[0].question, "Updated question?");
  assert.equal(res.body.kit.kit.technical_questions[0].edited, true);
  assert.equal(res.body.kit.kit.technical_questions[0].id, "q1");
  assert.deepEqual(res.body.kit.kit.flashcards, originalFlashcards);

  await controller.updateKit(builderRequest(userId, {
    operation: "edit", section: "flashcards", itemId: "f1", changes: { back: "Updated answer." },
  }), response());
  assert.equal(document.kit.flashcards[0].back, "Updated answer.");
  assert.equal(document.kit.flashcards[0].edited, true);

  await controller.updateKit(builderRequest(userId, {
    operation: "edit", section: "company", changes: { summary: "Edited brief." },
  }), response());
  assert.equal(document.company.summary, "Edited brief.");
  assert.equal(writes.length, 3);
});

test("rejects unknown fields, secret text, and invalid requirement IDs without writing", async () => {
  const { controller, writes, userId } = builderHarness();
  for (const body of [
    { operation: "edit", section: "technical_questions", itemId: "q1", changes: { userId: "other" } },
    { operation: "edit", section: "technical_questions", itemId: "q1", changes: { requirement_ids: ["missing"] } },
    { operation: "edit", section: "company", changes: { summary: "GEMINI_API_KEY=someverylongsecretvalue" } },
  ]) {
    await assert.rejects(controller.updateKit(builderRequest(userId, body)));
  }
  await assert.rejects(controller.updateKit(builderRequest(userId, {
    operation: "edit", section: "technical_questions", itemId: "q1", changes: { madeUpField: true },
  })), (error) => error.code === "VALIDATION_ERROR");
  assert.equal(writes.length, 0);
});

test("adds server-identified questions and flashcards with user metadata", async () => {
  const { controller, document, userId } = builderHarness();
  await controller.updateKit(builderRequest(userId, {
    operation: "add", section: "technical_questions", item: {
      question: "Handwritten question?", category: "technical", difficulty: 1, rationale: "User rationale.", requirement_ids: ["r1"],
    },
  }), response());
  await controller.updateKit(builderRequest(userId, {
    operation: "add", section: "flashcards", item: { front: "Handwritten prompt?", back: "Handwritten answer.", requirement_ids: ["r1"] },
  }), response());

  const addedQuestion = document.kit.technical_questions.at(-1);
  const addedFlashcard = document.kit.flashcards.at(-1);
  assert.equal(addedQuestion.id, "user-item-1");
  assert.equal(addedFlashcard.id, "user-item-2");
  assert.equal(addedQuestion.origin, "user");
  assert.equal(addedQuestion.edited, true);
  assert.equal(addedFlashcard.origin, "user");
  assert.equal(addedFlashcard.edited, true);
  await assert.rejects(controller.updateKit(builderRequest(userId, {
    operation: "add", section: "flashcards", item: { front: "Invalid?", back: "Bad requirement.", requirement_ids: ["missing"] },
  })));
});

test("reorders questions and flashcards by complete ID lists without dropping content", async () => {
  const { controller, document, userId } = builderHarness();
  const before = structuredClone(document.kit.technical_questions);
  const coverageBefore = structuredClone(document.coverage);
  const scheduleBefore = structuredClone(document.schedule);
  await controller.updateKit(builderRequest(userId, {
    operation: "reorder", section: "technical_questions", itemIds: ["q3", "q1", "q2"],
  }), response());
  assert.deepEqual(document.kit.technical_questions.map((item) => item.id), ["q3", "q1", "q2"]);
  assert.deepEqual(new Map(document.kit.technical_questions.map((item) => [item.id, item])), new Map(before.map((item) => [item.id, item])));
  assert.deepEqual(document.coverage, coverageBefore);
  assert.deepEqual(document.schedule, scheduleBefore);

  await controller.updateKit(builderRequest(userId, {
    operation: "reorder", section: "flashcards", itemIds: ["f3", "f1", "f2"],
  }), response());
  assert.deepEqual(document.kit.flashcards.map((item) => item.id), ["f3", "f1", "f2"]);
  await assert.rejects(controller.updateKit(builderRequest(userId, {
    operation: "reorder", section: "flashcards", itemIds: ["f1", "f1", "f2"],
  })));
  await assert.rejects(controller.updateKit(builderRequest(userId, {
    operation: "reorder", section: "technical_questions", itemIds: ["q1", "q2", "unknown"],
  })));
});

test("moves a question between supported question sections and marks the edit", async () => {
  const { controller, document, userId } = builderHarness();
  await controller.updateKit(builderRequest(userId, {
    operation: "move", itemId: "q1", fromSection: "technical_questions", toSection: "non_technical_questions", category: "behavioral",
  }), response());
  assert.equal(document.kit.technical_questions.some((item) => item.id === "q1"), false);
  const moved = document.kit.non_technical_questions[0];
  assert.equal(moved.id, "q1");
  assert.equal(moved.category, "behavioral");
  assert.equal(moved.edited, true);
});

test("deletes only selected question or flashcard and preserves unrelated sections", async () => {
  const { controller, document, writes, userId } = builderHarness();
  const nonTechnical = structuredClone(document.kit.non_technical_questions);
  const cards = structuredClone(document.kit.flashcards);
  await controller.deleteItem(builderRequest(userId, {}, { itemId: "q1", query: { section: "technical_questions" } }), response());
  assert.equal(document.kit.technical_questions.some((item) => item.id === "q1"), false);
  assert.deepEqual(document.kit.flashcards, cards);
  assert.deepEqual(document.kit.non_technical_questions, nonTechnical);
  await controller.deleteItem(builderRequest(userId, {}, { itemId: "f1", query: { section: "flashcards" } }), response());
  assert.equal(document.kit.flashcards.some((item) => item.id === "f1"), false);
  await assert.rejects(
    controller.deleteItem(builderRequest(userId, {}, { itemId: "missing", query: { section: "flashcards" } }), response()),
    (error) => error.code === "NOT_FOUND",
  );
  assert.equal(writes.length, 2);
});

test("ownership and request body cannot authorize or redirect a kit mutation", async () => {
  const { controller, writes } = builderHarness();
  await assert.rejects(
    controller.updateKit(builderRequest("another-user", {
      operation: "edit", section: "company", changes: { summary: "forged" },
    })),
    (error) => error.code === "NOT_FOUND",
  );
  await assert.rejects(controller.updateKit(builderRequest("session-user", {
    operation: "edit", section: "company", changes: { summary: "forged" }, userId: "another-user",
  })), (error) => error.code === "VALIDATION_ERROR");
  await assert.rejects(
    controller.deleteItem(builderRequest("another-user", {}, { itemId: "q1", query: { section: "technical_questions" } }), response()),
    (error) => error.code === "NOT_FOUND",
  );
  assert.equal(writes.length, 0);
});

test("regenerates questions while preserving edited and user questions and all flashcards", async () => {
  const generationCalls = [];
  const { controller, document, userId } = builderHarness({
    generateSection: async (...args) => { generationCalls.push(args); return generatedSection("technical_questions"); },
  });
  const flashcardsBefore = structuredClone(document.kit.flashcards);
  await controller.regenerateSection(builderRequest(userId, { section: "technical_questions" }), response());

  assert.deepEqual(document.kit.technical_questions.map((item) => item.id), ["q-new", "q2", "q3"]);
  assert.equal(document.kit.technical_questions[0].origin, "generated");
  assert.equal(document.kit.technical_questions[0].edited, false);
  assert.deepEqual(document.kit.technical_questions.slice(1), builderKit().technical_questions.slice(1));
  assert.deepEqual(document.kit.flashcards, flashcardsBefore);
  assert.equal(generationCalls.length, 1);
  assert.equal(generationCalls[0][0].requirements[0].id, "r1");
  assert.deepEqual(generationCalls[0][3].sectionRegeneration, {
    section: "technical_questions",
    preservedItems: builderKit().technical_questions.slice(1),
  });
});

test("regeneration retains duplicate content without overwriting preserved items and remaps colliding IDs", async () => {
  const { controller, document, userId } = builderHarness({
    generateSection: async () => ({
      ...generatedSection("technical_questions"),
      technical_questions: [
        {
          id: "q-duplicate", question: builderKit().technical_questions[1].question, category: "technical",
          difficulty: 2, rationale: "Duplicate generated content.", requirement_ids: ["r1"],
        },
        {
          id: "q2", question: "A new distinct generated question?", category: "technical",
          difficulty: 2, rationale: "A preserved item uses this ID.", requirement_ids: ["r1"],
        },
      ],
    }),
  });
  const preserved = structuredClone(document.kit.technical_questions.slice(1));
  const coverageBefore = structuredClone(document.coverage);
  const scheduleBefore = structuredClone(document.schedule);
  await controller.regenerateSection(builderRequest(userId, { section: "technical_questions" }), response());

  assert.notEqual(document.kit.technical_questions[0].id, "q2");
  assert.equal(document.kit.technical_questions[0].question, "A new distinct generated question?");
  assert.deepEqual(document.kit.technical_questions.slice(1), preserved);
  assert.deepEqual(document.coverage, coverageBefore);
  assert.deepEqual(document.schedule, scheduleBefore);
});

test("regenerates flashcards without changing edited questions or other kit sections", async () => {
  const { controller, document, userId } = builderHarness({
    generateSection: async () => generatedSection("flashcards"),
  });
  const questionsBefore = structuredClone(document.kit.technical_questions);
  const otherSections = structuredClone({ company: document.company, role: document.role, coverage: document.coverage });
  await controller.regenerateSection(builderRequest(userId, { section: "flashcards" }), response());
  assert.deepEqual(document.kit.flashcards.map((item) => item.id), ["f-new", "f2", "f3"]);
  assert.deepEqual(document.kit.technical_questions, questionsBefore);
  assert.deepEqual({ company: document.company, role: document.role, coverage: document.coverage }, otherSections);
});

test("generation failure or invalid generated section leaves stored content unchanged", async () => {
  const failed = builderHarness({ generateSection: async () => { throw new AppError("Provider failed", "GEMINI_API_ERROR", 502); } });
  const originalKit = structuredClone(failed.document.kit);
  await assert.rejects(
    failed.controller.regenerateSection(builderRequest(failed.userId, { section: "technical_questions" }), response()),
    (error) => error.code === "GEMINI_API_ERROR",
  );
  assert.deepEqual(failed.document.kit, originalKit);
  assert.equal(failed.writes.length, 0);

  const invalid = builderHarness({
    generateSection: async () => ({ ...generatedSection("technical_questions"), technical_questions: [{ ...generatedSection("technical_questions").technical_questions[0], requirement_ids: ["unknown"] }] }),
  });
  const invalidOriginal = structuredClone(invalid.document.kit);
  await assert.rejects(invalid.controller.regenerateSection(builderRequest(invalid.userId, { section: "technical_questions" }), response()));
  assert.deepEqual(invalid.document.kit, invalidOriginal);
  assert.equal(invalid.writes.length, 0);
});

test("uses the existing interview generation boundary for section regeneration", async () => {
  const calls = [];
  const { controller, userId } = builderHarness({
    generateSection: async (...args) => { calls.push(args); return generatedSection("technical_questions"); },
  });
  await controller.regenerateSection(builderRequest(userId, {
    section: "technical_questions",
    candidateContext: { projects: ["Transit Planner"] },
    githubContext: { repositories: [{ name: "route-engine" }] },
  }), response());

  assert.deepEqual(calls[0][1], { projects: ["Transit Planner"] });
  assert.deepEqual(calls[0][2], { repositories: [{ name: "route-engine" }] });
  assert.equal(calls[0][3].sectionRegeneration.section, "technical_questions");
});

test("can regenerate the company brief and deterministic schedule as isolated sections", async () => {
  const { controller, document, userId } = builderHarness({
    generateSection: async () => ({
      ...generatedSection("company_brief"),
      company_brief: {
        summary: "New summary.", what_they_do: "New activity.", products_services: "New products.",
        industry_domain: "New domain.", careers_information: "New hiring info.",
      },
    }),
  });
  const questionsBefore = structuredClone(document.kit);
  await controller.regenerateSection(builderRequest(userId, { section: "company_brief" }), response());
  assert.equal(document.company.summary, "New summary.");
  assert.deepEqual(document.kit, questionsBefore);
  await controller.regenerateSection(builderRequest(userId, { section: "schedule", daysAvailable: 3 }), response());
  assert.equal(document.schedule.days_available, 3);
  assert.equal(document.schedule.days.length, 3);
  assert.deepEqual(document.kit, questionsBefore);
});

test("practice session returns front and back with explicit uncovered state and hides persistence metadata", async () => {
  const { controller, document, userId } = builderHarness();
  document.practice = { f2: { confidence: 3, covered: true, lastPracticedAt: new Date("2026-01-01T00:00:00Z") } };
  const res = response();
  await controller.getPracticeSession(builderRequest(userId), res);

  assert.equal(res.body.items[0].flashcard.id, "f1");
  assert.equal(res.body.items[0].flashcard.front, "Original front?");
  assert.equal(res.body.items[0].flashcard.back, "Original back.");
  assert.deepEqual(res.body.items[0].flashcard.requirement_ids, ["r1"]);
  assert.equal(res.body.items[0].covered, false);
  assert.equal(res.body.items[0].confidence, null);
  const coveredItem = res.body.items.find((item) => item.flashcard.id === "f2");
  assert.equal(coveredItem.covered, true);
  assert.equal(coveredItem.confidence, 3);
  assert.equal("origin" in res.body.items[0].flashcard, false);
  assert.equal("edited" in res.body.items[0].flashcard, false);
  assert.equal("revealed" in res.body.items[0], false);
});

test("practice ordering is uncovered first, then weakest confidence, oldest attempt, and stable kit order", async () => {
  const { controller, document, userId } = builderHarness();
  document.kit.flashcards = [
    { ...document.kit.flashcards[0], id: "a" },
    { ...document.kit.flashcards[0], id: "b" },
    { ...document.kit.flashcards[0], id: "c" },
    { ...document.kit.flashcards[0], id: "d" },
    { ...document.kit.flashcards[0], id: "e" },
  ];
  document.practice = {
    a: { confidence: 5, covered: true, lastPracticedAt: new Date("2026-01-01T00:00:00Z") },
    b: { confidence: 2, covered: true, lastPracticedAt: new Date("2026-01-02T00:00:00Z") },
    c: { confidence: 2, covered: true, lastPracticedAt: new Date("2026-01-01T00:00:00Z") },
    d: { confidence: 2, covered: true, lastPracticedAt: new Date("2026-01-01T00:00:00Z") },
  };
  const res = response();
  await controller.getPracticeSession(builderRequest(userId), res);
  assert.deepEqual(res.body.items.map((item) => item.flashcard.id), ["e", "c", "d", "b", "a"]);
  assert.equal(res.body.items[0].covered, false);
});

test("records allowed confidence ratings without changing flashcard or kit data", async () => {
  for (const confidence of [1, 5]) {
    const { controller, document, writes, userId } = builderHarness();
    const kitBefore = structuredClone(document.kit);
    const scheduleBefore = structuredClone(document.schedule);
    const coverageBefore = structuredClone(document.coverage);
    const res = response();
    await controller.recordPracticeConfidence(builderRequest(userId, { confidence }, { flashcardId: "f1" }), res);

    assert.equal(res.body.practice.confidence, confidence);
    assert.equal(res.body.practice.covered, true);
    assert.equal(res.body.practice.lastPracticedAt.toISOString(), "2026-02-01T00:00:01.000Z");
    assert.deepEqual(document.kit, kitBefore);
    assert.deepEqual(document.schedule, scheduleBefore);
    assert.deepEqual(document.coverage, coverageBefore);
    assert.deepEqual(Object.keys(writes[0].changes), ["practice"]);
  }
});

test("rejects malformed confidence values, unknown cards, and client mutation fields without writes", async () => {
  const { controller, writes, userId } = builderHarness();
  for (const confidence of [0, 6, 1.5, "5", null]) {
    await assert.rejects(controller.recordPracticeConfidence(
      builderRequest(userId, { confidence }, { flashcardId: "f1" }), response(),
    ), (error) => error.code === "VALIDATION_ERROR");
  }
  await assert.rejects(controller.recordPracticeConfidence(
    builderRequest(userId, { confidence: 3 }, { flashcardId: "unknown" }), response(),
  ), (error) => error.code === "NOT_FOUND");
  await assert.rejects(controller.recordPracticeConfidence(
    builderRequest(userId, { confidence: 3, userId, front: "forged" }, { flashcardId: "f1" }), response(),
  ), (error) => error.code === "VALIDATION_ERROR");
  await assert.rejects(controller.recordPracticeConfidence(
    builderRequest(userId, { confidence: 3 }, { flashcardId: " " }), response(),
  ), (error) => error.code === "VALIDATION_ERROR");
  assert.equal(writes.length, 0);
});

test("practice reads and writes are owner-scoped and use session identity only", async () => {
  const { controller, writes } = builderHarness();
  await assert.rejects(controller.getPracticeSession(builderRequest("another-user")), (error) => error.code === "NOT_FOUND");
  await assert.rejects(controller.recordPracticeConfidence(
    builderRequest("another-user", { confidence: 4 }, { flashcardId: "f1" }), response(),
  ), (error) => error.code === "NOT_FOUND");
  assert.equal(writes.length, 0);
  assert.equal(kitsRoutes.stack[0].handle, requireAuth);
});
