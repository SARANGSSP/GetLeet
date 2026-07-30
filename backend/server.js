// Minimal backend for the GetLeet extension's GitHub OAuth flow.
//
// The ONLY job of this server: take a temporary "code" from the extension,
// exchange it with GitHub for an access token (which requires the client
// secret — something the extension itself must never hold), and hand the
// token back. Nothing is stored server-side; there's no database.
//
// Deploy this to Azure App Service (Node 18+ runtime) or run it on your VM
// behind a reverse proxy with HTTPS. See ../DEPLOY.md.

import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());

// Lock this down once you know your extension's ID (chrome://extensions
// with Developer mode on shows it). Example: "chrome-extension://abcdefg..."
const ALLOWED_ORIGIN = process.env.ALLOWED_EXTENSION_ORIGIN || "*";

app.use(
  cors({
    origin: ALLOWED_ORIGIN,
    methods: ["POST"],
  })
);

const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = process.env;

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
  console.warn(
    "[warn] GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET are not set. Set them as App Service environment variables (Configuration > Application settings)."
  );
}

app.post("/api/github/token", async (req, res) => {
  const { code, redirectUri } = req.body || {};
  if (!code) {
    return res.status(400).json({ error: "Missing 'code' in request body" });
  }

  try {
    const ghRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const data = await ghRes.json();

    if (data.error) {
      return res.status(400).json({ error: data.error_description || data.error });
    }

    // Only the access token needs to go back to the extension.
    return res.json({ access_token: data.access_token, scope: data.scope });
  } catch (err) {
    console.error("Token exchange failed:", err);
    return res.status(500).json({ error: "Token exchange failed" });
  }
});

app.get("/health", (_req, res) => res.send("ok"));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`OAuth backend listening on :${PORT}`));
