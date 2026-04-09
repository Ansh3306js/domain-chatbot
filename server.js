/**
 * server.js — Main entry point for the Domain-Specific Chatbot
 *
 * What this file does:
 *  1. Starts an HTTP server on port 3000
 *  2. Fetches "domain data" (FAQ/knowledge) from a public Git repo
 *  3. Exposes a POST /chat endpoint that accepts a user question
 *  4. Injects the domain data into a prompt and calls the Gemini API
 *  5. Returns the AI's answer as JSON
 *
 * Run with:  node server.js
 * Test with: curl -X POST http://localhost:3000/chat \
 *              -H "Content-Type: application/json" \
 *              -d '{"message":"What is Node.js?"}'
 */

const http = require("http");   // Node's built-in HTTP module — no install needed
const https = require("https"); // Used to make outbound HTTPS requests

// ─── CONFIGURATION ────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

/**
 * GEMINI_API_KEY must be set as an environment variable before running.
 * Example (Mac/Linux):  export GEMINI_API_KEY="AIza..."
 * Example (Windows):    set GEMINI_API_KEY=AIza...
 *
 * Get your key at https://aistudio.google.com/app/apikey
 */
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyCPD8-U606ki6Upx19-brpJBYB2PTiSQtA";

/**
 * RAW URL of a plain-text or JSON file in a public Git repository.
 * This is your "domain knowledge" — the chatbot will read this file
 * every time the server starts and use it as context for all answers.
 *
 * The URL below points to a small Node.js FAQ we host on GitHub as a demo.
 * Replace it with any raw GitHub/GitLab URL that serves plain text or JSON.
 */
const DOMAIN_DATA_URL =
  "https://raw.githubusercontent.com/nicholasgasior/gsfmt/master/README.md";

// ─── GLOBAL STATE ─────────────────────────────────────────────────────────────

/**
 * domainContext holds the text fetched from the Git repo.
 * It is loaded once at startup and injected into every prompt.
 */
let domainContext = "";

// ─── HELPER: fetch a URL and return its body as a string ─────────────────────

/**
 * httpGet(url) → Promise<string>
 *
 * A tiny wrapper around Node's built-in `https.get`.
 * We avoid adding npm dependencies (like axios) to keep setup minimal.
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        // Follow a single redirect if the server returns 301/302
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(httpGet(res.headers.location));
        }

        let data = "";
        res.on("data", (chunk) => (data += chunk)); // collect chunks
        res.on("end", () => resolve(data));          // return full body
      })
      .on("error", reject);
  });
}

// ─── HELPER: call the Google Gemini API ──────────────────────────────────────

/**
 * askGemini(userMessage) → Promise<string>
 *
 * Builds a prompt that:
 *   - Pastes the Git-fetched domain data as "reference material"
 *   - Asks Gemini to answer the user's question using that material
 *
 * POSTs to the Gemini generateContent endpoint and returns the reply text.
 */
function askGemini(userMessage) {
  return new Promise((resolve, reject) => {
    const prompt = `You are a helpful domain-specific assistant.
Use ONLY the following reference material to answer questions.
If the answer is not in the reference material, say so honestly.

=== DOMAIN REFERENCE MATERIAL (fetched from Git) ===
${domainContext}
=== END OF REFERENCE MATERIAL ===

User question: ${userMessage}`;

    const requestBody = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    });

    const options = {
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBody),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);

          // Check for API-level errors
          if (parsed.error) {
            return reject(new Error(parsed.error.message));
          }

          // Gemini's reply is in candidates[0].content.parts[0].text
          const reply =
            parsed.candidates?.[0]?.content?.parts?.[0]?.text ||
            "No response from model.";
          resolve(reply);
        } catch (e) {
          reject(new Error("Failed to parse Gemini response: " + data));
        }
      });
    });

    req.on("error", reject);
    req.write(requestBody);
    req.end();
  });
}

// ─── HTTP SERVER ──────────────────────────────────────────────────────────────

/**
 * We use Node's built-in `http` module to keep this dependency-free.
 *
 * Routes handled:
 *   GET  /          → serves the chat UI (index.html inlined as a string)
 *   POST /chat      → main chatbot endpoint
 *   *               → 404
 */
const server = http.createServer(async (req, res) => {
  // ── CORS headers so a browser frontend can talk to this server ────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Pre-flight request for CORS — just respond OK
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  // ── Route: GET / → Serve the HTML UI ─────────────────────────────────────
  if (req.method === "GET" && req.url === "/") {
    const fs = require("fs");
    const html = fs.readFileSync(__dirname + "/index.html", "utf8");
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(html);
  }

  // ── Route: GET /health → simple health check ─────────────────────────────
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        status: "ok",
        domainDataLoaded: domainContext.length > 0,
        domainDataChars: domainContext.length,
      })
    );
  }

  // ── Route: POST /chat → main chatbot endpoint ─────────────────────────────
  if (req.method === "POST" && req.url === "/chat") {
    // Collect the request body (it arrives in chunks)
    let body = "";
    req.on("data", (chunk) => (body += chunk));

    req.on("end", async () => {
      try {
        // Parse the incoming JSON: expects { "message": "..." }
        const { message } = JSON.parse(body);

        if (!message || typeof message !== "string" || !message.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "message field is required" }));
        }

        if (!GEMINI_API_KEY) {
          res.writeHead(500, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({ error: "GEMINI_API_KEY is not set on the server." })
          );
        }

        console.log(`[/chat] User: ${message}`);

        // Call Gemini with the user's message
        const answer = await askGemini(message.trim());

        console.log(`[/chat] Bot: ${answer.slice(0, 80)}...`);

        // Return the answer as JSON
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply: answer }));
      } catch (err) {
        console.error("[/chat] Error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });

    return; // stop here — response sent inside req.on("end")
  }

  // ── 404 for everything else ───────────────────────────────────────────────
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

// ─── STARTUP SEQUENCE ─────────────────────────────────────────────────────────

(async () => {
  console.log("🔄  Fetching domain data from Git repository...");

  try {
    // Step 1: Load the domain knowledge from the Git repo
    domainContext = await httpGet(DOMAIN_DATA_URL);
    console.log(`✅  Domain data loaded (${domainContext.length} characters)`);
  } catch (err) {
    // If the fetch fails the server still starts, but answers may be generic
    console.warn("⚠️   Could not load domain data:", err.message);
    domainContext = "No domain data available.";
  }

  // Step 2: Start listening for HTTP requests
  server.listen(PORT, () => {
    console.log(`\n🚀  Chatbot server running at http://localhost:${PORT}`);
    console.log(`    POST http://localhost:${PORT}/chat   ← main endpoint`);
    console.log(`    GET  http://localhost:${PORT}/health ← health check`);
    console.log(`    GET  http://localhost:${PORT}/       ← chat UI\n`);
  });
})();
