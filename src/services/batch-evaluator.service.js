const { AppError } = require("../utils/errors");
const { researchCompany } = require("./company-research.service");
const { extractRequestedRole } = require("./requirement-extraction.service");
const { buildGenerationContext } = require("./generation-context.service");
const { generateWithCoverageAndSchedule } = require("./coverage-schedule.service");

const INPUT_FIELDS = new Set(["id", "jd", "company_url", "days"]);

function inputError(message, details = undefined) {
  return new AppError(message, "BATCH_INPUT_INVALID", 400, details);
}

function validateBatchInput(input) {
  if (!Array.isArray(input)) throw inputError("Batch input must be an array");
  const ids = new Set();
  input.forEach((item, index) => {
    const path = `cases[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw inputError(`${path} must be an object`);
    }
    const extra = Object.keys(item).filter((field) => !INPUT_FIELDS.has(field));
    if (extra.length) throw inputError(`${path} contains unsupported fields: ${extra.join(", ")}`);
    if (typeof item.id !== "string" || !item.id.trim() || item.id.length > 128) throw inputError(`${path}.id must be a non-empty string of at most 128 characters`);
    if (ids.has(item.id)) throw inputError(`Duplicate case id: ${item.id}`);
    ids.add(item.id);
    if (typeof item.jd !== "string" || !item.jd.trim() || item.jd.length > 20000) throw inputError(`${path}.jd must be a non-empty string of at most 20000 characters`);
    if (typeof item.company_url !== "string" || !item.company_url.trim() || item.company_url.length > 2048) {
      throw inputError(`${path}.company_url must be a non-empty URL of at most 2048 characters`);
    }
    if (!Number.isInteger(item.days) || item.days < 1 || item.days > 60) {
      throw inputError(`${path}.days must be an integer between 1 and 60`);
    }
  });
  return input;
}

function projectKit(id, jd, generationContext, result, researchedAt) {
  const generated = result?.kit;
  if (!generated || !result.schedule || !result.coverage) {
    throw new AppError("The pipeline did not produce a complete kit", "KIT_INCOMPLETE", 422);
  }
  const questions = [...generated.technical_questions, ...generated.non_technical_questions].map((question) => ({
    id: question.id,
    requirement_ids: question.requirement_ids,
    category: question.category,
    prompt: question.question,
    answer_outline: question.answer_outline,
    difficulty: question.difficulty,
  }));
  const flashcards = generated.flashcards.map((card) => ({
    id: card.id,
    front: card.front,
    back: card.back,
    requirement_ids: card.requirement_ids,
  }));
  return {
    source: {
      company: generationContext.company.name,
      company_url: generationContext.company.url,
      role: generationContext.role.requested_role,
      location: null,
      jd_chars: jd.length,
      researched_at: researchedAt,
      pages_used: generationContext.research.pages_used,
    },
    company_brief: {
      summary: generationContext.company.summary || "",
      what_they_do: generationContext.company.what_they_do || "",
      sources: generationContext.research.sources.map((source) => source.url).filter((url) => typeof url === "string"),
    },
    role: {
      title: generationContext.role.requested_role,
      seniority: generationContext.role.seniority ?? null,
      responsibilities: generationContext.role.responsibilities || [],
      requirements: generationContext.requirements,
    },
    questions,
    flashcards,
    schedule: result.schedule,
    coverage: {
      uncovered_requirement_ids: result.coverage.uncovered_requirement_ids,
      passes: result.coverage.passes,
    },
  };
}

function createBatchEvaluator({
  research = researchCompany,
  extractRole = extractRequestedRole,
  buildContext = buildGenerationContext,
  generatePipeline = generateWithCoverageAndSchedule,
  now = () => new Date(),
} = {}) {
  for (const [name, fn] of Object.entries({ research, extractRole, buildContext, generatePipeline, now })) {
    if (typeof fn !== "function") throw new TypeError(`${name} must be a function`);
  }

  async function evaluateBatch(input) {
    validateBatchInput(input);
    const kits = [];
    for (const item of input) {
      try {
        const role = extractRole(item.jd);
        if (!role) throw new AppError("No explicit role title was found in the JD", "ROLE_UNAVAILABLE", 422);
        const researched = await research({
          company_url: item.company_url,
          role,
          user_jd: item.jd,
        });
        if (typeof researched?.company?.name !== "string" || !researched.company.name.trim()) {
          const blockingWarning = (researched?.pages_used?.length ?? 0) === 0
            ? researched?.warnings?.find((warning) =>
              ["ROBOTS_DISALLOW", "ROBOTS_UNAVAILABLE", "HTTP_RATE_LIMITED"].includes(warning?.code),
            )
            : null;
          throw new AppError(
            blockingWarning?.message || "Company research completed, but no trustworthy company name was available; generation was skipped.",
            blockingWarning?.code || "COMPANY_IDENTITY_UNAVAILABLE",
            422,
          );
        }
        const context = buildContext({
          company: researched.company,
          role: { ...researched.role_research, user_jd: researched.user_jd },
          research: {
            sources: researched.company.sources,
            pages_used: researched.pages_used,
            research_gaps: [],
            warnings: researched.warnings,
          },
        });
        const result = await generatePipeline({
          generationContext: context,
          candidateContext: undefined,
          githubContext: undefined,
          daysAvailable: item.days,
        });
        const researchedAt = now().toISOString();
        kits.push({
          id: item.id,
          status: "ok",
          kit: projectKit(item.id, item.jd, context, result, researchedAt),
          error: null,
        });
      } catch (error) {
        kits.push({
          id: item.id,
          status: "failed",
          kit: null,
          error: {
            code: typeof error?.code === "string" ? error.code : "CASE_EVALUATION_FAILED",
            message: typeof error?.message === "string" ? error.message : "Case evaluation failed",
          },
        });
      }
    }
    return { version: "1.0", generated_at: now().toISOString(), kits };
  }

  return { evaluateBatch };
}

const defaultEvaluator = createBatchEvaluator();
module.exports = { createBatchEvaluator, evaluateBatch: defaultEvaluator.evaluateBatch, validateBatchInput };
