const assert = require("node:assert/strict");
const test = require("node:test");

const {
  GENERATION_RESPONSE_SCHEMA,
  QUESTION_CATEGORIES,
  createGeminiService,
} = require("../src/services/gemini.service");

const originalGeminiModel = process.env.GEMINI_MODEL;
test.beforeEach(() => {
  process.env.GEMINI_MODEL = "gemini-test-configured-model";
});
test.after(() => {
  if (originalGeminiModel === undefined) {
    delete process.env.GEMINI_MODEL;
  } else {
    process.env.GEMINI_MODEL = originalGeminiModel;
  }
});

function generationContext() {
  return {
    company: { name: "Acme", url: "https://acme.example.com", summary: "" },
    role: {
      requested_role: "Software Engineer",
      matching_role_found: false,
      job_source: "user_provided",
      job_url: null,
      job_title: null,
      public_jd: null,
      user_jd: "Build software.",
    },
    requirements: [{ id: "r1", text: "Build software", kind: "technical", priority: "must" }],
    research: { sources: [], pages_used: [], research_gaps: [], warnings: [] },
  };
}

function generatedContent() {
  return {
    technical_questions: [
      {
        id: "t1",
        question: "How do you test a service?",
        category: "technical",
        difficulty: 2,
        rationale: "Tests protect service behavior.",
      },
    ],
    non_technical_questions: [
      {
        id: "n1",
        question: "Tell me about a difficult collaboration.",
        category: "behavioral",
        difficulty: 1,
        rationale: "Assesses communication experience.",
      },
    ],
    interviewer_questions: ["What does success look like in this role?"],
    interview_tips: ["Use specific examples."],
    follow_up_guidance: ["Send a concise thank-you note."],
    flashcards: [
      {
        id: "f1",
        front: "What is a software service?",
        back: "A deployable component that provides a defined capability.",
        requirement_ids: ["r1"],
      },
    ],
  };
}

function successfulResponse(content) {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(content) }] } }],
    }),
  };
}

function createService(options = {}) {
  const requestCalls = [];
  const service = createGeminiService({
    getApiKey: () => "test-secret-key",
    request: async (url, requestOptions) => {
      requestCalls.push({ url, requestOptions });
      return successfulResponse(generatedContent());
    },
    ...options,
  });
  return { service, requestCalls };
}

async function withGeminiModel(value, callback) {
  const previousValue = process.env.GEMINI_MODEL;
  if (value === undefined) {
    delete process.env.GEMINI_MODEL;
  } else {
    process.env.GEMINI_MODEL = value;
  }

  try {
    return await callback();
  } finally {
    if (previousValue === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = previousValue;
    }
  }
}

test("reports a missing API key without making a request", async () => {
  let requestCount = 0;
  const service = createGeminiService({
    getApiKey: () => "",
    request: async () => {
      requestCount += 1;
      return successfulResponse(generatedContent());
    },
  });

  await assert.rejects(
    service.generateInterviewContent(generationContext()),
    (error) => {
      assert.equal(error.code, "MISSING_GEMINI_API_KEY");
      assert.equal(error.statusCode, 503);
      assert.equal(error.message.includes("test-secret-key"), false);
      return true;
    },
  );
  assert.equal(requestCount, 0);
});

test("uses only the explicitly configured model and Gemini structured-output configuration", async () => {
  await withGeminiModel("gemini-test-free-tier-model", async () => {
    const { service, requestCalls } = createService();
    await service.generateInterviewContent(generationContext());

    assert.equal(service.model, "gemini-test-free-tier-model");
    assert.equal(requestCalls.length, 1);
    assert.match(requestCalls[0].url, /models\/gemini-test-free-tier-model:generateContent$/);
    assert.equal(requestCalls[0].requestOptions.headers["x-goog-api-key"], "test-secret-key");
    const body = JSON.parse(requestCalls[0].requestOptions.body);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(body.generationConfig.responseSchema, GENERATION_RESPONSE_SCHEMA);
    assert.deepEqual(GENERATION_RESPONSE_SCHEMA.properties.flashcards.items.required, [
      "id", "front", "back", "requirement_ids",
    ]);
    assert.ok(QUESTION_CATEGORIES.includes("company_fit"));
  });
});

test("rejects malformed flashcards from Gemini", async () => {
  const invalid = generatedContent();
  invalid.flashcards[0].requirement_ids = [];
  const service = createGeminiService({
    getApiKey: () => "test-secret-key",
    request: async () => successfulResponse(invalid),
  });

  await assert.rejects(
    service.generateInterviewContent(generationContext()),
    (error) => {
      assert.equal(error.code, "GENERATION_SCHEMA_ERROR");
      assert.ok(error.details.some((detail) => detail.path === "flashcards[0].requirement_ids"));
      return true;
    },
  );
});

test("rejects a missing GEMINI_MODEL without falling back", async () => {
  await withGeminiModel(undefined, async () => {
    let requestCount = 0;
    const service = createGeminiService({
      getApiKey: () => "test-secret-key",
      request: async () => {
        requestCount += 1;
        return successfulResponse(generatedContent());
      },
    });

    await assert.rejects(
      service.generateInterviewContent(generationContext()),
      (error) => error.code === "MISSING_GEMINI_MODEL" && error.message === "GEMINI_MODEL is not configured",
    );
    assert.equal(requestCount, 0);
  });
});

test("rejects an empty GEMINI_MODEL", async () => {
  await withGeminiModel("", async () => {
    const service = createService().service;
    await assert.rejects(
      service.generateInterviewContent(generationContext()),
      (error) => error.code === "MISSING_GEMINI_MODEL" && error.message === "GEMINI_MODEL is not configured",
    );
  });
});

test("rejects a whitespace-only GEMINI_MODEL", async () => {
  await withGeminiModel("   \t ", async () => {
    const service = createService().service;
    await assert.rejects(
      service.generateInterviewContent(generationContext()),
      (error) => error.code === "MISSING_GEMINI_MODEL" && error.message === "GEMINI_MODEL is not configured",
    );
  });
});

test("returns a valid structured model response", async () => {
  const { service } = createService();
  const result = await service.generateInterviewContent(generationContext());

  assert.deepEqual(result, generatedContent());
});

test("rejects malformed model JSON", async () => {
  const service = createGeminiService({
    getApiKey: () => "test-secret-key",
    request: async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "{invalid" }] } }] }),
    }),
  });

  await assert.rejects(
    service.generateInterviewContent(generationContext()),
    (error) => error.code === "MALFORMED_GEMINI_RESPONSE" && error.statusCode === 502,
  );
});

test("rejects parsed output that violates the generation contract", async () => {
  const invalid = generatedContent();
  invalid.technical_questions[0].difficulty = 5;
  const service = createGeminiService({
    getApiKey: () => "test-secret-key",
    request: async () => successfulResponse(invalid),
  });

  await assert.rejects(
    service.generateInterviewContent(generationContext()),
    (error) => {
      assert.equal(error.code, "GENERATION_SCHEMA_ERROR");
      assert.equal(error.statusCode, 502);
      assert.ok(error.details.some((detail) => detail.path === "technical_questions[0].difficulty"));
      return true;
    },
  );
});

test("sanitizes provider failures and does not expose the API key", async () => {
  const apiKey = "secret-do-not-leak";
  const service = createGeminiService({
    getApiKey: () => apiKey,
    request: async () => {
      throw new Error(`provider failure containing ${apiKey}`);
    },
  });

  await assert.rejects(
    service.generateInterviewContent(generationContext()),
    (error) => {
      assert.equal(error.code, "GEMINI_API_ERROR");
      assert.equal(error.message, "Gemini request failed");
      assert.equal(JSON.stringify({ message: error.message, details: error.details }).includes(apiKey), false);
      return true;
    },
  );
});

test("sanitizes Gemini API error responses", async () => {
  const apiKey = "secret-do-not-leak";
  const service = createGeminiService({
    getApiKey: () => apiKey,
    request: async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: `quota failed for ${apiKey}` }),
    }),
  });

  await assert.rejects(
    service.generateInterviewContent(generationContext()),
    (error) => {
      assert.equal(error.code, "GEMINI_API_ERROR");
      assert.equal(error.message, "Gemini could not generate interview content");
      assert.equal(JSON.stringify({ message: error.message, details: error.details }).includes(apiKey), false);
      return true;
    },
  );
});

test("maps a request timeout to a safe timeout error", async () => {
  const service = createGeminiService({
    getApiKey: () => "test-secret-key",
    timeoutMs: 5,
    request: async (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });

  await assert.rejects(
    service.generateInterviewContent(generationContext()),
    (error) => error.code === "GEMINI_TIMEOUT" && error.statusCode === 504,
  );
});

test("handles an unreadable provider payload safely", async () => {
  const service = createGeminiService({
    getApiKey: () => "test-secret-key",
    request: async () => ({ ok: true, json: async () => ({ candidates: [] }) }),
  });

  await assert.rejects(
    service.generateInterviewContent(generationContext()),
    (error) => error.code === "MALFORMED_GEMINI_RESPONSE" && error.statusCode === 502,
  );
});

test("returns deterministic output for the same mocked response", async () => {
  const { service } = createService();
  const first = await service.generateInterviewContent(generationContext());
  const second = await service.generateInterviewContent(generationContext());

  assert.deepEqual(first, second);
});

test("does not expose credentials in successful return data", async () => {
  const { service } = createService();
  const result = await service.generateInterviewContent(generationContext());

  assert.equal(JSON.stringify(result).includes("test-secret-key"), false);
  assert.deepEqual(Object.keys(result), [
    "technical_questions",
    "non_technical_questions",
    "interviewer_questions",
    "interview_tips",
    "follow_up_guidance",
    "flashcards",
  ]);
});
