const assert = require("node:assert/strict");
const test = require("node:test");
const { createBatchEvaluator } = require("../src/services/batch-evaluator.service");

const testCase = { id: "a", jd: "Job Title: Platform Engineer\nRequirements:\n- Node.js experience", company_url: "https://example.test", days: 2 };

function deps(overrides = {}) {
  const calls = { research: [], pipeline: [] };
  return {
    calls,
    evaluator: createBatchEvaluator({
      research: async (input) => {
        calls.research.push(input);
        return {
          company: { name: "Example Inc", url: input.company_url, summary: "Summary", what_they_do: "Software", sources: [{ url: input.company_url }] },
          role_research: { requested_role: input.role, matching_role_found: false, job_source: "user_provided" },
          user_jd: input.user_jd,
          pages_used: [input.company_url],
          warnings: [],
        };
      },
      buildContext: (research) => ({
        company: research.company,
        role: { requested_role: research.role.requested_role, seniority: null, responsibilities: [] },
        requirements: [{ id: "r1", text: "Node.js experience", priority: "must" }],
        research: { sources: research.research.sources, pages_used: research.research.pages_used },
      }),
      generatePipeline: async (input) => {
        calls.pipeline.push(input);
        return {
          kit: {
            technical_questions: [{ id: "q1", question: "How does Node.js work?", requirement_ids: ["r1"], category: "technical", answer_outline: ["Event loop"], difficulty: 2 }],
            non_technical_questions: [],
            flashcards: [{ id: "f1", front: "What is Node.js?", back: "A runtime", requirement_ids: ["r1"], origin: "generated" }],
          },
          schedule: { days_available: 2, days: [{ day: 1, focus: "Practice", question_ids: ["q1"], minutes: 45 }] },
          coverage: { uncovered_requirement_ids: [], passes: 1 },
        };
      },
      now: () => new Date("2026-01-02T03:04:05.000Z"),
      ...overrides,
    }),
    calls,
  };
}

test("evaluates cases through research, context and coverage pipeline and projects Appendix A fields", async () => {
  const { evaluator, calls } = deps();
  const output = await evaluator.evaluateBatch([testCase]);
  assert.equal(output.version, "1.0");
  assert.equal(output.kits[0].status, "ok");
  assert.deepEqual(calls.research[0], { company_url: testCase.company_url, role: "Platform Engineer", user_jd: testCase.jd });
  assert.equal(calls.pipeline[0].candidateContext, undefined);
  assert.equal(calls.pipeline[0].githubContext, undefined);
  assert.deepEqual(output.kits[0].kit.questions[0], {
    id: "q1", requirement_ids: ["r1"], category: "technical", prompt: "How does Node.js work?", answer_outline: ["Event loop"], difficulty: 2,
  });
  assert.deepEqual(output.kits[0].kit.flashcards[0], { id: "f1", front: "What is Node.js?", back: "A runtime", requirement_ids: ["r1"] });
  assert.equal(output.kits[0].kit.source.location, null);
});

test("fails one unsupported role without preventing other cases", async () => {
  const { evaluator } = deps();
  const output = await evaluator.evaluateBatch([
    { ...testCase, jd: "Build reliable systems" },
    { ...testCase, id: "b" },
  ]);
  assert.equal(output.kits[0].status, "failed");
  assert.equal(output.kits[0].error.code, "ROLE_UNAVAILABLE");
  assert.equal(output.kits[1].status, "ok");
});

test("rejects non-Appendix-B fields and invalid batch input before evaluation", async () => {
  const { evaluator, calls } = deps();
  await assert.rejects(evaluator.evaluateBatch([{ ...testCase, role: "invented" }]), /unsupported fields/);
  await assert.rejects(evaluator.evaluateBatch([{ ...testCase, days: 0 }]), /days/);
  assert.equal(calls.research.length, 0);
});

test("returns a failed case when the coverage pipeline cannot produce a schedule", async () => {
  const { evaluator } = deps({ generatePipeline: async () => ({ kit: {}, schedule: null, coverage: {} }) });
  const output = await evaluator.evaluateBatch([testCase]);
  assert.equal(output.kits[0].status, "failed");
  assert.equal(output.kits[0].error.code, "KIT_INCOMPLETE");
});
