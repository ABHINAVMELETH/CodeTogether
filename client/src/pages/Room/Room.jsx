import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Editor from "@monaco-editor/react";
import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";
import "./Room.css";
import VersionHistory from "../../components/VersionHistory";

function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();

  // =========================================================
  // WEBSOCKET REFS
  // =========================================================

  const socketRef = useRef(null);

  // Yjs document, shared text and observer
  const yDocRef = useRef(null);
  const yTextRef = useRef(null);
  const yObserverRef = useRef(null);
  const yBindingRef = useRef(null);

  // Prevent Monaco from treating remote changes as local edits
  const isRemoteChange = useRef(false);

  // Stores the current connection ID for this session
  const connectionIdRef = useRef(0);

  // Stores reconnect timeout
  const reconnectTimeoutRef = useRef(null);

  // Stores currently selected file
  const selectedFileRef = useRef(null);

  // Number of reconnect attempts
  const reconnectAttemptRef = useRef(0);

  // Whether current editor content has unsaved changes
  const isDirtyRef = useRef(false);

  // Whether this WebSocket effect should reconnect
  const shouldReconnectRef = useRef(true);

  // Whether this socket has successfully joined the current room
  const roomJoinedRef = useRef(false);

  // Room for which the current presence list is valid
  const presenceRoomRef = useRef(null);

  // Bottom of the chat list (kept from the previous auto-scroll)
  const chatEndRef = useRef(null);

  // Chat messages container (used for auto-scroll)
  const chatMessagesRef = useRef(null);

  // Monaco editor instance
  const editorRef = useRef(null);

  // IDs of remote cursor decorations currently shown in Monaco
  const remoteCursorDecorationsRef = useRef([]);

  // Cursor message throttling
  const cursorThrottleRef = useRef(null);
  const pendingCursorRef = useRef(null);

  // =========================================================
  // STATE
  // =========================================================

  const [onlineUsers, setOnlineUsers] = useState([]);

  const [files, setFiles] = useState([]);

  const [selectedFile, setSelectedFile] = useState(null);

  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const [connectionStatus, setConnectionStatus] = useState(
    navigator.onLine ? "Connecting" : "Offline"
  );

  const [code, setCode] = useState("");

  // Create file
  const [showCreateFile, setShowCreateFile] = useState(false);

  const [filename, setFilename] = useState("");

  const [language, setLanguage] = useState("javascript");

  const [creatingFile, setCreatingFile] = useState(false);

  const [error, setError] = useState("");

  const [message, setMessage] = useState("");

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  // Save status
  const [saveStatus, setSaveStatus] = useState("Saved");

  // Chat
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");

  // Remote cursors, keyed by userId
  const [remoteCursors, setRemoteCursors] = useState({});

  // =========================================================
  // CURRENT USER ID (decoded from JWT, only used to style
  // your own chat messages — the server stays authoritative)
  // =========================================================

  const getCurrentUserId = () => {
    try {
      const token = localStorage.getItem("token");

      if (!token) return null;

      const payload = JSON.parse(
        atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
      );

      return payload.userId ?? null;
    } catch (decodeError) {
      return null;
    }
  };

  const currentUserId = getCurrentUserId();

  // =========================================================
  // INITIALIZE YJS DOCUMENT
  // =========================================================

  const initializeYjsDocument = (
    fileId
  ) => {
    /*
     * Destroy previous document.
     */
    if (yDocRef.current) {
      yDocRef.current.destroy();
    }

    /*
     * Create new Yjs document.
     */
    const doc = new Y.Doc();

    /*
     * Get collaborative text.
     */
    const text = doc.getText("content");

    yDocRef.current = doc;
    yTextRef.current = text;

    /*
     * Request initial state from server.
     */
    const socket = socketRef.current;

    if (
      socket &&
      socket.readyState === WebSocket.OPEN
    ) {
      socket.send(
        JSON.stringify({
          type: "yjs-sync-request",
          fileId,
        })
      );
    }
  };

  // =========================================================
  // SETUP YJS DOCUMENT (with update sender)
  // =========================================================

  const setupYjsDocument = (fileId) => {
    /*
     * -------------------------------------------------------
     * Clean up previous Yjs document
     * -------------------------------------------------------
     */

    if (yBindingRef.current) {
      yBindingRef.current.destroy();
      yBindingRef.current = null;
    }

    if (yDocRef.current) {
      yDocRef.current.destroy();
      yDocRef.current = null;
    }

    /*
     * -------------------------------------------------------
     * Create new Yjs document
     * -------------------------------------------------------
     */

    const doc = new Y.Doc();

    const text = doc.getText("content");

    yDocRef.current = doc;
    yTextRef.current = text;

    /*
     * -------------------------------------------------------
     * Send local Yjs updates to server
     * -------------------------------------------------------
     */

    const updateHandler = (
      update,
      origin
    ) => {
      const socket = socketRef.current;

      /*
       * Ignore updates that came from the server.
       *
       * Otherwise:
       *
       * Server update
       *     ↓
       * Client
       *     ↓
       * send back
       *     ↓
       * Server
       *     ↓
       * broadcast
       *
       * This would create a loop.
       */
      if (origin === "remote") {
        return;
      }

      if (
        !socket ||
        socket.readyState !== WebSocket.OPEN
      ) {
        return;
      }

      socket.send(
        JSON.stringify({
          type: "yjs-update",
          fileId,
          update: Array.from(update),
        })
      );
    };

    doc.on(
      "update",
      updateHandler
    );

    return doc;
  };

  // =========================================================
  // GET ALL FILES
  // =========================================================

  useEffect(() => {
    const getFiles = async () => {
      const token = localStorage.getItem("token");

      try {
        const response = await fetch(
          `http://localhost:5000/api/rooms/${roomId}/files`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const data = await response.json();

        if (!response.ok) {
          setError(data.message || "Unable to load files");

          return;
        }

        setFiles(data.files);

        // Automatically select first file
        if (data.files.length > 0) {
          const firstFile = data.files[0];

          setSelectedFile(firstFile);

          selectedFileRef.current = firstFile;

          setCode(firstFile.content || "");

          setSaveStatus("Saved");

          isDirtyRef.current = false;
        }
      } catch (error) {
        console.error(error);

        setError("Unable to load files");
      } finally {
        setLoading(false);
      }
    };

    getFiles();
  }, [roomId]);

  // =========================================================
  // KEEP SELECTED FILE REF IN SYNC
  // =========================================================

  useEffect(() => {
    selectedFileRef.current = selectedFile;
  }, [selectedFile]);

  // =========================================================
  // AUTO-SCROLL CHAT TO NEWEST MESSAGE
  //
  // New message
  //     |
  // messages state
  //     |
  // useEffect
  //     |
  // scroll to bottom
  // =========================================================

  useEffect(() => {
    const container = chatMessagesRef.current;

    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [messages]);

  // =========================================================
  // RECONNECT DELAY
  // =========================================================

  const getReconnectDelay = () => {
    const attempt = reconnectAttemptRef.current;

    const delay = Math.min(1000 * Math.pow(2, attempt), 10000);

    return delay;
  };

  // =========================================================
  // ONLINE / OFFLINE DETECTION
  // =========================================================

  useEffect(() => {
    const handleOnline = () => {
      console.log("🟢 Browser is online");

      setIsOnline(true);
    };

    const handleOffline = () => {
      console.log("🔴 Browser is offline");

      setIsOnline(false);

      /*
       * IMPORTANT:
       *
       * Presence belongs to the WebSocket connection.
       *
       * When the browser goes offline, immediately remove
       * the local presence list so the UI does not continue
       * displaying stale users.
       */
      setOnlineUsers([]);

      setConnectionStatus("Offline");

      /*
       * Cancel any pending reconnect timer.
       */
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);

        reconnectTimeoutRef.current = null;
      }
    };

    window.addEventListener("online", handleOnline);

    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);

      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // =========================================================
  // WEBSOCKET CONNECTION
  // =========================================================

  useEffect(() => {
    /*
     * Each execution of this effect has its own
     * lifecycle.
     */
    let isEffectActive = true;

    reconnectAttemptRef.current = 0;

    shouldReconnectRef.current = true;

    /*
     * Entering a different room: drop the previous
     * room's chat so messages never leak across rooms.
     */
    setMessages([]);

    console.log("🔥 WebSocket useEffect STARTED");

    // =======================================================
    // DISCARD CURRENT SOCKET
    //
    // After the network drops, the browser keeps reporting
    // the old socket as OPEN for a long time even though it
    // is dead. If it stays in socketRef, coming back online
    // sees an "OPEN" socket, skips reconnecting, and the user
    // never receives a new presence list.
    //
    // So when the browser goes offline (or comes back online)
    // the old socket is thrown away completely. The server
    // removes the user from presence through its heartbeat.
    // =======================================================

    const discardCurrentSocket = () => {
      const currentSocket = socketRef.current;

      socketRef.current = null;

      /*
       * Invalidate callbacks of the old socket.
       */
      connectionIdRef.current += 1;

      roomJoinedRef.current = false;
      presenceRoomRef.current = null;

      if (currentSocket) {
        currentSocket.onopen = null;

        currentSocket.onmessage = null;

        currentSocket.onerror = null;

        currentSocket.onclose = null;

        try {
          currentSocket.close();
        } catch (closeError) {
          // ignore
        }
      }

      setOnlineUsers([]);
    };

    // =======================================================
    // CONNECT WEBSOCKET
    // =======================================================

    const connectWebSocket = () => {
      /*
       * Never connect when this effect is no longer active.
       */
      if (!isEffectActive) {
        console.log("🛑 WebSocket effect inactive. Not connecting.");

        return;
      }

      /*
       * Browser is offline.
       */
      if (!navigator.onLine) {
        console.log("📴 Browser is offline. Waiting for network...");

        setIsOnline(false);

        setOnlineUsers([]);

        setConnectionStatus("Offline");

        return;
      }

      setIsOnline(true);

      const token = localStorage.getItem("token");

      if (!token) {
        console.error("No authentication token found");

        setConnectionStatus("Disconnected");

        return;
      }

      /*
       * Prevent duplicate sockets.
       */
      if (
        socketRef.current &&
        (socketRef.current.readyState === WebSocket.OPEN ||
          socketRef.current.readyState === WebSocket.CONNECTING)
      ) {
        console.log("⚠️ WebSocket already OPEN or CONNECTING");

        return;
      }

      /*
       * New connection ID.
       */
      const connectionId = ++connectionIdRef.current;

      console.log(`🔌 Creating WebSocket connection #${connectionId}`);

      setConnectionStatus("Connecting");


      const pageParams = new URLSearchParams(window.location.search);

      const wsPort = pageParams.get("wsPort") || "5000";

      const socket = new WebSocket(`ws://localhost:${wsPort}?token=${encodeURIComponent(token)}`);
      /*
      const socket = new WebSocket(
        `ws://localhost:5000?token=${encodeURIComponent(token)}`
      );
      */

      socketRef.current = socket;

      // =====================================================
      // SOCKET OPEN
      // =====================================================

      socket.onopen = () => {
        /*
         * Ignore stale sockets.
         */
        if (connectionId !== connectionIdRef.current) {
          console.log("Ignoring old socket open event");

          socket.close();

          return;
        }

        if (!isEffectActive) {
          socket.close();

          return;
        }

        console.log(`🟢 WebSocket #${connectionId} connected`);

        /*
         * Reset exponential reconnect counter.
         */
        reconnectAttemptRef.current = 0;

        setIsOnline(true);

        setConnectionStatus("Connected");

        /*
         * IMPORTANT:
         *
         * Do NOT manually add the current user to
         * onlineUsers here.
         *
         * The server is responsible for sending the
         * authoritative presence list after join-room.
         */

        // ===================================================
        // JOIN ROOM
        // ===================================================

        socket.send(
          JSON.stringify({
            type: "join-room",
            roomId,
          })
        );
      };

      // =====================================================
      // SOCKET MESSAGE
      // =====================================================

      socket.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);

          console.log("WebSocket message:", data);

          // =================================================
          // YJS SYNC (initial load + reconnect)
          // =================================================

          if (data.type === "yjs-sync") {
            const { fileId, update } = data;

            const currentFile =
              selectedFileRef.current;

            if (
              !currentFile ||
              currentFile.id !== fileId
            ) {
              return;
            }

            if (!yDocRef.current) {
              return;
            }

            try {
              /*
               * Merge server state into the local Yjs document.
               *
               * Yjs does NOT simply overwrite local content.
               * It merges CRDT updates.
               */
              Y.applyUpdate(
                yDocRef.current,
                new Uint8Array(update),
                "remote"
              );

              /*
               * Send our local state back to the server.
               *
               * This is important after reconnect.
               *
               * If we had edits that were created while
               * disconnected, the server may not have them.
               */
              const syncSocket = socketRef.current;

              if (
                syncSocket &&
                syncSocket.readyState === WebSocket.OPEN
              ) {
                const localState =
                  Y.encodeStateAsUpdate(
                    yDocRef.current
                  );

                syncSocket.send(
                  JSON.stringify({
                    type: "yjs-update",
                    fileId,
                    update: Array.from(localState),
                  })
                );
              }

              const currentText =
                yTextRef.current?.toString() || "";

              setCode(currentText);

              isDirtyRef.current = false;
              setSaveStatus("Saved");
            } catch (error) {
              console.error(
                "Failed to apply Yjs sync:",
                error
              );
            }

            return;
          }

          // =================================================
          // YJS REMOTE UPDATE
          // =================================================

          if (data.type === "yjs-update") {
            const {
              fileId,
              update,
            } = data;

            const currentFile =
              selectedFileRef.current;

            if (
              !currentFile ||
              currentFile.id !== fileId
            ) {
              return;
            }

            if (!yDocRef.current) {
              return;
            }

            try {
              Y.applyUpdate(
                yDocRef.current,
                new Uint8Array(update),
                "remote"
              );
            } catch (error) {
              console.error(
                "Failed to apply remote Yjs update:",
                error
              );
            }

            return;
          }

          // =================================================
          // YJS SYNC ERROR
          // =================================================

          if (data.type === "yjs-sync-error") {
            console.error("Yjs sync error:", data.message);

            setError(data.message || "Unable to synchronize file");

            return;
          }

          // =================================================
          // ROOM PRESENCE UPDATE
          // =================================================

          if (data.type === "presence") {
            console.log("👥 Room presence received:", data);

            /*
             * Presence is authoritative server state.
             *
             * Ignore a late presence packet from an old
             * room/socket so it cannot pollute the current UI.
             */
            if (data.roomId && data.roomId !== roomId) {
              console.log("Ignoring presence for another room:", data.roomId);
              return;
            }

            if (!roomJoinedRef.current) {
              console.log("Ignoring presence before room join completed");
              return;
            }

            const users = Array.isArray(data.users) ? data.users : [];

            /*
             * Remove duplicate user IDs defensively.
             * The server remains the source of truth.
             */
            const uniqueUsers = Array.from(
              new Map(
                users
                  .filter(
                    (user) =>
                      user && user.userId !== undefined && user.userId !== null
                  )
                  .map((user) => [String(user.userId), user])
              ).values()
            );

            presenceRoomRef.current = roomId;
            setOnlineUsers(uniqueUsers);

            // Remove cursors of users who are no longer online
            const onlineUserIds = new Set(
              uniqueUsers.map((user) => String(user.userId))
            );

            setRemoteCursors((previous) => {
              const next = {};

              Object.values(previous).forEach((cursor) => {
                if (onlineUserIds.has(String(cursor.userId))) {
                  next[cursor.userId] = cursor;
                }
              });

              return next;
            });

            return;
          }

          // =================================================
          // ROOM JOINED
          // =================================================

          if (data.type === "room-joined") {
            console.log("Successfully joined room:", data.roomId);

            /*
             * The WebSocket connection is now fully
             * authenticated and joined to the room.
             */
            roomJoinedRef.current = true;
            presenceRoomRef.current = data.roomId || roomId;

            /*
             * Some server versions include the initial presence
             * list inside room-joined. Accept it when available.
             */
            if (Array.isArray(data.users)) {
              const uniqueUsers = Array.from(
                new Map(
                  data.users
                    .filter(
                      (user) =>
                        user &&
                        user.userId !== undefined &&
                        user.userId !== null
                    )
                    .map((user) => [String(user.userId), user])
                ).values()
              );

              setOnlineUsers(uniqueUsers);
            }

            setIsOnline(true);

            setConnectionStatus("Connected");

            const currentFile = selectedFileRef.current;

            const currentSocket = socketRef.current;

            /*
             * YJS RECONNECT SYNC
             *
             * WebSocket reconnect
             *        ↓
             * room-joined
             *        ↓
             * yjs-sync-request
             *        ↓
             * server sends Yjs state
             *        ↓
             * local Y.Doc merges state
             */
            if (
              currentFile &&
              currentSocket &&
              currentSocket.readyState === WebSocket.OPEN
            ) {
              currentSocket.send(
                JSON.stringify({
                  type: "yjs-sync-request",
                  fileId: currentFile.id,
                })
              );
            }

            /*
             * LOAD CHAT
             *
             * room-joined
             *      |
             *      +-- synchronize editor (above)
             *      |
             *      +-- load chat (below)
             *
             * This is independent of the editor state, and runs
             * on every (re)join so history is refreshed after
             * a reconnect.
             */
            if (
              currentSocket &&
              currentSocket.readyState === WebSocket.OPEN
            ) {
              currentSocket.send(
                JSON.stringify({
                  type: "load-chat",
                })
              );
            }

            return;
          }

          // =================================================
          // CHAT HISTORY
          // =================================================

          if (data.type === "chat-history") {
            setMessages(data.messages || []);
            return;
          }

          // =================================================
          // CHAT MESSAGE
          // =================================================

          if (data.type === "chat-message") {
            /*
             * Ignore duplicates (e.g. a live message that
             * also arrives inside a history reload).
             */
            setMessages((previous) => {
              if (previous.some((item) => item.id === data.message.id)) {
                return previous;
              }

              return [...previous, data.message];
            });

            return;
          }

          // =================================================
          // CHAT ERROR
          // =================================================

          if (data.type === "chat-error") {
            console.error("Chat error:", data.message);

            setError(data.message || "Chat error");

            return;
          }

          // =================================================
          // REMOTE CURSOR POSITION
          // =================================================

          if (data.type === "cursor-position") {
            if (data.userId === undefined || data.userId === null) {
              return;
            }

            setRemoteCursors((previous) => ({
              ...previous,
              [data.userId]: data,
            }));

            return;
          }

          // =================================================
          // ROOM ERROR
          // =================================================

          if (data.type === "room-error") {
            console.error("Room error:", data.message);

            setError(data.message);

            return;
          }

          // =================================================
          // SYNC ERROR
          // =================================================

          if (data.type === "sync-error") {
            setError(data.message || "Unable to synchronize file");

            return;
          }
        } catch (error) {
          console.error("Invalid WebSocket message:", error);
        }
      };

      // =====================================================
      // SOCKET ERROR
      // =====================================================

      socket.onerror = (error) => {
        console.error(`WebSocket #${connectionId} error:`, error);

        if (connectionId === connectionIdRef.current) {
          /*
           * Do not mark presence as online
           * when the socket is unhealthy.
           */
          setOnlineUsers([]);

          setConnectionStatus(navigator.onLine ? "Reconnecting" : "Offline");
        }
      };

      // =====================================================
      // SOCKET CLOSE
      // =====================================================

      socket.onclose = () => {
        console.log(`🔴 WebSocket #${connectionId} disconnected`);

        /*
         * Ignore close events from old sockets.
         */
        if (connectionId !== connectionIdRef.current) {
          console.log(`Ignoring old socket #${connectionId}`);

          return;
        }

        /*
         * This socket is no longer a member of the live
         * WebSocket session from the client's perspective.
         */
        roomJoinedRef.current = false;
        presenceRoomRef.current = null;

        /*
         * Clear the active socket.
         */
        if (socketRef.current === socket) {
          socketRef.current = null;
        }

        /*
         * IMPORTANT PRESENCE FIX:
         *
         * This socket is no longer connected,
         * therefore the client must not display
         * stale presence information.
         */
        setOnlineUsers([]);

        // Remote cursors are stale too
        setRemoteCursors({});

        /*
         * Effect already cleaned up.
         */
        if (!isEffectActive) {
          console.log("🛑 Reconnect cancelled because effect is inactive");

          return;
        }

        /*
         * Intentional disconnect.
         */
        if (!shouldReconnectRef.current) {
          console.log(
            "🛑 Reconnect cancelled because shouldReconnect is false"
          );

          setConnectionStatus("Disconnected");

          return;
        }

        /*
         * Browser is offline.
         */
        if (!navigator.onLine) {
          console.log("📴 Browser is offline. Waiting for network...");

          setIsOnline(false);

          setOnlineUsers([]);

          setConnectionStatus("Offline");

          return;
        }

        /*
         * Browser is online but WebSocket
         * disconnected.
         */
        setIsOnline(true);

        setConnectionStatus("Reconnecting");

        const delay = getReconnectDelay();

        reconnectAttemptRef.current += 1;

        console.log(`🔄 Reconnecting in ${delay}ms...`);

        /*
         * Prevent duplicate timers.
         */
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }

        reconnectTimeoutRef.current = setTimeout(() => {
          /*
           * Effect may have been cleaned up.
           */
          if (!isEffectActive) {
            console.log("🛑 Reconnect timer cancelled because effect is inactive");

            reconnectTimeoutRef.current = null;

            return;
          }

          /*
           * Reconnection may have been disabled.
           */
          if (!shouldReconnectRef.current) {
            console.log(
              "🛑 Reconnect timer cancelled because shouldReconnect is false"
            );

            reconnectTimeoutRef.current = null;

            return;
          }

          /*
           * Browser went offline while waiting.
           */
          if (!navigator.onLine) {
            console.log("📴 Reconnect cancelled because browser is offline");

            reconnectTimeoutRef.current = null;

            setIsOnline(false);

            setOnlineUsers([]);

            setConnectionStatus("Offline");

            return;
          }

          reconnectTimeoutRef.current = null;

          console.log("🔄 Starting WebSocket reconnect...");

          connectWebSocket();
        }, delay);
      };
    };

    // =======================================================
    // BROWSER OFFLINE HANDLER
    // =======================================================

    const handleBrowserOffline = () => {
      console.log("🔴 Browser went offline. Discarding socket.");

      /*
       * Cancel pending reconnect timer.
       */
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);

        reconnectTimeoutRef.current = null;
      }

      /*
       * The old socket cannot be trusted any more.
       */
      discardCurrentSocket();

      setIsOnline(false);

      setConnectionStatus("Offline");
    };

    // =======================================================
    // BROWSER ONLINE HANDLER
    // =======================================================

    const handleBrowserOnline = () => {
      console.log("🟢 Browser came back online");

      setIsOnline(true);

      /*
       * Presence from the previous socket must not
       * be trusted.
       */
      setOnlineUsers([]);

      /*
       * Restart reconnect delay from the beginning.
       */
      reconnectAttemptRef.current = 0;

      /*
       * Cancel old reconnect timer.
       */
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);

        reconnectTimeoutRef.current = null;
      }

      if (!shouldReconnectRef.current || !isEffectActive) {
        return;
      }

      const currentSocket = socketRef.current;

      /*
       * If another connection is currently
       * establishing, let it finish.
       */
      if (currentSocket && currentSocket.readyState === WebSocket.CONNECTING) {
        console.log("WebSocket is already CONNECTING.");

        setConnectionStatus("Connecting");

        return;
      }

      /*
       * An "OPEN" socket that lived through a network
       * change may be dead. Replace it with a fresh,
       * authenticated socket so presence is rebuilt
       * from the server.
       */
      discardCurrentSocket();

      setConnectionStatus("Reconnecting");

      connectWebSocket();
    };

    window.addEventListener("offline", handleBrowserOffline);

    window.addEventListener("online", handleBrowserOnline);

    // =======================================================
    // INITIAL CONNECTION
    // =======================================================

    connectWebSocket();

    // =======================================================
    // CLEANUP
    // =======================================================

    return () => {
      /*
       * Mark this effect inactive FIRST.
       */
      isEffectActive = false;

      /*
       * Stop reconnect attempts.
       */
      shouldReconnectRef.current = false;

      /*
       * Remove listeners.
       */
      window.removeEventListener("offline", handleBrowserOffline);

      window.removeEventListener("online", handleBrowserOnline);

      /*
       * Cancel reconnect timer.
       */
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);

        reconnectTimeoutRef.current = null;
      }

      /*
       * The socket is no longer allowed to contribute presence.
       */
      roomJoinedRef.current = false;
      presenceRoomRef.current = null;

      /*
       * Clear presence.
       */
      setOnlineUsers([]);

      /*
       * Close current socket.
       */
      const currentSocket = socketRef.current;

      if (currentSocket) {
        socketRef.current = null;

        /*
         * Remove handlers before closing.
         */
        currentSocket.onopen = null;

        currentSocket.onmessage = null;

        currentSocket.onerror = null;

        currentSocket.onclose = null;

        currentSocket.close();
      }

      setConnectionStatus("Disconnected");

      console.log("🧹 WebSocket CLEANUP");
    };
  }, [roomId]);

  // =========================================================
  // CLEAN UP YJS ON LEAVING THE ROOM
  // =========================================================

  useEffect(() => {
    return () => {
      if (yBindingRef.current) {
        yBindingRef.current.destroy();
        yBindingRef.current = null;
      }

      if (yDocRef.current) {
        yDocRef.current.destroy();
        yDocRef.current = null;
      }
    };
  }, []);

  // =========================================================
  // CREATE A NEW FILE
  // =========================================================

  const handleCreateFile = async (event) => {
    event.preventDefault();

    setError("");
    setMessage("");

    if (!filename.trim()) {
      setError("Filename is required");

      return;
    }

    const token = localStorage.getItem("token");

    setCreatingFile(true);

    try {
      const response = await fetch(
        `http://localhost:5000/api/rooms/${roomId}/files`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",

            Authorization: `Bearer ${token}`,
          },

          body: JSON.stringify({
            filename: filename.trim(),

            language: language,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Unable to create file");

        return;
      }

      // Add new file to local file list
      setFiles((previousFiles) => [...previousFiles, data.file]);

      // Open newly created file
      setSelectedFile(data.file);

      selectedFileRef.current = data.file;

      setCode(data.file.content || "");

      setSaveStatus("Saved");

      isDirtyRef.current = false;

      setMessage("File created successfully");

      // Clear form
      setFilename("");

      setLanguage("javascript");

      // Close popup
      setShowCreateFile(false);
    } catch (error) {
      console.error(error);

      setError("Unable to create file");
    } finally {
      setCreatingFile(false);
    }
  };

  // =========================================================
  // SELECT A FILE
  // =========================================================

  const handleFileSelect = async (file) => {
    const token = localStorage.getItem("token");

    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `http://localhost:5000/api/rooms/${roomId}/files/${file.id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Unable to open file");

        return;
      }

      const loadedFile = data.file;

      setSelectedFile(loadedFile);

      selectedFileRef.current = loadedFile;

      setCode(loadedFile.content || "");

      setSaveStatus("Saved");

      isDirtyRef.current = false;

      /*
       * NOTE: setupYjsDocument() is intentionally NOT called here.
       *
       * The Yjs document and the MonacoBinding are created together
       * in the Editor's onMount. Calling setupYjsDocument() here
       * destroyed the existing binding and doc, and because the
       * Editor's key (selectedFile.id) does not change when the same
       * file is clicked again, onMount never ran to rebuild them.
       * The editor was left disconnected from Yjs, so typing was never
       * sent and remote updates never appeared on screen.
       *
       * When a DIFFERENT file is selected, the key changes, the Editor
       * remounts and onMount sets up a fresh doc + binding.
       */
    } catch (error) {
      console.error(error);

      setError("Unable to open file");
    }
  };

  // =========================================================
  // SAVE CURRENT FILE
  // =========================================================

  const handleSave = async () => {
    if (!selectedFile) {
      return;
    }

    /*
     * Don't start another save while
     * one is already running.
     */
    if (saving) {
      return;
    }

    setError("");
    setMessage("");

    setSaving(true);

    setSaveStatus("Saving...");

    const token = localStorage.getItem("token");

    try {
      const response = await fetch(
        `http://localhost:5000/api/rooms/${roomId}/files/${selectedFile.id}`,
        {
          method: "PUT",

          headers: {
            "Content-Type": "application/json",

            Authorization: `Bearer ${token}`,
          },

          body: JSON.stringify({
            content: code,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Unable to save file");

        setSaveStatus("Save failed");

        return;
      }

      // =====================================================
      // UPDATE LOCAL FILE LIST
      // =====================================================

      setFiles((previousFiles) =>
        previousFiles.map((file) =>
          file.id === selectedFile.id ? data.file : file
        )
      );

      const loadedFile = data.file;

      // Update selected file ref
      selectedFileRef.current = loadedFile;

      // Update selected file
      setSelectedFile(loadedFile);

      setMessage("File saved successfully");

      setSaveStatus("Saved");

      isDirtyRef.current = false;

      /*
       * Other clients no longer need a "sync-file" message:
       * Yjs already delivers every edit to them.
       */
    } catch (error) {
      console.error(error);

      setError("Unable to save file");

      setSaveStatus("Save failed");
    } finally {
      setSaving(false);
    }
  };

  // =========================================================
  // SEND CHAT MESSAGE
  // =========================================================

  const handleSendMessage = () => {
    const message = chatInput.trim();

    if (!message) {
      return;
    }

    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("You are currently disconnected.");

      return;
    }

    socket.send(
      JSON.stringify({
        type: "chat-message",
        message,
      })
    );

    setChatInput("");
  };

  // =========================================================
  // DEBOUNCED AUTOSAVE (DISABLED FOR PHASE 5C)
  //
  // Yjs now owns the document content and the server
  // persists it (2 second debounce, content + yjs_state).
  //
  // This REST autosave would send the React `code` state,
  // which can lag behind the CRDT, and overwrite newer
  // content in PostgreSQL.
  //
  // Manual saves (Save button / Ctrl+S) still use
  // PUT /api/rooms/:roomId/files/:fileId.
  // =========================================================

  /*
  useEffect(() => {
    if (!selectedFile) {
      return;
    }

    if (saveStatus !== "Unsaved") {
      return;
    }

    const timer = setTimeout(() => {
      handleSave();
    }, 1500);

    return () => {
      clearTimeout(timer);
    };
  }, [code, selectedFile, saveStatus]);
  */

  // =========================================================
  // CTRL + S / CMD + S
  // =========================================================

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();

        handleSave();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedFile, code, saving]);

  // =========================================================
  // RENDER REMOTE CURSORS (MONACO DECORATIONS)
  //
  // User A -> file1 -> cursor visible
  // User B -> file2 -> cursor hidden
  //
  // User A switches to file2
  //      |
  // file1 cursor removed
  //      |
  // file2 cursor displayed
  // =========================================================

  useEffect(() => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    const currentFileId = selectedFileRef.current?.id;

    /*
     * Only display cursors belonging to
     * the currently selected file.
     */
    const visibleCursors = Object.values(remoteCursors).filter(
      (cursor) => cursor.fileId === currentFileId
    );

    const decorations = visibleCursors.map((cursor) => {
      const colorIndex = (Math.abs(Number(cursor.userId)) || 0) % 8;

      return {
        range: {
          startLineNumber: cursor.lineNumber,
          startColumn: cursor.column,
          endLineNumber: cursor.lineNumber,
          endColumn: cursor.column,
        },

        options: {
          beforeContentClassName: `remote-cursor remote-cursor-color-${colorIndex}`,

          after: {
            content: cursor.username || "User",
            inlineClassName: `remote-cursor-label remote-cursor-color-${colorIndex}`,
          },

          hoverMessage: {
            value: `**${cursor.username || "User"}**`,
          },
        },
      };
    });

    /*
     * Get all currently active decoration IDs.
     */
    const oldDecorations = Object.values(remoteCursorDecorationsRef.current);

    /*
     * Replace old decorations.
     */
    const newDecorations = editor.deltaDecorations(
      oldDecorations,
      decorations
    );

    /*
     * Store the new decoration IDs by user.
     */
    const newDecorationMap = {};

    visibleCursors.forEach((cursor, index) => {
      newDecorationMap[cursor.userId] = newDecorations[index];
    });

    remoteCursorDecorationsRef.current = newDecorationMap;
  }, [remoteCursors, selectedFile, code]);

  // =========================================================
  // CLEAR CURSOR THROTTLE TIMER ON UNMOUNT
  // =========================================================

  useEffect(() => {
    return () => {
      if (cursorThrottleRef.current) {
        clearTimeout(cursorThrottleRef.current);

        cursorThrottleRef.current = null;
      }
    };
  }, []);

  // =========================================================
  // LOADING
  // =========================================================

  if (loading) {
    return (
      <div className="room-loading">
        <div className="loading-spinner"></div>

        <h2>Loading room...</h2>
      </div>
    );
  }

  // =========================================================
  // UI
  // =========================================================

  return (
    <div className="coding-room">
      {/* =====================================================
          TOP HEADER
      ===================================================== */}

      <header className="coding-header">
        <div className="coding-header-left">
          <button
            className="back-button"
            onClick={() => navigate("/dashboard")}
          >
            ←
          </button>

          <div className="brand-section">
            <h1>CodeTogether</h1>

            <span className="room-label">Room</span>
          </div>

          <div className="header-divider"></div>

          <div className="room-id-display">
            <span>Room ID:</span>

            <strong>{roomId}</strong>
          </div>
        </div>

        <div className="connection-status">
          <span className="status-dot"></span>

          <span>{connectionStatus}</span>
        </div>
      </header>

      {/* =====================================================
          MAIN WORKSPACE
      ===================================================== */}

      <main className="workspace">
        {/* ===================================================
            FILE EXPLORER + PRESENCE
        =================================================== */}

        <aside className="file-explorer">
          {/* =================================================
              EXPLORER HEADER
          ================================================= */}

          <div className="explorer-header">
            <div>
              <h2>Explorer</h2>

              <p>Files</p>
            </div>

            <div className="explorer-actions">
              <span className="file-count">{files.length}</span>

              <button
                className="new-file-button"
                onClick={() => {
                  setShowCreateFile(true);

                  setError("");

                  setMessage("");
                }}
                title="Create new file"
              >
                +
              </button>
            </div>
          </div>

          {/* =================================================
              FILE LIST
          ================================================= */}

          <div className="file-list">
            {files.length === 0 ? (
              <div className="no-files">
                <div className="no-files-icon">+</div>

                <p>No files</p>

                <button
                  className="empty-create-button"
                  onClick={() => {
                    setShowCreateFile(true);

                    setError("");
                  }}
                >
                  Create File
                </button>
              </div>
            ) : (
              files.map((file) => (
                <button
                  key={file.id}
                  className={`file-item ${
                    selectedFile?.id === file.id ? "active" : ""
                  }`}
                  onClick={() => handleFileSelect(file)}
                >
                  <span className="file-icon">📄</span>

                  <span className="file-name">{file.filename}</span>
                </button>
              ))
            )}
          </div>

          {/* =================================================
              ONLINE USERS / PRESENCE
          ================================================= */}

          <div className="presence-section">
            <div className="presence-header">
              <div>
                <h3>Online Users ({onlineUsers.length})</h3>

                <p>
                  {onlineUsers.length}{" "}
                  {onlineUsers.length === 1 ? "user" : "users"} online
                </p>
              </div>

              <span className="presence-count">{onlineUsers.length}</span>
            </div>

            <div className="presence-list">
              {onlineUsers.length === 0 ? (
                <div className="no-online-users">No users online</div>
              ) : (
                onlineUsers.map((user) => (
                  <div key={user.userId} className="presence-user">
                    <span className="presence-dot"></span>

                    <span className="presence-username">
                      {user.username}
                      {currentUserId !== null &&
                        String(user.userId) === String(currentUserId) &&
                        " (You)"}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        {/* ===================================================
            EDITOR
        =================================================== */}

        <section className="editor-section">
          {selectedFile ? (
            <>
              {/* Editor Toolbar */}

              <div className="editor-toolbar">
                <div className="editor-file">
                  <span className="editor-file-icon">📄</span>

                  <span>{selectedFile.filename}</span>
                </div>

                <div className="editor-toolbar-right">
                  <span className="save-status">{saveStatus}</span>

                  <button
                    className="save-button"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              {/* Monaco Editor */}

              <div className="editor-container">
                <Editor
                  key={selectedFile?.id || "no-file"}
                  height="calc(100% - 50px)"
                  language={selectedFile.language || "plaintext"}
                  defaultValue={code}
                  onMount={(editor, monaco) => {
                    editorRef.current = editor;

                    // ===================================================
                    // REMOTE CURSOR SENDING (unchanged)
                    // ===================================================

                    const sendCursor = (position) => {
                      const socket = socketRef.current;
                      const currentFile = selectedFileRef.current;

                      if (
                        !socket ||
                        socket.readyState !== WebSocket.OPEN ||
                        !currentFile
                      ) {
                        return;
                      }

                      socket.send(
                        JSON.stringify({
                          type: "cursor-position",
                          fileId: currentFile.id,
                          lineNumber: position.lineNumber,
                          column: position.column,
                        })
                      );
                    };

                    editor.onDidChangeCursorPosition((event) => {
                      const position = event.position;

                      // Inside throttle window: remember the latest position
                      if (cursorThrottleRef.current) {
                        pendingCursorRef.current = position;
                        return;
                      }

                      sendCursor(position);

                      cursorThrottleRef.current = setTimeout(() => {
                        cursorThrottleRef.current = null;

                        // Send the final position if it moved meanwhile
                        if (pendingCursorRef.current) {
                          const latest = pendingCursorRef.current;
                          pendingCursorRef.current = null;
                          sendCursor(latest);
                        }
                      }, 50);
                    });

                    // ===================================================
                    // YJS + MONACO BINDING
                    // ===================================================

                    /*
                     * -------------------------------------------------------
                     * Create Yjs document for current file
                     * -------------------------------------------------------
                     */

                    const currentFile =
                      selectedFileRef.current;

                    if (!currentFile) {
                      return;
                    }

                    const doc = setupYjsDocument(
                      currentFile.id
                    );

                    const text =
                      doc.getText("content");

                    /*
                     * -------------------------------------------------------
                     * Bind Y.Text to Monaco
                     * -------------------------------------------------------
                     */

                    const binding = new MonacoBinding(
                      text,
                      editor.getModel(),
                      new Set([editor])
                    );

                    yBindingRef.current = binding;

                    /*
                     * -------------------------------------------------------
                     * Ask server for current document state
                     * -------------------------------------------------------
                     */

                    const socket = socketRef.current;

                    if (
                      socket &&
                      socket.readyState === WebSocket.OPEN
                    ) {
                      socket.send(
                        JSON.stringify({
                          type: "yjs-sync-request",
                          fileId: currentFile.id,
                        })
                      );
                    }
                  }}
                  onChange={(value) => {
                    /*
                     * Yjs / MonacoBinding is now responsible
                     * for synchronization.
                     *
                     * Do NOT send code-change here.
                     */
                    setCode(value || "");

                    setSaveStatus("Unsaved");

                    isDirtyRef.current = true;
                  }}
                  theme="vs-dark"
                  options={{
                    minimap: {
                      enabled: true,
                    },

                    fontSize: 14,

                    automaticLayout: true,

                    wordWrap: "on",

                    scrollBeyondLastLine: false,

                    smoothScrolling: true,

                    cursorBlinking: "smooth",

                    tabSize: 2,

                    insertSpaces: true,

                    suggestOnTriggerCharacters: true,

                    quickSuggestions: true,

                    formatOnType: true,
                  }}
                />
              </div>
            </>
          ) : (
            <div className="no-file-selected">
              <div className="code-icon">&lt;/&gt;</div>

              <h2>Select a file</h2>

              <p>Select a file from the explorer to start coding.</p>
            </div>
          )}
        </section>

        {/* ===================================================
            CHAT
        =================================================== */}

        <aside className="chat-section">
          <h3>Chat</h3>

          <div className="chat-messages" ref={chatMessagesRef}>
            {messages.length === 0 ? (
              <div className="no-chat-messages chat-empty">
                No messages yet. Start the conversation!
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`chat-message ${
                    currentUserId !== null &&
                    String(message.userId) === String(currentUserId)
                      ? "own"
                      : ""
                  }`}
                >
                  <div className="chat-message-user">{message.username}</div>

                  <div className="chat-message-text">{message.message}</div>
                </div>
              ))
            )}

            <div ref={chatEndRef}></div>
          </div>

          <div className="chat-input-row">
            <input
              type="text"
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleSendMessage();
                }
              }}
              placeholder="Type a message..."
              maxLength={2000}
            />

            <button
              onClick={handleSendMessage}
              disabled={
                connectionStatus !== "Connected" || !chatInput.trim()
              }
            >
              Send
            </button>
          </div>
        </aside>
      </main>

      {/* =====================================================
          BOTTOM STATUS BAR
      ===================================================== */}

      <footer className="status-bar">
        <div className="status-left">
          <span>CodeTogether</span>

          <span className="status-separator">|</span>

          <span>{selectedFile ? selectedFile.filename : "No file selected"}</span>
        </div>

        <div className="status-right">
          {message && <span className="success-message">✓ {message}</span>}

          {error && <span className="error-message">{error}</span>}
        </div>
      </footer>

      {/* =====================================================
          CREATE FILE MODAL
      ===================================================== */}

      {showCreateFile && (
        <div className="modal-overlay">
          <div className="create-file-modal">
            <div className="modal-header">
              <div>
                <h2>Create New File</h2>

                <p>Add a file to this room</p>
              </div>

              <button
                className="modal-close-button"
                onClick={() => {
                  setShowCreateFile(false);

                  setFilename("");

                  setError("");
                }}
              >
                ×
              </button>
            </div>

            <form className="create-file-form" onSubmit={handleCreateFile}>
              <label htmlFor="filename">Filename</label>

              <input
                id="filename"
                type="text"
                placeholder="example.js"
                value={filename}
                onChange={(event) => setFilename(event.target.value)}
                autoFocus
              />

              <label htmlFor="language">Language</label>

              <select
                id="language"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                <option value="javascript">JavaScript</option>

                <option value="typescript">TypeScript</option>

                <option value="python">Python</option>

                <option value="java">Java</option>

                <option value="cpp">C++</option>

                <option value="c">C</option>

                <option value="html">HTML</option>

                <option value="css">CSS</option>

                <option value="json">JSON</option>

                <option value="sql">SQL</option>

                <option value="plaintext">Plain Text</option>
              </select>

              {error && <p className="modal-error">{error}</p>}

              <div className="modal-actions">
                <button
                  type="button"
                  className="cancel-button"
                  onClick={() => {
                    setShowCreateFile(false);

                    setFilename("");

                    setError("");
                  }}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="create-file-submit"
                  disabled={creatingFile}
                >
                  {creatingFile ? "Creating..." : "Create File"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Room;