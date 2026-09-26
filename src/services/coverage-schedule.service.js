const { AppError } = require("../utils/errors");
const { generateInterviewKit: generateContent } = require("./interview-generation.service");
const { validateGeneratedInterviewKit } = require("./generated-kit-validation.service");
const { checkCoverage } = require("./coverage.service");
const { allocateSchedule } = require("./schedule.service");

const QUESTION_SECTIONS = ["technical_questions", "non_technical_questions"];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

function validatePipelineInput(input) {
  const details = [];
  if (!isPlainObject(input)) {
    throw new AppError("Coverage and schedule input is invalid", "VALIDATION_ERROR", 400, [
      { path: "input", message: "must be an object" },
    ]);
  }
  if (!isPlainObject(input.generationContext)) {
    details.push({ path: "generationContext", message: "is required and must be an object" });
  } else if (!Array.isArray(input.generationContext.requirements)) {
    details.push({ path: "generationContext.requirements", message: "must be an array" });
  }
  if (!Number.isInteger(input.daysAvailable) || input.daysAvailable < 1 || input.daysAvailable > 60) {
    details.push({ path: "daysAvailable", message: "must be an integer between 1 and 60" });
  }
  if (details.length > 0) {
    throw new AppError("Coverage and schedule input is invalid", "VALIDATION_ERROR", 400, details);
  }
}

function collectQuestions(kit) {
  return [...kit.technical_questions, ...kit.non_technical_questions];
}

function coverageInput(kit, requirements) {
  return {
    role: { requirements },
    questions: collectQuestions(kit),
  };
}

function categorizeCoverage(coverage, requirements) {
  const requirementById = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const uncoveredMust = coverage.uncovered_requirement_ids.filter(
    (id) => requirementById.get(id)?.priority === "must",
  );
  const uncoveredNice = coverage.uncovered_requirement_ids.filter(
    (id) => requirementById.get(id)?.priority === "nice",
  );

  return {
    ...coverage,
    uncovered_must_requirement_ids: uncoveredMust,
    uncovered_nice_requirement_ids: uncoveredNice,
  };
}

function mergeByIdentity(firstItems, secondItems, getId, getContentKey) {
  const merged = firstItems.map(cloneValue);
  const ids = new Set(firstItems.map(getId));
  const contentKeys = new Set(firstItems.map(getContentKey));

  for (const item of secondItems) {
    const id = getId(item);
    const contentKey = getContentKey(item);
    if (ids.has(id) || contentKeys.has(contentKey)) continue;
    ids.add(id);
    contentKeys.add(contentKey);
    merged.push(cloneValue(item));
  }

  return merged;
}

function normalizedText(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function mergeGeneratedMaterial(firstKit, secondKit) {
  const merged = cloneValue(firstKit);
  const questionId = (question) => question.id;
  const questionContent = (question) => normalizedText(question.question);
  const flashcardId = (flashcard) => flashcard.id;
  const flashcardContent = (flashcard) => `${normalizedText(flashcard.front)}\u0000${normalizedText(flashcard.back)}`;
  const seenQuestionIds = new Set([
    ...firstKit.technical_questions.map(questionId),
    ...firstKit.non_technical_questions.map(questionId),
  ]);
  const seenQuestionContent = new Set([
    ...firstKit.technical_questions.map(questionContent),
    ...firstKit.non_technical_questions.map(questionContent),
  ]);

  for (const section of QUESTION_SECTIONS) {
    for (const question of secondKit[section]) {
      const id = questionId(question);
      const content = questionContent(question);
      if (seenQuestionIds.has(id) || seenQuestionContent.has(content)) continue;
      seenQuestionIds.add(id);
      seenQuestionContent.add(content);
      merged[section].push(cloneValue(question));
    }
  }

  merged.flashcards = mergeByIdentity(
    firstKit.flashcards,
    secondKit.flashcards,
    flashcardId,
    flashcardContent,
  );

  for (const section of ["interviewer_questions", "interview_tips", "follow_up_guidance"]) {
    const seen = new Set(firstKit[section].map(normalizedText));
    merged[section] = firstKit[section].map(cloneValue);
    for (const item of secondKit[section]) {
      const normalized = normalizedText(item);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      merged[section].push(item);
    }
  }

  return merged;
}

function createCoverageScheduleService({
  generate = generateContent,
  validate = validateGeneratedInterviewKit,
  coverage = checkCoverage,
  schedule = allocateSchedule,
} = {}) {
  for (const [dependencyName, dependency] of Object.entries({ generate, validate, coverage, schedule })) {
    if (typeof dependency !== "function") throw new TypeError(`${dependencyName} must be a function`);
  }

  async function generateWithCoverageAndSchedule({
    generationContext,
    candidateContext,
    githubContext,
    daysAvailable,
  } = {}) {
    validatePipelineInput({ generationContext, daysAvailable });
    const requirements = generationContext.requirements;

    const firstGenerated = await generate(generationContext, candidateContext, githubContext);
    const firstKit = await validate(firstGenerated, { generationContext });
    const firstCoverage = coverage(coverageInput(firstKit, requirements), 1);

    let finalKit = firstKit;
    let finalCoverage = firstCoverage;
    let passes = 1;

    if (!firstCoverage.all_must_requirements_covered) {
      const uncoveredMustRequirementIds = firstCoverage.uncovered_requirement_ids.filter((id) =>
        requirements.some((requirement) => requirement.id === id && requirement.priority === "must"),
      );
      const secondGenerated = await generate(
        generationContext,
        candidateContext,
        githubContext,
        {
          secondPass: {
            uncovered_must_requirement_ids: uncoveredMustRequirementIds,
            existing_material: {
              technical_questions: cloneValue(firstKit.technical_questions),
              non_technical_questions: cloneValue(firstKit.non_technical_questions),
              flashcards: cloneValue(firstKit.flashcards),
            },
            coverage: cloneValue(firstCoverage),
          },
        },
      );
      const secondKit = await validate(secondGenerated, { generationContext });
      finalKit = mergeGeneratedMaterial(firstKit, secondKit);
      finalCoverage = coverage(coverageInput(finalKit, requirements), 2);
      passes = 2;
    }

    const categorizedCoverage = categorizeCoverage(finalCoverage, requirements);
    let finalSchedule = null;
    const warnings = [];
    if (categorizedCoverage.all_must_requirements_covered) {
      finalSchedule = schedule(collectQuestions(finalKit), requirements, daysAvailable);
    } else {
      warnings.push({
        code: "MUST_REQUIREMENTS_UNCOVERED",
        message: "A schedule was not created because must-have requirements remain uncovered.",
      });
    }

    return {
      kit: finalKit,
      coverage: { requirements: cloneValue(requirements), ...categorizedCoverage, passes },
      schedule: finalSchedule,
      warnings,
    };
  }

  return { generateWithCoverageAndSchedule };
}

const defaultService = createCoverageScheduleService();

module.exports = {
  createCoverageScheduleService,
  generateWithCoverageAndSchedule: defaultService.generateWithCoverageAndSchedule,
};
