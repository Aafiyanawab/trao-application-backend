const { ObjectId } = require("mongodb");
const { AppError } = require("./errors");

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError(`${field} is required`, "VALIDATION_ERROR", 400);
  }

  return value.trim();
}

function validateEmail(value) {
  const email = requireString(value, "email").toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError("email must be valid", "VALIDATION_ERROR", 400);
  }

  return email;
}

function validatePassword(value) {
  const password = requireString(value, "password");
  if (password.length < 8 || Buffer.byteLength(password, "utf8") > 1024) {
    throw new AppError("password must be at least 8 characters and at most 1024 bytes", "VALIDATION_ERROR", 400);
  }

  return password;
}

function validateObjectId(value, field = "id") {
  if (!ObjectId.isValid(value)) {
    throw new AppError(`${field} must be a valid id`, "VALIDATION_ERROR", 400);
  }

  return new ObjectId(value);
}

function validateRegisterPayload(body = {}) {
  return {
    email: validateEmail(body.email),
    password: validatePassword(body.password),
  };
}

function validateLoginPayload(body = {}) {
  const password = requireString(body.password, "password");
  if (Buffer.byteLength(password, "utf8") > 1024) {
    throw new AppError("password must not exceed 1024 bytes", "VALIDATION_ERROR", 400, [
      { path: "password", message: "must not exceed 1024 bytes" },
    ]);
  }
  return {
    email: validateEmail(body.email),
    password,
  };
}

module.exports = {
  requireString,
  validateEmail,
  validatePassword,
  validateObjectId,
  validateRegisterPayload,
  validateLoginPayload,
};
