const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { createInterviewKitService } = require("../src/services/interview-kit.service");
const { AppError } = require("../src/utils/errors");

function validGenerationContext() {
  return {
    company: {
      name: "Acme Systems",
      url: "https://acme.example.com/",
      summary: "Builds logistics software.",
      what_they_do: "Creates routing tools.",
      products_services: "Routing platform.",
      industry_domain: "Logistics technology.",
      careers_information: "",
    },
    role: {
      requested_role: "Software Engineer",
      matching_role_found: false,
      job_source: "user_provided",
      job_url: null,
      job_title: null,
      public_jd: null,
      user_jd: "Build reliable APIs.",
    },
    research: {
      sources: [],
      pages_used: [],
      research_gaps: ["public_role_not_found"],
      warnings: [],
    },
  };
}

function generatedKit() {
  return {
    technical_questions: [
      { id: "q1", question: "How would you design this API?", category: "technical", difficulty: 2, rationale: "The JD mentions APIs." },
    ],
    non_technical_questions: [],
    interviewer_questions: [],
    interview_tips: [],
    follow_up_guidance: [],
  };
}

function fakePipeline({ generated = generatedKit(), validated = generated } = {}) {
  const events = [];
  const calls = { generate: [], validate: [] };
  const service = createInterviewKitService({
    generate: async (...args) => {
      calls.generate.push(args);
      events.push("generate");
      return generated;
    },
    validate: (kit) => {
      calls.validate.push(kit);
      events.push("validate");
      return validated;
    },
  });

  return { generateInterviewKit: service.generateInterviewKit, calls, events };
}

test("runs generation before validation and returns the validated kit", async () => {
  const generationContext = validGenerationContext();
  const generated = generatedKit();
  const validated = { ...generated, validationMarker: true };
  const { generateInterviewKit, calls, events } = fakePipeline({ generated, validated });

  const result = await generateInterviewKit({ generationContext });

  assert.deepEqual(events, ["generate", "validate"]);
  assert.equal(calls.generate.length, 1);
  assert.equal(calls.validate.length, 1);
  assert.equal(calls.validate[0], generated);
  assert.equal(result, validated);
});

test("forwards candidate and GitHub contexts unchanged", async () => {
  const candidateContext = { experience_level: "fresher", skills: ["Python"] };
  const githubContext = { repositories: [{ name: "demo", languages: ["Python"] }] };
  const { generateInterviewKit, calls } = fakePipeline();

  await generateInterviewKit({
    generationContext: validGenerationContext(),
    candidateContext,
    githubContext,
  });

  assert.equal(calls.generate[0][1], candidateContext);
  assert.equal(calls.generate[0][2], githubContext);
});

test("allows candidate context without certifications", async () => {
  const candidateContext = { experience_level: "fresher", skills: ["Python"] };
  const { generateInterviewKit, calls } = fakePipeline();

  await generateInterviewKit({ generationContext: validGenerationContext(), candidateContext });

  assert.equal(calls.generate[0][1], candidateContext);
  assert.equal(Object.hasOwn(calls.generate[0][1], "certifications"), false);
});

test("allows missing candidate and GitHub contexts", async () => {
  const { generateInterviewKit, calls } = fakePipeline();

  await generateInterviewKit({ generationContext: validGenerationContext() });

  assert.equal(calls.generate[0][1], undefined);
  assert.equal(calls.generate[0][2], undefined);
});

test("rejects missing or malformed generation context before generation", async () => {
  const { generateInterviewKit, calls } = fakePipeline();

  for (const input of [undefined, {}, { generationContext: null }, { generationContext: { company: {}, role: {}, research: {} } }]) {
    await assert.rejects(
      generateInterviewKit(input),
      (error) => error instanceof AppError && error.code === "VALIDATION_ERROR" && error.statusCode === 400,
    );
  }

  assert.equal(calls.generate.length, 0);
  assert.equal(calls.validate.length, 0);
});

test("propagates generation AppErrors unchanged and skips validation", async () => {
  const generationError = new AppError("Gemini request timed out", "GEMINI_TIMEOUT", 504);
  let validationCalls = 0;
  const service = createInterviewKitService({
    generate: async () => { throw generationError; },
    validate: () => { validationCalls += 1; return generatedKit(); },
  });

  await assert.rejects(
    service.generateInterviewKit({ generationContext: validGenerationContext() }),
    (error) => error === generationError,
  );
  assert.equal(validationCalls, 0);
});

test("propagates validation AppErrors unchanged without retry or repair", async () => {
  const invalidKit = { technical_questions: [] };
  const validationError = new AppError("Generated interview kit is invalid", "INVALID_GENERATED_KIT", 422);
  let generationCalls = 0;
  let validationCalls = 0;
  const service = createInterviewKitService({
    generate: async () => { generationCalls += 1; return invalidKit; },
    validate: (value) => {
      validationCalls += 1;
      assert.equal(value, invalidKit);
      throw validationError;
    },
  });

  await assert.rejects(
    service.generateInterviewKit({ generationContext: validGenerationContext() }),
    (error) => error === validationError,
  );
  assert.equal(generationCalls, 1);
  assert.equal(validationCalls, 1);
  assert.deepEqual(invalidKit, { technical_questions: [] });
});

test("does not mutate generation, candidate, or GitHub input objects", async () => {
  const generationContext = validGenerationContext();
  const candidateContext = { projects: [{ name: "demo" }], skills: ["Python"] };
  const githubContext = { repositories: [{ name: "demo", topics: ["example"] }] };
  const originals = structuredClone({ generationContext, candidateContext, githubContext });
  const { generateInterviewKit } = fakePipeline();

  await generateInterviewKit({ generationContext, candidateContext, githubContext });

  assert.deepEqual(generationContext, originals.generationContext);
  assert.deepEqual(candidateContext, originals.candidateContext);
  assert.deepEqual(githubContext, originals.githubContext);
});

test("returns deterministic output for identical mocked inputs", async () => {
  const first = fakePipeline();
  const second = fakePipeline();
  const input = { generationContext: validGenerationContext(), candidateContext: { skills: ["Python"] } };

  const firstResult = await first.generateInterviewKit(input);
  const secondResult = await second.generateInterviewKit(input);

  assert.deepEqual(firstResult, secondResult);
  assert.deepEqual(first.calls.generate[0], second.calls.generate[0]);
});

test("has no persistence, schedule, coverage, retrieval, or GitHub network dependency", () => {
  const servicePath = path.join(__dirname, "..", "src", "services", "interview-kit.service.js");
  const source = fs.readFileSync(servicePath, "utf8");

  assert.doesNotMatch(source, /mongodb|coverage\.service|schedule\.service|web-research|company-research|research-context/i);
  assert.doesNotMatch(source, /github\.com|api\.github\.com|fetch\s*\(|https?\.request\s*\(/i);
});
