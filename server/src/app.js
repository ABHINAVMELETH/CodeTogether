const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const roomRoutes = require("./routes/roomRoutes");
const fileRoutes = require("./routes/fileRoutes");
const versionRoutes = require("./routes/versionRoutes");

const app = express();

app.use(cors());
app.use(express.json());



app.use("/api/files", versionRoutes);

app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/rooms", fileRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "CodeTogether API is running",
  });
});



module.exports = app;