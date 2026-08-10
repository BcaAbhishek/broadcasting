// Fetches your YouTube playlist's videos + durations via the YouTube Data
// API v3 and writes the result to ./playlist.json — no downloading, no
// audio files. Requires YOUTUBE_API_KEY and YOUTUBE_PLAYLIST_ID in ./.env
// (see .env.example).
//
// Run this once whenever the playlist changes:
//   npm run build-playlist

import { writeFileSync } from "fs";
import path from "path";
import "dotenv/config";

const API_KEY = process.env.YOUTUBE_API_KEY;
const PLAYLIST_ID = process.env.YOUTUBE_PLAYLIST_ID;
const OUT_FILE = path.join(process.cwd(), "playlist.json");

if (!API_KEY || !PLAYLIST_ID) {
  console.error(
    "Missing YOUTUBE_API_KEY or YOUTUBE_PLAYLIST_ID.\n" +
    "Copy .env.example to .env and fill both in, then re-run this script."
  );
  process.exit(1);
}

// PT#H#M#S -> seconds
function parseISODuration(iso) {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const [, h, m, s] = match;
  return (parseInt(h || 0) * 3600) + (parseInt(m || 0) * 60) + parseInt(s || 0);
}

async function fetchAllPlaylistVideoIds() {
  const ids = [];
  let pageToken = "";
  do {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "contentDetails");
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("playlistId", PLAYLIST_ID);
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
  // videos.list accepts up to 50 ids per call
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

async function run() {
  console.log(`Fetching playlist ${PLAYLIST_ID}…`);
  const videoIds = await fetchAllPlaylistVideoIds();

  if (videoIds.length === 0) {
    console.error("Playlist is empty (or private/unlisted in a way the API can't read).");
    process.exit(1);
  }

  const details = await fetchVideoDetails(videoIds);
  const playlist = [];

  for (const video of details) {
    const duration = parseISODuration(video.contentDetails.duration);
    if (duration <= 0) {
      console.warn(`Skipping "${video.snippet.title}" — could not read duration (likely a livestream).`);
      continue;
    }

    const thumb =
      video.snippet.thumbnails?.high?.url ||
      video.snippet.thumbnails?.medium?.url ||
      video.snippet.thumbnails?.default?.url ||
      null;

    playlist.push({
      id: video.id, // the YouTube video ID itself
      title: video.snippet.title,
      artist: video.snippet.channelTitle,
      duration,
      cover: thumb,
    });

    console.log(`Added: ${video.snippet.title} — ${video.snippet.channelTitle} (${duration}s)`);
  }

  writeFileSync(OUT_FILE, JSON.stringify(playlist, null, 2));
  console.log(`\nWrote ${playlist.length} tracks to playlist.json`);
}

run().catch((err) => {
  console.error("Failed to build playlist:", err.message);
  process.exit(1);
});
