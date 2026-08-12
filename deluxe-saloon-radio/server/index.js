import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import path from "path";

const PORT = process.env.PORT || 8787;
const DATA_PATH = path.join(process.cwd(), "playlists.json");

if (!existsSync(DATA_PATH)) {
  console.error(
    "playlists.json not found. Set YOUTUBE_API_KEY and either YOUTUBE_PLAYLIST_ID " +
    "or YOUTUBE_SCHEDULE in .env, then run `npm run build-playlist`"
  );
  process.exit(1);
}

const data = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
const { timezone, schedule, fallbackPlaylistId, playlists } = data;

for (const [id, tracks] of Object.entries(playlists)) {
  if (!tracks || tracks.length === 0) {
    console.error(`Playlist ${id} has no tracks. Check playlists.json.`);
    process.exit(1);
  }
}

// Which playlist ID is "on air" right now, based on the configured
// schedule and timezone. Falls back to fallbackPlaylistId outside any
// scheduled window (or if no schedule is configured at all).
function getActivePlaylistId(nowMs = Date.now()) {
  if (!schedule || schedule.length === 0) return fallbackPlaylistId;

  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: timezone }).format(nowMs)
  ) % 24;

  for (const slot of schedule) {
    const { start, end, playlistId } = slot;
    const inRange = start < end
      ? hour >= start && hour < end // normal same-day window, e.g. 6-9
      : hour >= start || hour < end; // wraps past midnight, e.g. 22-6
    if (inRange) return playlistId;
  }
  return fallbackPlaylistId;
}

// Deterministic "what's playing right now" — a pure function of wall-clock
// time, so every server instance and every client agree without needing to
// share any state. Whichever playlist is scheduled for this hour loops on
// its own independent clock.
function getPlaybackState(nowMs = Date.now()) {
  const activePlaylistId = getActivePlaylistId(nowMs);
  const tracks = playlists[activePlaylistId];
  const totalDuration = tracks.reduce((sum, t) => sum + t.duration, 0);

  let t = (nowMs / 1000) % totalDuration;
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    if (t < track.duration) {
      return { playlistId: activePlaylistId, trackIndex: i, track, offset: t };
    }
    t -= track.duration;
  }
  return { playlistId: activePlaylistId, trackIndex: 0, track: tracks[0], offset: 0 };
}

const app = express();
app.use(cors());

app.get("/api/playlist", (req, res) => {
  const state = getPlaybackState();
  res.json(playlists[state.playlistId].map(({ id, title, artist, duration, cover }) => ({
    id,
    title,
    artist,
    duration,
    cover,
  })));
});

function syncPayload() {
  const state = getPlaybackState();
  const tracks = playlists[state.playlistId];
  const nextTrack = tracks[(state.trackIndex + 1) % tracks.length];
  return {
    playlistId: state.playlistId,
    trackIndex: state.trackIndex,
    track: {
      id: state.track.id,
      title: state.track.title,
      artist: state.track.artist,
      duration: state.track.duration,
      cover: state.track.cover,
    },
    nextTrack: {
      title: nextTrack.title,
      artist: nextTrack.artist,
    },
    offset: state.offset,
    serverTime: Date.now(),
  };
}

app.get("/api/now-playing", (req, res) => {
  res.json({ ...syncPayload(), listeners: wss ? wss.clients.size : 0 });
});

app.get("/api/schedule", (req, res) => {
  const stripTrack = ({ title, artist, duration }) => ({ title, artist, duration });
  res.json({
    timezone,
    schedule: (schedule || []).map((slot) => ({
      start: slot.start,
      end: slot.end,
      playlistId: slot.playlistId,
      tracks: (playlists[slot.playlistId] || []).map(stripTrack),
    })),
    fallback: fallbackPlaylistId
      ? {
          playlistId: fallbackPlaylistId,
          tracks: (playlists[fallbackPlaylistId] || []).map(stripTrack),
        }
      : null,
  });
});


const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

function broadcastSync() {
  const payload = JSON.stringify({ type: "sync", ...syncPayload(), listeners: wss.clients.size });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

let lastKey = `${getPlaybackState().playlistId}:${getPlaybackState().trackIndex}`;

// Broadcast a correction every 5s (drift correction), and immediately
// whenever the track (or the active playlist, at a schedule boundary)
// changes — checked every second.
setInterval(broadcastSync, 5000);
setInterval(() => {
  const state = getPlaybackState();
  const key = `${state.playlistId}:${state.trackIndex}`;
  if (key !== lastKey) {
    lastKey = key;
    broadcastSync();
  }
}, 1000);

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "sync", ...syncPayload(), listeners: wss.clients.size }));
  // let everyone know the listener count changed
  broadcastSync();

  ws.on("close", () => broadcastSync());
});

httpServer.listen(PORT, () => {
  console.log(`Broadcasting Radio server running on http://localhost:${PORT}`);
  if (schedule && schedule.length > 0) {
    console.log(`Schedule active (${timezone}):`);
    for (const s of schedule) console.log(`  ${s.start}:00–${s.end}:00 -> ${s.playlistId}`);
    if (fallbackPlaylistId) console.log(`  outside schedule -> ${fallbackPlaylistId} (fallback)`);
  } else {
    console.log(`Single playlist: ${fallbackPlaylistId}`);
  }
});
