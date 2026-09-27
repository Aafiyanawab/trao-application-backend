const { AppError } = require("../utils/errors");

function notFoundHandler(req, res, next) {
  next(new AppError("The requested resource was not found", "NOT_FOUND", 404));
}

function errorHandler(error, req, res, next) {
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request body must contain valid JSON",
      },
    });
  }

  const knownAppError = error instanceof AppError;
  const statusCode = knownAppError ? error.statusCode : 500;
  const code = knownAppError ? error.code : "INTERNAL_ERROR";
  const message = knownAppError ? error.message : "An unexpected error occurred";

  if (statusCode >= 500) {
    console.error(error);
  }

  const response = {
    error: {
      code,
      message,
    },
  };

  if (knownAppError && error.details) {
    response.error.details = error.details;
  }

  res.status(statusCode).json(response);
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
