const assert = require("node:assert/strict");
const test = require("node:test");

const { validateGeneratedInterviewKit } = require("../src/services/generated-kit-validation.service");
const { AppError } = require("../src/utils/errors");

function validKit() {
  return {
    technical_questions: [
      {
        id: "q-tech-1",
        question: "How would you design a resilient API?",
        category: "technical",
        difficulty: 2,
        rationale: "The role JD mentions API development.",
      },
    ],
    non_technical_questions: [
      {
        id: "q-behavior-1",
        question: "Tell me about a time you resolved a disagreement.",
        category: "behavioral",
        difficulty: 1,
        rationale: "This explores collaboration.",
      },
    ],
    interviewer_questions: ["How does the team measure success in this role?"],
    interview_tips: ["Prepare one concise example relevant to the role."],
    follow_up_guidance: ["Be ready to explain your trade-offs and outcome."],
  };
}

function assertInvalid(kit, expectedPath) {
  assert.throws(
    () => validateGeneratedInterviewKit(kit),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "INVALID_GENERATED_KIT");
      assert.equal(error.statusCode, 422);
      assert.ok(Array.isArray(error.details));
      if (expectedPath) {
        assert.ok(error.details.some((detail) => detail.path === expectedPath));
      }
      return true;
    },
  );
}

test("accepts a valid complete kit and returns the original unchanged", () => {
  const kit = validKit();

  assert.equal(validateGeneratedInterviewKit(kit), kit);
});

test("rejects null, primitives, and arrays as the top-level result", () => {
  for (const value of [null, "kit", 5, [], undefined]) {
    assertInvalid(value, "generatedKit");
  }
});

test("rejects each missing required section", () => {
  for (const section of [
    "technical_questions",
    "non_technical_questions",
    "interviewer_questions",
    "interview_tips",
    "follow_up_guidance",
  ]) {
    const kit = validKit();
    delete kit[section];
    assertInvalid(kit, section);
  }
});

test("rejects each non-array section", () => {
  for (const section of [
    "technical_questions",
    "non_technical_questions",
    "interviewer_questions",
    "interview_tips",
    "follow_up_guidance",
  ]) {
    const kit = validKit();
    kit[section] = {};
    assertInvalid(kit, section);
  }
});

test("allows empty content arrays", () => {
  const kit = validKit();
  kit.technical_questions = [];
  kit.non_technical_questions = [];
  kit.interviewer_questions = [];
  kit.interview_tips = [];
  kit.follow_up_guidance = [];

  assert.equal(validateGeneratedInterviewKit(kit), kit);
});

test("accepts a valid question using the Gemini contract", () => {
  const kit = validKit();
  kit.non_technical_questions = [];

  assert.equal(validateGeneratedInterviewKit(kit), kit);
});

test("rejects malformed question objects", () => {
  for (const malformed of [null, "question", 1, []]) {
    const kit = validKit();
    kit.technical_questions = [malformed];
    assertInvalid(kit, "technical_questions[0]");
  }
});

test("rejects missing, empty, and non-string question IDs", () => {
  const cases = [
    [{ question: "Valid?", category: "technical", difficulty: 1, rationale: "Reason." }, "technical_questions[0].id"],
    [{ id: " ", question: "Valid?", category: "technical", difficulty: 1, rationale: "Reason." }, "technical_questions[0].id"],
    [{ id: 2, question: "Valid?", category: "technical", difficulty: 1, rationale: "Reason." }, "technical_questions[0].id"],
  ];
  for (const [question, path] of cases) {
    const kit = validKit();
    kit.technical_questions = [question];
    kit.non_technical_questions = [];
    assertInvalid(kit, path);
  }
});

test("rejects missing, blank, and non-string question text", () => {
  const cases = [
    [{ id: "q1", category: "technical", difficulty: 1, rationale: "Reason." }, "technical_questions[0].question"],
    [{ id: "q1", question: " \t ", category: "technical", difficulty: 1, rationale: "Reason." }, "technical_questions[0].question"],
    [{ id: "q1", question: 42, category: "technical", difficulty: 1, rationale: "Reason." }, "technical_questions[0].question"],
  ];
  for (const [question, path] of cases) {
    const kit = validKit();
    kit.technical_questions = [question];
    kit.non_technical_questions = [];
    assertInvalid(kit, path);
  }
});

test("rejects invalid categories and difficulty values outside the existing 1-3 contract", () => {
  for (const [field, value] of [["category", "random"], ["category", null], ["difficulty", 0], ["difficulty", 4], ["difficulty", 1.5], ["difficulty", "2"]]) {
    const kit = validKit();
    kit.non_technical_questions = [];
    kit.technical_questions[0][field] = value;
    assertInvalid(kit, `technical_questions[0].${field}`);
  }
});

test("rejects empty or non-string rationales", () => {
  for (const rationale of ["", "   ", null, 7]) {
    const kit = validKit();
    kit.non_technical_questions = [];
    kit.technical_questions[0].rationale = rationale;
    assertInvalid(kit, "technical_questions[0].rationale");
  }
});

test("rejects duplicate IDs within the technical section", () => {
  const kit = validKit();
  kit.technical_questions.push({ ...kit.technical_questions[0], question: "A distinct second question?" });

  assertInvalid(kit, "technical_questions[1].id");
});

test("rejects duplicate IDs within the non-technical section", () => {
  const kit = validKit();
  kit.non_technical_questions.push({ ...kit.non_technical_questions[0], question: "A distinct second question?" });

  assertInvalid(kit, "non_technical_questions[1].id");
});

test("rejects question IDs duplicated across technical and non-technical sections", () => {
  const kit = validKit();
  kit.non_technical_questions[0].id = kit.technical_questions[0].id;

  assertInvalid(kit, "non_technical_questions[0].id");
});

test("rejects exact duplicate questions across sections", () => {
  const kit = validKit();
  kit.non_technical_questions[0].question = kit.technical_questions[0].question;

  assertInvalid(kit, "non_technical_questions[0].question");
});

test("rejects case-only duplicate question text", () => {
  const kit = validKit();
  kit.non_technical_questions[0].question = kit.technical_questions[0].question.toUpperCase();

  assertInvalid(kit, "non_technical_questions[0].question");
});

test("rejects duplicates after trimming and collapsing whitespace", () => {
  const kit = validKit();
  kit.non_technical_questions[0].question = "  HOW   WOULD you design a resilient API?  ";
  kit.technical_questions[0].question = "How would you design a resilient API?";

  assertInvalid(kit, "non_technical_questions[0].question");
});

test("allows similar but non-identical questions", () => {
  const kit = validKit();
  kit.non_technical_questions[0].question = "How would you design a resilient API for mobile clients?";

  assert.equal(validateGeneratedInterviewKit(kit), kit);
});

test("validates interviewer questions as non-empty strings", () => {
  const kit = validKit();
  kit.interviewer_questions = [" "];

  assertInvalid(kit, "interviewer_questions[0]");
});

test("validates tips as non-empty strings", () => {
  const kit = validKit();
  kit.interview_tips = [null];

  assertInvalid(kit, "interview_tips[0]");
});

test("validates follow-up guidance as non-empty strings", () => {
  const kit = validKit();
  kit.follow_up_guidance = [{}];

  assertInvalid(kit, "follow_up_guidance[0]");
});

test("does not require GitHub, certifications, projects, or skills", () => {
  const kit = validKit();

  assert.equal(validateGeneratedInterviewKit(kit), kit);
});

test("accepts user-provided JD fallback and thin research options", () => {
  const kit = validKit();
  const options = {
    generationContext: {
      role: { matching_role_found: false, job_source: "user_provided" },
      research: { research_gaps: ["limited_company_information"], warnings: [] },
    },
  };

  assert.equal(validateGeneratedInterviewKit(kit, options), kit);
});

test("rejects obvious credential material without echoing the secret", () => {
  const kit = validKit();
  const secret = "GEMINI_API_KEY=abcdefghijklmnopqrstuvwxyz123456";
  kit.interview_tips[0] = `Do not publish ${secret}`;

  assert.throws(
    () => validateGeneratedInterviewKit(kit),
    (error) => {
      assert.equal(error.code, "INVALID_GENERATED_KIT");
      assert.equal(JSON.stringify(error.details).includes(secret), false);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});

test("does not mutate the generated kit", () => {
  const kit = validKit();
  const before = structuredClone(kit);

  validateGeneratedInterviewKit(kit);

  assert.deepEqual(kit, before);
});

test("returns deterministic validation behavior for identical input", () => {
  const invalid = validKit();
  invalid.technical_questions[0].difficulty = 5;
  const getDetails = () => {
    try {
      validateGeneratedInterviewKit(invalid);
      return null;
    } catch (error) {
      return { code: error.code, statusCode: error.statusCode, details: error.details };
    }
  };

  assert.deepEqual(getDetails(), getDetails());
});
