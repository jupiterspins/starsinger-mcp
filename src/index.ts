#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL =
  process.env.STARSINGER_API_URL ||
  "https://mcp-api.starsinger.ai";
const API_KEY = process.env.STARSINGER_API_KEY;

if (!API_KEY) {
  console.error(
    "STARSINGER_API_KEY environment variable is required.\n" +
      "Get a free key at https://mcp.starsinger.ai"
  );
  process.exit(1);
}

async function apiGet(
  path: string,
  params: Record<string, string | undefined> = {}
): Promise<unknown> {
  const url = new URL(path, API_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`StarSinger API ${res.status}: ${body}`);
  }

  return res.json();
}

async function apiPost(
  path: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const url = new URL(path, API_URL);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`StarSinger API ${res.status}: ${text}`);
  }

  return res.json();
}

function truncate(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  return s.length > max ? s.slice(0, max) + "..." : s;
}

interface Track {
  id: string;
  title: string;
  songTitle: string;
  artistName: string;
  genre: string | null;
  mood: string | null;
  audioUrl: string | null;
  thumbnailUrl: string | null;
  lyrics: string | null;
  language: string | null;
  views: number;
  likes: number;
  publishedAt: number;
  source: string;
  createYourOwn: string;
}

function formatTrackList(tracks: Track[]): string {
  if (tracks.length === 0) return "No tracks found.";

  return tracks
    .map(
      (t, i) =>
        `${i + 1}. **${t.songTitle}** by ${t.artistName}\n` +
        `   Genre: ${t.genre || "N/A"} | Mood: ${t.mood || "N/A"} | ` +
        `Plays: ${t.views} | Likes: ${t.likes}\n` +
        (t.audioUrl ? `   Stream: ${t.audioUrl}\n` : "") +
        (t.thumbnailUrl ? `   Cover: ${t.thumbnailUrl}\n` : "") +
        (t.lyrics ? `   Lyrics preview: ${truncate(t.lyrics, 120)}\n` : "") +
        `   ID: ${t.id}`
    )
    .join("\n\n");
}

const VALID_MOODS = [
  "purple",
  "red",
  "blue",
  "gold",
  "green",
  "pink",
  "dark",
  "rainbow",
] as const;

const server = new McpServer({
  name: "starsinger",
  version: "0.2.2",
});

// ============================================
// Song generation (StarSinger makes the song — real vocals, ~1 minute)
// ============================================
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SongJob {
  jobId: string;
  status: "queued" | "writing" | "generating" | "done" | "cap_reached" | "needs_public_ok" | "failed";
  title: string | null;
  error: string | null;
  creditSource: string | null;
  message?: string;
  checkoutUrl?: string;
  priceUsd?: number;
  song: {
    id: string;
    title: string;
    audioUrl: string;
    durationSeconds: number | null;
    genre: string | null;
    language: string | null;
    instrumental: boolean;
    lyrics: string | null;
    public: boolean;
    url: string;
  } | null;
}

function describeJob(job: SongJob): string {
  if (job.status === "done" && job.song) {
    const s = job.song;
    const mins = s.durationSeconds ? `${Math.floor(s.durationSeconds / 60)}:${String(Math.round(s.durationSeconds % 60)).padStart(2, "0")}` : "";
    return (
      `**${s.title}** is ready${mins ? ` (${mins})` : ""}.\n` +
      `Listen / share: ${s.url}\n` +
      `Audio (MP3): ${s.audioUrl}\n` +
      (s.instrumental ? "Instrumental, no vocals.\n" : "") +
      (job.creditSource === "free"
        ? "This used today's free song, so it is public in the StarSinger feed and on the account's artist profile.\n"
        : "This used a song credit; it stays private until published.\n") +
      (s.lyrics ? `\nLyrics:\n${s.lyrics}` : "")
    );
  }
  if (job.status === "cap_reached") {
    return job.message ?? `Today's free song is used. Buy a song credit at ${job.checkoutUrl}${job.priceUsd ? ` ($${job.priceUsd.toFixed(2)})` : ""}, then call make_song again.`;
  }
  if (job.status === "needs_public_ok") {
    return job.message ?? "This would use today's free song, which is published to the public StarSinger feed. Ask the user, then call make_song again with publicOk: true — or a song credit keeps it private.";
  }
  if (job.status === "failed") return `The studio could not make this song (${job.error ?? "unknown"}). Nothing was spent; try again or change the brief.`;
  return `Still working (${job.status}). Job ${job.jobId}.`;
}

server.tool(
  "make_song",
  `Make a finished song on StarSinger from a short brief: lyrics are written, the music composed, and it is sung with real vocals in about a minute. Say instrumental for no vocals. 49 languages.

Money and consent — read before calling:
- The account gets ONE FREE SONG A DAY. A free song is PUBLISHED to the public StarSinger feed and the account's artist profile. Tell the user that first; pass publicOk:true only if they agree.
- After the free song, a purchased song credit is used (private until the user publishes it). With no credit left, the result carries a checkout link and price — hand it to the user, never invent a price.
- No subscription exists.

This call returns a job immediately; poll song_status every ~10 s until status is "done" (usually 60–90 s), then give the user the song url.`,
  {
    brief: z.string().max(1500).optional().describe("What the song is about, who it is for, the occasion, the feel. Required unless lyrics are given."),
    lyrics: z.string().max(4000).optional().describe("Complete lyrics to sing, if the user wrote them."),
    genre: z.string().max(40).optional().describe("One genre label: Pop, Jazz, Hip-Hop, Country, Lo-fi, Classical, Afrobeats, K-Pop…"),
    style: z.string().max(120).optional().describe("Production values only: tempo, mood, instruments, era, a style reference. Under 12 words."),
    language: z.string().max(8).optional().describe("ISO 639-1 code of the lyrics, e.g. en, es, hi (default en)."),
    voice: z.enum(["male", "female", "neutral"]).optional().describe("Singing voice."),
    instrumental: z.boolean().optional().describe("No vocals at all: a piano piece, a beat, background music."),
    singInMyVoice: z.boolean().optional().describe("Sing it in the account owner's own cloned voice (if they set one up at starsinger.ai/studio/voice)."),
    title: z.string().max(80).optional(),
    publicOk: z.boolean().optional().describe("The user understands that a FREE song is published to the public feed and agrees. Required for a free draw."),
    wait: z.boolean().optional().describe("Wait for the song here (up to 4 minutes) instead of returning the job at once. Default true."),
  },
  async (args) => {
    const { wait = true, ...body } = args;
    let job = (await apiPost("/api/mcp/songs", body)) as SongJob;
    if (wait && (job.status === "queued" || job.status === "writing" || job.status === "generating")) {
      const deadline = Date.now() + 4 * 60 * 1000;
      while (Date.now() < deadline) {
        await sleep(8000);
        job = (await apiGet("/api/mcp/songs", { id: job.jobId })) as SongJob;
        if (job.status === "done" || job.status === "failed" || job.status === "cap_reached" || job.status === "needs_public_ok") break;
      }
    }
    return { content: [{ type: "text" as const, text: describeJob(job) }], isError: job.status === "failed" };
  }
);

server.tool(
  "song_status",
  "Status of a make_song job: writing → generating → done (with the song's url and MP3), or cap_reached / needs_public_ok / failed.",
  { jobId: z.string().describe("The jobId returned by make_song.") },
  async ({ jobId }) => {
    const job = (await apiGet("/api/mcp/songs", { id: jobId })) as SongJob;
    return { content: [{ type: "text" as const, text: describeJob(job) }] };
  }
);

server.tool(
  "my_songs",
  "The account's most recent StarSinger songs with playable MP3 links.",
  { limit: z.number().min(1).max(50).optional() },
  async ({ limit }) => {
    const data = (await apiGet("/api/mcp/my-songs", { limit: limit?.toString() })) as { songs: Array<{ id: string; title: string; audioUrl: string; durationSeconds: number | null; genre: string | null; instrumental: boolean; creditSource: string | null; createdAt: number }> };
    const text = data.songs.length
      ? data.songs.map((s, i) => `${i + 1}. **${s.title}**${s.instrumental ? " (instrumental)" : ""} · ${s.genre ?? ""} · ${s.creditSource === "free" ? "public" : "private"}\n   ${s.audioUrl}`).join("\n\n")
      : "No songs yet — make one with make_song.";
    return { content: [{ type: "text" as const, text }] };
  }
);

server.tool(
  "wallet",
  "What the next make_song will spend on this account: today's free song, a purchased credit, or nothing left (with the checkout link and price).",
  {},
  async () => {
    const w = (await apiGet("/api/mcp/wallet")) as { freeSongRemaining: number; songCreditsUsable: number; source: string | null; songPriceUsd: number; checkoutUrl: string };
    const text =
      w.freeSongRemaining > 0
        ? `Today's free song is available (it will be public in the feed). Purchased credits: ${w.songCreditsUsable}.`
        : w.songCreditsUsable > 0
          ? `Today's free song is used; ${w.songCreditsUsable} purchased credit(s) available (private songs).`
          : `Today's free song is used and there are no credits. A song credit is $${w.songPriceUsd.toFixed(2)} at ${w.checkoutUrl}.`;
    return { content: [{ type: "text" as const, text }] };
  }
);

// ============================================
// Tool: search_music
// ============================================
server.tool(
  "search_music",
  `Search the StarSinger AI music catalog by natural language query.

Best for: Finding tracks by mood, genre, artist name, instrument, lyrics, or vibe description.
Returns: Matching tracks with title, artist, genre, streaming URL, cover art, and lyrics preview.

Query tips: Use natural language — "upbeat jazz piano" or "melancholic violin ballad" work well.
Available moods: chill, energetic, emotional, uplifting, nature, romantic, intense, eclectic.`,
  {
    query: z
      .string()
      .describe(
        "Natural language search query — describe the music you want"
      ),
    mood: z
      .enum(VALID_MOODS)
      .optional()
      .describe(
        "Filter by mood: purple=chill, red=energetic, blue=emotional, gold=uplifting, green=nature, pink=romantic, dark=intense, rainbow=eclectic"
      ),
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe("Number of results (default 10, max 50)"),
  },
  async ({ query, mood, limit }) => {
    const data = (await apiGet("/api/mcp/search", {
      q: query,
      mood,
      limit: limit?.toString(),
    })) as { tracks: Track[]; count: number };

    return {
      content: [
        {
          type: "text" as const,
          text:
            `Found ${data.count} tracks matching "${query}"` +
            (mood ? ` (mood: ${mood})` : "") +
            `:\n\n${formatTrackList(data.tracks)}\n\n` +
            `Music by StarSinger — Create your own at https://starsinger.ai`,
        },
      ],
    };
  }
);

// ============================================
// Tool: get_track
// ============================================
server.tool(
  "get_track",
  `Get full details and streaming URL for a specific StarSinger track.

Best for: Getting complete metadata, full lyrics, and streaming URL for a track you've already found.
Returns: Full track details including streaming URL, cover art, full lyrics, mood profile, and artist info.`,
  {
    trackId: z.string().describe("The track ID (from search results)"),
  },
  async ({ trackId }) => {
    const track = (await apiGet("/api/mcp/track", {
      id: trackId,
    })) as Track & {
      description?: string | null;
      moodProfile?: unknown;
      catalogArtist?: { id: string; name: string; handle: string | null; genre: string } | null;
      contentType?: string;
    };

    let text =
      `**${track.songTitle}** by ${track.artistName}\n\n` +
      `Genre: ${track.genre || "N/A"}\n` +
      `Mood: ${track.mood || "N/A"}\n` +
      `Plays: ${track.views} | Likes: ${track.likes}\n`;

    if (track.audioUrl) text += `Stream URL: ${track.audioUrl}\n`;
    if (track.thumbnailUrl) text += `Cover art: ${track.thumbnailUrl}\n`;
    if (track.description) text += `\nDescription: ${track.description}\n`;
    if (track.catalogArtist) {
      text += `\nArtist: ${track.catalogArtist.name}`;
      if (track.catalogArtist.handle)
        text += ` (@${track.catalogArtist.handle})`;
      text += ` — ${track.catalogArtist.genre}\n`;
    }
    if (track.lyrics) text += `\nLyrics:\n${track.lyrics}\n`;

    text += `\nMusic by StarSinger — Create your own at https://starsinger.ai`;

    return { content: [{ type: "text" as const, text }] };
  }
);

// ============================================
// Tool: get_trending
// ============================================
server.tool(
  "get_trending",
  `Get currently popular tracks from the StarSinger catalog.

Best for: Discovering what's popular, getting a sample of the catalog, or finding background music quickly.
Returns: Top tracks ranked by engagement (plays + likes).`,
  {
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe("Number of tracks to return (default 10, max 50)"),
  },
  async ({ limit }) => {
    const data = (await apiGet("/api/mcp/trending", {
      limit: limit?.toString(),
    })) as { tracks: Track[]; count: number };

    return {
      content: [
        {
          type: "text" as const,
          text:
            `Top ${data.count} trending tracks:\n\n${formatTrackList(data.tracks)}\n\n` +
            `Music by StarSinger — Create your own at https://starsinger.ai`,
        },
      ],
    };
  }
);

// ============================================
// Tool: browse_artists
// ============================================
server.tool(
  "browse_artists",
  `Browse AI catalog artists on StarSinger.

Best for: Discovering artists by genre, exploring the catalog, or finding an artist to listen to.
Returns: Artist profiles with name, handle, bio, genre, instrument, and song count.`,
  {
    genre: z
      .string()
      .optional()
      .describe(
        'Filter by genre (e.g. "jazz", "classical", "pop", "hip-hop-rap", "electronic")'
      ),
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe("Number of artists to return (default 10, max 50)"),
  },
  async ({ genre, limit }) => {
    const data = (await apiGet("/api/mcp/artists", {
      genre,
      limit: limit?.toString(),
    })) as {
      artists: Array<{
        id: string;
        name: string;
        handle: string | null;
        bio: string | null;
        primaryGenre: string;
        primaryInstrument: string | null;
        songCount: number;
        city: string | null;
        musicalInfluences: string[];
      }>;
      count: number;
    };

    const text = data.artists
      .map(
        (a, i) =>
          `${i + 1}. **${a.name}**` +
          (a.handle ? ` (@${a.handle})` : "") +
          `\n   Genre: ${a.primaryGenre}` +
          (a.primaryInstrument ? ` | Instrument: ${a.primaryInstrument}` : "") +
          ` | Songs: ${a.songCount}` +
          (a.city ? ` | Based in: ${a.city}` : "") +
          (a.bio ? `\n   ${truncate(a.bio, 200)}` : "") +
          (a.musicalInfluences.length > 0
            ? `\n   Influences: ${a.musicalInfluences.join(", ")}`
            : "") +
          `\n   ID: ${a.id}`
      )
      .join("\n\n");

    return {
      content: [
        {
          type: "text" as const,
          text:
            `Found ${data.count} artists` +
            (genre ? ` in ${genre}` : "") +
            `:\n\n${text || "No artists found."}\n\n` +
            `Music by StarSinger — Create your own at https://starsinger.ai`,
        },
      ],
    };
  }
);

// ============================================
// Tool: get_artist
// ============================================
server.tool(
  "get_artist",
  `Get an artist's full profile and their tracks from the StarSinger catalog.

Best for: Learning about a specific artist and listening to their discography.
Returns: Full artist profile (bio, influences, instrument) plus all their published tracks with streaming URLs.`,
  {
    artistId: z
      .string()
      .optional()
      .describe("The artist ID (from browse_artists results)"),
    handle: z
      .string()
      .optional()
      .describe('The artist handle (e.g. "miles_rivers")'),
  },
  async ({ artistId, handle }) => {
    if (!artistId && !handle) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Please provide either artistId or handle.",
          },
        ],
        isError: true,
      };
    }

    const artist = (await apiGet("/api/mcp/artist", {
      id: artistId,
      handle,
    })) as {
      id: string;
      name: string;
      handle: string | null;
      bio: string | null;
      primaryGenre: string;
      primaryInstrument: string | null;
      songCount: number;
      city: string | null;
      musicalInfluences: string[];
      tracks: Track[];
    };

    let text =
      `**${artist.name}**` +
      (artist.handle ? ` (@${artist.handle})` : "") +
      `\n\n`;

    text += `Genre: ${artist.primaryGenre}`;
    if (artist.primaryInstrument)
      text += ` | Instrument: ${artist.primaryInstrument}`;
    text += ` | Songs: ${artist.songCount}`;
    if (artist.city) text += ` | Based in: ${artist.city}`;
    text += "\n";

    if (artist.bio) text += `\n${artist.bio}\n`;
    if (artist.musicalInfluences.length > 0)
      text += `\nInfluences: ${artist.musicalInfluences.join(", ")}\n`;

    if (artist.tracks.length > 0) {
      text += `\n--- Discography (${artist.tracks.length} tracks) ---\n\n`;
      text += formatTrackList(artist.tracks);
    }

    text += `\n\nMusic by StarSinger — Create your own at https://starsinger.ai`;

    return { content: [{ type: "text" as const, text }] };
  }
);

// ============================================
// Tool: create_playlist
// ============================================
server.tool(
  "create_playlist",
  `Create a curated playlist of StarSinger tracks.

Best for: Saving a collection of tracks for later use — DJ sets, background music schedules, themed playlists.
Returns: The created playlist with ID, name, and track count.

Workflow: Search for tracks first, then pass their IDs to create a playlist.`,
  {
    name: z.string().describe("Playlist name (e.g. 'Morning Cafe Jazz')"),
    description: z
      .string()
      .optional()
      .describe("Optional description of the playlist"),
    trackIds: z
      .array(z.string())
      .optional()
      .describe("Array of track IDs to add (from search results)"),
    tags: z
      .array(z.string())
      .optional()
      .describe("Tags for categorization (e.g. ['chill', 'morning'])"),
    isPublic: z
      .boolean()
      .optional()
      .describe("Make playlist publicly browsable (default false)"),
  },
  async ({ name, description, trackIds, tags, isPublic }) => {
    const result = (await apiPost("/api/mcp/playlists", {
      name,
      description,
      trackIds,
      tags,
      isPublic,
    })) as { id: string; name: string; description: string | null; trackCount: number; createdAt: number };

    return {
      content: [
        {
          type: "text" as const,
          text:
            `Playlist created: **${result.name}**\n\n` +
            `ID: ${result.id}\n` +
            `Tracks: ${result.trackCount}\n` +
            (result.description ? `Description: ${result.description}\n` : "") +
            `\nUse get_playlist with this ID to view the full playlist.`,
        },
      ],
    };
  }
);

// ============================================
// Tool: get_playlist
// ============================================
server.tool(
  "get_playlist",
  `Get a playlist with all its tracks and streaming URLs.

Best for: Retrieving a previously created playlist for playback or review.
Returns: Full playlist details including all tracks with streaming URLs.`,
  {
    playlistId: z.string().describe("The playlist ID (from create_playlist or list)"),
  },
  async ({ playlistId }) => {
    const playlist = (await apiGet("/api/mcp/playlist", {
      id: playlistId,
    })) as {
      id: string;
      name: string;
      description: string | null;
      tags: string[];
      tracks: Track[];
      trackCount: number;
      isPublic: boolean;
      createdAt: number;
      updatedAt: number;
    };

    let text =
      `**${playlist.name}**\n` +
      (playlist.description ? `${playlist.description}\n` : "") +
      `\n${playlist.trackCount} tracks` +
      (playlist.tags.length > 0 ? ` | Tags: ${playlist.tags.join(", ")}` : "") +
      ` | ${playlist.isPublic ? "Public" : "Private"}\n`;

    if (playlist.tracks.length > 0) {
      text += `\n${formatTrackList(playlist.tracks)}`;
    } else {
      text += "\nNo tracks in this playlist yet.";
    }

    text += `\n\nMusic by StarSinger — Create your own at https://starsinger.ai`;

    return { content: [{ type: "text" as const, text }] };
  }
);

// ============================================
// Start the server
// ============================================
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("StarSinger MCP server error:", err);
  process.exit(1);
});
