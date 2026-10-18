import { useState } from "react";
import { useNavigate } from "react-router-dom";

function Login() {
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const navigate = useNavigate();
  const [message, setMessage] = useState("");

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("Signing in...");

    try {
      const API_URL = import.meta.env.VITE_API_URL;

      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.message || "Login failed");
        return;
      }

      localStorage.setItem("connectx_token", data.token);
      localStorage.setItem("connectx_user", JSON.stringify(data.user));

      setMessage(`Welcome, ${data.user.name}! 🎉`);
    } catch (error) {
      setMessage("Unable to connect to server.");
    }
  };

  navigate("/dashboard");

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">ConnectX</div>

        <h1>Welcome Back</h1>
        <p>Sign in to continue to ConnectX.</p>

        <form onSubmit={handleSubmit}>
          <label>Email</label>
          <input
            type="email"
            name="email"
            placeholder="Enter your email"
            value={formData.email}
            onChange={handleChange}
            required
          />

          <label>Password</label>
          <input
            type="password"
            name="password"
            placeholder="Enter your password"
            value={formData.password}
            onChange={handleChange}
            required
          />

          <button type="submit" className="auth-btn">
            Sign In
          </button>
        </form>

        {message && <div className="auth-message">{message}</div>}

        <p className="auth-footer">
          Don't have an account? <span>Register</span>
        </p>
      </div>
    </div>
  );
}

export default Login;