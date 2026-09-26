const { AppError } = require("../utils/errors");
const { fetchCompanyPage } = require("./web-research.service");

const DEFAULT_MAX_PAGES = 6;
const MAX_ALLOWED_PAGES = 12;
const PAGE_SIGNALS = [
  { type: "careers", pattern: /\b(careers?|jobs?|join us|work with us|openings?|vacancies|hiring|apply)\b/ },
  { type: "about", pattern: /\b(about|company|who we are|our story|mission)\b/ },
  { type: "products", pattern: /\b(products?|services?|solutions?|platform)\b/ },
  { type: "teams", pattern: /\b(teams?|people|culture)\b/ },
];
const ROLE_STOP_WORDS = new Set([
  "a", "an", "and", "at", "for", "in", "of", "or", "the", "to", "with",
  "senior", "sr", "junior", "jr", "staff", "principal", "lead", "i", "ii", "iii",
  "engineer", "engineering", "developer", "developers", "manager", "specialist",
  "analyst", "associate", "consultant", "intern",
]);

function validationError(details) {
  return new AppError("Company research input is invalid", "VALIDATION_ERROR", 400, details);
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function roleTokens(role) {
  return [...new Set(normalizeText(role).split(/\s+/).filter((token) => token && !ROLE_STOP_WORDS.has(token)))];
}

function roleMatchScore(role, candidateText) {
  const tokens = roleTokens(role);
  if (tokens.length === 0) return 0;
  const normalizedCandidate = ` ${normalizeText(candidateText)} `;
  return tokens.filter((token) => normalizedCandidate.includes(` ${token} `)).length;
}

function hasRoleMatch(role, candidateText) {
  const tokens = roleTokens(role);
  return tokens.length > 0 && roleMatchScore(role, candidateText) >= Math.ceil(tokens.length * 0.6);
}

function detectPageType(value) {
  const normalized = normalizeText(value);
  for (const signal of PAGE_SIGNALS) {
    if (signal.pattern.test(normalized)) return signal.type;
  }
  return "company";
}

function classifyCandidate(link, baseUrl, requestedRole) {
  let url;
  try {
    url = new URL(link.href, baseUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";

  const baseHost = new URL(baseUrl).hostname.toLowerCase().replace(/^www\./, "");
  const linkHost = url.hostname.toLowerCase().replace(/^www\./, "");
  if (linkHost !== baseHost && !linkHost.endsWith(`.${baseHost}`)) return null;

  const discoveryText = `${url.pathname.replace(/[-_/]+/g, " ")} ${link.text || ""}`;
  const type = detectPageType(discoveryText);
  const roleScore = roleMatchScore(requestedRole, discoveryText);
  const isRoleCandidate = roleScore > 0;
  if (type === "company" && !isRoleCandidate) return null;

  const priority = type === "careers" || isRoleCandidate ? 0 : type === "about" ? 1 : 2;
  return {
    url: url.href,
    type: isRoleCandidate && type === "company" ? "role" : type,
    priority,
    roleScore,
  };
}

function canonicalUrl(value) {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
}

function excerpt(text, maxLength = 700) {
  return String(text || "").trim().slice(0, maxLength);
}

function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw validationError([{ path: "input", message: "must be an object" }]);
  }

  const details = [];
  for (const field of ["company_name", "company_url", "role"]) {
    if (typeof input[field] !== "string" || input[field].trim() === "") {
      details.push({ path: field, message: "must be a non-empty string" });
    }
  }
  if (typeof input.user_jd !== "string") {
    details.push({ path: "user_jd", message: "must be a string" });
  }
  if (details.length > 0) throw validationError(details);
}

function createCompanyResearchService({ fetchPage = fetchCompanyPage, maxPages = DEFAULT_MAX_PAGES } = {}) {
  if (typeof fetchPage !== "function") {
    throw new TypeError("fetchPage must be a function");
  }
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_ALLOWED_PAGES) {
    throw new TypeError(`maxPages must be an integer between 1 and ${MAX_ALLOWED_PAGES}`);
  }

  async function researchCompany(input) {
    validateInput(input);

    const companyName = input.company_name.trim();
    const companyUrl = input.company_url.trim();
    const requestedRole = input.role.trim();
    const userJd = input.user_jd;
    const pages = [];
    const warnings = [];
    const visited = new Set();
    const queued = new Set();
    let discoverySequence = 0;
    let candidates = [{ url: companyUrl, type: "company", priority: -1, roleScore: 0, sequence: discoverySequence++ }];
    queued.add(canonicalUrl(companyUrl));

    while (pages.length < maxPages && candidates.length > 0) {
      candidates.sort((left, right) =>
        left.priority - right.priority ||
        right.roleScore - left.roleScore ||
        left.sequence - right.sequence,
      );
      const candidate = candidates.shift();
      const key = canonicalUrl(candidate.url);
      if (visited.has(key)) continue;
      visited.add(key);

      let fetched;
      try {
        fetched = await fetchPage(candidate.url);
      } catch (error) {
        if (error?.code === "VALIDATION_ERROR" && error.statusCode === 400 && pages.length === 0) {
          throw error;
        }
        warnings.push({
          url: candidate.url,
          code: typeof error?.code === "string" ? error.code : "PAGE_UNAVAILABLE",
          message: "This company page could not be retrieved.",
        });
        continue;
      }

      const finalUrl = fetched.final_url || fetched.url || candidate.url;
      const page = {
        url: finalUrl,
        title: fetched.title || "",
        type: candidate.type === "company"
          ? detectPageType(`${finalUrl} ${fetched.title || ""} ${(fetched.headings || []).join(" ")}`)
          : candidate.type,
        text: fetched.text || "",
        headings: Array.isArray(fetched.headings) ? fetched.headings.slice() : [],
      };
      pages.push(page);

      const links = Array.isArray(fetched.links) ? fetched.links : [];
      for (const link of links) {
        if (!link || typeof link.href !== "string") continue;
        const discovered = classifyCandidate(link, finalUrl, requestedRole);
        if (!discovered) continue;
        const discoveredKey = canonicalUrl(discovered.url);
        if (visited.has(discoveredKey) || queued.has(discoveredKey)) continue;
        queued.add(discoveredKey);
        candidates.push({ ...discovered, sequence: discoverySequence++ });
      }
    }

    const jobCandidates = pages
      .filter((page) => ["careers", "role"].includes(page.type))
      .map((page, index) => {
        const searchable = `${page.title} ${page.url} ${page.headings.join(" ")} ${page.text}`;
        return {
          page,
          index,
          score: roleMatchScore(requestedRole, searchable),
          matched: hasRoleMatch(requestedRole, searchable),
        };
      })
      .filter((candidate) => candidate.matched)
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const matchingJob = jobCandidates[0]?.page;

    const homePage = pages[0];
    const companyPage = pages.find((page) => ["about", "products", "teams"].includes(page.type));
    const summarySource = homePage?.text || companyPage?.text || "";
    const aboutOrProducts = pages.find((page) => ["about", "products"].includes(page.type));
    const productsPage = pages.find((page) => page.type === "products");
    const careersPage = pages.find((page) => page.type === "careers");
    const whatTheyDoSource = aboutOrProducts?.text || "";
    const sources = pages.map((page) => ({
      url: page.url,
      title: page.title,
      type: page.type,
      text: excerpt(page.text),
    }));

    return {
      company: {
        name: companyName,
        url: companyUrl,
        summary: excerpt(summarySource),
        what_they_do: excerpt(whatTheyDoSource),
        products_services: excerpt(productsPage?.text || ""),
        industry_domain: excerpt(aboutOrProducts?.text || ""),
        careers_information: excerpt(careersPage?.text || ""),
        sources,
      },
      role_research: {
        requested_role: requestedRole,
        matching_role_found: Boolean(matchingJob),
        job_source: matchingJob ? "company_public_page" : "user_provided",
        job_url: matchingJob?.url || null,
        job_title: matchingJob?.title || null,
        public_jd: matchingJob?.text || null,
      },
      user_jd: userJd,
      pages_used: pages.map((page) => page.url),
      warnings,
    };
  }

  return { researchCompany };
}

const defaultService = createCompanyResearchService();

module.exports = {
  createCompanyResearchService,
  researchCompany: defaultService.researchCompany,
};
