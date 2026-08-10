import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import path from "path";

const PORT = process.env.PORT || 8787;
const PLAYLIST_PATH = path.join(process.cwd(), "playlist.json");

if (!existsSync(PLAYLIST_PATH)) {
  console.error(
    "playlist.json not found. Set YOUTUBE_API_KEY and YOUTUBE_PLAYLIST_ID in .env, then run `npm run build-playlist`"
  );
  process.exit(1);
}

const playlist = JSON.parse(readFileSync(PLAYLIST_PATH, "utf-8"));
const TOTAL_DURATION = playlist.reduce((sum, t) => sum + t.duration, 0);

if (TOTAL_DURATION <= 0) {
  console.error("Playlist has zero total duration. Check playlist.json.");
  process.exit(1);
}

// Deterministic "what's playing right now" — a pure function of wall-clock
// time, so every server instance and every client agree without needing to
// share any state. The playlist loops forever.
function getPlaybackState(nowMs = Date.now()) {
  let t = (nowMs / 1000) % TOTAL_DURATION;
  for (let i = 0; i < playlist.length; i++) {
    const track = playlist[i];
    if (t < track.duration) {
      return { trackIndex: i, track, offset: t };
    }
    t -= track.duration;
  }
  // floating point edge case — fall back to first track
  return { trackIndex: 0, track: playlist[0], offset: 0 };
}

const app = express();
app.use(cors());

app.get("/api/playlist", (req, res) => {
  res.json(playlist.map(({ id, title, artist, duration, cover }) => ({
    id,
    title,
    artist,
    duration,
    cover,
  })));
});

app.get("/api/now-playing", (req, res) => {
  const state = getPlaybackState();
  res.json({
    trackIndex: state.trackIndex,
    track: {
      id: state.track.id,
      title: state.track.title,
      artist: state.track.artist,
      duration: state.track.duration,
      cover: state.track.cover,
    },
    offset: state.offset,
    serverTime: Date.now(),
    listeners: wss ? wss.clients.size : 0,
  });
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

function broadcastSync() {
  const state = getPlaybackState();
  const payload = JSON.stringify({
    type: "sync",
    trackIndex: state.trackIndex,
    track: {
      id: state.track.id,
      title: state.track.title,
      artist: state.track.artist,
      duration: state.track.duration,
      cover: state.track.cover,
    },
    offset: state.offset,
    serverTime: Date.now(),
    listeners: wss.clients.size,
  });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

let lastTrackIndex = getPlaybackState().trackIndex;

// Broadcast a correction every 5s (drift correction), and immediately
// whenever the track changes (checked every second).
setInterval(broadcastSync, 5000);
setInterval(() => {
  const state = getPlaybackState();
  if (state.trackIndex !== lastTrackIndex) {
    lastTrackIndex = state.trackIndex;
    broadcastSync();
  }
}, 1000);

wss.on("connection", (ws) => {
  const state = getPlaybackState();
  ws.send(
    JSON.stringify({
      type: "sync",
      trackIndex: state.trackIndex,
      track: {
        id: state.track.id,
        title: state.track.title,
        artist: state.track.artist,
        duration: state.track.duration,
        cover: state.track.cover,
      },
      offset: state.offset,
      serverTime: Date.now(),
      listeners: wss.clients.size,
    })
  );
  // let everyone know the listener count changed
  broadcastSync();

  ws.on("close", () => broadcastSync());
});

httpServer.listen(PORT, () => {
  console.log(`Broadcasting Radio server running on http://localhost:${PORT}`);
  console.log(`${playlist.length} tracks loaded, total duration ${TOTAL_DURATION}s`);
});
