# Twitch Drops Miner — Deployment Guide

## Requirements

| Tool | Minimum version |
|------|----------------|
| Docker | 24+ |
| Docker Compose | v2 (bundled with Docker Desktop / `docker compose` plugin) |

---

## Quick Start (Docker — recommended)

```bash
# 1. Clone or unzip the project
unzip twitch-drops-miner.zip
cd twitch-drops-miner

# 2. Start the container
docker compose up -d --build

# 3. Open the app
open http://localhost:3000
```

That's it. The database is automatically created at `./data/farm.db` on first run.

---

## First-Run Setup

### 1. Get a Twitch Client ID

1. Go to **https://dev.twitch.tv/console**
2. Click **Register Your Application**
3. Name: anything you like (e.g. "My Drops Miner")
4. OAuth Redirect URL: `http://localhost`
5. Category: **Other**
6. Click **Create** → copy the **Client ID**

> ⚠️ You do **not** need a Client Secret. This app uses Device Code Flow.

### 2. Enter Client ID in Settings

1. Open **http://localhost:3000**
2. Click **Settings** in the left sidebar
3. Paste your Client ID into the **Twitch Client ID** field
4. Click **Save All**

### 3. Add a Twitch Account

1. Click **Accounts** in the sidebar
2. Click **Login with Twitch**
3. You'll see a 6-character code and a URL (`https://www.twitch.tv/activate`)
4. Open that URL, enter the code, and authorize
5. The account appears in the list automatically

---

## Configuration

### Via Settings UI (recommended)

| Setting | Description |
|---------|-------------|
| Twitch Client ID | Required. From dev.twitch.tv/console |
| Drop Alerts | Browser notification when a drop is claimed |
| Points Alerts | Browser notification when points are earned |

### Via Environment Variables

Set in `docker-compose.yml` under `environment:`:

```yaml
environment:
  - TWITCH_CLIENT_ID=abc123def456  # Skips the Settings UI step
  - PORT=3000                       # Change the port (also update `ports:`)
  - DATA_DIR=/app/data              # Where the SQLite DB is stored
  - LOG_LEVEL=debug                 # Enable verbose logging
```

---

## Running Without Docker

```bash
# Install Node.js 20+
node -v  # must be >= 20

# Install dependencies
npm install

# Build the frontend
npm run build

# Start the server
npm run server:dev       # development (auto-reloads)
# OR
node --loader tsx/esm server.ts   # production-like

# Open http://localhost:3000
```

---

## Updating

```bash
# Stop the container
docker compose down

# Unzip new version over the project directory (data/ is safe — it's a volume)
unzip -o twitch-drops-miner-v2.zip

# Rebuild and restart
docker compose up -d --build
```

Your database (`./data/farm.db`) is preserved across updates.

---

## Ports

| Port | Purpose |
|------|---------|
| 3000 | Web UI + REST API + WebSocket |

To run on a different host port:

```yaml
# docker-compose.yml
ports:
  - "8080:3000"   # host:container
```

---

## Common Issues

### "Twitch Client ID required" when clicking Login

The app couldn't find a client ID. Fix:
1. Go to **Settings**
2. Enter your Client ID in the **Twitch Client ID** field
3. Click **Save All**
4. Go to **Accounts** and try again

### "Partial data – Unexpected token '<'" on Dashboard

This means an API route returned the HTML index page instead of JSON. This is fixed in this version — all dashboard endpoints (`/api/points-history`, `/api/active-streams`, `/api/game-distribution`) are properly registered before the SPA catch-all.

### Accounts stop working after a few hours

The token refresh service runs every 30 minutes and proactively refreshes tokens that are within 60 minutes of expiry. If an account shows status `error`, it means the refresh token itself has expired — re-authenticate via **Accounts → Login with Twitch**.

### Container exits immediately

Check logs:
```bash
docker compose logs twitch-drops-miner
```

Common causes:
- Port 3000 is already in use → change `ports: - "3001:3000"`
- `./data/` has permission issues → `chmod 777 ./data`

---

## Backup

The entire state is in a single file:

```bash
cp ./data/farm.db ./data/farm.db.backup
```

To restore, stop the container, replace the file, and restart.

---

## Architecture

```
Browser ─── HTTP/WS ──► Express (port 3000)
                             │
                    ┌────────┴────────┐
                    │                 │
               /api routes       serve dist/
               routes.ts          (Vite build)
               dashboard-routes.ts
                    │
              SQLite (data/farm.db)
                    │
         ┌──────────┼──────────┐
         │          │          │
  TokenRefresh  DropIndexer  ChatFarmer
  (every 30m)  (every 5m)   (PubSub WS)
         │
   ServiceWatchdog wraps all services
   (auto-restart with exponential backoff)
```
