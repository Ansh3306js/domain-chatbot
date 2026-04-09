# Domain-Specific Chatbot 🤖

A lightweight chatbot that fetches knowledge from a Git repository
and uses Claude (Anthropic's LLM) to answer questions about that domain.

## Zero-install prerequisites

- Node.js (any version ≥ 14)  → https://nodejs.org
- A free Anthropic API key    → https://console.anthropic.com

---

## 1. Set your API key

**Mac / Linux:**
```bash
export ANTHROPIC_API_KEY="sk-ant-YOUR_KEY_HERE"
```

**Windows (Command Prompt):**
```cmd
set ANTHROPIC_API_KEY=AIzaSyCPD8-U606ki6Upx19-brpJBYB2PTiSQtA
```

---

## 2. Start the server

```bash
node server.js
```

You will see:
```
🔄  Fetching domain data from Git repository...
✅  Domain data loaded (XXXX characters)
🚀  Chatbot server running at http://localhost:3000
```

---

## 3. Use it

### Browser UI (easiest)
Open http://localhost:3000 in your browser.

### curl (terminal)
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is this project about?"}'
```

### Health check
```bash
curl http://localhost:3000/health
```

---

## How to use YOUR own domain data

Open `server.js` and change this line:

```js
const DOMAIN_DATA_URL =
  "https://raw.githubusercontent.com/nicholasgasior/gsfmt/master/README.md";
```

Replace the URL with the **raw** URL of any plain-text or JSON file in
a public GitHub/GitLab repository. Example:

```
https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/main/faq.txt
```

Restart the server. Done.

---

## Project structure

```
chatbot/
├── server.js    ← backend: HTTP server + Claude API + Git data fetch
├── index.html   ← frontend: chat UI served at GET /
├── package.json ← project metadata (no npm dependencies!)
└── README.md    ← this file
```

---

## API reference

### POST /chat
Request body:
```json
{ "message": "your question here" }
```
Response:
```json
{ "reply": "Claude's answer based on the domain data" }
```

### GET /health
```json
{ "status": "ok", "domainDataLoaded": true, "domainDataChars": 1234 }
```
