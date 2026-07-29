// ---- Fill these in once, before publishing to the Chrome Web Store ----
// End users of the published extension never see or touch these — they're
// baked in so "Connect with GitHub" just works out of the box.
const PUBLISHED_CLIENT_ID = "REPLACE_WITH_YOUR_GITHUB_OAUTH_CLIENT_ID";
const PUBLISHED_BACKEND_URL = "https://leetsync-oauth-yourname456.azurewebsites.net";
// -------------------------------------------------------------------

const fields = [
  "githubToken",
  "owner",
  "repo",
  "branch",
  "organizeBy",
  "includeReadme",
  "clientId",
  "backendUrl",
];

function load() {
  chrome.storage.sync.get(
    {
      githubToken: "",
      owner: "",
      repo: "",
      branch: "main",
      organizeBy: "difficulty-topic",
      includeReadme: true,
      clientId: PUBLISHED_CLIENT_ID,
      backendUrl: PUBLISHED_BACKEND_URL,
    },
    (settings) => {
      for (const key of fields) {
        const el = document.getElementById(key);
        if (el.type === "checkbox") el.checked = settings[key];
        else el.value = settings[key];
      }
    }
  );

  chrome.storage.local.get({ lastSync: null }, ({ lastSync }) => {
    const el = document.getElementById("lastSync");
    if (lastSync) {
      const when = new Date(lastSync.time).toLocaleString();
      el.textContent = `Last synced: "${lastSync.title}" → ${lastSync.path} (${when})`;
    }
  });
}

function save() {
  const settings = {};
  for (const key of fields) {
    const el = document.getElementById(key);
    settings[key] = el.type === "checkbox" ? el.checked : el.value.trim();
  }
  chrome.storage.sync.set(settings, () => {
    const status = document.getElementById("status");
    status.textContent = "Saved ✓";
    setTimeout(() => (status.textContent = ""), 1500);
  });
}

function connectOAuth() {
  const clientId = document.getElementById("clientId").value.trim() || PUBLISHED_CLIENT_ID;
  const backendUrl = document.getElementById("backendUrl").value.trim() || PUBLISHED_BACKEND_URL;
  const statusEl = document.getElementById("oauthStatus");

  if (!clientId || clientId.startsWith("REPLACE_WITH") || !backendUrl) {
    statusEl.textContent = "Not configured yet — expand 'Self-hosting' and fill in your own Client ID + backend URL, or wait for the developer to publish theirs.";
    return;
  }

  statusEl.textContent = "Opening GitHub authorization…";
  chrome.runtime.sendMessage(
    { type: "START_GITHUB_OAUTH", clientId, backendUrl },
    (response) => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = `Error: ${chrome.runtime.lastError.message}`;
        return;
      }
      if (response?.ok) {
        statusEl.textContent = "Connected ✓";
        load(); // refresh fields, including the token now stored via OAuth
      } else {
        statusEl.textContent = `Failed: ${response?.error || "unknown error"}`;
      }
    }
  );
}

document.getElementById("save").addEventListener("click", save);
document.getElementById("connectOAuth").addEventListener("click", connectOAuth);
document.addEventListener("DOMContentLoaded", load);
