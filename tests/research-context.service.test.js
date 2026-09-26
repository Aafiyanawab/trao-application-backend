const assert = require("node:assert/strict");
const test = require("node:test");

const { buildResearchContext } = require("../src/services/research-context.service");
const { AppError } = require("../src/utils/errors");

function completeResearchResult() {
  return {
    company: {
      name: "Acme Systems",
      url: "https://acme.example.com/",
      summary: "Acme builds software for logistics teams.",
      what_they_do: "They build logistics tools.",
      products_services: "Routing platform.",
      industry_domain: "Logistics software.",
      careers_information: "Engineering roles are open.",
      sources: [
        {
          url: "https://acme.example.com/about",
          title: "About Acme",
          type: "about",
          text: "They build logistics tools.",
        },
        {
          url: "https://acme.example.com/careers",
          title: "Careers",
          type: "careers",
          text: "Engineering roles are open.",
        },
      ],
    },
    role_research: {
      requested_role: "Senior Software Engineer",
      matching_role_found: true,
      job_source: "company_public_page",
      job_url: "https://acme.example.com/jobs/software-engineer",
      job_title: "Software Engineer",
      public_jd: "Build and maintain software services.",
    },
    user_jd: "User supplied job description.",
    pages_used: [
      "https://acme.example.com/",
      "https://acme.example.com/about",
      "https://acme.example.com/careers",
    ],
    warnings: [{ url: "https://acme.example.com/news", code: "PAGE_UNAVAILABLE", message: "Unavailable" }],
  };
}

test("normalizes complete company research with a public role", () => {
  const result = buildResearchContext(completeResearchResult());

  assert.deepEqual(Object.keys(result), [
    "company", "role", "sources", "pages_used", "research_gaps", "warnings",
  ]);
  assert.equal(result.company.name, "Acme Systems");
  assert.equal(result.company.products_services, "Routing platform.");
  assert.equal(result.role.matching_role_found, true);
  assert.equal(result.role.job_source, "company_public_page");
  assert.equal(result.role.public_jd, "Build and maintain software services.");
});

test("preserves public JD and original user JD when a public role is found", () => {
  const research = completeResearchResult();
  const result = buildResearchContext(research);

  assert.equal(result.role.public_jd, research.role_research.public_jd);
  assert.equal(result.role.user_jd, research.user_jd);
});

test("uses user JD when no public role was found", () => {
  const research = completeResearchResult();
  research.role_research.matching_role_found = false;
  research.role_research.public_jd = null;
  research.role_research.job_url = null;
  research.role_research.job_title = null;
  const result = buildResearchContext(research);

  assert.equal(result.role.matching_role_found, false);
  assert.equal(result.role.job_source, "user_provided");
  assert.equal(result.role.public_jd, null);
  assert.equal(result.role.user_jd, research.user_jd);
  assert.ok(result.research_gaps.includes("public_role_not_found"));
});

test("represents thin company research without inventing details", () => {
  const result = buildResearchContext({
    company: { name: "Acme", url: "https://acme.example.com", summary: "", sources: [] },
    role_research: { requested_role: "Engineer", matching_role_found: false },
    user_jd: "A short JD.",
    pages_used: [],
    warnings: [],
  });

  assert.equal(result.company.summary, "");
  assert.equal(result.company.what_they_do, "");
  assert.equal(result.company.products_services, "");
  assert.equal(result.role.public_jd, null);
  assert.equal(result.role.user_jd, "A short JD.");
  assert.deepEqual(result.sources, []);
  assert.ok(result.research_gaps.includes("limited_company_information"));
  assert.ok(result.research_gaps.includes("careers_information_unavailable"));
});

test("defaults missing optional fields while preserving empty arrays", () => {
  const result = buildResearchContext({
    company: { name: "Acme", url: "https://acme.example.com", sources: [] },
    role_research: { requested_role: "Engineer", matching_role_found: true },
    user_jd: "Original JD",
    pages_used: [],
  });

  assert.equal(result.company.summary, "");
  assert.equal(result.company.industry_domain, "");
  assert.equal(result.role.public_jd, null);
  assert.equal(result.role.job_url, null);
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.pages_used, []);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.research_gaps.includes("public_jd_unavailable"));
});

test("preserves and de-duplicates source and page URLs in first-seen order", () => {
  const research = completeResearchResult();
  const aboutSource = research.company.sources[0];
  research.company.sources.push({ ...aboutSource, title: "Duplicate about page" });
  research.pages_used.push(research.pages_used[0], "https://acme.example.com/jobs/software-engineer");
  const result = buildResearchContext(research);

  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0].title, "About Acme");
  assert.deepEqual(result.pages_used, [
    "https://acme.example.com/",
    "https://acme.example.com/about",
    "https://acme.example.com/careers",
    "https://acme.example.com/jobs/software-engineer",
  ]);
});

test("preserves warnings", () => {
  const research = completeResearchResult();
  const result = buildResearchContext(research);

  assert.deepEqual(result.warnings, research.warnings);
  assert.notEqual(result.warnings, research.warnings);
  assert.notEqual(result.warnings[0], research.warnings[0]);
});

test("derives only research gaps supported by the result", () => {
  const research = completeResearchResult();
  const result = buildResearchContext(research);

  assert.deepEqual(result.research_gaps, []);

  research.company.careers_information = "";
  research.company.sources = research.company.sources.filter((source) => source.type !== "careers");
  const withoutCareersEvidence = buildResearchContext(research);
  assert.ok(withoutCareersEvidence.research_gaps.includes("careers_information_unavailable"));
});

test("does not mutate the original research result", () => {
  const research = completeResearchResult();
  const before = structuredClone(research);

  buildResearchContext(research);

  assert.deepEqual(research, before);
});

test("rejects malformed research with structured validation errors", () => {
  assert.throws(
    () => buildResearchContext({ company: {}, role_research: {}, user_jd: 10 }),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.statusCode, 400);
      assert.ok(Array.isArray(error.details));
      return true;
    },
  );
});

test("does not invent absent company facts", () => {
  const result = buildResearchContext({
    company: { name: "Unknown Co", url: "https://unknown.example.com", sources: [] },
    role_research: { requested_role: "Engineer", matching_role_found: false },
    user_jd: "User facts only.",
  });

  assert.deepEqual(result.company, {
    name: "Unknown Co",
    url: "https://unknown.example.com",
    summary: "",
    what_they_do: "",
    products_services: "",
    industry_domain: "",
    careers_information: "",
    sources: [],
  });
  assert.equal(result.role.public_jd, null);
  assert.equal(result.role.user_jd, "User facts only.");
});

test("produces deterministic output for identical input", () => {
  const research = completeResearchResult();

  assert.deepEqual(buildResearchContext(research), buildResearchContext(research));
});
