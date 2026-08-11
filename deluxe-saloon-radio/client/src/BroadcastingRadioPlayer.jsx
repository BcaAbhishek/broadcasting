import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX, Users, AlertTriangle, X } from "lucide-react";

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
  const [showNotice, setShowNotice] = useState(true);
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
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type !== "sync") return;

      setListeners(msg.listeners);
      setNowPlaying(msg);
      applySync(msg);
    };

    return () => ws.close();
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
  const progressPct = track ? (displayElapsed / track.duration) * 100 : 0;

  return (
    <div className="dsr-root">
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Bebas+Neue&display=swap"
      />
      <style>{`
        .dsr-root {
          font-family: 'Poppins', 'Segoe UI', system-ui, -apple-system, sans-serif;
          width: 100%;
          max-width: 880px;
          margin: 0 auto;
          position: relative;
          border-radius: clamp(14px, 3vw, 22px);
          overflow: hidden;
          aspect-ratio: 16 / 15;
          box-shadow: 0 24px 70px rgba(15,8,3,0.5);
          background: #2a1608;
        }
        @media (max-width: 480px) {
          .dsr-root { aspect-ratio: 3 / 4; border-radius: 16px; }
        }
        @media (min-width: 1300px) {
          .dsr-root { max-width: 960px; }
        }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes drift1 { 0% { transform: translate(0,0); opacity:0; } 15% { opacity:0.5; } 100% { transform: translate(30px,-90px); opacity:0; } }
        @keyframes drift2 { 0% { transform: translate(0,0); opacity:0; } 15% { opacity:0.4; } 100% { transform: translate(-24px,-110px); opacity:0; } }
        @keyframes pulseGlow { 0%,100% { box-shadow: 0 0 0 0 rgba(126,216,88,0.5);} 50% { box-shadow: 0 0 0 6px rgba(126,216,88,0);} }
        @keyframes waveOut { 0% { transform: scale(0.85); opacity: 0.5; } 100% { transform: scale(1.35); opacity: 0; } }
        @keyframes eqA { 0%,100% { height: 4px; } 50% { height: 12px; } }
        @keyframes eqB { 0%,100% { height: 10px; } 50% { height: 3px; } }
        @keyframes eqC { 0%,100% { height: 6px; } 50% { height: 14px; } }
        .dsr-eq span { display:inline-block; width: clamp(2.5px, 0.6vw, 3px); background:#e8a13a; border-radius:2px; }
        .dsr-eq span:nth-child(1){ animation: eqA 0.9s ease-in-out infinite; }
        .dsr-eq span:nth-child(2){ animation: eqB 0.9s ease-in-out infinite 0.15s; }
        .dsr-eq span:nth-child(3){ animation: eqC 0.9s ease-in-out infinite 0.3s; }

        .dsr-badge {
          position: absolute;
          top: clamp(10px, 2.5vw, 18px);
          right: clamp(10px, 2.5vw, 18px);
          display: flex;
          align-items: center;
          gap: 6px;
          padding: clamp(5px, 1.2vw, 6px) clamp(10px, 2.5vw, 13px);
          border-radius: 999px;
          background: rgba(15,8,3,0.42);
          backdrop-filter: blur(6px);
          color: rgba(255,246,232,0.92);
          font-size: clamp(10.5px, 1.4vw, 14px);
          font-weight: 500;
          white-space: nowrap;
        }

        .dsr-notice {
          position: absolute;
          top: clamp(10px, 2.5vw, 18px);
          left: clamp(10px, 2.5vw, 18px);
          right: clamp(10px, 2.5vw, 18px);
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: clamp(8px, 1.4vw, 13px) clamp(10px, 1.6vw, 16px);
          border-radius: 12px;
          background: rgba(28,16,8,0.72);
          backdrop-filter: blur(6px);
          border: 1px solid rgba(232,161,58,0.35);
          color: rgba(255,246,232,0.92);
          font-size: clamp(10.5px, 1.4vw, 14px);
          line-height: 1.5;
          z-index: 5;
        }
        .dsr-notice-close {
          border: none;
          background: rgba(255,255,255,0.1);
          width: 20px;
          height: 20px;
          min-width: 20px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
          margin-left: auto;
        }

        .dsr-pill {
          position: absolute;
          left: clamp(10px, 2.5vw, 18px);
          right: clamp(10px, 2.5vw, 18px);
          bottom: clamp(10px, 2.5vw, 18px);
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(24,13,6,0.85) 0%, rgba(42,20,8,0.75) 100%);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border: 1px solid rgba(255,255,255,0.08);
          padding: clamp(7px, 1.4vw, 15px) clamp(10px, 1.8vw, 22px) clamp(7px, 1.4vw, 15px) clamp(6px, 1.2vw, 14px);
          display: flex;
          align-items: center;
          gap: clamp(8px, 1.4vw, 16px);
          transition: opacity 0.4s ease;
        }

        .dsr-album {
          width: clamp(42px, 6vw, 72px);
          height: clamp(42px, 6vw, 72px);
          border-radius: 50%;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.35);
        }

        .dsr-title { margin: 0; color: #fbf3e6; font-size: clamp(12.5px, 1.8vw, 20px); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dsr-artist { margin: 1px 0 0; color: rgba(251,243,230,0.62); font-size: clamp(10.5px, 1.4vw, 15px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dsr-time { font-size: clamp(9.5px, 1.1vw, 13px); color: rgba(251,243,230,0.55); font-variant-numeric: tabular-nums; white-space: nowrap; }

        .dsr-icon-btn {
          width: clamp(30px, 4.5vw, 42px);
          height: clamp(30px, 4.5vw, 42px);
          min-width: 30px;
          min-height: 30px;
          border-radius: 50%;
          border: none;
          background: rgba(255,255,255,0.12);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
        }

        .dsr-join-circle {
          width: clamp(52px, 8vw, 92px);
          height: clamp(52px, 8vw, 92px);
          border-radius: 50%;
          background: #fbf3e6;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        }
        .dsr-join-title { margin: 0; color: #fbf3e6; font-size: clamp(13px, 2vw, 20px); font-weight: 600; text-align: center; padding: 0 12px; }
        .dsr-join-sub { margin: 0; color: rgba(251,243,230,0.65); font-size: clamp(11px, 1.5vw, 16px); }
      `}</style>
      {/* Hidden YouTube player — audio only, no visible video frame */}
      <div style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" }}>
        <div ref={ytContainerRef} />
      </div>

      <Scene dim={!joined} />

      {joined && (
        <>
          <span style={{ position: "absolute", left: "58%", top: "62%", width: 3, height: 3, borderRadius: "50%", background: "#f5d99a", animation: "drift1 6s linear infinite" }} />
          <span style={{ position: "absolute", left: "68%", top: "58%", width: 2, height: 2, borderRadius: "50%", background: "#f5d99a", animation: "drift2 7.5s linear infinite 1.2s" }} />
          <span style={{ position: "absolute", left: "50%", top: "66%", width: 2.5, height: 2.5, borderRadius: "50%", background: "#f5d99a", animation: "drift1 8.2s linear infinite 3s" }} />
        </>
      )}

      {showNotice && (
        <div className="dsr-notice">
          <AlertTriangle size={15} strokeWidth={2.25} style={{ flexShrink: 0, marginTop: 1, color: "#e8a13a" }} />
          <span>
            Heads up — a few tracks may glitch out and play with no sound.
            If that happens, just wait for the next song, or refresh the page —
            your listening picks back up right where the broadcast is.
          </span>
          <button
            className="dsr-notice-close"
            aria-label="Dismiss notice"
            onClick={() => setShowNotice(false)}
          >
            <X size={12} color="#fbf3e6" />
          </button>
        </div>
      )}

      <div className="dsr-badge" style={{ top: showNotice ? "auto" : undefined, bottom: showNotice ? "calc(clamp(10px, 2.5vw, 18px) + 78px)" : "auto" }}>
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

      {!joined && track && (
        <div
          onClick={handleJoin}
          role="button"
          tabIndex={0}
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            background: "rgba(10,6,2,0.55)",
            cursor: "pointer",
          }}
        >
          <div className="dsr-join-circle">
            <div
              style={{
                width: 0,
                height: 0,
                marginLeft: 5,
                borderTop: "12px solid transparent",
                borderBottom: "12px solid transparent",
                borderLeft: "18px solid #6b3f16",
              }}
            />
          </div>
          <p className="dsr-join-title">{joining ? "Tuning in…" : "Tune in live"}</p>
          <p className="dsr-join-sub">{listeners} already listening</p>
        </div>
      )}

      <div className="dsr-pill" style={{ opacity: joined ? 1 : 0.5 }}>
        <AlbumArt cover={track?.cover || null} spinning={joined} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p className="dsr-title">{track ? track.title : "Loading…"}</p>
              <p className="dsr-artist">{track ? track.artist : ""}</p>
            </div>

            {joined && (
              <div className="dsr-eq" style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 14, marginRight: 2, flexShrink: 0 }}>
                <span style={{ height: 4 }} />
                <span style={{ height: 10 }} />
                <span style={{ height: 6 }} />
              </div>
            )}

            {joined && (
              <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} className="dsr-icon-btn">
                {muted ? <VolumeX size={15} color="#fbf3e6" /> : <Volume2 size={15} color="#fbf3e6" />}
              </button>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
            <div style={{ flex: 1, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.16)", position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${progressPct}%`,
                  borderRadius: 999,
                  background: "#e8a13a",
                  transition: "width 0.9s linear",
                }}
              />
            </div>
            <span className="dsr-time" style={{ minWidth: 60, textAlign: "right" }}>
              {track ? `${formatTime(displayElapsed)} / ${formatTime(track.duration)}` : "0:00 / 0:00"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AlbumArt({ cover, spinning }) {
  return (
    <div
      className="dsr-album"
      style={{
        background: cover
          ? `url(${cover}) center/cover, #1a0e08`
          : "radial-gradient(circle, #d9a441 0%, #d9a441 22%, #1a0e08 23%, #1a0e08 100%)",
        animation: spinning ? "spin 4.5s linear infinite" : "none",
      }}
    >
      <div
        style={{
          width: "27%",
          height: "27%",
          borderRadius: "50%",
          background: "rgba(20,10,6,0.55)",
          border: "2px solid rgba(255,255,255,0.25)",
        }}
      />
    </div>
  );
}

// Flat-illustration backdrop: a warm listening room with a vintage
// broadcast radio set as the centerpiece, plus a wordmark plaque on top.
function Scene({ dim }) {
  return (
    <svg
      viewBox="0 0 720 675"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid slice"
      style={{
        position: "absolute",
        inset: 0,
        display: "block",
        filter: dim ? "brightness(0.55) saturate(0.7)" : "brightness(1) saturate(1)",
        transition: "filter 0.6s ease",
      }}
    >
      {/* room walls */}
      <rect x="0" y="0" width="720" height="675" fill="#4a2c18" />
      <rect x="0" y="0" width="720" height="675" fill="#2e1810" opacity="0.35" />
      <rect x="0" y="480" width="720" height="195" fill="#1c1008" />

      {/* warm glow behind the radio */}
      <circle cx="360" cy="400" r="230" fill="#e8a13a" opacity="0.10" />
      <circle cx="360" cy="400" r="160" fill="#e8a13a" opacity="0.10" />

      {/* wordmark plaque */}
      <rect x="55" y="34" width="610" height="104" rx="10" fill="#1c1008" opacity="0.35" />
      <rect x="48" y="26" width="610" height="104" rx="10" fill="#c1622c" />
      <rect x="48" y="26" width="610" height="104" rx="10" fill="none" stroke="#2e1810" strokeWidth="4" />
      <text
        x="360"
        y="97"
        textAnchor="middle"
        fontFamily="'Bebas Neue', sans-serif"
        fontSize="58"
        letterSpacing="4"
        fill="#fbf3e6"
      >
        BROADCASTING RADIO
      </text>

      {/* floor rug under the set */}
      <ellipse cx="360" cy="560" rx="230" ry="40" fill="#7a2a1f" opacity="0.4" />

      {/* sound wave arcs from the speaker */}
      <g opacity={dim ? 0 : 1} style={{ transition: "opacity 0.6s ease" }}>
        <path d="M 275 400 a 55 55 0 0 1 0 -90" fill="none" stroke="#f5d99a" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
        <path d="M 258 400 a 75 75 0 0 1 0 -130" fill="none" stroke="#f5d99a" strokeWidth="3" strokeLinecap="round" opacity="0.3" />
      </g>

      {/* --- vintage radio set --- */}
      <g transform="translate(220,255)">
        {/* legs */}
        <rect x="20" y="238" width="16" height="26" rx="4" fill="#2e1810" />
        <rect x="244" y="238" width="16" height="26" rx="4" fill="#2e1810" />

        {/* body */}
        <rect x="0" y="0" width="280" height="245" rx="26" fill="#6b4423" />
        <rect x="0" y="0" width="280" height="245" rx="26" fill="none" stroke="#3a2414" strokeWidth="5" />

        {/* inner brass panel */}
        <rect x="20" y="20" width="240" height="170" rx="14" fill="#caa15a" />

        {/* speaker grille */}
        <circle cx="80" cy="105" r="58" fill="#241408" />
        <circle cx="80" cy="105" r="46" fill="none" stroke="#caa15a" strokeWidth="3" opacity="0.5" />
        <circle cx="80" cy="105" r="32" fill="none" stroke="#caa15a" strokeWidth="3" opacity="0.4" />
        <circle cx="80" cy="105" r="18" fill="none" stroke="#caa15a" strokeWidth="3" opacity="0.35" />

        {/* dial */}
        <circle cx="196" cy="90" r="42" fill="#f5e6d0" stroke="#241408" strokeWidth="5" />
        {Array.from({ length: 10 }).map((_, i) => {
          const angle = (i / 9) * Math.PI * 1.3 - Math.PI * 1.15;
          const x1 = 196 + Math.cos(angle) * 32;
          const y1 = 90 + Math.sin(angle) * 32;
          const x2 = 196 + Math.cos(angle) * 40;
          const y2 = 90 + Math.sin(angle) * 40;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#241408" strokeWidth="2.5" />;
        })}
        <line x1="196" y1="90" x2="222" y2="72" stroke="#c1622c" strokeWidth="4" strokeLinecap="round" />
        <circle cx="196" cy="90" r="5" fill="#241408" />

        {/* knobs */}
        <circle cx="70" cy="215" r="17" fill="#241408" />
        <circle cx="70" cy="215" r="17" fill="none" stroke="#caa15a" strokeWidth="2" opacity="0.5" />
        <circle cx="140" cy="215" r="17" fill="#241408" />
        <circle cx="140" cy="215" r="17" fill="none" stroke="#caa15a" strokeWidth="2" opacity="0.5" />
        <circle cx="210" cy="215" r="17" fill="#241408" />
        <circle cx="210" cy="215" r="17" fill="none" stroke="#caa15a" strokeWidth="2" opacity="0.5" />

        {/* antenna */}
        <line x1="235" y1="10" x2="300" y2="-95" stroke="#241408" strokeWidth="5" strokeLinecap="round" />
        <circle cx="300" cy="-95" r="7" fill="#e8a13a" />
      </g>

      {/* two seated listener silhouettes, low corners */}
      <g transform="translate(70,545)" opacity="0.9">
        <ellipse cx="24" cy="90" rx="40" ry="12" fill="#1c1008" opacity="0.4" />
        <path d="M0,90 v-40 q0,-30 24,-30 q24,0 24,30 v40 Z" fill="#3f6b7a" />
        <circle cx="24" cy="10" r="17" fill="#c98a5f" />
      </g>
      <g transform="translate(560,555)" opacity="0.9">
        <ellipse cx="24" cy="82" rx="38" ry="11" fill="#1c1008" opacity="0.4" />
        <path d="M0,82 v-36 q0,-28 24,-28 q24,0 24,28 v36 Z" fill="#c1622c" />
        <circle cx="24" cy="8" r="16" fill="#8a4a2a" />
      </g>

      <rect x="0" y="620" width="720" height="55" fill="#1c1008" opacity="0.4" />
    </svg>
  );
}
