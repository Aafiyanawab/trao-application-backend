class AppError extends Error {
  constructor(message, code = "INTERNAL_ERROR", statusCode = 500, details) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function notFoundError() {
  return new AppError("The requested resource was not found", "NOT_FOUND", 404);
}

module.exports = {
  AppError,
  notFoundError,
};
