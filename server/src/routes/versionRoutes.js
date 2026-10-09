
const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authMiddleware");
const { getFileVersions } = require("../controllers/versionController");

router.get("/:fileId/versions", authenticateToken, getFileVersions);

module.exports = router;