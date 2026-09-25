const kitService = require("../services/kit.service");
const { AppError } = require("../utils/errors");
const { validateObjectId } = require("../utils/validation");

async function listKits(req, res) {
  const kits = await kitService.listKitsForUser(req.user._id);
  res.json({ items: kits, placeholder: true });
}

function notImplemented(req, res, next) {
  next(
    new AppError(
      "Kit generation and editing are not implemented yet",
      "NOT_IMPLEMENTED",
      501,
    ),
  );
}

function getKit(req, res, next) {
  validateObjectId(req.params.id);
  notImplemented(req, res, next);
}

module.exports = {
  listKits,
  createKit: notImplemented,
  getKit,
  updateKit: notImplemented,
  deleteKit: notImplemented,
};
