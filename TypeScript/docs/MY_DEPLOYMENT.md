# My Deployment Guide

Personal deployment guide for the Polymarket Copy Trading Bot on DigitalOcean.

## Table of Contents

- [Prerequisites](#prerequisites)
- [SSH Setup](#ssh-setup)
- [Creating the Droplet](#creating-the-droplet)
- [Server Setup](#server-setup)
- [Deploying the Bot](#deploying-the-bot)
- [Managing Files Remotely](#managing-files-remotely)
- [Updating Configuration](#updating-configuration)
- [Updating Code](#updating-code)
- [Monitoring](#monitoring)
- [Stopping and Starting](#stopping-and-starting)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before starting, you need:

1. **DigitalOcean account** with billing configured
2. **Polygon wallet** -- a **dedicated** wallet (not your main one) funded with:
   - USDC for trading capital ($500-1000 recommended to start)
   - Small amount of POL for gas (~$5 worth)
3. **Polygon RPC endpoint** -- free tier from [Infura](https://infura.io), [Alchemy](https://alchemy.com), or [QuickNode](https://quicknode.com)
4. **Private key** for the Polygon wallet (without the `0x` prefix)

---

## SSH Setup

### Generate an SSH Key (if you don't have one)

On your Mac:

```bash
# Generate a new key pair (press Enter to accept defaults, optionally set a passphrase)
ssh-keygen -t ed25519 -C "polymarket-droplet"

# This creates two files:
#   ~/.ssh/id_ed25519       (private key -- never share this)
#   ~/.ssh/id_ed25519.pub   (public key -- this goes on the server)
```

If you already have keys in `~/.ssh/`, you can reuse them. Check with:

```bash
ls ~/.ssh/*.pub
```

### Add Your Public Key to DigitalOcean

1. Copy your public key to clipboard:

```bash
pbcopy < ~/.ssh/id_ed25519.pub
```

2. Go to **DigitalOcean > Settings > Security > SSH Keys > Add SSH Key**
3. Paste the key and give it a name (e.g., "MacBook")

### Connect to the Droplet

Once the droplet is created:

```bash
ssh root@<droplet-ip>
```

First connection will ask you to confirm the fingerprint -- type `yes`.

### (Optional) Set Up an SSH Config Alias

Add this to `~/.ssh/config` to avoid typing the IP every time:

```
Host polybot
    HostName <droplet-ip>
    User root
    IdentityFile ~/.ssh/id_ed25519
```

Then connect with just:

```bash
ssh polybot
```

---

## Creating the Droplet

In the DigitalOcean dashboard:

```
Create > Droplets
  Region:          AMS (Amsterdam) — see note below
  Image:           Ubuntu 24.04 LTS
  Size:            Basic > Regular > $12/mo (2GB RAM, 1 vCPU, 50GB SSD)
  Authentication:  SSH key (select the one you added above)
  Hostname:        polymarket-bot
```

**Region note:** Polymarket's CLOB matching engine runs on **AWS eu-west-2 (London)**, with AWS eu-west-1 (Ireland) as backup ([source](https://quantvps.com/blog/polymarket-servers-location)). DigitalOcean **Amsterdam (AMS3)** is the best choice for colocation — it's the closest non-geo-restricted region at **5-10ms** to London. By comparison, NYC has **70-80ms** latency to London. DigitalOcean has a London region (LON1), but the UK has historically been geo-blocked by Polymarket. For copy trading specifically, this latency difference is negligible (you're following trades that play out over hours/days), but Amsterdam is the right pick if you want the option of faster strategies later.

Note the IP address after creation.

---

## Server Setup

SSH into the new droplet and install Docker:

```bash
ssh root@<droplet-ip>

# Update system packages
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Docker Compose plugin
apt install -y docker-compose-plugin

# Verify installation
docker --version
docker compose version
```

---

## Deploying the Bot

### Clone and Configure

```bash
cd /opt
git clone https://github.com/<your-fork>/Polymarket-Copy-Trading-Bot.git
cd Polymarket-Copy-Trading-Bot/TypeScript

# Create .env from template
cp .env.example .env
chmod 600 .env

# Edit configuration
nano .env
```

### Key .env Values

```ini
# ── Traders to copy ──
# Recommended starting set: kch123 (best track record) + anoin123 (best risk profile)
USER_ADDRESSES = '0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee,0x96489abcb9f583d6835c8ef95ffc923d05a86825'

# ── Your wallet ──
PROXY_WALLET = '0xYourPolygonWalletAddress'
PRIVATE_KEY = 'your_private_key_without_0x'

# ── Database (local, handled by docker-compose) ──
MONGO_URI = 'mongodb://mongodb:27017/polymarket_copytrading'

# ── Blockchain ──
RPC_URL = 'https://polygon-mainnet.infura.io/v3/YOUR_KEY'

# ── Copy strategy (start conservative) ──
COPY_STRATEGY = 'FIXED'
COPY_SIZE = 5.0
MAX_ORDER_SIZE_USD = 25.0
MIN_ORDER_SIZE_USD = 1.0

# ── IMPORTANT: Start in preview mode ──
PREVIEW_MODE = true

# ── Polling ──
FETCH_INTERVAL = 1
```

### Start in Preview Mode

```bash
docker compose up -d
docker compose logs -f bot
```

In `PREVIEW_MODE = true`, the bot monitors and logs trades it **would** make without actually executing them. Run this for **at least 24-48 hours** and verify:

- Bot starts without errors
- Trade detection is working (log entries appear for target trader activity)
- Position sizing looks reasonable for your capital
- No connection timeouts or rate limiting
- MongoDB is storing data

### Go Live

Once preview looks good:

```bash
nano .env
# Change: PREVIEW_MODE = false
# Optionally adjust COPY_SIZE based on what you observed

# Restart to pick up changes
docker compose restart bot
docker compose logs -f bot
```

---

## Managing Files Remotely

### Option 1: VS Code / Cursor Remote SSH (Recommended)

Both VS Code and Cursor support editing files directly on the server:

1. Install the **Remote - SSH** extension (already built into Cursor)
2. Open the command palette: `Cmd+Shift+P`
3. Type `Remote-SSH: Connect to Host...`
4. Enter `root@<droplet-ip>` (or `polybot` if you set up the SSH config alias)
5. A new window opens connected to the server
6. Open the folder: `/opt/Polymarket-Copy-Trading-Bot/TypeScript`

This gives you the full editor experience (file tree, syntax highlighting, terminal) as if the files were local. You can edit `.env`, view logs, and manage files without remembering terminal commands.

**After editing `.env` via the remote editor**, you still need to restart the bot to pick up changes. Use the integrated terminal in the remote session:

```bash
cd /opt/Polymarket-Copy-Trading-Bot/TypeScript
docker compose restart bot
```

### Option 2: Terminal (nano/vim)

```bash
ssh root@<droplet-ip>
cd /opt/Polymarket-Copy-Trading-Bot/TypeScript
nano .env
```

### Option 3: SCP (Copy Files Between Local and Server)

```bash
# Upload a file to the server
scp ./my-file.txt root@<droplet-ip>:/opt/Polymarket-Copy-Trading-Bot/TypeScript/

# Download a file from the server
scp root@<droplet-ip>:/opt/Polymarket-Copy-Trading-Bot/TypeScript/.env ./env-backup
```

---

## Updating Configuration

### When You Edit .env

The `.env` file is read at container startup. After any change, you **must restart** the bot:

```bash
cd /opt/Polymarket-Copy-Trading-Bot/TypeScript

# Edit the config
nano .env

# Restart the bot container (MongoDB stays running)
docker compose restart bot

# Verify the bot started cleanly
docker compose logs -f bot
```

`docker compose restart bot` only restarts the bot container -- MongoDB keeps running and retains all data. There is no downtime risk to the database.

### Common Config Changes

**Swapping traders:**

```ini
# Change USER_ADDRESSES to new trader wallets
USER_ADDRESSES = '0xNewTrader1,0xNewTrader2'
```

Then `docker compose restart bot`.

**Adjusting position sizing:**

```ini
COPY_SIZE = 10.0           # increase per-trade amount
MAX_ORDER_SIZE_USD = 50.0  # raise the cap
```

Then `docker compose restart bot`.

**Switching back to preview mode:**

```ini
PREVIEW_MODE = true
```

Then `docker compose restart bot`. Useful if you want to observe a new trader before committing real capital.

---

## Updating Code

When you make changes to the bot code locally (or pull upstream updates):

### From Your Local Machine

```bash
# Push your changes to your fork
git add . && git commit -m "description" && git push
```

### On the Server

```bash
ssh root@<droplet-ip>
cd /opt/Polymarket-Copy-Trading-Bot/TypeScript

# Pull latest code
git pull origin main

# Rebuild and restart (--build forces a fresh Docker image)
docker compose up -d --build

# Verify
docker compose logs -f bot
```

**Note:** `docker compose up -d --build` rebuilds the bot container image with the new code. This takes 30-60 seconds. The bot will be briefly offline during the rebuild. MongoDB keeps running throughout.

---

## Monitoring

### View Live Logs

```bash
docker compose logs -f bot           # bot logs only
docker compose logs -f               # all containers (bot + mongodb)
docker compose logs --tail 100 bot   # last 100 lines
```

### Check Container Status

```bash
docker compose ps
```

Healthy output looks like:

```
NAME                          STATUS
polymarket-copy-trading-bot   Up 2 hours (healthy)
polymarket-mongodb            Up 2 hours (healthy)
```

### Check MongoDB Data

```bash
docker compose exec mongodb mongosh polymarket_copytrading --eval "db.getCollectionNames()"
```

### Check Disk Space

```bash
df -h
```

### Re-run Trader Analysis (Local)

Periodically re-evaluate your copy targets from your local machine:

```bash
cd TypeScript
npm run analyze-trader -- --traders "kch123,anoin123,Countryside,MrSparklySimpsons,DrPufferfish"
```

If a trader's performance has degraded, swap them out in the server's `.env` and restart.

---

## Stopping and Starting

```bash
cd /opt/Polymarket-Copy-Trading-Bot/TypeScript

# Stop everything (bot + MongoDB)
docker compose down

# Start everything
docker compose up -d

# Stop just the bot (keep MongoDB running)
docker compose stop bot

# Start just the bot
docker compose start bot

# Restart just the bot (e.g., after .env changes)
docker compose restart bot
```

**Data persistence:** MongoDB data is stored in Docker volumes (`mongodb-data`, `mongodb-config`). Running `docker compose down` stops containers but preserves volumes. Your trade history and tracking data survive restarts.

To **destroy everything including data** (nuclear option):

```bash
docker compose down -v   # -v removes volumes -- ALL DATA LOST
```

---

## Troubleshooting

### Bot Won't Start

```bash
# Check logs for errors
docker compose logs bot

# Common issues:
# - Missing .env values -> check all required fields are set
# - MongoDB connection refused -> ensure mongodb container is running
# - RPC errors -> verify your Infura/Alchemy key is valid
```

### Bot Starts But No Trades Detected

```bash
# Verify the traders you're copying are actually active
# Run the analyzer locally:
npm run analyze-trader -- --traders "0xTraderAddress"

# Check if FETCH_INTERVAL is too high (should be 1-3)
# Check if TOO_OLD_TIMESTAMP is too low
```

### Container Keeps Restarting

```bash
# Check exit code
docker compose ps -a

# Check for crash loops
docker compose logs --tail 50 bot
```

### Out of Disk Space

```bash
# Check usage
df -h

# Clean up old Docker images
docker system prune -f
```

### Can't SSH to Server

```bash
# Verify the IP is correct
ping <droplet-ip>

# Try with verbose output to see where it fails
ssh -v root@<droplet-ip>

# If locked out, use DigitalOcean's web console:
# Droplet > Access > Launch Recovery Console
```
