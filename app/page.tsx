'use client'

import { useMemo, useState } from "react";

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
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("idle");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [connectionRtt, setConnectionRtt] = useState<number | undefined>(
    undefined
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [key, setKey] = useState(0); // To force re-render of video element

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
    setRtspUrl(rtspSampleUrl);
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
        padding: "2rem 1rem 3rem",
        gap: "2rem",
        boxSizing: "border-box",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 900,
          display: "flex",
          flexDirection: "column",
          gap: "1.5rem",
          borderRadius: 12,
          padding: "1.5rem",
          border: "1px solid rgba(0,0,0,0.1)",
          backgroundColor: "rgba(255,255,255,0.02)",
        }}
      >
        <h1
          style={{
            fontSize: "1.75rem",
            fontWeight: 600,
          }}
        >
          Camera Streaming
        </h1>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
          }}
        >
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.4rem",
              fontSize: "0.95rem",
            }}
          >
            <span>Camera stream URL</span>
            <input
              type="text"
              placeholder="rtsp://host:554/path"
              value={rtspUrl}
              onChange={(event) => setRtspUrl(event.target.value)}
              style={{
                padding: "0.6rem 0.75rem",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                fontSize: "0.95rem",
                fontFamily: "inherit",
              }}
            />
          </label>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.5rem",
              alignItems: "center",
            }}
          >
            <button
              onClick={handleTestConnection}
              disabled={!isRtspValid}
              style={{
                padding: "0.5rem 0.9rem",
                borderRadius: 999,
                border: "none",
                fontSize: "0.9rem",
                cursor: !isRtspValid ? "not-allowed" : "pointer",
                backgroundColor: !isRtspValid ? "#9ca3af" : "#2563eb",
                color: "#fff",
              }}
            >
              Test connection
            </button>
            {!isPlaying ? (
              <button
                onClick={handleStartStream}
                disabled={!isRtspValid}
                style={{
                  padding: "0.5rem 0.9rem",
                  borderRadius: 999,
                  border: "none",
                  fontSize: "0.9rem",
                  cursor: !isRtspValid ? "not-allowed" : "pointer",
                  backgroundColor: !isRtspValid ? "#9ca3af" : "#16a34a",
                  color: "#fff",
                }}
              >
                Start stream
              </button>
            ) : (
                <button
                onClick={handleStopStream}
                style={{
                  padding: "0.5rem 0.9rem",
                  borderRadius: 999,
                  border: "none",
                  fontSize: "0.9rem",
                  cursor: "pointer",
                  backgroundColor: "#dc2626",
                  color: "#fff",
                }}
              >
                Stop stream
              </button>
            )}
            <button
              onClick={handleUseSampleRtsp}
              style={{
                padding: "0.45rem 0.8rem",
                borderRadius: 999,
                border: "1px solid #d1d5db",
                fontSize: "0.85rem",
                cursor: "pointer",
                backgroundColor: "transparent",
              }}
            >
              Use sample RTSP URL
            </button>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.75rem",
              alignItems: "center",
              fontSize: "0.85rem",
            }}
          >
            <div>
              <strong>Status:</strong> {connectionStatus === "ready" ? "Reachable" : connectionStatus}
            </div>
            {connectionRtt !== undefined && (
              <div>
                <strong>RTT:</strong> {connectionRtt} ms
              </div>
            )}
            {connectionMessage && (
                <div style={{ color: connectionStatus === "error" ? "#dc2626" : "green" }}>
                    {connectionMessage}
                </div>
            )}
          </div>
        </div>
      </section>

      <section
        style={{
          width: "100%",
          maxWidth: 900,
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          borderRadius: 12,
          padding: "1.5rem",
          border: "1px solid rgba(0,0,0,0.1)",
          backgroundColor: "#000",
          color: "#fff",
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
                style={{ width: "100%", height: "100%" }}
              />
            ) : (
                <div
                    style={{
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#9ca3af",
                        background: "rgba(255,255,255,0.1)"
                    }}
                >
                    Ready to stream
                </div>
            )}
        </div>
      </section>
    </main>
  );
}
