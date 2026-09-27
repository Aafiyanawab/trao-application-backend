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
        answer_outline: "Cover endpoint boundaries, validation, failure handling, and trade-offs.",
        category: "technical",
        difficulty: 2,
        rationale: "The role JD mentions API development.",
        requirement_ids: ["r1"],
      },
    ],
    non_technical_questions: [
      {
        id: "q-behavior-1",
        question: "Tell me about a time you resolved a disagreement.",
        answer_outline: "Explain the disagreement, how you listened, the action you took, and the outcome.",
        category: "behavioural",
        difficulty: 1,
        rationale: "This explores collaboration.",
        requirement_ids: ["r1"],
      },
    ],
    interviewer_questions: ["How does the team measure success in this role?"],
    interview_tips: ["Prepare one concise example relevant to the role."],
    follow_up_guidance: ["Be ready to explain your trade-offs and outcome."],
    flashcards: [],
  };
}

function kitWithFlashcard(flashcard) {
  const kit = validKit();
  kit.flashcards = [flashcard];
  return kit;
}

const validFlashcard = {
  id: "f1",
  front: "What is Docker?",
  back: "Docker packages applications into containers.",
  requirement_ids: ["r1"],
};

const requirementOptions = {
  generationContext: {
    requirements: [{ id: "r1", text: "Docker knowledge", kind: "technical", priority: "must" }],
  },
};

function assertInvalid(kit, expectedPath, options = requirementOptions) {
  assert.throws(
    () => validateGeneratedInterviewKit(kit, options),
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

  assert.equal(validateGeneratedInterviewKit(kit, requirementOptions), kit);
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
    "flashcards",
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
    "flashcards",
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
  kit.flashcards = [];

  assert.equal(validateGeneratedInterviewKit(kit, requirementOptions), kit);
});

test("accepts an Appendix A flashcard linked to an existing requirement", () => {
  assert.equal(validateGeneratedInterviewKit(kitWithFlashcard(validFlashcard), requirementOptions).flashcards[0], validFlashcard);
});

test("rejects malformed flashcard objects", () => {
  for (const flashcard of [null, "card", 1, []]) {
    assertInvalid(kitWithFlashcard(flashcard), "flashcards[0]");
  }
});

test("rejects missing, empty, and non-string flashcard IDs", () => {
  for (const flashcard of [
    { ...validFlashcard, id: undefined },
    { ...validFlashcard, id: " " },
    { ...validFlashcard, id: 7 },
  ]) {
    assertInvalid(kitWithFlashcard(flashcard), "flashcards[0].id");
  }
});

test("rejects empty flashcard front or back", () => {
  for (const field of ["front", "back"]) {
    assertInvalid(kitWithFlashcard({ ...validFlashcard, [field]: "  " }), `flashcards[0].${field}`);
  }
});

test("rejects missing flashcard front or back", () => {
  for (const field of ["front", "back"]) {
    const flashcard = { ...validFlashcard };
    delete flashcard[field];
    assertInvalid(kitWithFlashcard(flashcard), `flashcards[0].${field}`);
  }
});

test("rejects missing, empty, or non-array flashcard requirement IDs", () => {
  for (const requirementIds of [undefined, [], "r1"]) {
    assertInvalid(
      kitWithFlashcard({ ...validFlashcard, requirement_ids: requirementIds }),
      "flashcards[0].requirement_ids",
    );
  }
});

test("rejects malformed and unknown flashcard requirement IDs", () => {
  for (const requirementIds of [[" "], [7], ["r999"]]) {
    assertInvalid(
      kitWithFlashcard({ ...validFlashcard, requirement_ids: requirementIds }),
      "flashcards[0].requirement_ids[0]",
    );
  }
});

test("accepts flashcards linked to multiple real requirements", () => {
  const requirements = [
    { id: "r1", text: "Docker knowledge", kind: "technical", priority: "must" },
    { id: "r2", text: "Kubernetes experience", kind: "technical", priority: "nice" },
  ];
  const kit = kitWithFlashcard({ ...validFlashcard, requirement_ids: ["r1", "r2"] });

  assert.equal(validateGeneratedInterviewKit(kit, { generationContext: { requirements } }), kit);
});

test("rejects duplicate flashcard IDs", () => {
  const kit = validKit();
  kit.flashcards = [validFlashcard, { ...validFlashcard, front: "A different front?", back: "A different back." }];

  assertInvalid(kit, "flashcards[1].id");
});

test("rejects duplicate flashcard content after normalization", () => {
  const kit = validKit();
  kit.flashcards = [
    validFlashcard,
    { ...validFlashcard, id: "f2", front: "  what   is docker? ", back: "docker packages applications into containers." },
  ];

  assertInvalid(kit, "flashcards[1].front");
});

test("does not require flashcards when there are no requirements", () => {
  const kit = validKit();
  kit.technical_questions = [];
  kit.non_technical_questions = [];
  kit.flashcards = [];

  assert.equal(validateGeneratedInterviewKit(kit, { generationContext: { requirements: [] } }), kit);
});

test("rejects cards referencing fake IDs when there are no requirements", () => {
  assertInvalid(
    kitWithFlashcard(validFlashcard),
    "flashcards[0].requirement_ids[0]",
    { generationContext: { requirements: [] } },
  );
});

test("accepts a valid question using the Gemini contract", () => {
  const kit = validKit();
  kit.non_technical_questions = [];

  assert.equal(validateGeneratedInterviewKit(kit, requirementOptions), kit);
});

test("accepts every Appendix A question category and keeps answer outline distinct from rationale", () => {
  const categories = ["technical", "behavioural", "system-design", "company-fit"];
  for (const category of categories) {
    const kit = validKit();
    kit.technical_questions[0].category = category;
    assert.equal(validateGeneratedInterviewKit(kit, requirementOptions), kit);
  }
  const kit = validKit();
  assert.notEqual(kit.technical_questions[0].answer_outline, kit.technical_questions[0].rationale);
});

test("requires a non-empty answer outline and rejects secret material in it", () => {
  for (const answerOutline of [undefined, "", "   ", 7, "GEMINI_API_KEY=someverylongsecretvalue"]) {
    const kit = validKit();
    kit.technical_questions[0].answer_outline = answerOutline;
    assertInvalid(kit, "technical_questions[0].answer_outline");
  }
});

test("accepts question traceability to one or multiple existing requirements", () => {
  const kit = validKit();
  kit.technical_questions[0].requirement_ids = ["r1", "r2"];
  const options = {
    generationContext: {
      requirements: [
        ...requirementOptions.generationContext.requirements,
        { id: "r2", text: "Resilient APIs", kind: "technical", priority: "nice" },
      ],
    },
  };

  assert.equal(validateGeneratedInterviewKit(kit, options), kit);
});

test("rejects missing, non-array, and empty question requirement_ids", () => {
  const missing = validKit();
  delete missing.technical_questions[0].requirement_ids;
  assertInvalid(missing, "technical_questions[0].requirement_ids");

  const nonArray = validKit();
  nonArray.technical_questions[0].requirement_ids = "r1";
  assertInvalid(nonArray, "technical_questions[0].requirement_ids");

  const empty = validKit();
  empty.technical_questions[0].requirement_ids = [];
  assertInvalid(empty, "technical_questions[0].requirement_ids");
});

test("rejects unknown, malformed, and repeated IDs within one question", () => {
  for (const requirementIds of [["r999"], [" "], [5]]) {
    const kit = validKit();
    kit.technical_questions[0].requirement_ids = requirementIds;
    assertInvalid(kit, "technical_questions[0].requirement_ids[0]");
  }
  const duplicate = validKit();
  duplicate.technical_questions[0].requirement_ids = ["r1", "r1"];
  assertInvalid(duplicate, "technical_questions[0].requirement_ids[1]");
});

test("allows the same requirement ID on multiple different questions", () => {
  const kit = validKit();
  kit.technical_questions[0].requirement_ids = ["r1"];
  kit.non_technical_questions[0].requirement_ids = ["r1"];

  assert.equal(validateGeneratedInterviewKit(kit, requirementOptions), kit);
});

test("rejects technical and non-technical questions with unknown requirement references", () => {
  const kit = validKit();
  kit.non_technical_questions[0].requirement_ids = ["r999"];

  assertInvalid(kit, "non_technical_questions[0].requirement_ids[0]");
});

test("accepts no questions when there are no requirements", () => {
  const kit = validKit();
  kit.technical_questions = [];
  kit.non_technical_questions = [];
  kit.flashcards = [];

  assert.equal(validateGeneratedInterviewKit(kit, { generationContext: { requirements: [] } }), kit);
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

  assert.equal(validateGeneratedInterviewKit(kit, requirementOptions), kit);
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

  assert.equal(validateGeneratedInterviewKit(kit, requirementOptions), kit);
});

test("accepts user-provided JD fallback and thin research options", () => {
  const kit = validKit();
  const options = {
    generationContext: {
      requirements: requirementOptions.generationContext.requirements,
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

test("rejects credential-like material in flashcard content without echoing it", () => {
  const kit = kitWithFlashcard({ ...validFlashcard, back: "GITHUB_TOKEN=ghp_12345678901234567890abcdefghijkl" });

  assert.throws(
    () => validateGeneratedInterviewKit(kit, requirementOptions),
    (error) => {
      assert.equal(error.code, "INVALID_GENERATED_KIT");
      assert.equal(JSON.stringify(error.details).includes("ghp_"), false);
      return true;
    },
  );
});

test("does not mutate the generated kit", () => {
  const kit = validKit();
  const before = structuredClone(kit);

  validateGeneratedInterviewKit(kit, requirementOptions);

  assert.deepEqual(kit, before);
});

test("returns deterministic validation behavior for identical input", () => {
  const invalid = validKit();
  invalid.technical_questions[0].difficulty = 5;
  const getDetails = () => {
    try {
      validateGeneratedInterviewKit(invalid, requirementOptions);
      return null;
    } catch (error) {
      return { code: error.code, statusCode: error.statusCode, details: error.details };
    }
  };

  assert.deepEqual(getDetails(), getDetails());
});
