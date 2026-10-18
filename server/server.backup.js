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
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected successfully!");
  })
  .catch((error) => {
    console.error("MongoDB connection failed:", error.message);
  });

app.use(cors());
app.use(express.json());
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

    res.status(201).json({
      message: "Registration successful",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Server error",
    });
  }
});

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

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        message: "Invalid email or password",
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

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Server error",
    });
  }
});

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

app.get("/", (req, res) => {
  res.send("Real-Time Communication Server is running!");
});



io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", (roomId) => {
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

    console.log("User joined room:", room);
    console.log("Existing peers:", existingPeers);

    socket.emit("existing-peers", existingPeers);

    socket.to(room).emit("peer-joined", {
      socketId: socket.id,
    });
  });

  socket.on("offer", ({ target, offer }) => {
    console.log("Offer received from:", socket.id, "to:", target);

    if (target && offer) {
      io.to(target).emit("offer", {
        sender: socket.id,
        offer,
      });
    }
  });

  socket.on("answer", ({ target, answer }) => {
    console.log("Answer received from:", socket.id, "to:", target);

    if (target && answer) {
      io.to(target).emit("answer", {
        sender: socket.id,
        answer,
      });
    }
  });

  socket.on("ice-candidate", ({ target, candidate }) => {
    if (target && candidate) {
      io.to(target).emit("ice-candidate", {
        sender: socket.id,
        candidate,
      });
    }
  });

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



const PORT = 5000;

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});