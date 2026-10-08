require("dotenv").config();

const http = require("http");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const Y = require("yjs");

const app = require("./app");
const pool = require("./config/db");


const {
  getDocument,
  initializeDocument,
  getDocumentText,
  hasDocument,
  getDocumentState,
} = require("./services/yjsService");

const PORT = process.env.PORT || 5000;

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({
  server,
});

// Store connected users by room
//
// roomKey (string) -> Set(socket)
const rooms = new Map();

// Pending debounced Yjs saves
//
// fileId (string) -> { timer, fileId }
const yjsPersistenceTimers = new Map();



/*
 * =========================================================
 * PERSIST YJS DOCUMENT
 * =========================================================
 */

const persistYjsDocument = async (
  fileId
) => {
  try {
    /*
     * Get current CRDT state.
     */
    const state =
      getDocumentState(fileId);

    /*
     * Get human-readable code.
     */
    const content =
      getDocumentText(fileId);

    /*
     * Save both representations.
     */
    const result = await pool.query(
      `UPDATE files
       SET
         content = $1,
         yjs_state = $2,
         updated_at = CURRENT_TIMESTAMP,
         revision = revision + 1
       WHERE id = $3
       RETURNING revision`,
      [
        content,
        Buffer.from(state),
        fileId,
      ]
    );

    if (result.rows.length > 0) {
      console.log(
        `Yjs document persisted: ${fileId}`
      );
    }

  } catch (error) {
    console.error(
      `Failed to persist Yjs document ${fileId}:`,
      error
    );
  }
};

/*
 * =========================================================
 * SCHEDULE YJS PERSISTENCE (debounced)
 * =========================================================
 */

const scheduleYjsPersistence = (fileId) => {
  const key = String(fileId);

  /*
   * Cancel previous timer.
   */
  const existing = yjsPersistenceTimers.get(key);

  if (existing) {
    clearTimeout(existing.timer);
  }

  /*
   * Wait until the user stops typing.
   */
  const timer = setTimeout(async () => {
    yjsPersistenceTimers.delete(key);

    await persistYjsDocument(fileId);
  }, 2000);

  yjsPersistenceTimers.set(key, { timer, fileId });
};

/*
 * =========================================================
 * PERSIST ROOM DOCUMENTS (flush pending saves)
 * =========================================================
 *
 * Saves only files with an unsaved change (a pending timer)
 * AND an active Yjs document in memory, so we never write a
 * document that isn't loaded.
 */

const persistRoomDocuments = async (roomId) => {
  try {
    const result = await pool.query(
      `SELECT id
       FROM files
       WHERE room_id = $1`,
      [roomId]
    );

    for (const file of result.rows) {
      const pending = yjsPersistenceTimers.get(String(file.id));

      if (!pending) {
        continue;
      }

      clearTimeout(pending.timer);
      yjsPersistenceTimers.delete(String(file.id));

      /*
       * Only persist documents that are currently
       * loaded into Yjs memory.
       */
      if (hasDocument(pending.fileId)) {
        await persistYjsDocument(pending.fileId);
      }
    }
  } catch (error) {
    console.error("Room persistence error:", error);
  }
};

/*
 * =========================================================
 * WEBSOCKET HEARTBEAT
 * =========================================================
 *
 * Detects clients whose connection died without properly
 * closing the WebSocket.
 *
 * Example:
 *
 * Browser crashes
 * Laptop sleeps
 * Network disappears
 * Wi-Fi changes
 *
 * In those cases the server may not immediately receive
 * a normal "close" event.
 */

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((socket) => {
    /*
     * If the client did not respond to the previous ping,
     * consider the connection dead.
     */
    if (socket.isAlive === false) {
      console.log(
        `Terminating dead socket for user ${socket.userId}`
      );

      socket.terminate();

      return;
    }

    /*
     * Assume the socket is dead until it responds with pong.
     */
    socket.isAlive = false;

    /*
     * Browsers automatically answer ping frames with pong.
     */
    socket.ping();
  });
}, 30000);

// File revision store
const {
  getRevision,
  setRevision,
  deleteRevision,
} = require("./services/revisionStore");


// --------------------------------------------------
// Helper: normalise room ids
//
// FIX: "5" and 5 used to become two different Map
// keys, so users could end up in "different" rooms.
// --------------------------------------------------

const roomKey = (roomId) => String(roomId);


// --------------------------------------------------
// Helper: Add socket to a room
// --------------------------------------------------

const joinRoom = (roomId, socket) => {
  const key = roomKey(roomId);

  if (!rooms.has(key)) {
    rooms.set(key, new Set());
  }

  rooms.get(key).add(socket);

  console.log(`Socket joined room ${key}`);
  console.log(`Users in room: ${rooms.get(key).size}`);
};


// --------------------------------------------------
// Helper: Remove socket from a room
// --------------------------------------------------

const leaveRoom = (roomId, socket) => {
  const key = roomKey(roomId);

  if (!rooms.has(key)) {
    return;
  }

  const room = rooms.get(key);

  room.delete(socket);

  // If nobody is left in the room,
  // remove the room completely.
  if (room.size === 0) {
    rooms.delete(key);
    console.log(`Room ${key} removed`);
  } else {
    console.log(`Socket left room ${key}`);
    console.log(`Users in room: ${room.size}`);
  }
};


// --------------------------------------------------
// Helper: Broadcast message to room
// --------------------------------------------------

const broadcastToRoom = (roomId, message, senderSocket) => {
  const room = rooms.get(roomKey(roomId));

  if (!room) {
    return;
  }

  room.forEach((socket) => {
    // Don't send the message back
    // to the person who sent it.
    if (
      socket !== senderSocket &&
      socket.readyState === WebSocket.OPEN
    ) {
      socket.send(message);
    }
  });
};


// =========================================================
// Presence helpers
// =========================================================

const getRoomPresence = (roomId) => {
  const room = rooms.get(roomKey(roomId));

  if (!room) {
    return [];
  }

  /*
   * Only OPEN sockets are considered online.
   * Users are de-duplicated by userId so the same
   * person with two tabs open appears only once.
   */
  const seen = new Map();

  room.forEach((socket) => {
    if (
      socket.readyState === WebSocket.OPEN &&
      !seen.has(socket.userId)
    ) {
      seen.set(socket.userId, {
        userId: socket.userId,
        username: socket.username,
      });
    }
  });

  return Array.from(seen.values());
};


// =========================================================
// PRESENCE BROADCASTER
// =========================================================

const broadcastPresence = (roomId) => {
  const room = rooms.get(roomKey(roomId));

  if (!room) {
    return;
  }

  const users = getRoomPresence(roomId);

  const message = JSON.stringify({
    type: "presence",
    roomId,
    users,
    count: users.length,
  });

  /*
   * Presence is authoritative.
   * Everyone receives the complete list.
   */
  room.forEach((socket) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(message);
    }
  });
};


// --------------------------------------------------
// Helper: Authenticate a WebSocket using JWT
// Returns true on success, false (socket closed) on failure.
// --------------------------------------------------

const authenticateSocket = async (socket, request) => {
  const url = new URL(request.url, "http://localhost");

  const token = url.searchParams.get("token");

  // No token
  if (!token) {
    console.log("WebSocket rejected: Authentication required");
    socket.close(1008, "Authentication required");
    return false;
  }

  // Verify JWT
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    socket.userId = decoded.userId;

    const userResult = await pool.query(
      `SELECT
         id,
         username
       FROM users
       WHERE id = $1`,
      [socket.userId]
    );

    if (userResult.rows.length === 0) {
      socket.close(1008, "User not found");
      return false;
    }

    socket.username = userResult.rows[0].username;

    console.log(
      `WebSocket authenticated for user ${socket.userId}`
    );

    return true;
  } catch (error) {
    console.error("WebSocket authentication failed");
    socket.close(1008, "Invalid or expired token");
    return false;
  }
};


// --------------------------------------------------
// WebSocket connection
// --------------------------------------------------

wss.on("connection", (socket, request) => {
  console.log("WebSocket client connected");

  // Store the room this socket belongs to.
  socket.roomId = null;

  // ------------------------------------------------
  // HEARTBEAT: every new socket starts alive and is
  // marked alive again each time it answers a ping.
  // ------------------------------------------------

  socket.isAlive = true;

  socket.on("pong", () => {
    socket.isAlive = true;
  });


  // ------------------------------------------------
  // FIX (main bug):
  //
  // The old code did `await pool.query(...)` for auth
  // BEFORE registering socket.on("message"). Any message
  // the client sent right after `onopen` (e.g. "join-room")
  // arrived during that await, when no listener existed,
  // and was silently dropped. The user never joined the
  // room, so presence was empty / zero.
  //
  // Now the listeners are attached immediately and every
  // message waits for authentication to finish first.
  // Promise callbacks run in order, so message order
  // is preserved.
  // ------------------------------------------------

  const authPromise = authenticateSocket(socket, request);


  // ------------------------------------------------
  // Receive message
  // ------------------------------------------------

  socket.on("message", async (message) => {
    const authenticated = await authPromise;

    if (!authenticated) {
      return;
    }

    try {
      const data = JSON.parse(message.toString());

      console.log("Received:", data);


      // --------------------------------------------
      // JOIN ROOM
      // --------------------------------------------

      if (data.type === "join-room") {
        const { roomId } = data;

        // Validate room ID
        if (!roomId) {
          socket.send(
            JSON.stringify({
              type: "room-error",
              message: "Room ID is required",
            })
          );

          return;
        }

        try {
          // ----------------------------------------
          // Check room membership
          // ----------------------------------------

          const memberResult = await pool.query(
            `SELECT 1
             FROM room_members
             WHERE room_id = $1
             AND user_id = $2`,
            [roomId, socket.userId]
          );

          // User is NOT a member
          if (memberResult.rows.length === 0) {
            console.log(
              `User ${socket.userId} attempted to join room ${roomId} without membership`
            );

            socket.send(
              JSON.stringify({
                type: "room-error",
                message: "You are not a member of this room",
              })
            );

            return;
          }

          // ----------------------------------------
          // User IS a member
          // ----------------------------------------

          /*
           * If socket was already in a DIFFERENT room,
           * remove it first.
           */
          if (
            socket.roomId &&
            roomKey(socket.roomId) !== roomKey(roomId)
          ) {
            const previousRoomId = socket.roomId;

            leaveRoom(previousRoomId, socket);

            /*
             * Clear old room reference BEFORE
             * broadcasting old-room presence.
             */
            socket.roomId = null;

            /*
             * Tell remaining users in the old room
             * that this socket has left.
             */
            broadcastPresence(previousRoomId);
          }

          // Store new room
          socket.roomId = roomId;

          // Add socket to room
          joinRoom(roomId, socket);

          // Get authoritative presence
          const currentPresence = getRoomPresence(roomId);

          // Tell client joining succeeded
          socket.send(
            JSON.stringify({
              type: "room-joined",
              roomId,
              users: currentPresence,
              count: currentPresence.length,
            })
          );

          // Broadcast updated presence
          broadcastPresence(roomId);
        } catch (error) {
          console.error("Room membership check failed:", error);

          socket.send(
            JSON.stringify({
              type: "room-error",
              message: "Unable to join room",
            })
          );
        }

        return;
      }


     // --------------------------------------------
     //chat message
      // --------------------------------------------

      if (data.type === "chat-message") {
  if (!socket.roomId) return;

  const messageText = data.message?.trim();

  if (!messageText) {
    return;
  }

  /*
   * Prevent unnecessarily huge messages.
   */
  if (messageText.length > 2000) {
    socket.send(
      JSON.stringify({
        type: "chat-error",
        message: "Message is too long",
      })
    );

    return;
  }

  try {
    /*
     * Save message to PostgreSQL.
     */
    const result = await pool.query(
      `INSERT INTO messages
       (room_id, user_id, message)
       VALUES ($1, $2, $3)
       RETURNING
         id,
         room_id,
         user_id,
         message,
         created_at`,
      [
        socket.roomId,
        socket.userId,
        messageText,
      ]
    );

    const savedMessage = result.rows[0];

    /*
     * Add username.
     */
    const chatMessage = {
      id: savedMessage.id,
      roomId: savedMessage.room_id,
      userId: savedMessage.user_id,
      username: socket.username,
      message: savedMessage.message,
      createdAt: savedMessage.created_at,
    };

    /*
     * Broadcast to everyone in the room,
     * including the sender.
     */
    const room = rooms.get(socket.roomId);

    if (!room) return;

    const payload = JSON.stringify({
      type: "chat-message",
      message: chatMessage,
    });

    room.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  } catch (error) {
    console.error(
      "Chat message error:",
      error
    );

    socket.send(
      JSON.stringify({
        type: "chat-error",
        message: "Unable to send message",
      })
    );
  }

  return;
}


       // --------------------------------------------
       // LOAD CHAT HISTORY
        // --------------------------------------------

        if (data.type === "load-chat") {
  if (!socket.roomId) return;

  try {
    const result = await pool.query(
      `SELECT
         m.id,
         m.room_id,
         m.user_id,
         m.message,
         m.created_at,
         u.username
       FROM messages m
       JOIN users u
         ON u.id = m.user_id
       WHERE m.room_id = $1
       ORDER BY m.created_at ASC
       LIMIT 100`,
      [socket.roomId]
    );

    socket.send(
      JSON.stringify({
        type: "chat-history",
        messages: result.rows.map((message) => ({
          id: message.id,
          roomId: message.room_id,
          userId: message.user_id,
          username: message.username,
          message: message.message,
          createdAt: message.created_at,
        })),
      })
    );
  } catch (error) {
    console.error(
      "Chat history error:",
      error
    );

    socket.send(
      JSON.stringify({
        type: "chat-error",
        message: "Unable to load chat history",
      })
    );
  }

  return;
}
      


      // =========================================================
// CURSOR POSITION
// =========================================================

if (data.type === "cursor-position") {
  if (!socket.roomId) {
    return;
  }

  const {
    fileId,
    lineNumber,
    column,
  } = data;

  // Validate data
  if (
    !fileId ||
    typeof lineNumber !== "number" ||
    typeof column !== "number"
  ) {
    return;
  }

  const room = rooms.get(socket.roomId);

  if (!room) {
    return;
  }

  const cursorMessage = JSON.stringify({
    type: "cursor-position",
    userId: socket.userId,
    username: socket.username,
    fileId,
    lineNumber,
    column,
  });

  // Send cursor position to everyone except sender
  room.forEach((client) => {
    if (
      client !== socket &&
      client.readyState === WebSocket.OPEN
    ) {
      client.send(cursorMessage);
    }
  });

  return;
}

// =========================================================
// YJS UPDATE
// =========================================================

if (data.type === "yjs-update") {
  if (!socket.roomId) {
    return;
  }

  const {
    fileId,
    update,
  } = data;

  if (
    !fileId ||
    !Array.isArray(update)
  ) {
    return;
  }

  try {
    /*
     * Make sure the file belongs to this room.
     */
    const result = await pool.query(
      `SELECT id
       FROM files
       WHERE id = $1
       AND room_id = $2`,
      [
        fileId,
        socket.roomId,
      ]
    );

    if (result.rows.length === 0) {
      return;
    }

    /*
     * Get the Yjs document.
     */
    const doc = getDocument(fileId);

    /*
     * Convert JSON array back to Uint8Array.
     */
    const uint8Update =
      new Uint8Array(update);

    /*
     * Apply CRDT update.
     */
    Y.applyUpdate(
      doc,
      uint8Update
    );

    /*
     * Persist after a short delay.
     */
    scheduleYjsPersistence(fileId);

    /*
     * Broadcast the update to
     * every other client in the room.
     */
    const room = rooms.get(
      socket.roomId
    );

    if (!room) {
      return;
    }

    const payload = JSON.stringify({
      type: "yjs-update",
      fileId,
      update: Array.from(
        uint8Update
      ),
    });

    room.forEach((client) => {
      if (
        client !== socket &&
        client.readyState === WebSocket.OPEN
      ) {
        client.send(payload);
      }
    });
  } catch (error) {
    console.error(
      "Yjs update error:",
      error
    );
  }

  return;
}


    // =========================================================
// YJS INITIAL SYNCHRONIZATION
// =========================================================

if (data.type === "yjs-sync-request") {
  if (!socket.roomId) {
    return;
  }

  const { fileId } = data;

  if (!fileId) {
    return;
  }

  try {
    /*
     * -----------------------------------------------------
     * Load file from PostgreSQL
     * -----------------------------------------------------
     */

    const result = await pool.query(
      `SELECT
         id,
         content,
         yjs_state
       FROM files
       WHERE id = $1
       AND room_id = $2`,
      [
        fileId,
        socket.roomId,
      ]
    );

    if (result.rows.length === 0) {
      socket.send(
        JSON.stringify({
          type: "yjs-sync-error",
          fileId,
          message: "File not found",
        })
      );

      return;
    }

    const file = result.rows[0];

    /*
     * -----------------------------------------------------
     * Initialize / restore Yjs document
     * -----------------------------------------------------
     */

    const doc = initializeDocument(
      fileId,
      file.content || "",
      file.yjs_state
    );

    /*
     * -----------------------------------------------------
     * Encode complete CRDT state
     * -----------------------------------------------------
     */

    const state =
      Y.encodeStateAsUpdate(doc);

    /*
     * -----------------------------------------------------
     * Send state to client
     * -----------------------------------------------------
     */

    socket.send(
      JSON.stringify({
        type: "yjs-sync",
        fileId,
        update: Array.from(state),
      })
    );

  } catch (error) {
    console.error(
      "Yjs synchronization error:",
      error
    );

    socket.send(
      JSON.stringify({
        type: "yjs-sync-error",
        fileId,
        message:
          "Unable to synchronize document",
      })
    );
  }

  return;
}

      // --------------------------------------------
      // CODE CHANGE
      // --------------------------------------------

      if (data.type === "code-change") {
        if (!socket.roomId) {
          return;
        }

        const { fileId, content, revision } = data;

        if (!fileId) {
          return;
        }

        if (typeof content !== "string") {
          return;
        }

        if (typeof revision !== "number") {
          return;
        }

        try {
          // ----------------------------------------
          // Check file belongs to current room
          // ----------------------------------------

          const fileResult = await pool.query(
            `SELECT
              id,
              room_id,
              revision
             FROM files
             WHERE id = $1
             AND room_id = $2`,
            [fileId, socket.roomId]
          );

          if (fileResult.rows.length === 0) {
            socket.send(
              JSON.stringify({
                type: "code-change-error",
                message: "File not found",
              })
            );

            return;
          }

          const file = fileResult.rows[0];

          /*
           * Get server's current revision.
           */
          let currentRevision = getRevision(fileId);

          /*
           * If WebSocket revision store
           * has never seen this file,
           * initialize it from PostgreSQL.
           */
          if (currentRevision === undefined) {
            currentRevision = Number(file.revision);

            setRevision(fileId, currentRevision);
          }

          /*
           * Client must be editing the
           * latest server version.
           */
          if (revision !== currentRevision) {
            socket.send(
              JSON.stringify({
                type: "stale-change",
                fileId,
                expectedRevision: currentRevision,
                receivedRevision: revision,
              })
            );

            return;
          }

          /*
           * Atomically update database.
           */
          const updateResult = await pool.query(
            `UPDATE files
             SET
               content = $1,
               revision = revision + 1,
               updated_at = CURRENT_TIMESTAMP
             WHERE id = $2
             AND room_id = $4
             AND revision = $3
             RETURNING
               id,
               room_id,
               filename,
               language,
               content,
               revision`,
            [content, fileId, currentRevision, socket.roomId]
          );

          /*
           * Update failed because someone else
           * changed the file.
           */
          if (updateResult.rows.length === 0) {
            const latestResult = await pool.query(
              `SELECT
                id,
                content,
                revision
               FROM files
               WHERE id = $1
               AND room_id = $2`,
              [fileId, socket.roomId]
            );

            if (latestResult.rows.length > 0) {
              const latestFile = latestResult.rows[0];

              const latestRevision = Number(latestFile.revision);

              setRevision(fileId, latestRevision);

              socket.send(
                JSON.stringify({
                  type: "stale-change",
                  fileId,
                  expectedRevision: latestRevision,
                  receivedRevision: revision,
                })
              );
            }

            return;
          }

          const updatedFile = updateResult.rows[0];

          const newRevision = Number(updatedFile.revision);

          /*
           * Keep WebSocket revision store
           * synchronized with PostgreSQL.
           */
          setRevision(fileId, newRevision);

          /*
           * Broadcast accepted change
           * to other clients.
           */
          const messageData = JSON.stringify({
            type: "code-change",
            fileId,
            content: updatedFile.content,
            revision: newRevision,
          });

          broadcastToRoom(socket.roomId, messageData, socket);

          /*
           * Confirm to sender.
           */
          socket.send(
            JSON.stringify({
              type: "change-accepted",
              fileId,
              revision: newRevision,
            })
          );
        } catch (error) {
          console.error("Code change error:", error);

          socket.send(
            JSON.stringify({
              type: "code-change-error",
              message: "Unable to process code change",
            })
          );
        }

        return;
      }


      // --------------------------------------------
      // FILE CHECK
      // --------------------------------------------

      if (data.type === "check-file") {
        try {
          /*
           * User must already be in a room.
           */
          if (!socket.roomId) {
            return;
          }

          const { fileId, revision } = data;

          console.log("📋 FILE CHECK REQUEST:", {
            fileId,
            clientRevision: revision,
          });

          // Validate fileId
          if (!fileId) {
            socket.send(
              JSON.stringify({
                type: "error",
                message: "fileId is required",
              })
            );

            return;
          }

          // ---------------------------------------
          // Get latest file from database
          // ---------------------------------------

          const result = await pool.query(
            `
            SELECT
              id,
              revision
            FROM files
            WHERE id = $1
            AND room_id = $2
            `,
            [fileId, socket.roomId]
          );

          // File not found
          if (result.rows.length === 0) {
            console.log("❌ FILE NOT FOUND:", fileId);

            socket.send(
              JSON.stringify({
                type: "error",
                message: "File not found",
                fileId,
              })
            );

            return;
          }

          const file = result.rows[0];

          const serverRevision = Number(file.revision);

          const clientRevision = Number(revision);

          console.log("🔍 FILE REVISION CHECK:", {
            fileId,
            clientRevision,
            serverRevision,
          });

          // ---------------------------------------
          // FILE IN SYNC
          // ---------------------------------------

          if (clientRevision === serverRevision) {
            console.log("✅ FILE IN SYNC:", {
              fileId,
              revision: serverRevision,
            });

            socket.send(
              JSON.stringify({
                type: "file-in-sync",
                fileId: file.id,
                revision: serverRevision,
              })
            );

            return;
          }

          // ---------------------------------------
          // FILE OUT OF SYNC
          // ---------------------------------------

          console.warn("⚠️ FILE OUT OF SYNC:", {
            fileId,
            clientRevision,
            serverRevision,
          });

          socket.send(
            JSON.stringify({
              type: "file-out-of-sync",
              fileId: file.id,
              clientRevision,
              serverRevision,
            })
          );
        } catch (error) {
          console.error(
            "❌ Error checking file synchronization:",
            error
          );

          socket.send(
            JSON.stringify({
              type: "error",
              message: "Failed to check file synchronization",
            })
          );
        }

        return;
      }


      // --------------------------------------------
      // REQUEST LATEST FILE STATE
      // --------------------------------------------

      if (data.type === "sync-file") {
        if (!socket.roomId) {
          return;
        }

        const { fileId } = data;

        if (!fileId) {
          return;
        }

        try {
          const result = await pool.query(
            `SELECT
              id,
              room_id,
              filename,
              language,
              content,
              revision
             FROM files
             WHERE id = $1
             AND room_id = $2`,
            [fileId, socket.roomId]
          );

          if (result.rows.length === 0) {
            socket.send(
              JSON.stringify({
                type: "sync-error",
                fileId,
                message: "File not found",
              })
            );

            return;
          }

          const file = result.rows[0];

          /*
           * PostgreSQL is the source of truth.
           */
          const serverRevision = Number(file.revision);

          setRevision(fileId, serverRevision);

          socket.send(
            JSON.stringify({
              type: "file-state",
              fileId: file.id,
              content: file.content || "",
              revision: serverRevision,
            })
          );
        } catch (error) {
          console.error("File synchronization error:", error);

          socket.send(
            JSON.stringify({
              type: "sync-error",
              fileId,
              message: "Unable to synchronize file",
            })
          );
        }

        return;
      }


      // --------------------------------------------
      // ROOM MESSAGE
      // --------------------------------------------

      if (data.type === "room-message") {
        // User must already be inside a room
        if (!socket.roomId) {
          return;
        }

        const messageData = JSON.stringify({
          type: "room-message",
          message: data.message,
        });

        broadcastToRoom(socket.roomId, messageData, socket);

        return;
      }
    } catch (error) {
      console.error("Invalid WebSocket message:", error);
    }
  });


  // ------------------------------------------------
  // Client disconnects
  // ------------------------------------------------

  socket.on("close", () => {
    console.log("WebSocket client disconnected");

    const roomId = socket.roomId;

    if (roomId) {
      /*
       * Flush any unsaved Yjs changes for this room.
       * Not awaited so the close handler stays synchronous.
       */
      persistRoomDocuments(roomId);

      /*
       * IMPORTANT:
       *
       * Remove the socket FIRST.
       *
       * Otherwise getRoomPresence()
       * would still see the disconnected
       * user.
       */
      leaveRoom(roomId, socket);

      // Clear the socket's room reference.
      socket.roomId = null;

      // Tell all remaining users about the updated presence.
      broadcastPresence(roomId);
    }
  });


  // ------------------------------------------------
  // WebSocket error
  // ------------------------------------------------

  socket.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});


// --------------------------------------------------
// Graceful shutdown: stop the heartbeat timer so it
// does not keep the Node process alive.
// --------------------------------------------------

process.on("SIGTERM", () => {
  clearInterval(heartbeatInterval);

  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  clearInterval(heartbeatInterval);

  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});


// --------------------------------------------------
// Start Server
// --------------------------------------------------

const startServer = async () => {
  try {
    await pool.query("SELECT NOW()");

    console.log("PostgreSQL connected");

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);

      console.log(
        `WebSocket server running on ws://localhost:${PORT}`
      );
    });
  } catch (error) {
    console.error("Database connection failed:", error);
  }
};


startServer();