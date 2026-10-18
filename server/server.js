
const User = require("./models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

// Frontend URLs allowed to connect to this backend.
const allowedOrigins = [
  "http://localhost:5173",
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  })
);

app.use(express.json());

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected successfully!");
  })
  .catch((error) => {
    console.error("MongoDB connection failed:", error.message);
  });

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
});

// Health check
app.get("/", (req, res) => {
  res.send("Real-Time Communication Server is running!");
});

// Register
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters",
      });
    }

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(400).json({
        message: "User already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
    });

    return res.status(201).json({
      message: "Registration successful",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Registration error:", error.message);

    return res.status(500).json({
      message: "Server error",
    });
  }
});

// Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const isPasswordValid = await bcrypt.compare(
      password,
      user.password
    );

    if (!isPasswordValid) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured");

      return res.status(500).json({
        message: "Server configuration error",
      });
    }

    const token = jwt.sign(
      {
        id: user._id,
        email: user.email,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d",
      }
    );

    return res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      message: "Server error",
    });
  }
});

// Socket.IO real-time events
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Join meeting room
  socket.on("join-room", (data) => {
    const roomId =
      typeof data === "string" ? data : data?.roomId;

    const name =
      typeof data === "object" && data?.name
        ? String(data.name).trim().slice(0, 40)
        : "Participant";

    if (typeof roomId !== "string" || !roomId.trim()) {
      console.log("Invalid room ID from:", socket.id);
      return;
    }

    const room = roomId.trim();

    const existingRoom = io.sockets.adapter.rooms.get(room);
    const existingPeers = existingRoom
      ? [...existingRoom].filter((id) => id !== socket.id)
      : [];

    socket.join(room);
    socket.data.meetingRoom = room;
    socket.data.participantName = name;

    const participants = existingPeers.map((id) => ({
      socketId: id,
      name:
        io.sockets.sockets.get(id)?.data.participantName ||
        "Participant",
    }));

    console.log("User joined room:", room, "Name:", name);
    console.log("Existing participants:", participants);

    socket.emit("existing-peers", participants);

    socket.to(room).emit("peer-joined", {
      socketId: socket.id,
      name,
    });
  });

  // Real-time room chat
  socket.on("chat-message", (data) => {
    const room = socket.data.meetingRoom;

    if (!room || !data || typeof data.message !== "string") {
      return;
    }

    const message = data.message.trim();

    if (!message || message.length > 1000) {
      return;
    }

    io.to(room).emit("chat-message", {
      senderId: socket.id,
      name: socket.data.participantName || "Participant",
      message,
      timestamp: new Date().toISOString(),
    });
  });

  // WebRTC offer
  socket.on("offer", (data) => {
    if (!data) return;

    const { target, offer } = data;

    if (target && offer) {
      io.to(target).emit("offer", {
        sender: socket.id,
        offer,
      });
    }
  });

  // WebRTC answer
  socket.on("answer", (data) => {
    if (!data) return;

    const { target, answer } = data;

    if (target && answer) {
      io.to(target).emit("answer", {
        sender: socket.id,
        answer,
      });
    }
  });

  // WebRTC ICE candidates
  socket.on("ice-candidate", (data) => {
    if (!data) return;

    const { target, candidate } = data;

    if (target && candidate) {
      io.to(target).emit("ice-candidate", {
        sender: socket.id,
        candidate,
      });
    }
  });

  // Participant disconnected
  socket.on("disconnect", () => {
    const room = socket.data.meetingRoom;

    if (room) {
      socket.to(room).emit("peer-left", {
        socketId: socket.id,
      });
    }

    console.log("User disconnected:", socket.id);
  });
});

// Render provides PORT automatically.
const PORT = process.env.PORT || 5000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
