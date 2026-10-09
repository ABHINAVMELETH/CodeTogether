
const pool = require("../config/db");

const getFileVersions = async (req, res) => {
  const { fileId } = req.params;
  const userId = req.user.userId;

  try {
    // Verify the user belongs to the room containing this file.
    const accessResult = await pool.query(
      `SELECT f.id
       FROM files f
       JOIN room_members rm ON rm.room_id = f.room_id
       WHERE f.id = $1 AND rm.user_id = $2`,
      [fileId, userId]
    );

    if (accessResult.rows.length === 0) {
      return res.status(404).json({
        message: "File not found or access denied",
      });
    }

    const result = await pool.query(
      `SELECT
         id,
         file_id,
         revision,
         content,
         created_by,
         created_at
       FROM file_versions
       WHERE file_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
      [fileId]
    );

    return res.json({
      versions: result.rows,
    });
  } catch (error) {
    console.error("Get versions error:", error);

    return res.status(500).json({
      message: "Unable to load version history",
    });
  }
};

module.exports = {
  getFileVersions,
};