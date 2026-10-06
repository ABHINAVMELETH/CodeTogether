import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Dashboard.css";

function Dashboard() {
  const [user, setUser] = useState(null);
  const [rooms, setRooms] = useState([]);

  const [roomName, setRoomName] = useState("");

  // Join Room states
  const [joinRoomId, setJoinRoomId] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joiningRoom, setJoiningRoom] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const navigate = useNavigate();

  // ==============================
  // Get logged-in user
  // ==============================

  useEffect(() => {
    const getUser = async () => {
      const token = localStorage.getItem("token");

      if (!token) {
        navigate("/login");
        return;
      }

      try {
        const response = await fetch(
          "http://localhost:5000/api/auth/me",
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const data = await response.json();

        if (!response.ok) {
          localStorage.removeItem("token");
          navigate("/login");
          return;
        }

        setUser(data.user);
      } catch (error) {
        console.error(error);
        setError("Unable to connect to server");
      }
    };

    getUser();
  }, [navigate]);

  // ==============================
  // Get rooms of logged-in user
  // ==============================

  const getRooms = async () => {
    const token = localStorage.getItem("token");

    if (!token) {
      navigate("/login");
      return;
    }

    try {
      const response = await fetch(
        "http://localhost:5000/api/rooms",
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Unable to load rooms");
        return;
      }

      setRooms(data.rooms);
    } catch (error) {
      console.error(error);
      setError("Unable to load rooms");
    }
  };

  // ==============================
  // Get rooms when Dashboard loads
  // ==============================

  useEffect(() => {
    const token = localStorage.getItem("token");

    if (token) {
      getRooms();
    }
  }, []);

  // ==============================
  // Create a new room
  // ==============================

  const handleCreateRoom = async (event) => {
    event.preventDefault();

    setError("");
    setMessage("");

    if (!roomName.trim()) {
      setError("Please enter a room name");
      return;
    }

    const token = localStorage.getItem("token");

    try {
      const response = await fetch(
        "http://localhost:5000/api/rooms",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },

          body: JSON.stringify({
            name: roomName.trim(),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Unable to create room");
        return;
      }

      setMessage("Room created successfully!");

      setRoomName("");

      // Reload rooms
      getRooms();
    } catch (error) {
      console.error(error);
      setError("Unable to connect to server");
    }
  };

  // ==============================
  // Join an existing room
  // ==============================

  const handleJoinRoom = async (event) => {
    event.preventDefault();

    setJoinError("");

    if (!joinRoomId.trim()) {
      setJoinError("Room ID is required");
      return;
    }

    const token = localStorage.getItem("token");

    if (!token) {
      navigate("/login");
      return;
    }

    setJoiningRoom(true);

    try {
      const response = await fetch(
        "http://localhost:5000/api/rooms/join",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },

          body: JSON.stringify({
            roomId: joinRoomId.trim(),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setJoinError(
          data.message || "Unable to join room"
        );
        return;
      }

      // Clear input
      setJoinRoomId("");

      // Reload rooms
      getRooms();

      // Open the room
      navigate(`/rooms/${data.room.id}`);
    } catch (error) {
      console.error(error);

      setJoinError("Unable to connect to server");
    } finally {
      setJoiningRoom(false);
    }
  };

  // ==============================
  // Copy Room ID
  // ==============================

  const handleCopyRoomId = async (roomId) => {
    try {
      await navigator.clipboard.writeText(roomId);

      setMessage("Room ID copied to clipboard!");
    } catch (error) {
      console.error(error);
      setError("Unable to copy Room ID");
    }
  };

  // ==============================
  // Logout
  // ==============================

  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/login");
  };

  // ==============================
  // Error while getting user
  // ==============================

  if (error && !user) {
    return (
      <div className="dashboard-loading">
        <h1>{error}</h1>
      </div>
    );
  }

  // ==============================
  // Loading user
  // ==============================

  if (!user) {
    return (
      <div className="dashboard-loading">
        <h1>Loading...</h1>
      </div>
    );
  }

  return (
    <div className="dashboard">

      {/* ==============================
          Header
      ============================== */}

      <header className="dashboard-header">

        <div className="dashboard-title">

          <h1>Dashboard</h1>

          <p>
            Welcome back to CodeTogether
          </p>

        </div>

        <button
          className="logout-button"
          onClick={handleLogout}
        >
          Logout
        </button>

      </header>


      {/* ==============================
          User Information
      ============================== */}

      <section className="user-card">

        <div className="user-avatar">
          {user.username.charAt(0).toUpperCase()}
        </div>

        <div className="user-info">

          <h2>
            Welcome, {user.username}
          </h2>

          <p>
            {user.email}
          </p>

        </div>

      </section>


      {/* ==============================
          Create Room
      ============================== */}

      <section className="room-card">

        <div className="section-header">

          <h2>Create a Room</h2>

          <p>
            Start a collaborative coding session
          </p>

        </div>


        <form
          className="room-form"
          onSubmit={handleCreateRoom}
        >

          <input
            type="text"
            placeholder="Enter room name"
            value={roomName}
            onChange={(event) =>
              setRoomName(event.target.value)
            }
          />

          <button
            className="create-room-button"
            type="submit"
          >
            + Create Room
          </button>

        </form>


        {/* Success Message */}

        {message && (
          <p className="success-message">
            ✓ {message}
          </p>
        )}


        {/* Error Message */}

        {error && (
          <p className="error-message">
            {error}
          </p>
        )}

      </section>


      {/* ==============================
          Join Room
      ============================== */}

      <section className="join-room-card">

        <div className="section-header">

          <h2>Join a Room</h2>

          <p>
            Enter a Room ID shared by another user
          </p>

        </div>


        <form
          className="join-room-form"
          onSubmit={handleJoinRoom}
        >

          <input
            type="text"
            placeholder="Enter Room ID"
            value={joinRoomId}
            onChange={(event) =>
              setJoinRoomId(event.target.value)
            }
          />

          <button
            className="join-room-button"
            type="submit"
            disabled={joiningRoom}
          >
            {joiningRoom
              ? "Joining..."
              : "Join Room"}
          </button>

        </form>


        {/* Join Error */}

        {joinError && (
          <p className="error-message">
            {joinError}
          </p>
        )}

      </section>


      {/* ==============================
          My Rooms
      ============================== */}

      <section className="rooms-section">

        <div className="rooms-header">

          <div>

            <h2>My Rooms</h2>

            <p>
              Rooms you have created or joined
            </p>

          </div>

          <span className="room-count">

            {rooms.length}{" "}

            {rooms.length === 1
              ? "Room"
              : "Rooms"}

          </span>

        </div>


        {/* No Rooms */}

        {rooms.length === 0 ? (

          <div className="empty-rooms">

            <div className="empty-icon">
              +
            </div>

            <h3>No rooms yet</h3>

            <p>
              Create your first room to start
              collaborating with your team.
            </p>

          </div>

        ) : (

          <div className="rooms-grid">

            {rooms.map((room) => (

              <div
                className="room-item"
                key={room.id}
              >

                <div className="room-item-header">

                  <div className="room-icon">
                    &lt;/&gt;
                  </div>

                  <h3>
                    {room.name}
                  </h3>

                </div>


                {/* Room ID */}

                <p className="room-id">
                  Room ID
                </p>

                <p className="room-id-value">
                  {room.id}
                </p>


                {/* Copy Room ID */}

                <button
                  className="copy-room-button"
                  onClick={() =>
                    handleCopyRoomId(room.id)
                  }
                >
                  Copy Room ID
                </button>


                {/* Open Room */}

                <button
                  className="open-room-button"
                  onClick={() =>
                    navigate(`/rooms/${room.id}`)
                  }
                >
                  Open Room →
                </button>

              </div>

            ))}

          </div>

        )}

      </section>

    </div>
  );
}

export default Dashboard;

