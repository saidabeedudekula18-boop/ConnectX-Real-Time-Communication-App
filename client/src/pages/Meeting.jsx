import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";

export default function Meeting() {
  const { meetingId } = useParams();
  const navigate = useNavigate();

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const socketRef = useRef(null);
  const peerConnectionsRef = useRef({});
  const pendingCandidatesRef = useRef({});

  const [joinId, setJoinId] = useState("");
  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem("connectx_display_name") || ""
  );
  const [remoteNames, setRemoteNames] = useState({});
  const [remoteStreams, setRemoteStreams] = useState({});
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Connecting...");
  const [copied, setCopied] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  
  const chatMessagesContainerRef = useRef(null);
  const isChatAtBottomRef = useRef(true);
  const [unreadCount, setUnreadCount] = useState(0);

  
  useEffect(() => {
    const container = chatMessagesContainerRef.current;
    if (!container || chatMessages.length === 0) return;

    // Scroll only the messages area, never the whole page.
    // Do not move the reader if they have scrolled up to older messages.
    if (isChatAtBottomRef.current) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth",
      });
      setUnreadCount(0);
    }
  }, [chatMessages]);

  const createMeeting = () => {
    const newMeetingId = Math.random()
      .toString(36)
      .substring(2, 10);

    navigate(`/meeting/${newMeetingId}`);
  };

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

    Object.keys(peers).forEach((id) => {
      peers[id]?.close();
      delete peers[id];
    });

    Object.keys(pendingCandidates).forEach((id) => {
      delete pendingCandidates[id];
    });

    setRemoteStreams({});
    setRemoteNames({});
    setError("");
    setStatus("Starting meeting...");

    const flushCandidates = async (peerId, pc) => {
      const candidates = pendingCandidates[peerId] || [];
      delete pendingCandidates[peerId];

      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(
            new RTCIceCandidate(candidate)
          );
        } catch (err) {
          console.error("Could not add queued ICE candidate:", err);
        }
      }
    };

    const createPeerConnection = (peerId) => {
      if (peers[peerId]) {
        return peers[peerId];
      }

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
        let name =
          localStorage.getItem("connectx_display_name") || "";

        if (!name.trim()) {
          name =
            window.prompt("Enter your name for this meeting:") || "";
        }

        name = name.trim().slice(0, 40);

        if (!name) {
          setError("Please enter your name to join the meeting.");
          setStatus("Waiting for your name");
          return;
        }

        localStorage.setItem("connectx_display_name", name);
        setDisplayName(name);

        setError("");
        setStatus("Requesting camera and microphone...");

        if (
          !navigator.mediaDevices ||
          !navigator.mediaDevices.getUserMedia
        ) {
          throw new Error(
            "Camera access is unavailable. Use a supported browser on localhost or HTTPS."
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

        socket = io("https://connectx-real-time-communication-app.onrender.com");
        socketRef.current = socket;

        socket.on("connect", () => {
          if (!active) return;

          console.log("Socket connected:", socket.id);
          setStatus("Joining meeting...");

          socket.emit("join-room", {
            roomId: meetingId,
            name,
          });
        });

        socket.on("connect_error", (err) => {
          console.error("Socket connection error:", err);

          if (active) {
            setError(
              "Could not connect to the server. Make sure the backend is running on port 5000."
            );
            setStatus("Server connection failed");
          }
        });
    
        socket.on("chat-message", (data) => {
          if (!active || !data) return;
          console.log("CHAT MESSAGE RECEIVED:", data);
          const isOwnMessage = data.senderId === socket.id;

          const container = chatMessagesContainerRef.current;
          const isActuallyAtBottom = container
            ? container.scrollHeight - container.scrollTop - container.clientHeight < 30
            : true;
          // Scroll position is tracked only by the chat area's onScroll handler.
          if (!isOwnMessage && !isActuallyAtBottom) {
            setUnreadCount((count) => count + 1);
          }

          setChatMessages((previous) => [
            ...previous,
            {
              id: `${Date.now()}-${Math.random()}`,
              senderId: data.senderId,
              name: data.name || "Participant",
              message: data.message || "",
              timestamp: data.timestamp || new Date().toISOString(),
            },
          ]);
        });

        // Existing participants: normalize IDs before creating offers.
        socket.on("existing-peers", async (participants) => {
          console.log("Existing participants:", participants);

          const peerList = (Array.isArray(participants)
            ? participants
            : []
          )
            .map((participant) => {
              if (typeof participant === "string") {
                return {
                  socketId: participant,
                  name: "Participant",
                };
              }

              return participant;
            })
            .filter(
              (participant) =>
                typeof participant?.socketId === "string" &&
                participant.socketId !== socket.id
            );

          setRemoteNames((previous) => {
            const updated = { ...previous };

            peerList.forEach((participant) => {
              updated[participant.socketId] =
                participant.name || "Participant";
            });

            return updated;
          });

          for (const participant of peerList) {
            if (!active) return;

            // Always use the socket ID string, never the whole object.
            const peerId = participant.socketId;

            try {
              const pc = createPeerConnection(peerId);
              const offer = await pc.createOffer();

              await pc.setLocalDescription(offer);

              if (active && socket.connected) {
                socket.emit("offer", {
                  target: peerId,
                  offer: pc.localDescription,
                });

                console.log("Offer sent to:", peerId);
              }
            } catch (err) {
              console.error(
                "Error creating offer for:",
                peerId,
                err
              );

              if (active) {
                setError(
                  `Could not connect to ${participant.name || "participant"}.`
                );
              }
            }
          }

          if (active) {
            setStatus(
              peerList.length
                ? "Connecting to participants..."
                : "Waiting for someone to join..."
            );
          }
        });

        // A new participant has joined this room.
        socket.on("peer-joined", (data) => {
          const peerId =
            typeof data === "string" ? data : data?.socketId;

          if (!peerId || peerId === socket.id) return;

          const participantName =
            typeof data === "object"
              ? data.name || "Participant"
              : "Participant";

          console.log(
            "Participant joined:",
            participantName,
            peerId
          );

          setRemoteNames((previous) => ({
            ...previous,
            [peerId]: participantName,
          }));

          if (active) {
            setStatus(
              `${participantName} joined. Connecting video...`
            );
          }
        });

        // Receive an offer and return an answer.
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

            if (active && socket.connected) {
              socket.emit("answer", {
                target: sender,
                answer: pc.localDescription,
              });

              console.log("Answer sent to:", sender);
            }
          } catch (err) {
            console.error("Error handling offer:", err);

            if (active) {
              setError("Could not establish the video connection.");
            }
          }
        });

        // Receive an answer to our offer.
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

        // Exchange ICE candidates.
        socket.on("ice-candidate", async ({ sender, candidate }) => {
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
        });

        // Remove a participant who leaves.
        socket.on("peer-left", (data) => {
          const peerId =
            typeof data === "string" ? data : data?.socketId;

          if (!peerId) return;

          console.log("Participant left:", peerId);

          peers[peerId]?.close();
          delete peers[peerId];
          delete pendingCandidates[peerId];

          if (active) {
            setRemoteStreams((previous) => {
              const updated = { ...previous };
              delete updated[peerId];
              return updated;
            });

            setRemoteNames((previous) => {
              const updated = { ...previous };
              delete updated[peerId];
              return updated;
            });

            setStatus("A participant left the meeting.");
          }
        });
      } catch (err) {
        console.error("Could not start meeting:", err);

        if (active) {
          setError(
            err.name === "NotAllowedError"
              ? "Camera or microphone permission was denied. Allow access in browser settings."
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

    // Stop screen sharing first
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });

      screenStreamRef.current = null;
    }

    setScreenSharing(false);

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

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
  };

  }, [meetingId]);

  const toggleCamera = () => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const nextState = !cameraOn;

    stream.getVideoTracks().forEach((track) => {
      track.enabled = nextState;
    });

    setCameraOn(nextState);
  };

  const toggleMic = () => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const nextState = !micOn;

    stream.getAudioTracks().forEach((track) => {
      track.enabled = nextState;
    });

    setMicOn(nextState);
  };
  
  const sendChatMessage = (event) => {
    event?.preventDefault();

    const message = chatInput.trim();
    const socket = socketRef.current;

    if (!message || !socket?.connected) return;

    // Sending a message returns the chat to the latest messages.
    isChatAtBottomRef.current = true;
    setUnreadCount(0);

    socket.emit("chat-message", { message });
    setChatInput("");
  };

  const startScreenShare = async () => {
  try {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError(
        "Screen sharing is not supported in this browser. Use a supported browser on localhost or HTTPS."
      );
      return;
    }

    const screenStream =
      await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

    const screenTrack = screenStream.getVideoTracks()[0];

    if (!screenTrack) {
      screenStream.getTracks().forEach((track) => track.stop());
      return;
    }

    screenStreamRef.current = screenStream;

    // Show the shared screen in your own video tile.
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = screenStream;
    }

    // Replace the camera video track for every connected participant.
    const peers = peerConnectionsRef.current;

    for (const pc of Object.values(peers)) {
      const sender = pc
        .getSenders()
        .find((item) => item.track?.kind === "video");

      if (sender) {
        await sender.replaceTrack(screenTrack);
      }
    }

    screenTrack.onended = () => {
      stopScreenShare();
    };

    setScreenSharing(true);
    setError("");
    setStatus("You are sharing your screen.");
  } catch (err) {
    console.error("Screen sharing failed:", err);

    if (err.name !== "NotAllowedError") {
      setError("Could not start screen sharing. Please try again.");
    }
  }
};

const stopScreenShare = async () => {
  const screenStream = screenStreamRef.current;

  if (!screenStream) return;

  // Stop the display capture.
  screenStream.getTracks().forEach((track) => {
    track.onended = null;
    track.stop();
  });

  screenStreamRef.current = null;

  const cameraTrack = localStreamRef.current
    ?.getVideoTracks()[0];

  // Restore the original camera for every participant.
  for (const pc of Object.values(peerConnectionsRef.current)) {
    const sender = pc
      .getSenders()
      .find((item) => item.track?.kind === "video");

    if (sender) {
      await sender.replaceTrack(cameraTrack || null);
    }
  }

  // Restore the local camera preview.
  if (localVideoRef.current) {
    localVideoRef.current.srcObject =
      localStreamRef.current;
  }

  setScreenSharing(false);
  setStatus("Screen sharing stopped.");
  };

  const copyMeetingLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);

      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Could not copy meeting link:", err);
      setError(
        "Could not copy the link. Please copy it from the address bar."
      );
    }
  };

  const leaveMeeting = () => {
    socketRef.current?.disconnect();
    navigate("/dashboard");
  };

  if (!meetingId) {
    return (
      <div style={styles.page}>
        <div style={styles.lobby}>
          <h1 style={styles.logo}>ConnectX</h1>

          <p style={styles.subtitle}>
            Connect with people, anywhere.
          </p>

          <input
            style={styles.input}
            type="text"
            placeholder="Your display name"
            maxLength={40}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />

          <button
            style={styles.secondaryButton}
            onClick={() => {
              const name = displayName.trim().slice(0, 40);

              if (!name) {
                setError("Please enter your display name.");
                return;
              }

              localStorage.setItem("connectx_display_name", name);
              createMeeting();
            }}
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

          {error && <p style={styles.error}>{error}</p>}

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

          <p style={styles.meetingInfo}>
            Your name: <strong>{displayName || "You"}</strong>
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

        {error && <div style={styles.error}>{error}</div>}

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
              {displayName || "You"}
              {!micOn && " (Mic off)"}
              {!cameraOn && " — Camera off"}
            </div>

            {!cameraOn && (
              <div style={styles.videoOverlay}>
                Camera Off
              </div>
            )}
          </div>

          {Object.entries(remoteStreams).map(([peerId, stream]) => (
            <RemoteVideo
              key={peerId}
              stream={stream}
              name={remoteNames[peerId] || "Participant"}
            />
          ))}
        </div>

        {Object.keys(remoteStreams).length === 0 && (
          <p style={styles.waiting}>
            Waiting for another participant to connect...
          </p>
        )}

        <p style={styles.participantCount}>
          Participants connected: {Object.keys(remoteStreams).length + 1}
        </p>

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
            style={{
              ...styles.controlButton,
              background: screenSharing ? "#b42318" : "#176b45",
            }}
            onClick={
              screenSharing ? stopScreenShare : startScreenShare
            }
          >
            {screenSharing ? "Stop Sharing" : "Share Screen"}
          </button>

          <button
            style={styles.leaveButton}
            onClick={leaveMeeting}
          >
            Leave Meeting
          </button>
        </div>

        
        
        <div style={styles.chatPanel}>
          <div style={styles.chatHeader}>
            <div>
              <h2 style={styles.chatTitle}>Meeting Chat</h2>
              <p style={styles.chatSubtitle}>
                Chat with everyone in this meeting
              </p>
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                style={styles.unreadButton}
                onClick={() => {
                  isChatAtBottomRef.current = true;
                  const container = chatMessagesContainerRef.current;
                  if (container) {
                    container.scrollTo({
                      top: container.scrollHeight,
                      behavior: "smooth",
                    });
                  }
                  setUnreadCount(0);
                }}
              >
                ↓ {unreadCount} new
              </button>
            )}
          </div>

          <div
            ref={chatMessagesContainerRef}
            style={styles.chatMessages}
            onScroll={(event) => {
              const element = event.currentTarget;
              const distanceFromBottom =
                element.scrollHeight - element.scrollTop - element.clientHeight;
              const atBottom = distanceFromBottom <= 40;

              isChatAtBottomRef.current = atBottom;

              // Clear unread only when the user reaches the latest messages.
              if (atBottom) setUnreadCount(0);
            }}
          >
            {chatMessages.map((item) => {
              const isMine =
                item.senderId === socketRef.current?.id;

              return (
                <div
                  key={item.id}
                  style={{
                    ...styles.chatMessageRow,
                    justifyContent: isMine ? "flex-end" : "flex-start",
                  }}
                >
                  <div
                    style={{
                      ...styles.chatMessage,
                      ...(isMine
                        ? styles.ownChatMessage
                        : styles.otherChatMessage),
                    }}
                  >
                    <div style={styles.chatMessageHeader}>
                      <strong style={styles.chatSender}>
                        {isMine ? "You" : item.name}
                      </strong>

                      <small style={styles.chatTime}>
                        {new Date(item.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </small>
                    </div>

                    <p style={styles.chatText}>{item.message}</p>
                  </div>
                </div>
              );
            })}

            {chatMessages.length === 0 && (
              <div style={styles.chatEmpty}>
                <div style={styles.chatEmptyIcon}>✉</div>
                <strong>No messages yet</strong>
                <p>Send a message to start the conversation.</p>
              </div>
            )}

          </div>

          <form onSubmit={sendChatMessage} style={styles.chatForm}>
            <input
              style={styles.chatInput}
              type="text"
              maxLength={1000}
              placeholder="Write a message..."
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
            />

            <button
              type="submit"
              style={styles.chatSendButton}
              disabled={!chatInput.trim()}
            >
              Send
            </button>
          </form>

          <p style={styles.chatFooter}>
            Messages are shared with meeting participants.
          </p>
        </div>

      </main>
    </div>
  );
}

function RemoteVideo({ stream, name }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;

    if (!video || !stream) return;

    video.srcObject = stream;

    video.play().catch((err) => {
      console.warn("Remote video autoplay was blocked:", err);
    });

    return () => {
      video.srcObject = null;
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

      <div style={styles.videoLabel}>{name}</div>
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
    marginBottom: "6px",
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
  participantCount: {
    textAlign: "center",
    color: "#c2cce0",
    marginTop: "20px",
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
    marginTop: "10px",
  },
  backButton: {
    marginTop: "20px",
    background: "transparent",
    border: "none",
    color: "#a9c8ff",
    cursor: "pointer",
  },
  
  
  chatPanel: {
    width: "100%",
    maxWidth: "800px",
    margin: "32px auto 0",
    padding: "20px",
    boxSizing: "border-box",
    background: "#151e30",
    border: "1px solid #344158",
    borderRadius: "16px",
  },
  chatHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
    paddingBottom: "14px",
    borderBottom: "1px solid #344158",
  },
  chatTitle: {
    margin: 0,
    color: "#ffffff",
    fontSize: "21px",
  },
  chatSubtitle: {
    margin: "6px 0 0",
    color: "#aab6ca",
    fontSize: "13px",
  },
  unreadButton: {
    border: "1px solid #3478f6",
    borderRadius: "20px",
    background: "#203b68",
    color: "#ffffff",
    padding: "8px 12px",
    cursor: "pointer",
  },
  chatMessages: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    height: "320px",
    overflowY: "auto",
    padding: "16px 4px",
    overscrollBehavior: "contain",
  },
  chatMessageRow: {
    display: "flex",
    width: "100%",
    flexShrink: 0,
  },
  chatMessage: {
    maxWidth: "80%",
    minWidth: "80px",
    padding: "10px 13px",
    borderRadius: "14px",
    overflowWrap: "anywhere",
    boxSizing: "border-box",
  },
  ownChatMessage: {
    background: "#2458a6",
    borderBottomRightRadius: "4px",
  },
  otherChatMessage: {
    background: "#263449",
    borderBottomLeftRadius: "4px",
  },
  chatMessageHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "16px",
  },
  chatSender: {
    color: "#d9e7ff",
    fontSize: "12px",
  },
  chatTime: {
    color: "#b6c4da",
    fontSize: "10px",
    flexShrink: 0,
  },
  chatText: {
    margin: "8px 0 0",
    color: "#ffffff",
    fontSize: "14px",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  chatEmpty: {
    flex: 1,
    minHeight: "200px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    color: "#aab6ca",
    textAlign: "center",
    gap: "8px",
  },
  chatEmptyIcon: {
    fontSize: "30px",
    marginBottom: "4px",
  },
  chatForm: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    paddingTop: "14px",
    borderTop: "1px solid #344158",
  },
  chatInput: {
    flex: 1,
    minWidth: 0,
    padding: "13px 14px",
    borderRadius: "10px",
    border: "1px solid #465773",
    background: "#0b1120",
    color: "#ffffff",
    outline: "none",
    fontSize: "14px",
  },
  chatSendButton: {
    padding: "13px 18px",
    border: "none",
    borderRadius: "10px",
    background: "#3478f6",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: "bold",
  },
  chatFooter: {
    color: "#8290a8",
    fontSize: "11px",
    textAlign: "center",
    margin: "12px 0 0",
  },

};