const { AppError } = require("../utils/errors");

const MIN_DAYS = 1;
const MAX_DAYS = 60;
const BASE_MINUTES = 15;
const MINUTES_PER_DIFFICULTY_POINT = 15;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validationError(details) {
  return new AppError(
    "Schedule allocation validation failed",
    "VALIDATION_ERROR",
    400,
    details,
  );
}

function allocateSchedule(questions, requirements, daysAvailable) {
  const details = [];

  if (!Array.isArray(questions)) {
    details.push({ path: "questions", message: "must be an array" });
  }
  if (!Array.isArray(requirements)) {
    details.push({ path: "requirements", message: "must be an array" });
  }
  if (
    !Number.isInteger(daysAvailable) ||
    daysAvailable < MIN_DAYS ||
    daysAvailable > MAX_DAYS
  ) {
    details.push({
      path: "daysAvailable",
      message: `must be an integer between ${MIN_DAYS} and ${MAX_DAYS}`,
    });
  }

  if (details.length > 0) {
    throw validationError(details);
  }

  const requirementIds = new Set();
  const mustRequirementIds = new Set();
  requirements.forEach((requirement, index) => {
    const path = `requirements[${index}]`;
    if (!isPlainObject(requirement)) {
      details.push({ path, message: "must be an object" });
      return;
    }
    if (typeof requirement.id !== "string" || requirement.id.trim() === "") {
      details.push({ path: `${path}.id`, message: "must be a non-empty string" });
    } else if (requirementIds.has(requirement.id)) {
      details.push({ path: `${path}.id`, message: "must be unique within the kit" });
    } else {
      requirementIds.add(requirement.id);
    }
    if (requirement.priority !== "must" && requirement.priority !== "nice") {
      details.push({
        path: `${path}.priority`,
        message: "must be must or nice",
      });
    } else if (requirement.priority === "must" && typeof requirement.id === "string") {
      mustRequirementIds.add(requirement.id);
    }
  });

  const questionIds = new Set();
  const normalizedQuestions = [];
  questions.forEach((question, index) => {
    const path = `questions[${index}]`;
    if (!isPlainObject(question)) {
      details.push({ path, message: "must be an object" });
      return;
    }
    if (typeof question.id !== "string" || question.id.trim() === "") {
      details.push({ path: `${path}.id`, message: "must be a non-empty string" });
    } else if (questionIds.has(question.id)) {
      details.push({ path: `${path}.id`, message: "must be unique within the kit" });
    } else {
      questionIds.add(question.id);
    }
    if (!Array.isArray(question.requirement_ids)) {
      details.push({
        path: `${path}.requirement_ids`,
        message: "must be an array",
      });
    } else {
      question.requirement_ids.forEach((requirementId, requirementIndex) => {
        const requirementPath = `${path}.requirement_ids[${requirementIndex}]`;
        if (typeof requirementId !== "string" || requirementId.trim() === "") {
          details.push({ path: requirementPath, message: "must be a non-empty string" });
        } else if (!requirementIds.has(requirementId)) {
          details.push({
            path: requirementPath,
            message: `references unknown requirement '${requirementId}'`,
          });
        }
      });
    }
    if (!Number.isInteger(question.difficulty) || question.difficulty < 1 || question.difficulty > 3) {
      details.push({
        path: `${path}.difficulty`,
        message: "must be an integer between 1 and 3",
      });
    }
    normalizedQuestions.push({
      question,
      index,
      coversMustRequirement:
        Array.isArray(question.requirement_ids) &&
        question.requirement_ids.some((requirementId) => mustRequirementIds.has(requirementId)),
    });
  });

  const uncoveredMustRequirementIds = requirements
    .filter(
      (requirement) =>
        mustRequirementIds.has(requirement.id) &&
        !questions.some(
          (question) =>
            Array.isArray(question.requirement_ids) &&
            question.requirement_ids.includes(requirement.id),
        ),
    )
    .map((requirement) => requirement.id);

  if (uncoveredMustRequirementIds.length > 0) {
    details.push({
      path: "requirements",
      message: `must requirements are not covered by questions: ${uncoveredMustRequirementIds.join(", ")}`,
    });
  }

  if (details.length > 0) {
    throw validationError(details);
  }

  const rankedQuestions = normalizedQuestions
    .slice()
    .sort((left, right) => {
      if (left.coversMustRequirement !== right.coversMustRequirement) {
        return left.coversMustRequirement ? -1 : 1;
      }
      if (left.question.difficulty !== right.question.difficulty) {
        return right.question.difficulty - left.question.difficulty;
      }
      return left.index - right.index;
    });

  const days = [];
  const baseQuestionsPerDay = Math.floor(rankedQuestions.length / daysAvailable);
  const daysWithExtraQuestion = rankedQuestions.length % daysAvailable;
  let questionIndex = 0;

  for (let dayNumber = 1; dayNumber <= daysAvailable; dayNumber += 1) {
    const questionsForDay =
      baseQuestionsPerDay + (dayNumber <= daysWithExtraQuestion ? 1 : 0);
    const dayQuestions = rankedQuestions.slice(questionIndex, questionIndex + questionsForDay);
    questionIndex += questionsForDay;

    const questionIds = dayQuestions.map(({ question }) => question.id);
    const minutes = dayQuestions.reduce(
      (total, { question }) => total + BASE_MINUTES + question.difficulty * MINUTES_PER_DIFFICULTY_POINT,
      0,
    );

    days.push({
      day: dayNumber,
      focus: questionIds.length > 0 ? "Interview question practice" : "Review and reflection",
      question_ids: questionIds,
      minutes,
    });
  }

  return {
    days_available: daysAvailable,
    days,
  };
}

module.exports = {
  allocateSchedule,
};
