const assert = require("node:assert/strict");
const test = require("node:test");

const { buildGenerationContext } = require("../src/services/generation-context.service");
const { AppError } = require("../src/utils/errors");

function completeResearchContext(overrides = {}) {
  return {
    company: {
      name: "Acme Systems",
      url: "https://acme.example.com/",
      summary: "Acme builds logistics software.",
      what_they_do: "They build routing tools.",
      products_services: "Routing platform.",
      industry_domain: "Logistics technology.",
      careers_information: "Engineering roles are available.",
    },
    role: {
      requested_role: "Senior Software Engineer",
      matching_role_found: true,
      job_source: "company_public_page",
      job_url: "https://acme.example.com/jobs/software-engineer",
      job_title: "Software Engineer",
      public_jd: "Build reliable software services.",
      user_jd: "User-provided engineering JD.",
    },
    research: {
      sources: [
        {
          url: "https://acme.example.com/about",
          title: "About Acme",
          type: "about",
          text: "They build routing tools.",
        },
      ],
      pages_used: ["https://acme.example.com/", "https://acme.example.com/about"],
      research_gaps: [],
      warnings: [{ code: "PAGE_UNAVAILABLE", message: "A nonessential page was unavailable." }],
    },
    ...overrides,
  };
}

test("builds generation context from complete company and role research", () => {
  const context = buildGenerationContext(completeResearchContext());

  assert.deepEqual(Object.keys(context), ["company", "role", "requirements", "research"]);
  assert.equal(context.company.name, "Acme Systems");
  assert.equal(context.role.requested_role, "Senior Software Engineer");
  assert.equal(context.role.matching_role_found, true);
  assert.equal(context.role.job_source, "company_public_page");
  assert.deepEqual(context.requirements, []);
});

test("preserves public JD and user JD when a public role was found", () => {
  const context = buildGenerationContext(completeResearchContext());

  assert.equal(context.role.public_jd, "Build reliable software services.");
  assert.equal(context.role.user_jd, "User-provided engineering JD.");
});

test("preserves explicitly supported seniority and responsibilities in role context", () => {
  const input = completeResearchContext();
  input.role.seniority = "Staff";
  input.role.responsibilities = ["Design distributed services.", "Review production incidents."];
  const context = buildGenerationContext(input);
  assert.equal(context.role.seniority, "Staff");
  assert.deepEqual(context.role.responsibilities, input.role.responsibilities);
});

test("extracts only explicit seniority and responsibilities from supplied role/JD text", () => {
  const input = completeResearchContext();
  input.role.requested_role = "Senior Software Engineer";
  input.role.user_jd = "Responsibilities:\n- Build reliable APIs.\n- Review service changes.\nRequirements:\n- Experience with Node.js.";
  input.role.matching_role_found = false;
  input.role.job_source = "user_provided";
  input.role.job_url = null;
  input.role.job_title = null;
  input.role.public_jd = null;
  const context = buildGenerationContext(input);
  assert.equal(context.role.seniority, "Senior");
  assert.deepEqual(context.role.responsibilities, ["Build reliable APIs.", "Review service changes."]);
  assert.deepEqual(context.requirements.map((item) => item.text), ["Experience with Node.js."]);
});

test("uses null seniority and an empty responsibilities list when details are not explicit", () => {
  const input = completeResearchContext();
  input.role.requested_role = "Software Engineer";
  input.role.job_title = "Software Engineer";
  input.role.user_jd = "Build reliable software.";
  const context = buildGenerationContext(input);
  assert.equal(context.role.seniority, null);
  assert.deepEqual(context.role.responsibilities, []);
});

test("uses the user JD as source when no public role was found", () => {
  const input = completeResearchContext();
  input.role.matching_role_found = false;
  input.role.job_source = "user_provided";
  input.role.job_url = null;
  input.role.job_title = null;
  input.role.public_jd = null;
  input.research.research_gaps = ["public_role_not_found"];

  const context = buildGenerationContext(input);

  assert.equal(context.role.matching_role_found, false);
  assert.equal(context.role.job_source, "user_provided");
  assert.equal(context.role.public_jd, null);
  assert.equal(context.role.user_jd, input.role.user_jd);
});

test("preserves research gaps and warnings", () => {
  const input = completeResearchContext({
    research: {
      sources: [],
      pages_used: [],
      research_gaps: ["limited_company_information", "careers_information_unavailable"],
      warnings: [{ code: "TIMEOUT", message: "A page timed out." }],
    },
  });
  const context = buildGenerationContext(input);

  assert.deepEqual(context.research.research_gaps, input.research.research_gaps);
  assert.deepEqual(context.research.warnings, input.research.warnings);
});

test("preserves sources and pages used", () => {
  const input = completeResearchContext();
  const context = buildGenerationContext(input);

  assert.deepEqual(context.research.sources, input.research.sources);
  assert.deepEqual(context.research.pages_used, input.research.pages_used);
});

test("accepts thin research and preserves empty arrays and meaningful null values", () => {
  const context = buildGenerationContext({
    company: {
      name: "Small Company",
      url: "https://small.example.com",
      summary: "",
      what_they_do: null,
      sources: [],
    },
    role: {
      requested_role: "Engineer",
      matching_role_found: false,
      job_source: "user_provided",
      job_url: null,
      job_title: null,
      public_jd: null,
      user_jd: "Short JD.",
    },
    research: {
      sources: [],
      pages_used: [],
      research_gaps: ["limited_company_information"],
      warnings: [],
    },
  });

  assert.equal(context.company.summary, "");
  assert.equal(context.company.what_they_do, null);
  assert.equal(context.role.public_jd, null);
  assert.equal(context.role.user_jd, "Short JD.");
  assert.deepEqual(context.research.sources, []);
  assert.deepEqual(context.research.pages_used, []);
  assert.deepEqual(context.research.research_gaps, ["limited_company_information"]);
  assert.deepEqual(context.requirements, []);
});

test("adds deterministic requirements derived from the original user JD", () => {
  const research = completeResearchContext();
  research.role.user_jd = "Required: Experience with AWS.\nPreferred: Familiarity with Terraform.";
  const context = buildGenerationContext(research);

  assert.deepEqual(context.requirements, [
    { id: "r1", text: "Experience with AWS.", kind: "technical", priority: "must" },
    { id: "r2", text: "Familiarity with Terraform.", kind: "technical", priority: "nice" },
  ]);
  assert.equal(context.role.user_jd, research.role.user_jd);
});

test("rejects malformed input with structured validation errors", () => {
  assert.throws(
    () => buildGenerationContext({ company: {}, role: {}, research: {} }),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.statusCode, 400);
      assert.ok(Array.isArray(error.details));
      return true;
    },
  );
});

test("does not mutate the input context", () => {
  const input = completeResearchContext();
  const before = structuredClone(input);

  buildGenerationContext(input);

  assert.deepEqual(input, before);
});

test("produces deterministic output for identical input", () => {
  const input = completeResearchContext();

  assert.deepEqual(buildGenerationContext(input), buildGenerationContext(input));
});

test("does not add unsupported company facts or research", () => {
  const context = buildGenerationContext({
    company: { name: "Unknown", url: "https://unknown.example.com", summary: "" },
    role: {
      requested_role: "Analyst",
      matching_role_found: false,
      job_source: "user_provided",
      public_jd: null,
      user_jd: "User JD only.",
    },
    research: {
      sources: [],
      pages_used: [],
      research_gaps: ["limited_company_information"],
      warnings: [],
    },
  });

  assert.equal(context.company.summary, "");
  assert.equal(context.company.what_they_do, "");
  assert.equal(context.role.public_jd, null);
  assert.equal(context.role.user_jd, "User JD only.");
  assert.deepEqual(context.research.sources, []);
  assert.deepEqual(context.research.research_gaps, ["limited_company_information"]);
});

test("copies nested research values without sharing mutable references", () => {
  const input = completeResearchContext();
  const context = buildGenerationContext(input);

  assert.notEqual(context.research.sources, input.research.sources);
  assert.notEqual(context.research.sources[0], input.research.sources[0]);
  assert.notEqual(context.research.warnings[0], input.research.warnings[0]);
});
