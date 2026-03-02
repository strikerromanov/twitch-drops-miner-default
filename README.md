# 🎮 Twitch Drops Farmer

**Advanced Twitch drops mining application with automated point claiming, algorithmic betting, and drop campaign tracking.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node-20.x-brightgreen)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue)](https://www.docker.com)
[![GitHub](https://img.shields.io/badge/Gateway-2.1.0-purple)](https://github.com/strikerromanov/twitch-drops-miner-default)

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

### 1. Twitch API Setup

1. Go to [Twitch Dev Console](https://dev.twitch.tv/console/apps)
2. Create a new application
3. Copy your **Client ID**
4. Note: No Client Secret needed for Device Code Flow

### 2. Configure Application

1. Open the web interface
2. Go to **Settings** → Enter your **Twitch Client ID**
3. Click **Save Changes**

### 3. Add Account

1. Click **"Add Account via Device Code"**
2. A device code will be displayed
3. Go to [twitch.tv/activate](https://www.twitch.tv/activate)
4. Enter the code
5. Approve the authorization

### 4. Start Farming

1. Toggle your account to **Farming** status
2. Watch drops and points accumulate automatically!

## 📊 Features Explained

### Drop Farming
- Fetches campaigns from Twitch GraphQL API
- Tracks progress per campaign
- Automatically switches streams to complete drops
- Supports multiple simultaneous campaigns

### Point Farming
- Uses WebSocket PubSub for real-time bonus detection
- Claims bonus points automatically
- Tracks all claims in database
- Works on both followed channels and allocated streams

### Betting Engine
- **Kelly Criterion** - Mathematical optimal betting
- **Risk Levels**:
  - Conservative: Half Kelly (safer, slower growth)
  - Moderate: Three-quarter Kelly (balanced)
  - Aggressive: Full Kelly (maximum growth, higher risk)
- **Auto-Skip** - Avoids poor performing streamers
- **Sample Size Building** - Starts conservative, increases with data

### Token Management
- Checks token expiry every 30 minutes
- Refreshes tokens within 60 minutes of expiry
- Updates database with new tokens
- Prevents authentication interruptions

## 🛠️ Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build:all

# Run tests
npm test

# Start production server
npm start
```

## 📝 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stats` | GET | Get overall statistics |
| `/api/accounts` | GET | List all accounts |
| `/api/accounts/:id/toggle` | POST | Toggle farming status |
| `/api/auth/device` | POST | Request device code |
| `/api/auth/device/poll` | POST | Poll for authorization |
| `/api/settings` | GET/POST | Manage settings |
| `/api/campaigns` | GET | Get drop campaigns |

## 🔧 Advanced Settings

| Setting | Range | Default | Description |
|---------|-------|---------|-------------|
| `maxBetPercentage` | 1-20% | 5% | Max bet per wager |
| `bettingStrategy` | conservative/moderate/aggressive | conservative | Risk level |
| `tokenRefreshInterval` | 5-60 min | 30 min | Token check frequency |

## 📈 Technology Stack

- **Backend:** Node.js + Express + TypeScript
- **Database:** SQLite with better-sqlite3
- **Real-time:** WebSocket (ws)
- **Container:** Docker (Alpine Linux)

## 🐳 Docker Deployment

### Environment Variables

```bash
PORT=3000
NODE_ENV=production
DATABASE_PATH=/app/data/farm.db
```

### Docker Compose

```yaml
services:
  twitch-drops-farmer:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

## 📁 Project Structure

```
twitch-drops-miner-default/
├── src/
│   ├── core/           # Core utilities (auth, db, logger)
│   ├── services/       # Background services
│   │   ├── betting.service.ts
│   │   ├── campaign-discovery.service.ts
│   │   ├── chat-farmer.service.ts
│   │   ├── drop-indexer.service.ts
│   │   ├── followed-channels.service.ts
│   │   ├── point-claimer.service.ts
│   │   ├── stream-allocator.service.ts
│   │   └── token-refresh.service.ts
│   └── api/            # API routes
├── server.ts           # Main server entry point
├── docker-compose.yml
└── package.json
```

## 🔍 Troubleshooting

### Container won't start
```bash
# Check logs
docker compose logs -f
```

### Points not claiming
1. Check account is in "Farming" status
2. Verify Client ID is correct
3. Check logs for connection errors

### Betting not working
1. Ensure betting is enabled
2. Verify account has sufficient points
3. Check streamer statistics

## 🤝 Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## ⚠️ Disclaimer

This tool is for educational purposes only. Please respect Twitch's Terms of Service.

---

**Made with ❤️ by [strikerromanov](https://github.com/strikerromanov)**

**Live Demo:** http://192.168.1.99:3000
