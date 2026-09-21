import playlistsData from "../playlists.json";

const {
  timezone,
  schedule,
  specialDays,
  fallbackPlaylistId,
  playlists
} = playlistsData;


// --------------------------------------------------
// TIME / SCHEDULE
// --------------------------------------------------

function getTodaySpecialDay(nowMs = Date.now()) {
  if (!specialDays || specialDays.length === 0) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone
  })
    .formatToParts(nowMs)
    .reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});

  const todayKey = `${parts.month}-${parts.day}`;

  return (
    specialDays.find((s) => s.date === todayKey) || null
  );
}


function getActivePlaylistId(nowMs = Date.now()) {
  const special = getTodaySpecialDay(nowMs);

  if (special) {
    return special.playlistId;
  }

  if (!schedule || schedule.length === 0) {
    return fallbackPlaylistId;
  }

  const hour =
    Number(
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hour12: false,
        timeZone: timezone
      }).format(nowMs)
    ) % 24;

  for (const slot of schedule) {
    const { start, end, playlistId } = slot;

    const inRange =
      start < end
        ? hour >= start && hour < end
        : hour >= start || hour < end;

    if (inRange) {
      return playlistId;
    }
  }

  return fallbackPlaylistId;
}


// --------------------------------------------------
// PLAYBACK
// --------------------------------------------------

function getPlaybackState(nowMs = Date.now()) {
  const activePlaylistId = getActivePlaylistId(nowMs);

  const tracks = playlists[activePlaylistId];

  if (!tracks || tracks.length === 0) {
    return null;
  }

  const totalDuration = tracks.reduce(
    (sum, track) => sum + track.duration,
    0
  );

  let t = (nowMs / 1000) % totalDuration;

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];

    if (t < track.duration) {
      return {
        playlistId: activePlaylistId,
        trackIndex: i,
        track,
        offset: t
      };
    }

    t -= track.duration;
  }

  return {
    playlistId: activePlaylistId,
    trackIndex: 0,
    track: tracks[0],
    offset: 0
  };
}


// --------------------------------------------------
// SYNC PAYLOAD
// --------------------------------------------------

function syncPayload() {
  const state = getPlaybackState();

  if (!state) {
    return {
      playlistId: null,
      trackIndex: 0,
      track: null,
      nextTrack: null,
      specialDay: null,
      offset: 0,
      serverTime: Date.now()
    };
  }

  const tracks = playlists[state.playlistId];

  const nextTrack =
    tracks[(state.trackIndex + 1) % tracks.length];

  const special = getTodaySpecialDay();

  return {
    playlistId: state.playlistId,

    trackIndex: state.trackIndex,

    track: {
      id: state.track.id,
      title: state.track.title,
      artist: state.track.artist,
      duration: state.track.duration,
      cover: state.track.cover
    },

    nextTrack: {
      title: nextTrack.title,
      artist: nextTrack.artist
    },

    specialDay: special
      ? {
          label: special.label
        }
      : null,

    offset: state.offset,

    serverTime: Date.now()
  };
}


// --------------------------------------------------
// PLAYLIST API
// --------------------------------------------------

function playlistResponse() {
  const state = getPlaybackState();

  if (!state) {
    return [];
  }

  return playlists[state.playlistId].map(
    ({ id, title, artist, duration, cover }) => ({
      id,
      title,
      artist,
      duration,
      cover
    })
  );
}


// --------------------------------------------------
// SCHEDULE API
// --------------------------------------------------

function scheduleResponse() {
  const stripTrack = ({
    id,
    title,
    artist,
    duration
  }) => ({
    id,
    title,
    artist,
    duration
  });

  const special = getTodaySpecialDay();

  if (special) {
    return {
      timezone,

      specialDay: {
        label: special.label
      },

      schedule: [
        {
          start: 0,
          end: 24,
          label:
            special.label || "Today's Special",

          playlistId: special.playlistId,

          tracks:
            (playlists[special.playlistId] || [])
              .map(stripTrack)
        }
      ],

      fallback: null
    };
  }

  return {
    timezone,

    specialDay: null,

    schedule: (schedule || []).map((slot) => ({
      start: slot.start,
      end: slot.end,
      label: slot.label || null,
      playlistId: slot.playlistId,

      tracks:
        (playlists[slot.playlistId] || [])
          .map(stripTrack)
    })),

    fallback: fallbackPlaylistId
      ? {
          playlistId: fallbackPlaylistId,

          tracks:
            (playlists[fallbackPlaylistId] || [])
              .map(stripTrack)
        }
      : null
  };
}


// --------------------------------------------------
// CLOUDFLARE WORKER
// --------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods":
        "GET, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }


    // -----------------------------
    // WebSocket
    // -----------------------------

    if (
      url.pathname === "/ws" &&
      request.headers.get("Upgrade")?.toLowerCase() ===
        "websocket"
    ) {
      const id = env.RADIO.idFromName("main-radio");

      const room = env.RADIO.get(id);

      return room.fetch(request);
    }


    // -----------------------------
    // Playlist
    // -----------------------------

    if (url.pathname === "/api/playlist") {
      return new Response(
        JSON.stringify(playlistResponse()),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        }
      );
    }


    // -----------------------------
    // Now Playing
    // -----------------------------

    if (url.pathname === "/api/now-playing") {
      const id =
        env.RADIO.idFromName("main-radio");

      const room =
        env.RADIO.get(id);

      const countResponse =
        await room.fetch(
          new Request(
            new URL(
              "/internal/listeners",
              request.url
            )
          )
        );

      const data =
        await countResponse.json();

      return new Response(
        JSON.stringify({
          ...syncPayload(),
          listeners: data.listeners || 0
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        }
      );
    }


    // -----------------------------
    // Schedule
    // -----------------------------

    if (url.pathname === "/api/schedule") {
      return new Response(
        JSON.stringify(scheduleResponse()),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        }
      );
    }


    // -----------------------------
    // Health check
    // -----------------------------

    if (url.pathname === "/") {
      return new Response(
        "Broadcasting Radio Cloudflare API Running 🚀",
        {
          headers: corsHeaders
        }
      );
    }


    return new Response("Not Found", {
      status: 404,
      headers: corsHeaders
    });
  }
};


// ==================================================
// DURABLE OBJECT
// ==================================================

export class RadioRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }


  async fetch(request) {

    // -----------------------------
    // Listener count
    // -----------------------------

    if (
      new URL(request.url).pathname ===
      "/internal/listeners"
    ) {
      const sockets =
        this.state.getWebSockets();

      return Response.json({
        listeners: sockets.length
      });
    }


    // -----------------------------
    // WebSocket connection
    // -----------------------------

    if (
      request.headers.get("Upgrade")?.toLowerCase() !==
      "websocket"
    ) {
      return new Response(
        "Radio WebSocket Room",
        {
          status: 200
        }
      );
    }


    const upgrade =
      new WebSocketPair();

    const client =
      upgrade[0];

    const server =
      upgrade[1];


    this.state.acceptWebSocket(server);


    // Send current state immediately
    server.send(
      JSON.stringify({
        type: "sync",
        ...syncPayload(),
        listeners:
          this.state.getWebSockets().length
      })
    );


    // Tell all listeners about the new count
    this.broadcastSync();


    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }


  // -----------------------------
  // WebSocket message
  // -----------------------------

  async webSocketMessage(ws, message) {
    // No commands are currently required
  }


  // -----------------------------
  // WebSocket close
  // -----------------------------

  async webSocketClose(ws) {
    this.broadcastSync();
  }


  // -----------------------------
  // WebSocket error
  // -----------------------------

  async webSocketError(ws) {
    this.broadcastSync();
  }


  // -----------------------------
  // Broadcast
  // -----------------------------

  broadcastSync() {

    const payload = JSON.stringify({
      type: "sync",
      ...syncPayload(),
      listeners:
        this.state.getWebSockets().length
    });


    for (
      const client of this.state.getWebSockets()
    ) {
      try {
        client.send(payload);
      } catch {
        // Ignore disconnected clients
      }
    }
  }
}