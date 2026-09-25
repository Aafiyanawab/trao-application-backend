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

  const statusCode = error.statusCode || 500;
  const code = error.code || "INTERNAL_ERROR";
  const message = statusCode >= 500 ? "An unexpected error occurred" : error.message;

  if (statusCode >= 500) {
    console.error(error);
  }

  res.status(statusCode).json({
    error: {
      code,
      message,
    },
  });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
