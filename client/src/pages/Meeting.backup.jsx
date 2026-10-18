
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";

export default function Meeting() {
  const { meetingId } = useParams();
  const navigate = useNavigate();

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const socketRef = useRef(null);
  const peerConnectionsRef = useRef({});
  const pendingCandidatesRef = useRef({});

  const [joinId, setJoinId] = useState("");
  const [remoteStreams, setRemoteStreams] = useState({});
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Connecting...");
  const [copied, setCopied] = useState(false);

  // Create a new meeting
  const createMeeting = () => {
    const newMeetingId = Math.random().toString(36).substring(2, 10);
    navigate(`/meeting/${newMeetingId}`);
  };

  // Join a meeting using its ID
  const joinMeeting = () => {
    const id = joinId.trim();

    if (id) {
      navigate(`/meeting/${encodeURIComponent(id)}`);
    }
  };

  useEffect(() => {
    if (!meetingId) return;

    let active = true;
    let socket;
    let localStream;

    const peers = peerConnectionsRef.current;
    const pendingCandidates = pendingCandidatesRef.current;

    peers && Object.keys(peers).forEach((id) => {
      peers[id]?.close();
      delete peers[id];
    });

    Object.keys(pendingCandidates).forEach((id) => {
      delete pendingCandidates[id];
    });

    const flushCandidates = async (peerId, pc) => {
      const candidates = pendingCandidates[peerId] || [];
      delete pendingCandidates[peerId];

      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error("Could not add queued ICE candidate:", err);
        }
      }
    };

    const createPeerConnection = (peerId) => {
      if (peers[peerId]) return peers[peerId];

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
        ],
      });

      peers[peerId] = pc;

      const stream = localStreamRef.current;

      if (stream) {
        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate && socket?.connected) {
          socket.emit("ice-candidate", {
            target: peerId,
            candidate: event.candidate,
          });
        }
      };

      pc.ontrack = (event) => {
        const remoteStream = event.streams?.[0];

        if (remoteStream && active) {
          console.log("Remote track received from:", peerId);

          setRemoteStreams((previous) => ({
            ...previous,
            [peerId]: remoteStream,
          }));
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(
          "Peer connection state:",
          peerId,
          pc.connectionState
        );

        if (!active) return;

        if (pc.connectionState === "connected") {
          setStatus("Video connection established!");
          setError("");
        } else if (pc.connectionState === "failed") {
          setError(
            "Video connection failed. Check your network and console logs."
          );
          setStatus("Connection failed");
        } else if (pc.connectionState === "disconnected") {
          setStatus("Video connection interrupted...");
        } else if (pc.connectionState === "connecting") {
          setStatus("Connecting video...");
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(
          "ICE connection state:",
          peerId,
          pc.iceConnectionState
        );
      };

      return pc;
    };

    const startMeeting = async () => {
      try {
        setError("");
        setStatus("Requesting camera and microphone...");

        if (
          !navigator.mediaDevices ||
          !navigator.mediaDevices.getUserMedia
        ) {
          throw new Error(
            "Camera access is unavailable. Open the app in a supported browser using localhost or HTTPS."
          );
        }

        localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (!active) {
          localStream.getTracks().forEach((track) => track.stop());
          return;
        }

        localStreamRef.current = localStream;

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }

        setStatus("Connecting to meeting server...");

        socket = io("http://localhost:5000");
        socketRef.current = socket;

        socket.on("connect", () => {
          if (!active) return;

          console.log("Socket connected:", socket.id);
          setStatus("Joining meeting...");
          socket.emit("join-room", meetingId);
        });

        socket.on("connect_error", (err) => {
          console.error("Socket connection error:", err);

          if (active) {
            setError(
              "Could not connect to the meeting server. Make sure the backend is running on port 5000."
            );
            setStatus("Server connection failed");
          }
        });

        // Create offers to people already in the room
        socket.on("existing-peers", async (peerIds) => {
          console.log("Existing peers:", peerIds);

          for (const peerId of peerIds) {
            if (!active) return;

            try {
              const pc = createPeerConnection(peerId);
              const offer = await pc.createOffer();

              await pc.setLocalDescription(offer);

              if (socket.connected) {
                socket.emit("offer", {
                  target: peerId,
                  offer: pc.localDescription,
                });
              }
            } catch (err) {
              console.error("Error creating offer:", err);
              if (active) {
                setError("Could not start the video connection.");
              }
            }
          }

          if (active) {
            setStatus(
              peerIds.length > 0
                ? "Connecting video..."
                : "Waiting for someone to join..."
            );
          }
        });

        // A new participant has joined
        socket.on("peer-joined", (data) => {
          const peerId =
            typeof data === "string" ? data : data?.socketId;

          console.log("Peer joined:", peerId);

          if (active) {
            setStatus("Another participant joined. Connecting video...");
          }
        });

        // Receive an offer and return an answer
        socket.on("offer", async ({ sender, offer }) => {
          if (!active || !sender || !offer) return;

          try {
            console.log("Received offer from:", sender);

            const pc = createPeerConnection(sender);

            await pc.setRemoteDescription(
              new RTCSessionDescription(offer)
            );

            await flushCandidates(sender, pc);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            if (socket.connected) {
              socket.emit("answer", {
                target: sender,
                answer: pc.localDescription,
              });
            }
          } catch (err) {
            console.error("Error handling offer:", err);

            if (active) {
              setError("Could not establish the video connection.");
            }
          }
        });

        // Receive an answer to our offer
        socket.on("answer", async ({ sender, answer }) => {
          if (!active || !sender || !answer) return;

          try {
            console.log("Received answer from:", sender);

            const pc = peers[sender];

            if (!pc) {
              console.warn("No peer connection found for:", sender);
              return;
            }

            await pc.setRemoteDescription(
              new RTCSessionDescription(answer)
            );

            await flushCandidates(sender, pc);
          } catch (err) {
            console.error("Error handling answer:", err);
          }
        });

        // Exchange ICE network candidates
        socket.on(
          "ice-candidate",
          async ({ sender, candidate }) => {
            if (!active || !sender || !candidate) return;

            try {
              const pc = peers[sender];

              if (pc?.remoteDescription) {
                await pc.addIceCandidate(
                  new RTCIceCandidate(candidate)
                );
              } else {
                if (!pendingCandidates[sender]) {
                  pendingCandidates[sender] = [];
                }

                pendingCandidates[sender].push(candidate);
              }
            } catch (err) {
              console.error("Error adding ICE candidate:", err);
            }
          }
        );

        // Remove a participant who leaves
        socket.on("peer-left", (data) => {
          const peerId =
            typeof data === "string" ? data : data?.socketId;

          if (!peerId) return;

          console.log("Peer left:", peerId);

          peers[peerId]?.close();
          delete peers[peerId];
          delete pendingCandidates[peerId];

          if (active) {
            setRemoteStreams((previous) => {
              const updated = { ...previous };
              delete updated[peerId];
              return updated;
            });

            setStatus("Participant left the meeting.");
          }
        });
      } catch (err) {
        console.error("Could not start meeting:", err);

        if (active) {
          setError(
            err.name === "NotAllowedError"
              ? "Camera or microphone permission was denied. Allow access in your browser settings."
              : err.name === "NotFoundError"
                ? "No camera or microphone was found."
                : err.message || "Could not start the meeting."
          );

          setStatus("Unable to start meeting");
        }
      }
    };

    startMeeting();

    return () => {
      active = false;

      Object.values(peers).forEach((pc) => pc.close());

      Object.keys(peers).forEach((id) => {
        delete peers[id];
      });

      Object.keys(pendingCandidates).forEach((id) => {
        delete pendingCandidates[id];
      });

      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }

      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }

      localStreamRef.current = null;
      socketRef.current = null;
    };
  }, [meetingId]);

  // Turn camera on or off
  const toggleCamera = () => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const nextState = !cameraOn;

    stream.getVideoTracks().forEach((track) => {
      track.enabled = nextState;
    });

    setCameraOn(nextState);
  };

  // Turn microphone on or off
  const toggleMic = () => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const nextState = !micOn;

    stream.getAudioTracks().forEach((track) => {
      track.enabled = nextState;
    });

    setMicOn(nextState);
  };

  // Copy the meeting link
  const copyMeetingLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Could not copy meeting link:", err);
      setError("Could not copy the link. Please copy it from the address bar.");
    }
  };

  // Lobby screen when no meeting ID is present
  if (!meetingId) {
    return (
      <div style={styles.page}>
        <div style={styles.lobby}>
          <h1 style={styles.logo}>ConnectX</h1>
          <p style={styles.subtitle}>
            Connect with people, anywhere.
          </p>

          <button
            style={styles.primaryButton}
            onClick={createMeeting}
          >
            Create Meeting
          </button>

          <div style={styles.divider}>OR</div>

          <input
            style={styles.input}
            type="text"
            placeholder="Enter Meeting ID"
            value={joinId}
            onChange={(event) => setJoinId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") joinMeeting();
            }}
          />

          <button
            style={styles.secondaryButton}
            onClick={joinMeeting}
            disabled={!joinId.trim()}
          >
            Join Meeting
          </button>

          <button
            style={styles.backButton}
            onClick={() => navigate("/dashboard")}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.logo}>ConnectX</h1>
          <p style={styles.meetingInfo}>
            Meeting ID: <strong>{meetingId}</strong>
          </p>
        </div>

        <button
          style={styles.copyButton}
          onClick={copyMeetingLink}
        >
          {copied ? "Link Copied!" : "Copy Invite Link"}
        </button>
      </header>

      <main style={styles.main}>
        <p style={styles.status}>{status}</p>

        {error && (
          <div style={styles.error}>
            {error}
          </div>
        )}

        <div style={styles.videoGrid}>
          <div style={styles.videoCard}>
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              style={styles.video}
            />

            <div style={styles.videoLabel}>
              You {micOn ? "" : "(Mic off)"}
              {!cameraOn && " — Camera off"}
            </div>

            {!cameraOn && (
              <div style={styles.videoOverlay}>
                Camera Off
              </div>
            )}
          </div>

          {Object.entries(remoteStreams).map(
            ([peerId, stream]) => (
              <RemoteVideo
                key={peerId}
                peerId={peerId}
                stream={stream}
              />
            )
          )}
        </div>

        {Object.keys(remoteStreams).length === 0 && (
          <p style={styles.waiting}>
            Waiting for another participant to connect...
          </p>
        )}

        <div style={styles.controls}>
          <button
            style={{
              ...styles.controlButton,
              background: cameraOn ? "#263449" : "#b42318",
            }}
            onClick={toggleCamera}
          >
            {cameraOn ? "Turn Camera Off" : "Turn Camera On"}
          </button>

          <button
            style={{
              ...styles.controlButton,
              background: micOn ? "#263449" : "#b42318",
            }}
            onClick={toggleMic}
          >
            {micOn ? "Mute Mic" : "Unmute Mic"}
          </button>

          <button
            style={styles.leaveButton}
            onClick={() => navigate("/dashboard")}
          >
            Leave Meeting
          </button>
        </div>
      </main>
    </div>
  );
}

function RemoteVideo({ peerId, stream }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;

      videoRef.current.play().catch((err) => {
        console.warn("Remote video autoplay was blocked:", err);
      });
    }

    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [stream]);

  return (
    <div style={styles.videoCard}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={styles.video}
      />

      <div style={styles.videoLabel}>
        Participant
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#0b1120",
    color: "#ffffff",
    fontFamily: "Arial, sans-serif",
    padding: "24px",
    boxSizing: "border-box",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "16px",
    borderBottom: "1px solid #293449",
    paddingBottom: "18px",
  },
  logo: {
    margin: 0,
    fontSize: "28px",
    color: "#72a7ff",
  },
  subtitle: {
    color: "#aab6ca",
    marginBottom: "28px",
  },
  meetingInfo: {
    color: "#c2cce0",
    marginBottom: 0,
    overflowWrap: "anywhere",
  },
  main: {
    maxWidth: "1200px",
    margin: "0 auto",
    paddingTop: "20px",
  },
  status: {
    textAlign: "center",
    color: "#a9c8ff",
  },
  error: {
    background: "#451d26",
    border: "1px solid #9e3949",
    color: "#ffd6dc",
    padding: "12px",
    borderRadius: "8px",
    margin: "16px 0",
    overflowWrap: "anywhere",
  },
  videoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "18px",
    marginTop: "24px",
  },
  videoCard: {
    position: "relative",
    background: "#172033",
    border: "1px solid #344158",
    borderRadius: "12px",
    overflow: "hidden",
    minHeight: "200px",
  },
  video: {
    width: "100%",
    aspectRatio: "16 / 9",
    display: "block",
    objectFit: "cover",
    background: "#080c14",
  },
  videoLabel: {
    padding: "10px 12px",
    color: "#ffffff",
    background: "#172033",
    fontSize: "14px",
    overflowWrap: "anywhere",
  },
  videoOverlay: {
    position: "absolute",
    inset: "0 0 42px 0",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "#111827",
    color: "#ffffff",
  },
  waiting: {
    color: "#aab6ca",
    textAlign: "center",
    marginTop: "24px",
  },
  controls: {
    display: "flex",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: "12px",
    marginTop: "28px",
  },
  controlButton: {
    border: "none",
    color: "#ffffff",
    borderRadius: "8px",
    padding: "12px 18px",
    cursor: "pointer",
  },
  leaveButton: {
    border: "none",
    color: "#ffffff",
    background: "#c62828",
    borderRadius: "8px",
    padding: "12px 18px",
    cursor: "pointer",
  },
  copyButton: {
    background: "#263449",
    color: "#ffffff",
    border: "1px solid #465773",
    padding: "10px 14px",
    borderRadius: "8px",
    cursor: "pointer",
  },
  lobby: {
    width: "100%",
    maxWidth: "420px",
    margin: "70px auto",
    padding: "32px",
    boxSizing: "border-box",
    background: "#151e30",
    border: "1px solid #344158",
    borderRadius: "16px",
    textAlign: "center",
  },
  primaryButton: {
    width: "100%",
    background: "#3478f6",
    color: "#ffffff",
    border: "none",
    padding: "13px",
    borderRadius: "8px",
    cursor: "pointer",
    marginTop: "10px",
  },
  secondaryButton: {
    width: "100%",
    background: "#263449",
    color: "#ffffff",
    border: "1px solid #465773",
    padding: "13px",
    borderRadius: "8px",
    cursor: "pointer",
    marginTop: "12px",
  },
  divider: {
    color: "#8290a8",
    margin: "20px 0",
    fontSize: "13px",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "13px",
    borderRadius: "8px",
    border: "1px solid #465773",
    background: "#0b1120",
    color: "#ffffff",
    outline: "none",
  },
  backButton: {
    marginTop: "20px",
    background: "transparent",
    border: "none",
    color: "#a9c8ff",
    cursor: "pointer",
  },
};
