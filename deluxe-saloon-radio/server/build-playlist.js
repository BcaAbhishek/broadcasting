// Fetches one or more YouTube playlists' videos + durations via the
// YouTube Data API v3 and writes the result to ./playlists.json — no
// downloading, no audio files. Requires YOUTUBE_API_KEY in ./.env, plus
// either YOUTUBE_PLAYLIST_ID (single playlist) or YOUTUBE_SCHEDULE
// (time-based rotation) — see .env.example for both formats.
//
// Run this once whenever a playlist changes, or the schedule changes:
//   npm run build-playlist

import { writeFileSync } from "fs";
import path from "path";
import "dotenv/config";

const API_KEY = process.env.YOUTUBE_API_KEY;
const PLAYLIST_ID = process.env.YOUTUBE_PLAYLIST_ID;
const SCHEDULE_RAW = process.env.YOUTUBE_SCHEDULE;
const TIMEZONE = process.env.TIMEZONE || "Asia/Kolkata";
const OUT_FILE = path.join(process.cwd(), "playlists.json");

if (!API_KEY) {
  console.error("Missing YOUTUBE_API_KEY. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

// "6-9:PLaaa,9-16:PLbbb,16-18:PLccc" -> [{start:6,end:9,playlistId:"PLaaa"}, ...]
function parseSchedule(raw) {
  if (!raw) return [];
  return raw.split(",").map((entry) => {
    const [range, playlistId] = entry.trim().split(":");
    const [start, end] = range.split("-").map(Number);
    if (Number.isNaN(start) || Number.isNaN(end) || !playlistId) {
      throw new Error(`Bad YOUTUBE_SCHEDULE entry: "${entry}". Expected format like "6-9:PLxxxx".`);
    }
    return { start, end, playlistId: playlistId.trim() };
  });
}

const schedule = parseSchedule(SCHEDULE_RAW);

if (schedule.length === 0 && !PLAYLIST_ID) {
  console.error(
    "Set either YOUTUBE_PLAYLIST_ID (single playlist) or YOUTUBE_SCHEDULE " +
    "(time-based rotation) in .env — see .env.example."
  );
  process.exit(1);
}

// Every distinct playlist ID we need to fetch: everything in the
// schedule, plus the fallback/default playlist if set.
const playlistIds = [...new Set([...schedule.map((s) => s.playlistId), ...(PLAYLIST_ID ? [PLAYLIST_ID] : [])])];

// PT#H#M#S -> seconds
function parseISODuration(iso) {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const [, h, m, s] = match;
  return (parseInt(h || 0) * 3600) + (parseInt(m || 0) * 60) + parseInt(s || 0);
}

async function fetchAllPlaylistVideoIds(playlistId) {
  const ids = [];
  let pageToken = "";
  do {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "contentDetails");
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("key", API_KEY);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    for (const item of data.items) ids.push(item.contentDetails.videoId);
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return ids;
}

async function fetchVideoDetails(ids) {
  const results = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "contentDetails,snippet");
    url.searchParams.set("id", chunk.join(","));
    url.searchParams.set("key", API_KEY);

    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    results.push(...data.items);
  }
  return results;
}

async function buildOnePlaylist(playlistId) {
  console.log(`Fetching playlist ${playlistId}…`);
  const videoIds = await fetchAllPlaylistVideoIds(playlistId);

  if (videoIds.length === 0) {
    throw new Error(`Playlist ${playlistId} is empty (or private/unlisted in a way the API can't read).`);
  }

  const details = await fetchVideoDetails(videoIds);
  const tracks = [];

  for (const video of details) {
    const duration = parseISODuration(video.contentDetails.duration);
    if (duration <= 0) {
      console.warn(`  Skipping "${video.snippet.title}" — could not read duration (likely a livestream).`);
      continue;
    }
    const thumb =
      video.snippet.thumbnails?.high?.url ||
      video.snippet.thumbnails?.medium?.url ||
      video.snippet.thumbnails?.default?.url ||
      null;

    tracks.push({
      id: video.id,
      title: video.snippet.title,
      artist: video.snippet.channelTitle,
      duration,
      cover: thumb,
    });
    console.log(`  Added: ${video.snippet.title} — ${video.snippet.channelTitle} (${duration}s)`);
  }

  return tracks;
}

async function run() {
  const playlists = {};
  for (const id of playlistIds) {
    playlists[id] = await buildOnePlaylist(id);
  }

  const output = {
    timezone: TIMEZONE,
    schedule,
    fallbackPlaylistId: PLAYLIST_ID || schedule[0]?.playlistId,
    playlists,
  };

  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));

  console.log(`\nWrote ${playlistIds.length} playlist(s) to playlists.json`);
  if (schedule.length > 0) {
    console.log("Schedule (times are in " + TIMEZONE + "):");
    for (const s of schedule) {
      console.log(`  ${s.start}:00–${s.end}:00 -> ${s.playlistId} (${playlists[s.playlistId].length} tracks)`);
    }
    if (output.fallbackPlaylistId) {
      console.log(`  outside schedule -> ${output.fallbackPlaylistId} (fallback)`);
    }
  }
}

run().catch((err) => {
  console.error("Failed to build playlists:", err.message);
  process.exit(1);
});
