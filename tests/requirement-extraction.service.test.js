const assert = require("node:assert/strict");
const test = require("node:test");

const { extractRequirements } = require("../src/services/requirement-extraction.service");
const { AppError } = require("../src/utils/errors");

const role = "Cloud DevOps Engineer";

test("extracts grounded requirements into the existing requirement shape", () => {
  const result = extractRequirements({
    role,
    userJd: "Required: Experience with AWS cloud services.\nPreferred: Familiarity with Terraform.",
  });

  assert.deepEqual(result, {
    requirements: [
      { id: "r1", text: "Experience with AWS cloud services.", kind: "technical", priority: "must" },
      { id: "r2", text: "Familiarity with Terraform.", kind: "technical", priority: "nice" },
    ],
  });
});

test("extracts multiple requirements in source order with stable sequential IDs", () => {
  const userJd = [
    "Requirements:",
    "- Experience with AWS",
    "- Knowledge of Terraform",
    "Nice to have:",
    "- Familiarity with Docker",
  ].join("\n");

  const first = extractRequirements({ role, userJd });
  const second = extractRequirements({ role, userJd });

  assert.deepEqual(first, second);
  assert.deepEqual(first.requirements.map(({ id }) => id), ["r1", "r2", "r3"]);
  assert.deepEqual(first.requirements.map(({ priority }) => priority), ["must", "must", "nice"]);
});

test("classifies explicit mandatory cues as must", () => {
  const result = extractRequirements({ role, userJd: "Must have experience with Kubernetes." });

  assert.equal(result.requirements[0].priority, "must");
});

test("classifies explicit preferred cues as nice", () => {
  const result = extractRequirements({ role, userJd: "AWS experience is preferred." });

  assert.equal(result.requirements[0].priority, "nice");
});

test("classifies explicit behavioral requirements using the existing kind enum", () => {
  const result = extractRequirements({ role, userJd: "Required: Strong communication and collaboration skills." });

  assert.equal(result.requirements[0].kind, "behavioural");
});

test("does not infer must priority from a bare technology mention", () => {
  const result = extractRequirements({ role, userJd: "Experience with AWS and Terraform." });

  assert.deepEqual(result.requirements.map(({ priority }) => priority), ["nice"]);
});

test("deduplicates case and whitespace variants deterministically", () => {
  const result = extractRequirements({
    role,
    userJd: "Required: Experience with AWS\nexperience   with   aws",
  });

  assert.deepEqual(result.requirements, [
    { id: "r1", text: "Experience with AWS", kind: "technical", priority: "must" },
  ]);
});

test("does not promote requirements inferred only from company research", () => {
  const result = extractRequirements({
    role,
    userJd: "Build backend services.",
    companyResearch: {
      summary: "The company builds cloud products and uses Kubernetes.",
    },
  });

  assert.deepEqual(result.requirements, []);
});

test("does not invent common technologies absent from the JD", () => {
  const result = extractRequirements({
    role,
    userJd: "Required: Experience with AWS, Terraform, and Docker.",
  });
  const combinedText = result.requirements.map(({ text }) => text).join(" ").toLowerCase();

  assert.match(combinedText, /aws/);
  assert.match(combinedText, /terraform/);
  assert.match(combinedText, /docker/);
  assert.doesNotMatch(combinedText, /kubernetes|linux|python|ci\/cd/);
});

test("preserves the input JD and does not mutate the input object", () => {
  const input = { role, userJd: "Required: Experience with Node.js." };
  const before = structuredClone(input);

  extractRequirements(input);

  assert.deepEqual(input, before);
  assert.equal(input.userJd, "Required: Experience with Node.js.");
});

test("rejects a missing JD with a structured AppError", () => {
  assert.throws(
    () => extractRequirements({ role, userJd: " " }),
    (error) => error instanceof AppError && error.code === "VALIDATION_ERROR" && error.statusCode === 400,
  );
});

test("rejects a missing role with a structured AppError", () => {
  assert.throws(
    () => extractRequirements({ userJd: "Experience with AWS." }),
    (error) => error instanceof AppError && error.code === "VALIDATION_ERROR" && error.statusCode === 400,
  );
});

test("rejects malformed input types without echoing JD content", () => {
  const sensitiveText = "GEMINI_API_KEY=abcdefghijklmnopqrstuvwxyz123456";
  assert.throws(
    () => extractRequirements({ role: 42, userJd: sensitiveText }),
    (error) => {
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.message.includes(sensitiveText), false);
      assert.equal(JSON.stringify(error.details).includes(sensitiveText), false);
      return true;
    },
  );
});

test("returns a requirements array with unique IDs and non-empty text", () => {
  const result = extractRequirements({
    role,
    userJd: "Required: Experience with AWS. Preferred: Familiarity with Terraform.",
  });
  const ids = result.requirements.map(({ id }) => id);

  assert.equal(new Set(ids).size, ids.length);
  assert.ok(result.requirements.every(({ text }) => text.trim().length > 0));
  assert.ok(result.requirements.every(({ priority }) => ["must", "nice"].includes(priority)));
});
