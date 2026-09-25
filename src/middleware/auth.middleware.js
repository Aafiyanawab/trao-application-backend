const authService = require("../services/auth.service");
const { AppError } = require("../utils/errors");

const SESSION_COOKIE = "trao_session";

function parseCookies(header = "") {
  return header.split(";").reduce((cookies, pair) => {
    const separator = pair.indexOf("=");
    if (separator === -1) {
      return cookies;
    }

    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

async function requireAuth(req, res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const user = await authService.getUserBySessionToken(token);

    if (!user) {
      throw new AppError("Authentication is required", "UNAUTHORIZED", 401);
    }

    req.user = user;
    req.sessionToken = token;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  SESSION_COOKIE,
  requireAuth,
};
