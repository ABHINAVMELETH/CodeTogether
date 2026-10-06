const express = require("express");

const {
  createFile,
  getFiles,
  getFile,
  updateFile,
} = require("../controllers/fileController");

const authenticateToken = require("../middleware/authMiddleware");

const router = express.Router();


// Create file
router.post(
  "/:roomId/files",
  authenticateToken,
  createFile
);


// Get all files
router.get(
  "/:roomId/files",
  authenticateToken,
  getFiles
);


// Get one file
router.get(
  "/:roomId/files/:fileId",
  authenticateToken,
  getFile
);


// Save/update file
router.put(
  "/:roomId/files/:fileId",
  authenticateToken,
  updateFile
);


module.exports = router;