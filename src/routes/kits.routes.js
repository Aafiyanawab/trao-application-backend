const express = require("express");

const kitsController = require("../controllers/kits.controller");
const { requireAuth } = require("../middleware/auth.middleware");

const router = express.Router();

router.use(requireAuth);
router.get("/", kitsController.listKits);
router.post("/", kitsController.createKit);
router.get("/:id", kitsController.getKit);
router.patch("/:id", kitsController.updateKit);
router.delete("/:id", kitsController.deleteKit);

module.exports = router;
