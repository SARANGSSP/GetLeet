import { app } from "@azure/functions";

const ALLOWED_ORIGIN = process.env.ALLOWED_EXTENSION_ORIGIN || "*";

// Minimal in-memory rate limiter. Each exchange still requires a valid,
// single-use GitHub "code", so this is a best-effort guard rather than a
// hard security boundary — and on the Consumption plan it only persists
// for as long as the underlying instance stays warm. See BUG_AUDIT.md #6.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const rateLimitBuckets = new Map();

function isRateLimited(key) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key) || { count: 0, windowStart: now };

  if (now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    bucket.count = 0;
    bucket.windowStart = now;
  }
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

app.http("githubToken", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "github/token",
  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders() };
    }

    const rateLimitKey = request.headers.get("x-forwarded-for") || "unknown";
    if (isRateLimited(rateLimitKey)) {
      return {
        status: 429,
        headers: corsHeaders(),
        jsonBody: { error: "Too many requests, please slow down." },
      };
    }

    const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = process.env;
    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
      return {
        status: 500,
        headers: corsHeaders(),
        jsonBody: { error: "Server missing GITHUB_CLIENT_ID/SECRET app settings." },
      };
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, headers: corsHeaders(), jsonBody: { error: "Invalid JSON body" } };
    }

    const { code, redirectUri } = body || {};
    if (!code) {
      return { status: 400, headers: corsHeaders(), jsonBody: { error: "Missing 'code'" } };
    }

    try {
      const ghRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          client_secret: GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: redirectUri,
        }),
      });

      const data = await ghRes.json();

      if (data.error) {
        return {
          status: 400,
          headers: corsHeaders(),
          jsonBody: { error: data.error_description || data.error },
        };
      }

      return {
        status: 200,
        headers: corsHeaders(),
        jsonBody: { access_token: data.access_token, scope: data.scope },
      };
    } catch (err) {
      context.error("Token exchange failed:", err);
      return { status: 500, headers: corsHeaders(), jsonBody: { error: "Token exchange failed" } };
    }
  },
});
