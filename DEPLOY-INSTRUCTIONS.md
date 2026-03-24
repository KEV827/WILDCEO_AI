# WILDCEO AI — UMBREL DEPLOYMENT INSTRUCTIONS
## For the person deploying this: follow every step exactly.

---

## OVERVIEW

You are deploying the **WildCEO AI** app to Umbrel as a **Community App Store**.
The result: a self-hosted AI strategic advisor accessible at `http://umbrel.local:3777`.
Users install it from the Umbrel App Store UI like any other app.

**Architecture:**
```
GitHub Repo (community app store)
    └── wildceo-ai/
        ├── umbrel-app.yml      ← app metadata
        ├── docker-compose.yml  ← Umbrel orchestration (uses app_proxy)
        ├── icon.svg            ← 256x256 app icon
        ├── Dockerfile          ← builds the container
        ├── backend/server.js   ← Node.js Express + multi-LLM routing
        └── frontend/index.html ← Full SPA, zero build step
```

**What the user gets:**
- App shows up in Umbrel App Store after adding the community store
- One-click install
- Opens in browser with WildCEO UI (same dark theme as wildceo.live)
- User configures their LLM provider (Anthropic/OpenAI/OpenRouter/Ollama) in Settings
- Fully functional war room AI advisor

---

## STEP 1: PREREQUISITES

On your development machine (NOT the Umbrel device), install:

```bash
# Docker with buildx (for multi-arch builds)
docker --version        # Must be 20.10+
docker buildx version   # Must be available

# Git
git --version

# GitHub CLI (optional but helpful)
gh --version
```

On the Umbrel device:
- umbrelOS 1.x running (check at http://umbrel.local)
- SSH access: `ssh umbrel@umbrel.local` (password: your umbrel password)
- If using Ollama locally: Ollama must be installed on the Umbrel host machine

---

## STEP 2: CREATE THE GITHUB REPOSITORY

```bash
# Create the repo on GitHub
gh repo create wildceo/wildceo-umbrel-store --public --description "WildCEO AI — Community App Store for Umbrel"

# Or do it manually at https://github.com/new
# Repo name: wildceo-umbrel-store
# Visibility: Public (Umbrel needs to clone it)
```

---

## STEP 3: PUSH THE APP STORE FILES

Copy the entire `wildceo-umbrel-store/` directory contents to the repo:

```bash
cd wildceo-umbrel-store

git init
git remote add origin https://github.com/wildceo/wildceo-umbrel-store.git

# Verify structure
ls -la
# Should show:
#   umbrel-app-store.yml    ← ROOT LEVEL, required
#   wildceo-ai/             ← app directory

ls -la wildceo-ai/
# Should show:
#   umbrel-app.yml
#   docker-compose.yml
#   icon.svg
#   Dockerfile
#   backend/
#   frontend/

git add .
git commit -m "Initial release: WildCEO AI v1.0.0"
git branch -M main
git push -u origin main
```

---

## STEP 4: BUILD AND PUSH THE DOCKER IMAGE

The docker-compose.yml references `ghcr.io/wildceo/wildceo-ai:1.0.0`.
You need to build this image for both ARM64 (Raspberry Pi) and AMD64 (x86 NAS/PC).

```bash
cd wildceo-ai

# Login to GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u wildceo --password-stdin
# (Create a Personal Access Token at https://github.com/settings/tokens with write:packages scope)

# Create a multi-arch builder (one-time setup)
docker buildx create --name multiarch --use
docker buildx inspect --bootstrap

# Build and push multi-arch image
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag ghcr.io/wildceo/wildceo-ai:1.0.0 \
  --tag ghcr.io/wildceo/wildceo-ai:latest \
  --push \
  .

# Verify the image exists
docker manifest inspect ghcr.io/wildceo/wildceo-ai:1.0.0
```

**IMPORTANT:** After pushing, make the package public:
1. Go to https://github.com/orgs/wildceo/packages (or your user packages page)
2. Find `wildceo-ai`
3. Package Settings → Change Visibility → Public

### Get the SHA256 digest (required for production)

```bash
docker manifest inspect ghcr.io/wildceo/wildceo-ai:1.0.0 --verbose | grep digest
```

Then update docker-compose.yml to pin the digest:
```yaml
image: ghcr.io/wildceo/wildceo-ai:1.0.0@sha256:YOUR_DIGEST_HERE
```

Commit and push the updated docker-compose.yml.

---

## STEP 5: INSTALL ON UMBREL

### Option A: Via Umbrel UI (recommended for end users)

1. Open Umbrel in your browser: `http://umbrel.local`
2. Go to **App Store**
3. Click the **⋯ (three dots)** menu in the top-right corner
4. Click **"Community App Stores"**
5. Paste this URL: `https://github.com/wildceo/wildceo-umbrel-store`
6. Click **Add**
7. Click **Open** to browse the WildCEO store
8. Click **Install** on WildCEO AI
9. Wait for download + container start (~30 seconds)
10. Click **Open** → app loads at `http://umbrel.local:3777`

### Option B: Via CLI (for development/testing)

```bash
# SSH into Umbrel
ssh umbrel@umbrel.local

# Install via umbreld CLI
umbreld client apps.install.mutate --appId wildceo-ai
```

---

## STEP 6: CONFIGURE THE APP

After installation, open the app and:

1. Click **Settings** (gear icon in sidebar footer)
2. Choose **Provider**:
   - **Anthropic** → paste your `sk-ant-...` key → model: `claude-sonnet-4-20250514`
   - **OpenAI** → paste your `sk-...` key → model: `gpt-4o`
   - **OpenRouter** → paste your `sk-or-...` key → model: `anthropic/claude-sonnet-4-20250514`
   - **Ollama** → no key needed → model: `llama3` → base URL: `http://host.docker.internal:11434`
3. Click **⚡ Test Connection**
4. If green ✓ → click **Save Settings**
5. Start a new War Room conversation

---

## STEP 7: OLLAMA SETUP (for fully offline mode)

If using Ollama on the same machine as Umbrel:

```bash
# SSH into Umbrel host
ssh umbrel@umbrel.local

# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model
ollama pull llama3
# Or for better quality (needs 16GB+ RAM):
ollama pull llama3:70b
# Or smaller/faster:
ollama pull mistral
ollama pull phi3

# Verify it's running
curl http://localhost:11434/api/tags
```

In the WildCEO AI settings:
- Provider: **Ollama**
- Model: `llama3` (or whichever you pulled)
- Base URL: `http://host.docker.internal:11434`

The `host.docker.internal` works because the docker-compose.yml includes:
```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

This maps to the Umbrel host machine where Ollama runs.

---

## STEP 8: GALLERY SCREENSHOTS

Umbrel shows screenshots in the App Store listing. You need 3 JPG images:

**Required specs:** 1440×900 pixels, JPG format, named `1.jpg`, `2.jpg`, `3.jpg`

**What to screenshot:**
1. `1.jpg` — The chat interface with a conversation showing a WildCEO response (with THE MOVE section visible)
2. `2.jpg` — The Settings panel showing LLM provider selection
3. `3.jpg` — The welcome screen showing all 4 war room modes

**How to create them:**
1. Install the app on Umbrel
2. Configure it and have a conversation
3. Take browser screenshots at 1440×900
4. Save as JPG in `wildceo-ai/gallery/`
5. Commit and push

---

## STEP 9: VERIFY EVERYTHING WORKS

### Checklist

```
[ ] GitHub repo is public and contains:
    [ ] umbrel-app-store.yml at root
    [ ] wildceo-ai/ directory with all files
    [ ] icon.svg is 256x256

[ ] Docker image is:
    [ ] Built for linux/amd64 AND linux/arm64
    [ ] Pushed to ghcr.io/wildceo/wildceo-ai:1.0.0
    [ ] Package is set to Public on GitHub
    [ ] SHA256 digest pinned in docker-compose.yml

[ ] On Umbrel:
    [ ] Community store added successfully
    [ ] App appears in store with correct icon and description
    [ ] App installs without errors
    [ ] App opens in browser
    [ ] Settings page loads
    [ ] LLM connection test passes
    [ ] Chat works and responds with WildCEO personality
    [ ] Conversations persist after app restart
    [ ] Ollama connection works (if applicable)
    [ ] Mobile view works (test from phone on same network)
```

---

## STEP 10: UPDATES

To push updates:

1. Update the code in `backend/` or `frontend/`
2. Bump version in `umbrel-app.yml` (e.g., `"1.0.1"`)
3. Add release notes in `umbrel-app.yml`
4. Build and push new Docker image:
```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag ghcr.io/wildceo/wildceo-ai:1.0.1 \
  --tag ghcr.io/wildceo/wildceo-ai:latest \
  --push \
  .
```
5. Update the image tag + SHA256 in `docker-compose.yml`
6. Commit and push to GitHub
7. On Umbrel: the App Store auto-detects updates → user clicks "Update"

---

## TROUBLESHOOTING

### "App with ID not found"
The app ID in `umbrel-app.yml` must match the directory name.
Directory: `wildceo-ai/` → ID: `wildceo-ai`

### Container won't start
```bash
ssh umbrel@umbrel.local
docker logs wildceo-ai_server_1
```

### App proxy issues (blank page)
Check that APP_HOST in docker-compose.yml matches: `wildceo-ai_server_1`
(Pattern: `<app-id>_<service-name>_1`)

### Ollama can't connect
```bash
# Test from inside the container
ssh umbrel@umbrel.local
docker exec -it wildceo-ai_server_1 /bin/sh
wget -qO- http://host.docker.internal:11434/api/tags
```
If this fails, Ollama isn't running on the host or the port is blocked.

### Data persistence
All data lives in: `~/umbrel/app-data/wildceo-ai/data/`
- `config.json` — LLM provider settings + API key
- `conversations.json` — chat history  
- `license.json` — license tier info

### Restart the app
```bash
umbreld client apps.restart.mutate --appId wildceo-ai
```

### Full reinstall (destroys data!)
```bash
umbreld client apps.uninstall.mutate --appId wildceo-ai
umbreld client apps.install.mutate --appId wildceo-ai
```

---

## DESIGN NOTES

The frontend (frontend/index.html) uses the **exact WildCEO brand identity**:
- **Background:** `#06090F` (deep navy, matches wildceo.live)
- **Accent:** `#E6007E` (WildCEO pink)
- **Secondary:** `#00D4FF` (cyan for status/tags)
- **Font:** DM Sans (body) + JetBrains Mono (code/labels)
- **Pattern:** Dark sidebar + main chat area + floating input
- **Mode tabs:** ♟ STRATEGY | ⚔ FIGHT | ⚡ BUILD | 🔥 LEAD

If you need to match wildceo.live even more closely, update the CSS variables
at the top of `frontend/index.html`. The entire UI is in one file — no build step needed.

---

## FILE INVENTORY

```
wildceo-umbrel-store/
├── umbrel-app-store.yml              ← Community store manifest (2 lines)
├── README.md                         ← Store description for GitHub
└── wildceo-ai/                       ← The app
    ├── umbrel-app.yml                ← App manifest for Umbrel
    ├── docker-compose.yml            ← Umbrel orchestration with app_proxy
    ├── Dockerfile                    ← Multi-arch container build
    ├── icon.svg                      ← 256×256 app icon
    ├── backend/
    │   ├── package.json              ← Node.js dependencies
    │   └── server.js                 ← Express server + LLM routing + license system
    ├── frontend/
    │   └── index.html                ← Full SPA (zero build step, ~37KB)
    └── gallery/
        ├── 1.jpg                     ← Screenshot: chat interface (YOU CREATE THIS)
        ├── 2.jpg                     ← Screenshot: settings panel (YOU CREATE THIS)
        └── 3.jpg                     ← Screenshot: welcome screen (YOU CREATE THIS)
```

---

**Total deploy time: ~15 minutes** (excluding Docker build which takes ~5 min first time)

Questions? Mark knows the architecture. The app code is self-contained and documented.
