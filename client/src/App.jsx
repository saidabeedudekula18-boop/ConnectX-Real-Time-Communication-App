import "./App.css";
import { Routes, Route, Link } from "react-router-dom";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Meeting from "./pages/Meeting";

function Home() {
  return (
    <div className="app">
      <nav className="navbar">
        <div className="logo">ConnectX</div>

        <div className="nav-links">
          <Link to="/login">Login</Link>
          <Link to="/register" className="signup-btn">
            Get Started
          </Link>
        </div>
      </nav>

      <main className="hero">
        <div className="hero-content">
          <div className="badge">⚡ Real-Time Collaboration</div>

          <h1>
            Connect.
            <br />
            Collaborate.
            <br />
            <span>In Real Time.</span>
          </h1>

          <p>
            A secure real-time communication platform for video meetings,
            screen sharing, file sharing and collaborative work.
          </p>

          <div className="hero-buttons">
            <Link to="/register" className="primary-btn">
              Start a Meeting →
            </Link>

            <Link to="/login" className="secondary-btn">
              Join a Meeting
            </Link>
          </div>
        </div>

        <div className="hero-card">
          <div className="video-header">
            <span>ConnectX Meeting</span>
            <span className="live">● LIVE</span>
          </div>

          <div className="video-area">
            <div className="avatar">C</div>
            <p>Your meeting starts here</p>
          </div>

          <div className="controls">
            <button>🎤</button>
            <button>📹</button>
            <button>🖥️</button>
            <button>💬</button>
            <button className="end-call">☎</button>
          </div>
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/meeting" element={<Meeting />} />
      <Route path="/meeting/:meetingId" element={<Meeting />} />
    </Routes>
  );
}

export default App;