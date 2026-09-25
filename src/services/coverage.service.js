const { AppError } = require("../utils/errors");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validationError(details) {
  return new AppError(
    "Coverage check validation failed",
    "VALIDATION_ERROR",
    400,
    details,
  );
}

function checkCoverage(kit, passes = undefined) {
  if (!isPlainObject(kit)) {
    throw validationError([{ path: "kit", message: "must be an object" }]);
  }

  const details = [];
  const requirements = kit.role && kit.role.requirements;
  const questions = kit.questions;

  if (!Array.isArray(requirements)) {
    details.push({ path: "role.requirements", message: "must be an array" });
  }
  if (!Array.isArray(questions)) {
    details.push({ path: "questions", message: "must be an array" });
  }

  if (details.length > 0) {
    throw validationError(details);
  }

  const requirementIds = new Set();
  const mustRequirementIds = new Set();

  requirements.forEach((requirement, index) => {
    const path = `role.requirements[${index}]`;
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

  const coveredRequirementIds = new Set();
  questions.forEach((question, index) => {
    const path = `questions[${index}]`;
    if (!isPlainObject(question)) {
      details.push({ path, message: "must be an object" });
      return;
    }

    if (!Array.isArray(question.requirement_ids)) {
      details.push({
        path: `${path}.requirement_ids`,
        message: "must be an array",
      });
      return;
    }

    question.requirement_ids.forEach((requirementId, requirementIndex) => {
      const requirementPath = `${path}.requirement_ids[${requirementIndex}]`;
      if (typeof requirementId !== "string" || requirementId.trim() === "") {
        details.push({ path: requirementPath, message: "must be a non-empty string" });
      } else if (!requirementIds.has(requirementId)) {
        details.push({
          path: requirementPath,
          message: `references unknown requirement '${requirementId}'`,
        });
      } else {
        coveredRequirementIds.add(requirementId);
      }
    });
  });

  if (details.length > 0) {
    throw validationError(details);
  }

  const uncoveredRequirementIds = requirements
    .filter((requirement) => !coveredRequirementIds.has(requirement.id))
    .map((requirement) => requirement.id);
  const uncoveredMustRequirementIds = uncoveredRequirementIds.filter((id) => mustRequirementIds.has(id));
  const coveragePasses = passes === undefined ? kit.coverage?.passes ?? 1 : passes;

  if (!Number.isInteger(coveragePasses) || coveragePasses < 0) {
    throw validationError([
      {
        path: "passes",
        message: "must be a non-negative integer",
      },
    ]);
  }

  return {
    uncovered_requirement_ids: uncoveredRequirementIds,
    covered_requirement_ids: requirements
      .filter((requirement) => coveredRequirementIds.has(requirement.id))
      .map((requirement) => requirement.id),
    all_must_requirements_covered: uncoveredMustRequirementIds.length === 0,
    passes: coveragePasses,
  };
}

module.exports = {
  checkCoverage,
};
