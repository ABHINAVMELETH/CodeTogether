const pool = require("../config/db");

const {
  setRevision,
  deleteRevision,
} = require("../services/revisionStore");


// Create a new file
const createFile = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { filename, language } = req.body;

    // Check filename
    if (!filename || filename.trim() === "") {
      return res.status(400).json({
        message: "Filename is required",
      });
    }

    // Check whether user belongs to the room
    const memberResult = await pool.query(
      `SELECT 1
       FROM room_members
       WHERE room_id = $1
       AND user_id = $2`,
      [roomId, req.user.userId]
    );

    if (memberResult.rows.length === 0) {
      return res.status(403).json({
        message: "You are not a member of this room",
      });
    }

    // Create file
    const result = await pool.query(
      `INSERT INTO files
       (room_id, filename, language)
       VALUES ($1, $2, $3)
       RETURNING id, room_id, filename, language,
                 content, revision, created_at, updated_at`,
      [
        roomId,
        filename.trim(),
        language || null,
      ]
    );

    res.status(201).json({
      message: "File created successfully",
      file: result.rows[0],
    });

  } catch (error) {
    console.error(error);

    if (error.code === "23505") {
      return res.status(409).json({
        message: "A file with this name already exists",
      });
    }

    res.status(500).json({
      message: "Server error",
    });
  }
};


// Get all files inside a room
const getFiles = async (req, res) => {
  try {
    const { roomId } = req.params;

    // Check room membership
    const memberResult = await pool.query(
      `SELECT 1
       FROM room_members
       WHERE room_id = $1
       AND user_id = $2`,
      [roomId, req.user.userId]
    );

    if (memberResult.rows.length === 0) {
      return res.status(403).json({
        message: "You are not a member of this room",
      });
    }

    // Get files
    const result = await pool.query(
      `SELECT
        id,
        room_id,
        filename,
        language,
        content,
        revision,
        created_at,
        updated_at
       FROM files
       WHERE room_id = $1
       ORDER BY created_at ASC`,
      [roomId]
    );

    res.status(200).json({
      files: result.rows,
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Server error",
    });
  }
};


// Get one file
const getFile = async (req, res) => {
  try {
    const { roomId, fileId } = req.params;

    // Check room membership
    const memberResult = await pool.query(
      `SELECT 1
       FROM room_members
       WHERE room_id = $1
       AND user_id = $2`,
      [roomId, req.user.userId]
    );

    if (memberResult.rows.length === 0) {
      return res.status(403).json({
        message: "You are not a member of this room",
      });
    }

    // Get the file
    const result = await pool.query(
      `SELECT
        id,
        room_id,
        filename,
        language,
        content,
        revision,
        created_at,
        updated_at
       FROM files
       WHERE id = $1
       AND room_id = $2`,
      [fileId, roomId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "File not found",
      });
    }

    res.status(200).json({
      file: result.rows[0],
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Server error",
    });
  }
};


// Update file content
const updateFile = async (req, res) => {
  try {
    const { roomId, fileId } = req.params;
    const { content } = req.body;

    // Check room membership
    const memberResult = await pool.query(
      `SELECT 1
       FROM room_members
       WHERE room_id = $1
       AND user_id = $2`,
      [roomId, req.user.userId]
    );

    if (memberResult.rows.length === 0) {
      return res.status(403).json({
        message: "You are not a member of this room",
      });
    }

    // Update file
    const result = await pool.query(
      `UPDATE files
       SET content = $1,
           revision = revision + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       AND room_id = $3
       RETURNING
         id,
         room_id,
         filename,
         language,
         content,
         revision,
         created_at,
         updated_at`,
      [content || "", fileId, roomId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "File not found",
      });
    }

    // Get updated file
    const updatedFile = result.rows[0];

    // Keep WebSocket revision store
    // synchronized with PostgreSQL
    setRevision(
      fileId,
      updatedFile.revision
    );

    res.status(200).json({
      message: "File saved successfully",
      file: updatedFile,
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Server error",
    });
  }
};


module.exports = {
  createFile,
  getFiles,
  getFile,
  updateFile,
};

