const express = require("express");

const {
  createRoom,
  getRooms,
  joinRoom,
  getRoom,
} = require("../controllers/roomController");

const authenticateToken = require("../middleware/authMiddleware");

const router = express.Router();

router.post(
  "/",
  authenticateToken,
  createRoom
);

router.get(
  "/",
  authenticateToken,
  getRooms
);

router.post(
  "/join",
  authenticateToken,
  joinRoom
);

router.get(
  "/:roomId",
  authenticateToken,
  getRoom
);

module.exports = router;