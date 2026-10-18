
import { useState } from "react";
import { useNavigate } from "react-router-dom";

function Dashboard() {
  const navigate = useNavigate();
  const [meetingId, setMeetingId] = useState("");

  const user = JSON.parse(localStorage.getItem("connectx_user"));

  const handleLogout = () => {
    localStorage.removeItem("connectx_token");
    localStorage.removeItem("connectx_user");
    navigate("/login");
  };

  const createMeeting = () => {
    const newMeetingId = Math.random().toString(36).substring(2, 10);
    navigate(`/meeting/${newMeetingId}`);
  };

  const joinMeeting = () => {
    const id = meetingId.trim();

    if (!id) {
      alert("Please enter a Meeting ID");
      return;
    }

    navigate(`/meeting/${encodeURIComponent(id)}`);
  };

  return (
    <div className="dashboard-page">
      <nav className="dashboard-nav">
        <div className="logo">ConnectX</div>

        <div className="dashboard-user">
          <span>👤 {user?.name || "User"}</span>
          <button onClick={handleLogout} className="logout-btn">
            Logout
          </button>
        </div>
      </nav>

      <main className="dashboard-content">
        <div className="welcome">
          <span className="badge">⚡ Your Workspace</span>
          <h1>
            Welcome back,{" "}
            <span>{user?.name?.split(" ")[0] || "User"}!</span>
          </h1>
          <p>
            Start a meeting or join your team and collaborate in real time.
          </p>
        </div>

        <div className="meeting-actions">
          <div className="action-card">
            <div className="action-icon">🎥</div>
            <h2>Create a Meeting</h2>
            <p>
              Start a new video meeting and invite others to collaborate.
            </p>
            <button className="primary-btn" onClick={createMeeting}>
              Create Meeting →
            </button>
          </div>

          <div className="action-card">
            <div className="action-icon">🔗</div>
            <h2>Join a Meeting</h2>
            <p>
              Enter the Meeting ID shared by the meeting host.
            </p>

            <input
              type="text"
              placeholder="Enter Meeting ID"
              value={meetingId}
              onChange={(event) => setMeetingId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") joinMeeting();
              }}
              aria-label="Meeting ID"
            />

            <button className="secondary-btn" onClick={joinMeeting}>
              Join Meeting →
            </button>
          </div>
        </div>

        <section className="dashboard-features">
          <h2>ConnectX Features</h2>
          <div className="dashboard-feature-grid">
            <div>🎥 Video Calling</div>
            <div>🖥️ Screen Sharing</div>
            <div>📁 File Sharing</div>
            <div>✏️ Collaborative Whiteboard</div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default Dashboard;
