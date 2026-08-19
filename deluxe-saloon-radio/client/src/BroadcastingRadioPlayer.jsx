import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX, Users, Share2, Check, WifiOff, SkipForward, PartyPopper } from "lucide-react";

// Point this at your running server (see server/README).
const SERVER_URL = "https://broadcasting-github-io.onrender.com";
const WS_URL = SERVER_URL.replace(/^http/, "ws");

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// Loads the YouTube IFrame API script once and resolves when it's ready.
let ytApiPromise = null;
function loadYouTubeAPI() {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prevCallback) prevCallback();
      resolve(window.YT);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

export default function BroadcastingRadioPlayer() {
  const playerRef = useRef(null); // YT.Player instance
  const playerReadyRef = useRef(false);
  const ytContainerRef = useRef(null);
  const wsRef = useRef(null);
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [muted, setMuted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [listeners, setListeners] = useState(0);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [displayElapsed, setDisplayElapsed] = useState(0);
  const currentTrackIdRef = useRef(null);
  const pendingSyncRef = useRef(null); // latest sync msg, applied once the player is ready

  // Set up the hidden YouTube player once on mount.
  useEffect(() => {
    let cancelled = false;
    loadYouTubeAPI().then((YT) => {
      if (cancelled || !ytContainerRef.current) return;
      playerRef.current = new YT.Player(ytContainerRef.current, {
        height: "1",
        width: "1",
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1 },
        events: {
          onReady: () => {
            playerReadyRef.current = true;
            if (pendingSyncRef.current) applySync(pendingSyncRef.current);
          },
        },
      });
    });
    return () => {
      cancelled = true;
      playerRef.current?.destroy?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applySync(msg) {
    const player = playerRef.current;
    if (!player || !playerReadyRef.current) {
      pendingSyncRef.current = msg;
      return;
    }
    const trackChanged = currentTrackIdRef.current !== msg.track.id;
    currentTrackIdRef.current = msg.track.id;

    if (trackChanged) {
      if (joined) {
        player.loadVideoById({ videoId: msg.track.id, startSeconds: msg.offset });
      } else {
        player.cueVideoById({ videoId: msg.track.id, startSeconds: msg.offset });
      }
    } else if (joined) {
      const localElapsed = msg.offset + (Date.now() - msg.serverTime) / 1000;
      const current = player.getCurrentTime ? player.getCurrentTime() : 0;
      if (Math.abs(current - localElapsed) > 1.5) {
        player.seekTo(localElapsed, true);
      }
    }
  }

  useEffect(() => {
    let stopped = false;
    let reconnectDelay = 1000;
    let reconnectTimer = null;

    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectDelay = 1000; // reset backoff on a successful connection
      };

      ws.onclose = () => {
        setConnected(false);
        if (stopped) return;
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 1.6, 15000); // back off, cap at 15s
      };

      ws.onerror = () => ws.close();

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type !== "sync") return;

        setListeners(msg.listeners);
        setNowPlaying(msg);
        applySync(msg);
      };
    }

    connect();

    return () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);

  useEffect(() => {
    if (!nowPlaying) return;
    const tick = () => {
      const elapsed = nowPlaying.offset + (Date.now() - nowPlaying.serverTime) / 1000;
      setDisplayElapsed(Math.min(elapsed, nowPlaying.track.duration));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [nowPlaying]);

  // Media Session API — shows lock-screen / notification media controls
  // (title, artist, cover art) and tells the OS this is active media,
  // which helps background playback survive on Android and desktop.
  // Note: this can't override iOS Safari's background-suspension of
  // third-party iframe audio — that's an OS-level restriction.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !nowPlaying) return;
    const t = nowPlaying.track;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      artwork: t.cover ? [{ src: t.cover, sizes: "512x512", type: "image/jpeg" }] : [],
    });
    navigator.mediaSession.playbackState = joined ? "playing" : "none";

    navigator.mediaSession.setActionHandler("play", () => {
      if (!joined) handleJoin();
      else {
        playerRef.current?.unMute?.();
        setMuted(false);
      }
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      playerRef.current?.mute?.();
      setMuted(true);
    });

    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowPlaying, joined]);

  // Dynamic tab title — shows what's playing so the tab is easy to find
  // among others, and reverts once you navigate away.
  useEffect(() => {
    const track = nowPlaying?.track;
    document.title = track ? `♪ ${track.title} — Broadcasting Radio` : "Broadcasting Radio";
    return () => {
      document.title = "Broadcasting Radio";
    };
  }, [nowPlaying]);

  // Only show the "connection lost" banner after a short grace period,
  // so a brief reconnect blip doesn't flash an alarming message.
  const [showOffline, setShowOffline] = useState(false);
  useEffect(() => {
    if (connected) {
      setShowOffline(false);
      return;
    }
    const id = setTimeout(() => setShowOffline(true), 3000);
    return () => clearTimeout(id);
  }, [connected]);

  const [shareCopied, setShareCopied] = useState(false);
  const handleShare = async () => {
    const shareData = {
      title: "Broadcasting Radio",
      text: nowPlaying?.track ? `Listening to "${nowPlaying.track.title}" on Broadcasting Radio — tune in live:` : "Tune in to Broadcasting Radio, live:",
      url: window.location.href,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        // user cancelled the share sheet — no-op
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // clipboard unavailable — nothing more we can do silently
    }
  };

  const handleJoin = () => {
    const player = playerRef.current;
    if (!player || !nowPlaying || !playerReadyRef.current) return;
    setJoining(true);
    const liveElapsed = nowPlaying.offset + (Date.now() - nowPlaying.serverTime) / 1000;
    currentTrackIdRef.current = nowPlaying.track.id;
    player.loadVideoById({ videoId: nowPlaying.track.id, startSeconds: liveElapsed });
    player.unMute();
    setJoined(true);
    setJoining(false);
  };

  const toggleMute = () => {
    const player = playerRef.current;
    if (!player) return;
    if (muted) {
      player.unMute();
    } else {
      player.mute();
    }
    setMuted((m) => !m);
  };

  const track = nowPlaying?.track;
  const nextTrack = nowPlaying?.nextTrack;
  const progressPct = track ? (displayElapsed / track.duration) * 100 : 0;

  // If nothing's arrived after a few seconds, it's very likely a free-tier
  // backend cold start (Render puts idle servers to sleep) rather than a
  // stuck page — say so instead of leaving "Loading…" up indefinitely.
  const [slowStart, setSlowStart] = useState(false);
  useEffect(() => {
    if (nowPlaying) {
      setSlowStart(false);
      return;
    }
    const id = setTimeout(() => setSlowStart(true), 5000);
    return () => clearTimeout(id);
  }, [nowPlaying]);

  const loadingLabel = slowStart
    ? "Waking up the radio server… (can take up to a minute)"
    : "Loading…";

  return (
    <div className={`dsr-root ${!joined ? "is-dim" : ""}`}>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Poppins:wght@400;500;600&display=swap"
      />
      <style>{`
        .dsr-root {
          font-family: 'Poppins', 'Segoe UI', system-ui, -apple-system, sans-serif;
          width: 100%;
          max-width: 880px;
          margin: 0 auto;
          position: relative;
          border-radius: clamp(20px, 3vw, 32px);
          overflow: hidden;
          background: #0b0a10;
          box-shadow: 0 30px 80px rgba(0,0,0,0.6);
          border: 1px solid rgba(255,255,255,0.06);
          padding: clamp(18px, 3vw, 30px);
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          min-height: clamp(480px, 60vw, 620px);
        }
        @media (min-width: 1300px) {
          .dsr-root { max-width: 960px; }
        }

        /* Aurora background — slow-moving blurred gradient blobs */
        .dsr-aurora {
          position: absolute;
          inset: -20%;
          z-index: 0;
          filter: blur(70px);
          opacity: 0.65;
          transition: opacity 0.6s ease;
        }
        .dsr-root.is-dim .dsr-aurora { opacity: 0.28; }
        .dsr-blob {
          position: absolute;
          border-radius: 50%;
        }
        .dsr-blob-1 {
          width: 46%; height: 46%; top: 4%; left: 6%;
          background: #8b5cf6;
          animation: drift1 14s ease-in-out infinite;
        }
        .dsr-blob-2 {
          width: 40%; height: 40%; bottom: 6%; right: 8%;
          background: #f472b6;
          animation: drift2 17s ease-in-out infinite;
        }
        .dsr-blob-3 {
          width: 34%; height: 34%; bottom: 20%; left: 24%;
          background: #fb923c;
          animation: drift3 20s ease-in-out infinite;
        }
        @keyframes drift1 {
          0%,100% { transform: translate(0,0) scale(1); }
          50% { transform: translate(8%, 10%) scale(1.15); }
        }
        @keyframes drift2 {
          0%,100% { transform: translate(0,0) scale(1); }
          50% { transform: translate(-10%, -6%) scale(1.1); }
        }
        @keyframes drift3 {
          0%,100% { transform: translate(0,0) scale(1); }
          50% { transform: translate(6%, -12%) scale(1.2); }
        }

        .dsr-grain {
          position: absolute;
          inset: 0;
          z-index: 1;
          background: rgba(11,10,16,0.35);
          backdrop-filter: blur(60px);
        }

        .dsr-content {
          position: relative;
          z-index: 2;
          display: flex;
          flex-direction: column;
          flex: 1;
        }

        @keyframes pulseGlow { 0%,100% { box-shadow: 0 0 0 0 rgba(126,216,88,0.5);} 50% { box-shadow: 0 0 0 6px rgba(126,216,88,0);} }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes eqA { 0%,100% { height: 5px; } 50% { height: 16px; } }
        @keyframes eqB { 0%,100% { height: 14px; } 50% { height: 4px; } }
        @keyframes eqC { 0%,100% { height: 8px; } 50% { height: 18px; } }
        .dsr-eq span { display:inline-block; width: 3px; border-radius: 2px; background: linear-gradient(180deg, #f472b6, #8b5cf6); }
        .dsr-eq span:nth-child(1){ animation: eqA 0.9s ease-in-out infinite; }
        .dsr-eq span:nth-child(2){ animation: eqB 0.9s ease-in-out infinite 0.15s; }
        .dsr-eq span:nth-child(3){ animation: eqC 0.9s ease-in-out infinite 0.3s; }

        .dsr-wordmark {
          position: relative;
          z-index: 4;
          text-align: center;
          font-family: 'Space Grotesk', 'Poppins', sans-serif;
          font-weight: 700;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          font-size: clamp(14px, 2.4vw, 21px);
          margin: 0 0 clamp(12px, 2.4vw, 18px);
          background: linear-gradient(90deg, #8b5cf6, #f472b6, #fb923c);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          filter: drop-shadow(0 0 10px rgba(244,114,182,0.45)) drop-shadow(0 0 22px rgba(139,92,246,0.3));
          animation: neonPulse 4.5s ease-in-out infinite;
        }
        @keyframes neonPulse {
          0%, 100% { filter: drop-shadow(0 0 10px rgba(244,114,182,0.45)) drop-shadow(0 0 22px rgba(139,92,246,0.3)); }
          50% { filter: drop-shadow(0 0 16px rgba(251,146,60,0.5)) drop-shadow(0 0 30px rgba(139,92,246,0.45)); }
        }

        .dsr-static {
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          opacity: 0.05;
          mix-blend-mode: overlay;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
        }

        .dsr-top-stack {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: clamp(14px, 3vw, 22px);
        }
        .dsr-badge-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .dsr-clock-spacer { margin-right: auto; }
        .dsr-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 7px 13px;
          border-radius: 999px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.08);
          backdrop-filter: blur(10px);
          color: rgba(255,255,255,0.85);
          font-size: clamp(11px, 1.3vw, 13px);
          font-weight: 500;
          white-space: nowrap;
          margin-left: auto;
        }
        .dsr-share-btn {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.06);
          backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
        }
        .dsr-offline {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          border-radius: 12px;
          background: rgba(244,63,94,0.12);
          border: 1px solid rgba(244,63,94,0.3);
          color: #fecdd3;
          font-size: clamp(11px, 1.3vw, 13px);
        }
        .dsr-special {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 10px 14px;
          border-radius: 12px;
          background: linear-gradient(90deg, rgba(139,92,246,0.18), rgba(244,114,182,0.18), rgba(251,146,60,0.18));
          border: 1px solid rgba(255,255,255,0.12);
          color: #fff;
          font-size: clamp(12px, 1.5vw, 14px);
          font-weight: 600;
          text-align: center;
        }

        .dsr-center {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: clamp(14px, 3vw, 20px);
          padding: clamp(6px, 2vw, 14px) 8px;
        }

        .dsr-album-wrap {
          position: relative;
          width: clamp(120px, 26vw, 190px);
          height: clamp(120px, 26vw, 190px);
        }
        .dsr-album-ring {
          position: absolute;
          inset: -8px;
          border-radius: 50%;
          background: conic-gradient(from 0deg, #8b5cf6, #f472b6, #fb923c, #8b5cf6);
          opacity: 0.9;
          filter: blur(1px);
        }
        .dsr-album-ring.spinning { animation: spin 6s linear infinite; }
        .dsr-dial-ticks {
          position: absolute;
          inset: -20px;
          border-radius: 50%;
          background: repeating-conic-gradient(
            rgba(255,255,255,0.35) 0deg 1.2deg,
            transparent 1.2deg 9deg
          );
          -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 6px), #000 100%, transparent 100%);
          mask: radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 6px), #000 100%, transparent 100%);
          opacity: 0.5;
        }
        .dsr-album {
          position: absolute;
          inset: 5px;
          border-radius: 50%;
          background-size: cover;
          background-position: center;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }
        .dsr-album.spinning { animation: spin 8s linear infinite; }
        .dsr-album-dot {
          position: absolute;
          top: 50%; left: 50%;
          width: 22%; height: 22%;
          transform: translate(-50%,-50%);
          border-radius: 50%;
          background: rgba(11,10,16,0.75);
          border: 2px solid rgba(255,255,255,0.2);
        }

        .dsr-title {
          margin: 0;
          font-family: 'Space Grotesk', 'Poppins', sans-serif;
          font-weight: 700;
          font-size: clamp(19px, 3.4vw, 30px);
          line-height: 1.15;
          letter-spacing: -0.01em;
          background: linear-gradient(90deg, #ffffff, #e9d5ff);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          max-width: 90%;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        .dsr-artist {
          margin: 0;
          color: rgba(255,255,255,0.5);
          font-size: clamp(12px, 1.8vw, 15px);
          font-weight: 500;
          max-width: 85%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .dsr-nextup {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 12px;
          border-radius: 999px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.55);
          font-size: clamp(10.5px, 1.2vw, 12px);
          max-width: 92%;
        }
        .dsr-nextup span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .dsr-bottom {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: clamp(10px, 2.5vw, 16px);
        }
        .dsr-progress-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .dsr-progress-track {
          flex: 1;
          height: 4px;
          border-radius: 999px;
          background: rgba(255,255,255,0.1);
          position: relative;
          overflow: hidden;
        }
        .dsr-progress-fill {
          position: absolute;
          left: 0; top: 0; bottom: 0;
          border-radius: 999px;
          background: linear-gradient(90deg, #8b5cf6, #f472b6, #fb923c);
          transition: width 0.9s linear;
        }
        .dsr-time {
          font-size: clamp(10px, 1.2vw, 12px);
          color: rgba(255,255,255,0.4);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          min-width: 62px;
          text-align: right;
        }
        .dsr-controls-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 14px;
        }
        .dsr-icon-btn {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.06);
          backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
        }

        .dsr-join-overlay {
          position: absolute;
          inset: 0;
          z-index: 3;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 16px;
          background: rgba(6,5,10,0.88);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          cursor: pointer;
          text-align: center;
          padding: 20px;
        }
        .dsr-join-circle {
          width: clamp(64px, 10vw, 84px);
          height: clamp(64px, 10vw, 84px);
          border-radius: 50%;
          background: linear-gradient(135deg, #8b5cf6, #f472b6, #fb923c);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 12px 32px rgba(139,92,246,0.4);
        }
        .dsr-join-title {
          margin: 0;
          font-family: 'Space Grotesk', 'Poppins', sans-serif;
          font-weight: 700;
          font-size: clamp(16px, 2.6vw, 22px);
          color: #fff;
        }
        .dsr-join-sub {
          margin: 0;
          color: rgba(255,255,255,0.55);
          font-size: clamp(11.5px, 1.6vw, 14px);
        }
      `}</style>

      <div className="dsr-aurora">
        <div className="dsr-blob dsr-blob-1" />
        <div className="dsr-blob dsr-blob-2" />
        <div className="dsr-blob dsr-blob-3" />
      </div>
      <div className="dsr-grain" />
      <div className="dsr-static" />

      {/* Hidden YouTube player — audio only, no visible video frame */}
      <div style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" }}>
        <div ref={ytContainerRef} />
      </div>

      <p className="dsr-wordmark">Broadcasting Radio</p>

      <div className="dsr-content">
        <div className="dsr-top-stack">
          <div className="dsr-badge-row">
            <div className="dsr-badge">
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: connected ? "#7ed858" : "#8a5a5a",
                  animation: connected ? "pulseGlow 2s ease-out infinite" : "none",
                  flexShrink: 0,
                }}
              />
              <Users size={13} strokeWidth={2.25} style={{ flexShrink: 0 }} />
              <span>{listeners} listening</span>
            </div>
            <button className="dsr-share-btn" onClick={handleShare} aria-label="Share">
              {shareCopied ? <Check size={14} color="#7ed858" /> : <Share2 size={14} color="#fff" />}
            </button>
          </div>

          {showOffline && (
            <div className="dsr-offline">
              <WifiOff size={14} strokeWidth={2.25} style={{ flexShrink: 0 }} />
              <span>Connection lost — reconnecting…</span>
            </div>
          )}

          {nowPlaying?.specialDay?.label && (
            <div className="dsr-special">
              <PartyPopper size={15} strokeWidth={2.25} style={{ flexShrink: 0 }} />
              <span>{nowPlaying.specialDay.label}</span>
            </div>
          )}
        </div>

        <div className="dsr-center">
          <div className="dsr-album-wrap">
            <div className="dsr-dial-ticks" />
            <div className={`dsr-album-ring ${joined ? "spinning" : ""}`} />
            <div
              className={`dsr-album ${joined ? "spinning" : ""}`}
              style={{
                background: track?.cover ? `url(${track.cover}) center/cover, #1a1625` : "linear-gradient(135deg, #8b5cf6, #f472b6)",
              }}
            >
              <div className="dsr-album-dot" />
            </div>
          </div>

          <div>
            <p className="dsr-title">{track ? track.title : loadingLabel}</p>
            <p className="dsr-artist">{track ? track.artist : ""}</p>
          </div>

          {joined && (
            <div className="dsr-eq" style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 18 }}>
              <span style={{ height: 5 }} />
              <span style={{ height: 14 }} />
              <span style={{ height: 8 }} />
            </div>
          )}

          {track && nextTrack && (
            <div className="dsr-nextup">
              <SkipForward size={11} strokeWidth={2.25} style={{ flexShrink: 0, color: "#f472b6" }} />
              <span>Up next: {nextTrack.title} — {nextTrack.artist}</span>
            </div>
          )}
        </div>

        <div className="dsr-bottom">
          <div className="dsr-progress-row">
            <div className="dsr-progress-track">
              <div className="dsr-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <span className="dsr-time">
              {track ? `${formatTime(displayElapsed)} / ${formatTime(track.duration)}` : "0:00 / 0:00"}
            </span>
          </div>

          {joined && (
            <div className="dsr-controls-row">
              <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} className="dsr-icon-btn">
                {muted ? <VolumeX size={17} color="#fff" /> : <Volume2 size={17} color="#fff" />}
              </button>
            </div>
          )}
        </div>
      </div>

      {!joined && track && (
        <div className="dsr-join-overlay" onClick={handleJoin} role="button" tabIndex={0}>
          <div className="dsr-join-circle">
            <div
              style={{
                width: 0,
                height: 0,
                marginLeft: 5,
                borderTop: "13px solid transparent",
                borderBottom: "13px solid transparent",
                borderLeft: "20px solid #ffffff",
              }}
            />
          </div>
          <p className="dsr-join-title">{joining ? "Tuning in…" : "Tune in live"}</p>
          <p className="dsr-join-sub">{listeners} already listening</p>
        </div>
      )}
    </div>
  );
}
