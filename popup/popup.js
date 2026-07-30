// ---- Fill these in once, before publishing to the Chrome Web Store ----
// End users of the published extension never see or touch these — they're
// baked in so "Connect with GitHub" just works out of the box.
const PUBLISHED_CLIENT_ID = "REPLACE_WITH_YOUR_GITHUB_OAUTH_CLIENT_ID";
const PUBLISHED_BACKEND_URL = "https://leetsync-oauth-yourname456.azurewebsites.net";
// -------------------------------------------------------------------

const textFields = ["githubToken", "owner", "repo", "branch", "organizeBy", "clientId", "backendUrl"];
const checkboxFields = ["privateRepo"];

function load() {
  chrome.storage.sync.get(
    {
      githubToken: "",
      owner: "",
      repo: "",
      branch: "main",
      organizeBy: "difficulty-topic",
      clientId: PUBLISHED_CLIENT_ID,
      backendUrl: PUBLISHED_BACKEND_URL,
      privateRepo: false,
    },
    (settings) => {
      for (const key of textFields) {
        document.getElementById(key).value = settings[key];
      }
      for (const key of checkboxFields) {
        document.getElementById(key).checked = Boolean(settings[key]);
      }
      updateConnectedInfo(settings);
    }
  );

  chrome.storage.local.get({ lastSync: null, lastError: null }, ({ lastSync, lastError }) => {
    const el = document.getElementById("lastSync");
    if (lastSync) {
      const when = new Date(lastSync.time).toLocaleString();
      el.textContent = `Last synced: "${lastSync.title}" → ${lastSync.path} (${when})`;
    }
    renderError(lastError);
  });

  loadStats();
}

function renderError(lastError) {
  const el = document.getElementById("errorBanner");
  if (lastError?.message) {
    const when = new Date(lastError.time).toLocaleString();
    el.textContent = `Last sync failed (${when}): ${lastError.message}`;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

function loadStats() {
  chrome.storage.local.get({ stats: { totalSolved: 0, streak: 0 } }, ({ stats }) => {
    document.getElementById("streakValue").textContent = stats.streak || 0;
    document.getElementById("solvedValue").textContent = stats.totalSolved || 0;
  });
}

function updateConnectedInfo(settings) {
  const el = document.getElementById("connectedInfo");
  if (settings.owner && settings.repo) {
    el.textContent = `Connected as ${settings.owner} → ${settings.repo}`;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

function save() {
  const settings = {};
  for (const key of textFields) {
    settings[key] = document.getElementById(key).value.trim();
  }
  for (const key of checkboxFields) {
    settings[key] = document.getElementById(key).checked;
  }
  chrome.storage.sync.set(settings, () => {
    const status = document.getElementById("status");
    status.textContent = "Saved ✓";
    setTimeout(() => (status.textContent = ""), 1500);
    updateConnectedInfo(settings);
  });
}

function connectOAuth() {
  const clientId = document.getElementById("clientId").value.trim() || PUBLISHED_CLIENT_ID;
  const backendUrl = document.getElementById("backendUrl").value.trim() || PUBLISHED_BACKEND_URL;
  const privateRepo = document.getElementById("privateRepo").checked;
  const statusEl = document.getElementById("oauthStatus");

  if (!clientId || clientId.startsWith("REPLACE_WITH") || !backendUrl) {
    statusEl.textContent =
      "Not configured yet — expand 'Advanced settings' and fill in your own Client ID + backend URL, or wait for the developer to publish theirs.";
    return;
  }

  statusEl.textContent = "Opening GitHub authorization…";
  chrome.runtime.sendMessage(
    { type: "START_GITHUB_OAUTH", clientId, backendUrl, privateRepo },
    (response) => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = `Error: ${chrome.runtime.lastError.message}`;
        return;
      }
      if (response?.ok) {
        statusEl.textContent = `Connected as ${response.username} → ${response.repo} ✓`;
        load(); // refresh everything, including the token + repo now set automatically
      } else {
        statusEl.textContent = `Failed: ${response?.error || "unknown error"}`;
      }
    }
  );
}

document.getElementById("save").addEventListener("click", save);
document.getElementById("connectOAuth").addEventListener("click", connectOAuth);
document.addEventListener("DOMContentLoaded", load);

// Keep stats and the error banner fresh if a sync happens while the popup is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.stats) loadStats();
  if (changes.lastError) renderError(changes.lastError.newValue);
});
