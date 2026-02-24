'use client';

import { useEffect, useMemo, useRef, useState } from "react";

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

/**
 * A specialized Low-Latency Player using Media Source Extensions (MSE).
 * This component fetches fragmented MP4 chunks from the /api/stream endpoint
 * and appends them to a Media Source buffer for real-time playback.
 */
function LowLatencyPlayer({ url }: { url: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Buffer Pruning & Latency Synchronization
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const syncInterval = setInterval(() => {
      if (video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const lag = bufferedEnd - video.currentTime;
        
        // Aggressive sync: If lag > 0.5s, hard-jump to live edge
        if (lag > 0.5) {
          video.currentTime = bufferedEnd - 0.05;
          video.playbackRate = 1.0;
        } 
        // Subtle catch-up: If lag > 0.2s, speed up slightly
        else if (lag > 0.2) {
          video.playbackRate = 1.1;
        } 
        // Normal speed
        else {
          video.playbackRate = 1.0;
        }

        // Keep the video playing if it gets stuck
        if (video.paused && !video.ended && video.readyState >= 2) {
            video.play().catch(() => {});
        }
      }
    }, 200); // Check every 200ms for ultra-responsiveness

    const pruningInterval = setInterval(() => {
        const sb = sourceBufferRef.current;
        if (sb && !sb.updating && video.buffered.length > 0) {
            const start = video.buffered.start(0);
            const end = video.currentTime - 10; // Keep last 10 seconds
            if (end > start) {
                try {
                    sb.remove(start, end);
                } catch {
                }
            }
        }
    }, 30000); // Prune every 30 seconds

    return () => {
      clearInterval(syncInterval);
      clearInterval(pruningInterval);
    };
  }, []);

  useEffect(() => {
    if (!url || !videoRef.current) return;

    const video = videoRef.current;
    mediaSourceRef.current = new MediaSource();
    video.src = URL.createObjectURL(mediaSourceRef.current);

    const onSourceOpen = async () => {
      URL.revokeObjectURL(video.src);
      
      const mimeType = 'video/mp4; codecs="avc1.42E01E"';
      if (!MediaSource.isTypeSupported(mimeType)) {
        setError("Browser does not support the required video codec.");
        return;
      }

      const ms = mediaSourceRef.current!;
      const sb = ms.addSourceBuffer(mimeType);
      sourceBufferRef.current = sb;

      const queue: Uint8Array[] = [];
      sb.addEventListener('updateend', () => {
        if (queue.length > 0 && !sb.updating) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sb.appendBuffer(queue.shift()! as any);
        }
      });

      abortControllerRef.current = new AbortController();
      try {
        const response = await fetch(url, {
          signal: abortControllerRef.current.signal,
        });

        if (!response.body) throw new Error("ReadableStream not supported");
        const reader = response.body.getReader();
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (sb.updating || queue.length > 0) {
            queue.push(value);
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sb.appendBuffer(value as any);
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error("Stream fetch error:", err);
          setError("Failed to fetch video stream.");
        }
      }
    };

    mediaSourceRef.current.addEventListener('sourceopen', onSourceOpen);

    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (mediaSourceRef.current && mediaSourceRef.current.readyState === 'open') {
        mediaSourceRef.current.removeEventListener('sourceopen', onSourceOpen);
        if (sourceBufferRef.current) {
          try {
            mediaSourceRef.current.removeSourceBuffer(sourceBufferRef.current);
          } catch {}
        }
        mediaSourceRef.current.endOfStream();
      }
      if (video.src) {
        URL.revokeObjectURL(video.src);
        video.src = "";
      }
    };
  }, [url]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {error && (
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(0,0,0,0.8)",
          color: "#ef4444",
          zIndex: 10,
          padding: "1rem",
          textAlign: "center"
        }}>
          {error}
        </div>
      )}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        controls
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
    </div>
  );
}

export default function Home() {
  const [rtspUrl, setRtspUrl] = useState(() => {
    if (typeof window === "undefined") return "";
    const saved = window.localStorage.getItem("rtsp_cameras");
    if (!saved) return "";
    try {
      const parsed = JSON.parse(saved) as string[];
      return parsed.length > 0 ? parsed[0] : "";
    } catch {
      return "";
    }
  });
  const [newCameraUrl, setNewCameraUrl] = useState("");
  const [cameras, setCameras] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    const saved = window.localStorage.getItem("rtsp_cameras");
    if (!saved) return [];
    try {
      return JSON.parse(saved) as string[];
    } catch {
      return [];
    }
  });
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("idle");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [connectionRtt, setConnectionRtt] = useState<number | undefined>(
    undefined
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [key, setKey] = useState(0); // To force re-render of video element

  // Removed useEffect for loading from localStorage as it's now in initializers

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



  function handleAddCamera() {
    if (!isValidStreamUrl(newCameraUrl)) return;
    if (!cameras.includes(newCameraUrl)) {
      const next = [...cameras, newCameraUrl];
      setCameras(next);
      if (!rtspUrl) {
        setRtspUrl(newCameraUrl);
      }
      if (typeof window !== "undefined") {
        window.localStorage.setItem("rtsp_cameras", JSON.stringify(next));
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
                onFocus={(e) => { e.target.style.borderColor = "#60a5fa" }}
                onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.1)" }}
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
              <LowLatencyPlayer key={key} url={outputUrl} />
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
