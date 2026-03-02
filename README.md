# 🎮 Twitch Drops Farmer

**Advanced Twitch drops mining application with automated point claiming, algorithmic betting, and drop campaign tracking.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node-20.x-brightgreen)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue)](https://www.docker.com)
[![GitHub](https://img.shields.io/badge/Gateway-2.1.0-purple)](https://github.com/strikerromanov/twitch-drops-miner-default)

## ⚠️ IMPORTANT - Client ID Required

**This application requires your own Twitch Client ID to work.**

The default Twitch web Client-ID does NOT work with OAuth authentication.

### Getting Your Client ID (Required)

1. Go to **https://dev.twitch.tv/console**
2. Click **"Register Your Application"**
3. Fill in the form:
   - **Name:** `Twitch Drops Farmer` (or any name you like)
   - **OAuth Redirect URLs:** `http://localhost:3000` (or your deployment URL)
   - **Category:** `Website Integration` (or any category)
4. Click **"Create"**
5. Copy your **Client ID** (you don't need Client Secret for Device Code Flow)

### Set Your Client ID

Once you have your Client ID, set it in the app:

```bash
curl -X PUT http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  -d '{"twitchClientId":"YOUR_CLIENT_ID_HERE"}'
```

Or via the web UI at `http://localhost:3000` → Settings

## ✨ Features

### 🎯 Core Features
- ✅ **Automated Drop Farming** - Automatic discovery and tracking of Twitch drop campaigns
- ✅ **Point Farming** - Real-time bonus point claiming via PubSub WebSocket
- ✅ **Algorithmic Betting** - Kelly Criterion strategy with risk mitigation
- ✅ **Multi-Account Support** - Farm with unlimited accounts simultaneously
- ✅ **24/7 Operation** - Automatic token refresh prevents re-authentication

### 🚀 Advanced Features
1. **Device Code Flow Authentication** - No redirect URI needed, perfect for headless environments
2. **Token Refresh Automation** - Refresh tokens before expiry for continuous farming
3. **Intelligent Stream Allocation** - Automatically allocates accounts to suitable streams
4. **Chat Point Farming** - Listens to bonus point events via PubSub
5. **Kelly Criterion Betting** - Mathematical optimal betting with configurable strategies
6. **Real-time Updates** - WebSocket for live status updates
7. **Multi-Account Coordination** - Prevents duplicate stream watching

## 📦 Quick Start

### Option 1: Docker (Recommended)

```bash
git clone https://github.com/strikerromanov/twitch-drops-miner-default.git
cd twitch-drops-miner-default
docker compose up -d
```

Access at: **http://localhost:3000**

### Option 2: Manual Installation

```bash
git clone https://github.com/strikerromanov/twitch-drops-miner-default.git
cd twitch-drops-miner-default
npm install
npm run build:all
npm start
```

## ⚙️ Configuration

### Required: Twitch Client ID

1. Go to https://dev.twitch.tv/console
2. Register a new application
3. Copy the Client ID
4. Set it in the app settings

### Optional Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `THEME_MODE` | UI theme (dark/light/auto) | `auto` |
| `NOTIFY_DROPS` | Drop notifications | `true` |
| `NOTIFY_POINTS` | Point claim notifications | `true` |
| `NOTIFY_ERRORS` | Error notifications | `true` |

## 📖 Setup Guide

### 1. Configure Client ID

```bash
curl -X PUT http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  -d '{"twitchClientId":"your_client_id_here"}'
```

### 2. Add Your Twitch Account

1. Open `http://localhost:3000`
2. Go to **Accounts** page
3. Click **"Add Account"**
4. You'll see a code (e.g., `ABCD1234`)
5. Go to `https://www.twitch.tv/activate`
6. Enter the code and authorize
7. The app will automatically save your account

### 3. Start Farming

1. Go to **Accounts** page
2. Toggle account to **"Farming"** status
3. The app will automatically:
   - Discover active drop campaigns
   - Allocate you to suitable streams
   - Monitor drop progress
   - Claim bonus points

## 📡 API Endpoints

### Authentication
```bash
# Request device code
POST /api/auth/device
Body: { "clientId": "your_client_id" }

# Poll for token
POST /api/auth/device/poll
Body: { "clientId": "your_client_id", "deviceCode": "..." }

# Check status
GET /api/auth/status
```

### Settings
```bash
GET  /api/settings
PUT  /api/settings
GET  /api/settings/meta
```

### Accounts
```bash
GET     /api/accounts
POST    /api/accounts/:id/toggle
DELETE  /api/accounts/:id
```

### Campaigns
```bash
GET /api/campaigns
```

### Stats & Health
```bash
GET /api/stats
GET /api/health
GET /api/logs
```

### Betting
```bash
GET /api/betting/stats
GET /api/betting/history
POST /api/betting/toggle
POST /api/betting/config
```

## 🎰 Betting System

The Kelly Criterion is used for optimal bet sizing:

**Formula:** f* = (bp - q) / b

Where:
- b = odds - 1
- p = probability of winning
- q = probability of losing (1 - p)

### Strategies

1. **Conservative** - Half Kelly (0.5 × f*)
2. **Moderate** - Three-quarter Kelly (0.75 × f*)
3. **Aggressive** - Full Kelly (1.0 × f*)

### Features

- Automatic streamer analysis
- Win/loss tracking
- ROI calculation
- Configurable max bet percentage

## 🔧 Services Architecture

```
┌─────────────────────────────────────────────────┐
│              Twitch Drops Farmer                │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─────────────┐  ┌──────────────┐            │
│  │   Token     │  │  Campaign    │            │
│  │   Refresh   │  │  Discovery   │            │
│  │   Service   │  │   Service    │            │
│  └──────┬──────┘  └──────┬───────┘            │
│         │                 │                     │
│         ▼                 ▼                     │
│  ┌────────────────────────────────┐           │
│  │     Service Watchdog          │           │
│  │  (Auto-restart on failure)    │           │
│  └────────────────────────────────┘           │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │  Stream  │  │   Drop   │  │   Chat    │  │
│  │Allocator │  │ Indexer  │  │  Farmer   │  │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘  │
│       │             │              │          │
│       ▼             ▼              ▼          │
│  ┌─────────────────────────────────────┐    │
│  │        Multi-Account Coordination    │    │
│  └─────────────────────────────────────┘    │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │  Point   │  │  Followed│  │  Betting  │  │
│  │ Claimer  │  │ Channels │  │  Service  │  │
│  └──────────┘  └──────────┘  └───────────┘  │
└─────────────────────────────────────────────────┘
```

### Service Details

| Service | Interval | Description |
|---------|----------|-------------|
| Token Refresh | 30 min | Refreshes tokens before expiry |
| Campaign Discovery | 10 min | Finds active campaigns via Helix API |
| Stream Allocator | 5 min | Allocates accounts to suitable streams |
| Drop Indexer | 1 min | Monitors drop progress |
| Point Claimer | 2 min | Claims available bonus points |
| Chat Farmer | Continuous | Listens for bonus claims via PubSub |
| Betting Service | 1 min | Places bets on predictions |

## 🐛 Troubleshooting

### "Client ID is invalid" or 404 errors

**Solution:** You must use your own Twitch Client ID from https://dev.twitch.tv/console

The default web Client ID (`kimne78kx3ncx6brgo4mv6wki5h1ko`) doesn't work with OAuth.

### Account shows as "error"

**Solution:** Token may have expired. Re-add your account.

### No streams being allocated

**Possible causes:**
- No active campaigns for your account
- All campaigns have ended
- No suitable streams found

### Points not claiming

**Possible causes:**
- Internet connection issues
- Account not in "farming" status
- PubSub connection failed

## 📝 Environment Variables

```bash
# Database
DATABASE_PATH=/path/to/database.db

# Server
PORT=3000
NODE_ENV=production

# Twitch (optional - can be set via UI)
TWITCH_CLIENT_ID=your_client_id_here
```

## 📁 Project Structure

```
twitch-drops-miner-default/
├── src/
│   ├── api/              # API routes
│   │   ├── routes.ts     # Main API endpoints
│   │   └── dashboard-routes.ts
│   ├── core/             # Core utilities
│   │   ├── db.ts         # Database schema & setup
│   │   ├── auth.ts       # OAuth & device code flow
│   │   └── logger.ts     # Logging utilities
│   └── services/         # Background services
│       ├── token-refresh.service.ts
│       ├── campaign-discovery.service.ts
│       ├── stream-allocator.service.ts
│       ├── drop-indexer.service.ts
│       ├── point-claimer.service.ts
│       ├── chat-farmer.service.ts
│       ├── followed-channels.service.ts
│       ├── betting.service.ts
│       └── service-watchdog.ts
├── dist/                 # Built frontend
├── public/               # Frontend source
├── server.ts             # Main server entry
├── package.json
└── tsconfig.json
```

## 🛠️ Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build frontend only
npm run build

# Build server only
npm run build:server

# Build everything
npm run build:all

# Run tests
npm test
```

## 🚀 Deployment

### Docker

```bash
docker-compose up -d
```

### Manual

```bash
NODE_ENV=production npm start
```

### Using PM2

```bash
npm install -g pm2
pm2 start npm --name "twitch-drops" -- start
pm2 save
pm2 startup
```

## 📊 Monitoring

### Health Check

```bash
curl http://localhost:3000/api/health
```

Response includes:
- Service status
- System uptime
- Memory usage
- Active campaigns

### Real-time Updates

Connect to WebSocket for live updates:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data);
};
```

## 📝 License

MIT License - see LICENSE file for details

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## ⚠️ Disclaimer

This tool is for educational purposes only. Use responsibly and in accordance with Twitch's Terms of Service.

## 🙏 Credits

Built with:
- Express.js
- better-sqlite3
- WebSocket (ws)
- Twitch Helix API
- Twitch PubSub

---

**Made with ❤️ for the Twitch community**
