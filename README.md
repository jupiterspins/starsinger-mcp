# StarSinger MCP Server

An MCP (Model Context Protocol) server that gives AI agents access to the **StarSinger AI music catalog** — search, stream, and browse tracks from a growing library of AI-generated music.

## Make a song (v0.2)

Ask your assistant to *make a song* and it can — `make_song` writes the lyrics, composes and sings a finished song with real vocals in about a minute (or an instrumental if you ask), on the StarSinger account behind your API key.

- One free song a day, no subscription. **A free song is published to the public StarSinger feed** — the tool says so and only proceeds with `publicOk: true`.
- After that, a purchased song credit (private until you publish). With none left, the tool hands back a checkout link and the price.
- `song_status` polls a job, `my_songs` lists your recent songs, `wallet` says what the next song will spend.

Remote (no install): `POST https://mcp-api.starsinger.ai/mcp` with `Authorization: Bearer <api key>` — Streamable HTTP, stateless.

## Quick Start

### 1. Get an API Key

Get a free API key at [mcp.starsinger.ai](https://mcp.starsinger.ai) — sign up and create a key from the dashboard.

### 2. Add to Your AI Tool

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "starsinger": {
      "command": "npx",
      "args": ["-y", "starsinger-mcp"],
      "env": {
        "STARSINGER_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

**Cursor** — add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "starsinger": {
      "command": "npx",
      "args": ["-y", "starsinger-mcp"],
      "env": {
        "STARSINGER_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

**VS Code** — add to user settings:

```json
{
  "mcp": {
    "servers": {
      "starsinger": {
        "command": "npx",
        "args": ["-y", "starsinger-mcp"],
        "env": {
          "STARSINGER_API_KEY": "your_api_key_here"
        }
      }
    }
  }
}
```

### 3. Try It

Ask your AI assistant:

> "Find me some chill jazz piano tracks"

> "What artists does StarSinger have?"

> "Get me an upbeat track for a workout video"

## Tools

### `search_music`

Search the catalog by natural language query, mood, or genre.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Natural language search — "upbeat jazz piano", "sad violin ballad" |
| `mood` | string | No | Filter by mood: `purple` (chill), `red` (energetic), `blue` (emotional), `gold` (uplifting), `green` (nature), `pink` (romantic), `dark` (intense), `rainbow` (eclectic) |
| `limit` | number | No | Results to return (default 10, max 50) |

### `get_track`

Get full details and streaming URL for a specific track.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | Yes | Track ID from search results |

### `get_trending`

Get currently popular tracks from the catalog.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | No | Number of tracks (default 10, max 50) |

### `browse_artists`

Browse AI catalog artists, optionally filtered by genre.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `genre` | string | No | Filter by genre (e.g. "jazz", "classical", "pop") |
| `limit` | number | No | Number of artists (default 10, max 50) |

### `get_artist`

Get an artist's full profile and discography.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `artistId` | string | No | Artist ID from browse results |
| `handle` | string | No | Artist handle (e.g. "miles_rivers") |

## What You Get

Every track response includes:

- **Streaming URL** — Direct MP3 link, ready to play or embed
- **Cover art** — Album artwork URL
- **Full lyrics** — Complete song lyrics
- **Metadata** — Title, artist, genre, mood, play count, likes
- **Artist info** — Bio, influences, instrument, city

## Configuration

| Environment Variable | Required | Default | Description |
|---------------------|----------|---------|-------------|
| `STARSINGER_API_KEY` | Yes | — | Your StarSinger API key |
| `STARSINGER_API_URL` | No | `https://mcp-api.starsinger.ai` | API base URL |

## About StarSinger

[StarSinger](https://starsinger.ai) is an AI music creation platform. All music in the catalog is AI-generated and owned by Veronata Inc., available for use via this API.

## License

MIT
