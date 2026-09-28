const assert = require("node:assert/strict");
const test = require("node:test");

const { createKitService } = require("../src/services/kit.service");
const { fingerprintGenerationRequest } = require("../src/services/kit.service");
const { AppError } = require("../src/utils/errors");

function generationContext() {
  return {
    company: { name: "Acme", url: "https://acme.example", summary: "Builds tools." },
    role: { requested_role: "Engineer", user_jd: "Build APIs." },
    requirements: [{ id: "r1", text: "Build APIs", kind: "technical", priority: "must" }],
  };
}

function pipelineResult() {
  return {
    kit: {
      technical_questions: [{ id: "q1", question: "How do you build APIs?", answer_outline: "Cover routing, validation, and error handling.", category: "technical", difficulty: 2, rationale: "Tests API design.", requirement_ids: ["r1"] }],
      non_technical_questions: [],
      interviewer_questions: [],
      interview_tips: [],
      follow_up_guidance: [],
      flashcards: [{ id: "f1", front: "What is an API?", back: "A software interface.", requirement_ids: ["r1"] }],
    },
    coverage: { all_must_requirements_covered: true, requirements: [{ id: "r1" }], covered_requirement_ids: ["r1"] },
    schedule: { days: [{ day: 1, question_ids: ["q1"], duration_minutes: 30 }] },
    warnings: [],
  };
}

function fakeDatabase() {
  const documents = [];
  const indexes = [];
  const collection = {
    createIndex: async (keys, options) => { indexes.push({ keys, options }); },
    insertOne: async (document) => {
      if (document.requestFingerprint && documents.some((item) =>
        item.userId === document.userId && item.requestFingerprint === document.requestFingerprint)) {
        const error = new Error("duplicate key");
        error.code = 11000;
        throw error;
      }
      documents.push(document);
      return { insertedId: document.kitId };
    },
    find: (query) => ({
      sort: () => ({
        toArray: async () => documents.filter((item) => item.userId === query.userId),
      }),
    }),
    findOne: async (query) => documents.find((item) => Object.entries(query).every(([key, value]) =>
      item[key] === value)) ?? null,
    updateOne: async (query, update) => {
      const found = documents.find((item) => item.userId === query.userId
        && item.kitId === query.kitId
        && item.updatedAt === query.updatedAt);
      if (!found) return { matchedCount: 0 };
      Object.assign(found, update.$set);
      return { matchedCount: 1 };
    },
  };
  return { database: { collection: () => collection }, documents, indexes };
}

test("persists the final pipeline result and returns a safe reopenable kit", async () => {
  const { database, documents, indexes } = fakeDatabase();
  const timestamp = new Date("2026-01-02T03:04:05.000Z");
  const service = createKitService({
    getDatabase: () => database,
    createKitId: () => "stable-kit-id",
    now: () => timestamp,
  });
  const context = generationContext();
  context.company.gemini_api_key = "must-not-persist";
  context.role.github_token = "must-not-persist";
  context.requirements[0].passwordHash = "must-not-persist";
  const result = await service.createKitForUser("owner-1", {
    generationContext: context,
    pipelineResult: pipelineResult(),
  });

  assert.equal(documents.length, 1);
  assert.equal(documents[0].kitId, "stable-kit-id");
  assert.equal(documents[0].userId, "owner-1");
  assert.deepEqual(documents[0].company, generationContext().company);
  assert.deepEqual(documents[0].role, generationContext().role);
  assert.deepEqual(documents[0].requirements, generationContext().requirements);
  assert.equal(Object.hasOwn(documents[0].company, "gemini_api_key"), false);
  assert.equal(Object.hasOwn(documents[0].role, "github_token"), false);
  assert.equal(Object.hasOwn(documents[0].requirements[0], "passwordHash"), false);
  assert.deepEqual(documents[0].kit.technical_questions, pipelineResult().kit.technical_questions.map((item) => ({ ...item, origin: "generated", edited: false })));
  assert.deepEqual(documents[0].kit.flashcards, pipelineResult().kit.flashcards.map((item) => ({ ...item, origin: "generated", edited: false })));
  assert.deepEqual(documents[0].practice, {});
  assert.deepEqual(result.practice, {});
  assert.deepEqual(documents[0].coverage, pipelineResult().coverage);
  assert.deepEqual(documents[0].schedule, pipelineResult().schedule);
  assert.equal(documents[0].createdAt, timestamp);
  assert.equal(documents[0].updatedAt, timestamp);
  assert.equal(result.id, "stable-kit-id");
  assert.equal(Object.hasOwn(result, "userId"), false);
  assert.equal(Object.hasOwn(result, "passwordHash"), false);
  assert.equal(Object.hasOwn(documents[0], "candidateContext"), false);
  assert.equal(Object.hasOwn(documents[0], "githubContext"), false);
  assert.equal(indexes.length, 3);
  assert.deepEqual(indexes[2], {
    keys: { userId: 1, requestFingerprint: 1 },
    options: { unique: true, partialFilterExpression: { requestFingerprint: { $type: "string" } } },
  });
});

test("projects generated kit fields onto the persisted schema", async () => {
  const { database, documents } = fakeDatabase();
  const service = createKitService({ getDatabase: () => database, createKitId: () => "projection-kit" });
  const generated = pipelineResult();
  generated.kit.unexpected = { injected: true };
  generated.kit.technical_questions[0].admin = true;
  generated.kit.flashcards[0].script = "unexpected";
  await service.createKitForUser("owner-1", { generationContext: generationContext(), pipelineResult: generated });
  assert.equal(Object.hasOwn(documents[0].kit, "unexpected"), false);
  assert.equal(Object.hasOwn(documents[0].kit.technical_questions[0], "admin"), false);
  assert.equal(Object.hasOwn(documents[0].kit.flashcards[0], "script"), false);
  assert.deepEqual(Object.keys(documents[0].kit.technical_questions[0]).sort(), [
    "answer_outline", "category", "difficulty", "edited", "id", "origin", "question", "rationale", "requirement_ids",
  ].sort());
});

test("fingerprints the logical request deterministically without depending on object key order", () => {
  const first = fingerprintGenerationRequest({
    generationContext: { company: { name: "Acme", url: "https://acme.example" }, requirements: [] },
    candidateContext: { skills: ["Node.js"], projects: [{ name: "API" }] },
    daysAvailable: 4,
  });
  const reordered = fingerprintGenerationRequest({
    daysAvailable: 4,
    candidateContext: { projects: [{ name: "API" }], skills: ["Node.js"] },
    generationContext: { requirements: [], company: { url: "https://acme.example", name: "Acme" } },
  });
  const changedDays = fingerprintGenerationRequest({
    generationContext: { company: { name: "Acme", url: "https://acme.example" }, requirements: [] },
    candidateContext: { skills: ["Node.js"], projects: [{ name: "API" }] },
    daysAvailable: 5,
  });

  assert.equal(first, reordered);
  assert.notEqual(first, changedDays);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("deduplicates concurrent identical requests per user in the existing kits collection", async () => {
  const { database, documents } = fakeDatabase();
  let id = 0;
  const service = createKitService({ getDatabase: () => database, createKitId: () => `kit-${++id}` });
  const requestFingerprint = "a".repeat(64);
  const params = {
    generationContext: generationContext(),
    pipelineResult: pipelineResult(),
    requestFingerprint,
  };

  const [first, second] = await Promise.all([
    service.createKitForUser("owner-1", params),
    service.createKitForUser("owner-1", params),
  ]);

  assert.equal(documents.length, 1);
  assert.equal(first.id, second.id);
  assert.equal(documents[0].requestFingerprint, requestFingerprint);
  assert.equal(Object.hasOwn(first, "requestFingerprint"), false);
  assert.equal(await service.getKitForRequest("owner-1", requestFingerprint).then((kit) => kit.id), first.id);
  assert.equal(await service.getKitForRequest("owner-2", requestFingerprint), null);
});

test("updates only owner-scoped fields and refreshes updatedAt", async () => {
  const { database, documents } = fakeDatabase();
  const times = [new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:01Z")];
  const service = createKitService({
    getDatabase: () => database,
    createKitId: () => "stable-kit-id",
    now: () => times.shift(),
  });
  const created = await service.createKitForUser("owner-1", {
    generationContext: generationContext(),
    pipelineResult: pipelineResult(),
  });
  const updated = await service.updateKitForUser(
    "owner-1",
    created.id,
    { company: { ...created.company, summary: "Edited summary." } },
    created.updatedAt,
  );

  assert.equal(updated.company.summary, "Edited summary.");
  assert.equal(updated.updatedAt.toISOString(), "2026-01-01T00:00:01.000Z");
  assert.equal(documents[0].userId, "owner-1");
  await assert.rejects(service.updateKitForUser("owner-2", created.id, { title: "forged" }));
  assert.equal(documents[0].title, "Acme — Engineer");
});

test("leaves the persisted document unchanged when an atomic update loses its version match", async () => {
  const { database, documents } = fakeDatabase();
  const service = createKitService({ getDatabase: () => database, createKitId: () => "stable-kit-id" });
  const created = await service.createKitForUser("owner-1", {
    generationContext: generationContext(),
    pipelineResult: pipelineResult(),
  });
  const before = structuredClone(documents[0]);
  database.collection("kits").updateOne = async () => ({ matchedCount: 0 });

  await assert.rejects(
    service.updateKitForUser("owner-1", created.id, { company: { ...created.company, summary: "partial" } }, created.updatedAt),
    (error) => error.code === "KIT_UPDATE_CONFLICT" && error.statusCode === 409,
  );
  assert.deepEqual(documents[0], before);
});

test("lists and retrieves kits only for the authenticated owner", async () => {
  const { database } = fakeDatabase();
  let id = 0;
  const service = createKitService({ getDatabase: () => database, createKitId: () => `kit-${++id}` });
  await service.createKitForUser("user-a", { generationContext: generationContext(), pipelineResult: pipelineResult() });
  await service.createKitForUser("user-b", { generationContext: generationContext(), pipelineResult: pipelineResult() });

  const list = await service.listKitsForUser("user-a");
  assert.deepEqual(list.map((kit) => kit.id), ["kit-1"]);
  assert.equal(Object.hasOwn(list[0], "kit"), false);

  const ownKit = await service.getKitForUser("user-a", "kit-1");
  assert.equal(ownKit.id, "kit-1");
  await assert.rejects(
    service.getKitForUser("user-a", "kit-2"),
    (error) => error instanceof AppError && error.code === "NOT_FOUND" && error.statusCode === 404,
  );
});
