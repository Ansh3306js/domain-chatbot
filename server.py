"""
server.py — Domain-Specific Chatbot Backend (Python version)

What this file does:
 1. Starts an HTTP server on port 3000
 2. Fetches "domain data" (FAQ/knowledge) from a public Git repo
 3. Exposes a POST /chat endpoint that accepts a user question
 4. Injects the domain data into a prompt and calls the Gemini API
 5. Returns the AI's answer as JSON

Run with:  python server.py
"""

import os
import json
import urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler

# ─── CONFIGURATION ────────────────────────────────────────────────────────────

PORT = 3000

# Set your Gemini API key as an environment variable before running:
#   Windows CMD:        set GEMINI_API_KEY=AIza...
#   Windows PowerShell: $env:GEMINI_API_KEY="AIza..."
#   Mac/Linux:          export GEMINI_API_KEY="AIza..."
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "AIzaSyCPD8-U606ki6Upx19-brpJBYB2PTiSQtA")

# Raw URL of a plain-text file in a public Git repo (your domain knowledge)
DOMAIN_DATA_URL = "https://raw.githubusercontent.com/nicholasgasior/gsfmt/master/README.md"

# ─── GLOBAL STATE ─────────────────────────────────────────────────────────────

domain_context = ""

# ─── HELPER: fetch domain data from Git ──────────────────────────────────────

def fetch_domain_data(url):
    with urllib.request.urlopen(url) as response:
        return response.read().decode("utf-8")

# ─── HELPER: call Gemini API ─────────────────────────────────────────────────

def ask_gemini(user_message):
    prompt = f"""You are a helpful domain-specific assistant.
Use ONLY the following reference material to answer questions.
If the answer is not in the reference material, say so honestly.

=== DOMAIN REFERENCE MATERIAL (fetched from Git) ===
{domain_context}
=== END OF REFERENCE MATERIAL ===

User question: {user_message}"""

    request_body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}]
    }).encode("utf-8")

    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"

    req = urllib.request.Request(
        api_url,
        data=request_body,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    with urllib.request.urlopen(req) as response:
        result = json.loads(response.read().decode("utf-8"))
        return result["candidates"][0]["content"]["parts"][0]["text"]

# ─── HTTP REQUEST HANDLER ─────────────────────────────────────────────────────

class ChatHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        # Custom log format
        print(f"[{self.command}] {self.path} — {args[1]}")

    def send_json(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        # Serve the chat UI
        if self.path == "/":
            try:
                with open("index.html", "r", encoding="utf-8") as f:
                    html = f.read().encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(html)
            except FileNotFoundError:
                self.send_json(404, {"error": "index.html not found"})

        # Health check
        elif self.path == "/health":
            self.send_json(200, {
                "status": "ok",
                "domainDataLoaded": len(domain_context) > 0,
                "domainDataChars": len(domain_context)
            })

        else:
            self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path == "/chat":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")

            try:
                data = json.loads(body)
                message = data.get("message", "").strip()

                if not message:
                    return self.send_json(400, {"error": "message field is required"})

                if not GEMINI_API_KEY:
                    return self.send_json(500, {"error": "GEMINI_API_KEY is not set on the server."})

                print(f"[/chat] User: {message}")
                answer = ask_gemini(message)
                print(f"[/chat] Bot: {answer[:80]}...")

                self.send_json(200, {"reply": answer})

            except Exception as e:
                print(f"[/chat] Error: {e}")
                self.send_json(500, {"error": str(e)})
        else:
            self.send_json(404, {"error": "Not found"})

# ─── STARTUP ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    global domain_context

    print("🔄  Fetching domain data from Git repository...")
    try:
        domain_context = fetch_domain_data(DOMAIN_DATA_URL)
        print(f"✅  Domain data loaded ({len(domain_context)} characters)")
    except Exception as e:
        print(f"⚠️   Could not load domain data: {e}")
        domain_context = "No domain data available."

    server = HTTPServer(("", PORT), ChatHandler)
    print(f"\n🚀  Chatbot server running at http://localhost:{PORT}")
    print(f"    POST http://localhost:{PORT}/chat   ← main endpoint")
    print(f"    GET  http://localhost:{PORT}/health ← health check")
    print(f"    GET  http://localhost:{PORT}/       ← chat UI\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n👋  Server stopped.")
