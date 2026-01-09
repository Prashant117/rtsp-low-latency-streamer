'use client'

import { useMemo, useState, useEffect } from "react";

type ConnectionStatus =
  | "idle"
  | "validating"
  | "testing"
  | "ready"
  | "error";

type RtspTestResult = {
  ok: boolean;
  message?: string;
  roundTripMs?: number;
};

const rtspSampleUrl =
  "http://192.168.0.175:8080/video";

function isValidStreamUrl(value: string) {
  if (!value.trim()) return false;
  try {
    const url = new URL(value);
    if (!url.hostname) return false;
    return true;
  } catch {
    return false;
  }
}

export default function Home() {
  const [rtspUrl, setRtspUrl] = useState("");
  const [newCameraUrl, setNewCameraUrl] = useState("");
  const [cameras, setCameras] = useState<string[]>([]);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("idle");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [connectionRtt, setConnectionRtt] = useState<number | undefined>(
    undefined
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [key, setKey] = useState(0); // To force re-render of video element
  const [isLoaded, setIsLoaded] = useState(false); // Flag to prevent saving empty initial state

  // Load cameras from localStorage on mount
  useEffect(() => {
    const savedCameras = localStorage.getItem("rtsp_cameras");
    if (savedCameras) {
      try {
        setCameras(JSON.parse(savedCameras));
      } catch (e) {
        console.error("Failed to parse saved cameras", e);
      }
    }
    setIsLoaded(true);
  }, []);

  // Save cameras to localStorage whenever they change
  useEffect(() => {
      if (isLoaded) {
          localStorage.setItem("rtsp_cameras", JSON.stringify(cameras));
      }
  }, [cameras, isLoaded]);

  const isRtspValid = useMemo(() => isValidStreamUrl(rtspUrl), [rtspUrl]);

  async function handleTestConnection() {
    if (!isRtspValid) return;
    setConnectionStatus("testing");
    setConnectionMessage("");
    setConnectionRtt(undefined);
    try {
      const started = performance.now();
      const response = await fetch("/api/rtsp/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: rtspUrl }),
      });
      const elapsed = performance.now() - started;
      const data = (await response.json()) as RtspTestResult;
      if (!response.ok || !data.ok) {
        setConnectionStatus("error");
        setConnectionMessage(
          data.message || "Unable to connect to RTSP endpoint."
        );
        return;
      }
      setConnectionStatus("ready");
      setConnectionMessage(
        data.message || "RTSP endpoint is reachable."
      );
      setConnectionRtt(data.roundTripMs ?? Math.round(elapsed));
    } catch {
      setConnectionStatus("error");
      setConnectionMessage("Network error while testing connection.");
    }
  }

  function handleStartStream() {
    if (!isRtspValid) return;
    setIsPlaying(true);
    setKey(prev => prev + 1); // Force video reload
  }

  function handleStopStream() {
    setIsPlaying(false);
    setKey(prev => prev + 1);
  }

  function handleUseSampleRtsp() {
    if (!cameras.includes(rtspSampleUrl)) {
        setCameras(prev => [...prev, rtspSampleUrl]);
    }
    setRtspUrl(rtspSampleUrl);
  }

  function handleAddCamera() {
      if (!isValidStreamUrl(newCameraUrl)) return;
      if (!cameras.includes(newCameraUrl)) {
          setCameras(prev => [...prev, newCameraUrl]);
          if (!rtspUrl) {
              setRtspUrl(newCameraUrl);
          }
      }
      setNewCameraUrl("");
  }

  const outputUrl = isPlaying
    ? `/api/stream?url=${encodeURIComponent(rtspUrl)}`
    : "";

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "3rem 1.5rem",
        gap: "2.5rem",
        boxSizing: "border-box",
        backgroundColor: "#0f172a",
        color: "#f8fafc",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 900,
          display: "flex",
          flexDirection: "column",
          gap: "1.5rem",
          borderRadius: 16,
          padding: "2rem",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          backgroundColor: "rgba(30, 41, 59, 0.7)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              background: "linear-gradient(to right, #60a5fa, #a78bfa)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              margin: 0,
            }}
          >
            Camera Streaming
          </h1>
          <div style={{ 
            display: "flex", 
            alignItems: "center", 
            gap: "0.5rem", 
            fontSize: "0.85rem",
            backgroundColor: "rgba(0,0,0,0.3)",
            padding: "0.4rem 0.8rem",
            borderRadius: 999
          }}>
             <span style={{ 
               width: 8, 
               height: 8, 
               borderRadius: "50%", 
               backgroundColor: connectionStatus === "ready" ? "#4ade80" : connectionStatus === "error" ? "#ef4444" : "#94a3b8",
               boxShadow: connectionStatus === "ready" ? "0 0 8px #4ade80" : "none"
             }} />
             <span style={{ color: "#e2e8f0" }}>
               {connectionStatus === "ready" ? "System Online" : connectionStatus === "idle" ? "Ready" : connectionStatus}
             </span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          
          {/* Add Camera Section */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label style={{ fontSize: "0.9rem", color: "#94a3b8", fontWeight: 500 }}>
              Add New Camera
            </label>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <input
                type="text"
                placeholder="rtsp://user:password@ip:554/stream"
                value={newCameraUrl}
                onChange={(event) => setNewCameraUrl(event.target.value)}
                style={{
                  flex: 1,
                  padding: "0.75rem 1rem",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.1)",
                  backgroundColor: "rgba(15, 23, 42, 0.6)",
                  color: "#fff",
                  fontSize: "0.95rem",
                  outline: "none",
                  transition: "all 0.2s",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#60a5fa")}
                onBlur={(e) => (e.target.style.borderColor = "rgba(255,255,255,0.1)")}
              />
              <button
                onClick={handleAddCamera}
                disabled={!isValidStreamUrl(newCameraUrl)}
                style={{
                  padding: "0.75rem 1.5rem",
                  borderRadius: 12,
                  border: "none",
                  fontSize: "0.95rem",
                  fontWeight: 600,
                  cursor: !isValidStreamUrl(newCameraUrl) ? "not-allowed" : "pointer",
                  backgroundColor: !isValidStreamUrl(newCameraUrl) ? "#334155" : "#3b82f6",
                  color: !isValidStreamUrl(newCameraUrl) ? "#64748b" : "#fff",
                  transition: "all 0.2s",
                  boxShadow: !isValidStreamUrl(newCameraUrl) ? "none" : "0 4px 12px rgba(59, 130, 246, 0.3)",
                }}
              >
                Add Camera
              </button>
            </div>
          </div>

          {/* Select Camera Section */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
             <label style={{ fontSize: "0.9rem", color: "#94a3b8", fontWeight: 500 }}>
              Active Camera
            </label>
            <div style={{ position: "relative" }}>
              <select
                value={rtspUrl}
                onChange={(e) => {
                  setRtspUrl(e.target.value);
                  setIsPlaying(false);
                  setConnectionStatus("idle");
                  setConnectionMessage("");
                  setConnectionRtt(undefined);
                }}
                style={{
                  width: "100%",
                  appearance: "none",
                  padding: "0.75rem 1rem",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.1)",
                  backgroundColor: "rgba(15, 23, 42, 0.6)",
                  color: "#fff",
                  fontSize: "0.95rem",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="" disabled>Select a camera stream...</option>
                {cameras.map((url) => (
                  <option key={url} value={url}>
                    {url}
                  </option>
                ))}
              </select>
              <div style={{ position: "absolute", right: "1rem", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#64748b" }}>
                ▼
              </div>
            </div>
          </div>

          {/* Controls */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.75rem",
              alignItems: "center",
              marginTop: "0.5rem",
            }}
          >
            <button
              onClick={handleTestConnection}
              disabled={!isRtspValid}
              style={{
                padding: "0.6rem 1.25rem",
                borderRadius: 99,
                border: "1px solid rgba(96, 165, 250, 0.5)",
                fontSize: "0.9rem",
                fontWeight: 600,
                cursor: !isRtspValid ? "not-allowed" : "pointer",
                backgroundColor: "transparent",
                color: !isRtspValid ? "#64748b" : "#60a5fa",
                borderColor: !isRtspValid ? "#334155" : "rgba(96, 165, 250, 0.5)",
                transition: "all 0.2s",
              }}
            >
              Test Connection
            </button>
            {!isPlaying ? (
              <button
                onClick={handleStartStream}
                disabled={!isRtspValid}
                style={{
                  padding: "0.6rem 1.5rem",
                  borderRadius: 99,
                  border: "none",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  cursor: !isRtspValid ? "not-allowed" : "pointer",
                  background: !isRtspValid ? "#334155" : "linear-gradient(135deg, #10b981, #059669)",
                  color: !isRtspValid ? "#64748b" : "#fff",
                  boxShadow: !isRtspValid ? "none" : "0 4px 12px rgba(16, 185, 129, 0.3)",
                  transition: "all 0.2s",
                }}
              >
                Start Stream
              </button>
            ) : (
                <button
                onClick={handleStopStream}
                style={{
                  padding: "0.6rem 1.5rem",
                  borderRadius: 99,
                  border: "none",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  background: "linear-gradient(135deg, #ef4444, #dc2626)",
                  color: "#fff",
                  boxShadow: "0 4px 12px rgba(239, 68, 68, 0.3)",
                  transition: "all 0.2s",
                }}
              >
                Stop Stream
              </button>
            )}
            <button
              onClick={handleUseSampleRtsp}
              style={{
                padding: "0.6rem 1.25rem",
                borderRadius: 99,
                border: "none",
                fontSize: "0.9rem",
                cursor: "pointer",
                backgroundColor: "rgba(255, 255, 255, 0.05)",
                color: "#94a3b8",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#e2e8f0")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#94a3b8")}
            >
              Load Sample Camera
            </button>
          </div>
          
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: "0.5rem", padding: "1rem", backgroundColor: "rgba(0,0,0,0.2)", borderRadius: 12 }}>
             <div style={{ fontSize: "0.85rem", color: "#94a3b8", lineHeight: 1.5 }}>
                Status: <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{connectionMessage || "Idle"}</span>
                {connectionRtt && <span style={{ marginLeft: "1rem", color: "#fbbf24" }}>latency: {connectionRtt}ms</span>}
             </div>
             
             <div style={{ fontSize: "0.8rem", color: "#64748b", display: "flex", gap: "0.5rem" }}>
               <span>Need a stream?</span>
               <a 
                 href="https://www.ispyconnect.com/cameras" 
                 target="_blank" 
                 rel="noopener noreferrer"
                 style={{ color: "#60a5fa", textDecoration: "none" }}
               >
                 Find RTSP URL →
               </a>
             </div>
          </div>
        </div>
      </section>

      <section
        style={{
          width: "100%",
          maxWidth: 900,
          borderRadius: 16,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.1)",
          backgroundColor: "#000",
          boxShadow: isPlaying ? "0 0 40px rgba(96, 165, 250, 0.15)" : "none",
          transition: "box-shadow 0.5s ease"
        }}
      >
        <div style={{ position: "relative", width: "100%", aspectRatio: "16/9" }}>
            {isPlaying ? (
              <video
                key={key}
                src={outputUrl}
                autoPlay
                muted
                playsInline
                controls
                style={{ width: "100%", height: "100%", display: "block" }}
              />
            ) : (
                <div
                    style={{
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "1rem",
                        color: "#475569",
                        background: "radial-gradient(circle at center, rgba(30, 41, 59, 0.5) 0%, rgba(15, 23, 42, 1) 100%)"
                    }}
                >
                    <div style={{ 
                      width: 64, 
                      height: 64, 
                      borderRadius: "50%", 
                      border: "2px dashed #475569", 
                      display: "flex", 
                      alignItems: "center", 
                      justifyContent: "center",
                      opacity: 0.5
                    }}>
                       <div style={{ width: 12, height: 12, backgroundColor: "#475569", borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: "0.95rem", fontWeight: 500, letterSpacing: "0.02em" }}>STREAM OFFLINE</span>
                </div>
            )}
        </div>
      </section>
    </main>
  );
}
