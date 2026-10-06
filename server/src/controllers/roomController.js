const pool = require("../config/db");

const createRoom = async (req, res) => {
  const client = await pool.connect();

  try {
    const { name } = req.body;

    // Check room name
    if (!name || name.trim() === "") {
      return res.status(400).json({
        message: "Room name is required",
      });
    }

    // Start transaction
    await client.query("BEGIN");

    // Create room
    const roomResult = await client.query(
      `INSERT INTO rooms (name, owner_id)
       VALUES ($1, $2)
       RETURNING id, name, owner_id, created_at`,
      [name.trim(), req.user.userId]
    );

    const room = roomResult.rows[0];

    // Add owner to room_members
    await client.query(
      `INSERT INTO room_members (room_id, user_id)
       VALUES ($1, $2)`,
      [room.id, req.user.userId]
    );

    // Complete transaction
    await client.query("COMMIT");

    res.status(201).json({
      message: "Room created successfully",
      room,
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error(error);

    res.status(500).json({
      message: "Server error",
    });
  } finally {
    client.release();
  }
};


/*
  Get all rooms that the current user belongs to
*/
const getRooms = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        r.id,
        r.name,
        r.owner_id,
        r.created_at
       FROM rooms r
       INNER JOIN room_members rm
         ON r.id = rm.room_id
       WHERE rm.user_id = $1
       ORDER BY r.created_at DESC`,
      [req.user.userId]
    );

    res.status(200).json({
      rooms: result.rows,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Server error",
    });
  }
};


// Join an existing room
const joinRoom = async (req, res) => {
  try {
    const { roomId } = req.body;

    if (!roomId || roomId.trim() === "") {
      return res.status(400).json({
        message: "Room ID is required",
      });
    }

    // Check whether room exists
    const roomResult = await pool.query(
      `SELECT
        id,
        name,
        owner_id,
        created_at
       FROM rooms
       WHERE id = $1`,
      [roomId.trim()]
    );

    if (roomResult.rows.length === 0) {
      return res.status(404).json({
        message: "Room not found",
      });
    }

    const room = roomResult.rows[0];

    // Add user to room_members
    await pool.query(
      `INSERT INTO room_members
       (room_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (room_id, user_id)
       DO NOTHING`,
      [room.id, req.user.userId]
    );

    res.status(200).json({
      message: "Joined room successfully",
      room,
    });
  } catch (error) {
    console.error(error);

    // PostgreSQL invalid UUID
    if (error.code === "22P02") {
      return res.status(400).json({
        message: "Invalid room ID",
      });
    }

    res.status(500).json({
      message: "Server error",
    });
  }
};


// Get a room that the current user is a member of
const getRoom = async (req, res) => {
  try {
    const { roomId } = req.params;

    const result = await pool.query(
      `SELECT
        r.id,
        r.name,
        r.owner_id,
        r.created_at
       FROM rooms r
       INNER JOIN room_members rm
         ON r.id = rm.room_id
       WHERE r.id = $1
       AND rm.user_id = $2`,
      [roomId, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Room not found or you are not a member",
      });
    }

    res.status(200).json({
      room: result.rows[0],
    });
  } catch (error) {
    console.error(error);

    if (error.code === "22P02") {
      return res.status(400).json({
        message: "Invalid room ID",
      });
    }

    res.status(500).json({
      message: "Server error",
    });
  }
};


module.exports = {
  createRoom,
  getRooms,
  joinRoom,
  getRoom,
};