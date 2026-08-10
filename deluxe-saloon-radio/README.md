# Broadcasting Radio — synced radio

Everyone who opens the page hears the same song at the same position, live,
like a real radio station — with a live listener count. You supply a
YouTube playlist link; the server keeps every listener in sync, playing
through YouTube's own official embedded player (no downloading, no
re-hosting of anyone's audio).

## How the sync works

The server never stores "what's playing now." It computes it fresh, every
time, as a pure function of the clock:

```
position_in_playlist = (current unix time) % (total playlist duration)
```

Every server restart and every connected client arrives at the exact same
answer, so there's nothing to keep in sync except the clock itself. The
server broadcasts a correction over websocket every 5 seconds (and instantly
whenever the track changes) so clients don't drift.

Playback itself happens in a visually hidden YouTube IFrame player on each
client — the video frame is shrunk to 1x1px and hidden, so visually it still
looks like the radio UI, but the actual play/pause/seek is all done through
YouTube's official, ToS-compliant embed API. Nothing is downloaded or
re-streamed from YouTube's servers.

## Project layout

```
deluxe-saloon-radio/
  server/     Express + websocket backend — computes sync position from a
              YouTube playlist's video IDs + durations
  client/     Vite + React frontend — the player page, embeds a hidden
              YouTube player synced to the server
```

## 1. Get a free YouTube Data API key

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or pick an existing one).
3. Go to **APIs & Services → Library**, search **"YouTube Data API v3"**,
   click **Enable**.
4. Go to **APIs & Services → Credentials → Create Credentials → API key**.
5. Copy the key. Free tier quota is generous — this app only calls it once
   per playlist rebuild, not per listener.

## 2. Point it at your playlist

```bash
cd server
cp .env.example .env
```

Open `.env` and fill in:
```
YOUTUBE_API_KEY=your_key_here
YOUTUBE_PLAYLIST_ID=the_id_from_your_playlist_url
```

The playlist ID is the `list=` value in a URL like
`https://www.youtube.com/playlist?list=PLxxxxxxxxxxxxxxxx`.

The playlist should be **Public** or **Unlisted** (Private playlists aren't
readable by the API).

## 3. Start the backend

```bash
npm install
npm run build-playlist   # fetches video IDs + durations, writes playlist.json
npm start                 # runs on http://localhost:8787
```

You should see something like:
```
Broadcasting Radio server running on http://localhost:8787
12 tracks loaded, total duration 2760s
```

Sanity check it's alive by opening `http://localhost:8787/api/playlist` in a
browser — you should see your tracks as JSON. (Opening `http://localhost:8787/`
directly will say "Cannot GET /" — that's expected, the server has no
homepage, only API/websocket routes.)

## 4. Start the frontend

In a **second terminal** (keep the server running in the first one):

```bash
cd client
npm install
npm run dev
```

Vite will print a local URL, usually `http://localhost:5173`. Open that in
your browser — that's the actual radio page.

Browsers block audio autoplay without a user gesture, so you'll see a
"Tune in live" button on first load — after that it stays playing and
synced, same as walking into a room where the radio's already on.

If your server isn't running on `localhost:8787`, update the `SERVER_URL`
constant at the top of `client/src/BroadcastingRadioPlayer.jsx`.

## Changing the playlist later

Edit the playlist on YouTube itself, then re-run `npm run build-playlist`
in the `server` folder and restart `npm start`. No changes needed on the
client side.

## Deploying for real visitors

For strangers on the internet to share the same broadcast:
1. Host `server/` somewhere reachable (Render, Railway, a small VPS, etc.),
   with `YOUTUBE_API_KEY` and `YOUTUBE_PLAYLIST_ID` set as environment
   variables there too.
2. Update `SERVER_URL` in `client/src/BroadcastingRadioPlayer.jsx` to that
   public URL.
3. Build the client for production: `cd client && npm run build`, then deploy
   the generated `dist/` folder anywhere that serves static files (Netlify,
   Vercel, GitHub Pages, etc.).

## A note on staying within YouTube's rules

This app only ever uses YouTube's official embedded player, controlled via
their public IFrame API (play, pause, seek) — the same thing any website
embedding a YouTube video does. It never downloads, extracts, or re-hosts
audio from YouTube's servers, which is what keeps this different from
sites that scrape YouTube audio for their own streaming.
