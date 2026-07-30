const LC_GRAPHQL = "https://leetcode.com/graphql";

const LANG_EXT = {
  python: "py",
  python3: "py",
  java: "java",
  "c++": "cpp",
  c: "c",
  "c#": "cs",
  javascript: "js",
  typescript: "ts",
  php: "php",
  swift: "swift",
  kotlin: "kt",
  dart: "dart",
  golang: "go",
  ruby: "rb",
  scala: "scala",
  rust: "rs",
  racket: "rkt",
  erlang: "erl",
  elixir: "ex",
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "SUBMISSION_ACCEPTED") {
    handleAcceptedSubmission(msg.submissionId, msg.titleSlug).catch((err) =>
      console.error("[GetLeet] sync failed:", err)
    );
    return false;
  }

  if (msg?.type === "START_GITHUB_OAUTH") {
    startGithubOAuth(msg.clientId, msg.backendUrl)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep the message channel open for the async response
  }

  return false;
});

// ---------- GitHub OAuth (Authorization Code flow) ----------
//
// 1. We open GitHub's authorize page via chrome.identity.launchWebAuthFlow.
//    Chrome intercepts the redirect to https://<ext-id>.chromiumapp.org/
//    itself — no real page load happens, and the "code" GitHub appended to
//    that URL is handed straight back to us in JS.
// 2. We send that code to YOUR backend (which holds the client secret) to
//    exchange it for a real access token.
// 3. We store the token exactly like a manually-pasted PAT.

async function startGithubOAuth(clientId, backendUrl) {
  if (!clientId || !backendUrl) {
    throw new Error("Client ID and backend URL are required.");
  }

  const redirectUri = chrome.identity.getRedirectURL(); // https://<ext-id>.chromiumapp.org/
  const authUrl = new URL("https://github.com/login/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "repo");

  const resultUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });

  const code = new URL(resultUrl).searchParams.get("code");
  if (!code) throw new Error("GitHub did not return an authorization code.");

  const tokenRes = await fetch(`${backendUrl.replace(/\/$/, "")}/api/github/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirectUri }),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    throw new Error(`Backend token exchange failed: ${errBody}`);
  }

  const { access_token } = await tokenRes.json();
  if (!access_token) throw new Error("Backend response missing access_token.");

  const settings = await getSettings();
  await chrome.storage.sync.set({
    ...settings,
    githubToken: access_token,
    clientId,
    backendUrl,
  });

  return { username: null }; // could hit /user with the token if you want to show it
}

async function handleAcceptedSubmission(submissionId, titleSlug) {
  const settings = await getSettings();
  if (!settings.githubToken || !settings.owner || !settings.repo) {
    console.warn("[GetLeet] Extension not configured yet — open the popup and add your GitHub details.");
    return;
  }

  const [submission, question] = await Promise.all([
    fetchSubmissionDetails(submissionId),
    fetchQuestionMeta(titleSlug),
  ]);

  const folderPath = buildFolderPath(question, settings.organizeBy);
  const ext = LANG_EXT[submission.langSlug?.toLowerCase()] || "txt";
  const fileName = `${sanitize(question.title)}.${ext}`;
  const fullPath = `${folderPath}/${fileName}`;

  const readme = buildReadme(question);
  await Promise.all([
    commitFileToGithub(settings, fullPath, submission.code),
    settings.includeReadme
      ? commitFileToGithub(settings, `${folderPath}/README.md`, readme, true)
      : Promise.resolve(),
  ]);

  chrome.storage.local.set({
    lastSync: { title: question.title, path: fullPath, time: Date.now() },
  });

  chrome.action.setBadgeText({ text: "✓" });
  chrome.action.setBadgeBackgroundColor({ color: "#2ea44f" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
}

// ---------- LeetCode GraphQL ----------

async function fetchSubmissionDetails(submissionId) {
  const query = `
    query submissionDetails($submissionId: Int!) {
      submissionDetails(submissionId: $submissionId) {
        code
        lang { name }
        question { titleSlug }
      }
    }
  `;
  const data = await lcGraphql(query, { submissionId: Number(submissionId) });
  const details = data.submissionDetails;
  return {
    code: details.code,
    langSlug: details.lang?.name,
  };
}

async function fetchQuestionMeta(titleSlug) {
  const query = `
    query questionData($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        title
        titleSlug
        difficulty
        topicTags { name slug }
      }
    }
  `;
  const data = await lcGraphql(query, { titleSlug });
  return data.question;
}

async function lcGraphql(query, variables) {
  const res = await fetch(LC_GRAPHQL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include", // reuse the user's logged-in leetcode.com session cookies
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`LeetCode GraphQL error: ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// ---------- Folder logic (the actual "auto" part) ----------

function buildFolderPath(question, organizeBy) {
  const difficulty = capitalize(question.difficulty || "Unknown");
  const primaryTopic = question.topicTags?.[0]?.name
    ? sanitize(question.topicTags[0].name)
    : "Uncategorized";

  switch (organizeBy) {
    case "topic":
      return primaryTopic;
    case "topic-difficulty":
      return `${primaryTopic}/${difficulty}`;
    case "difficulty-topic":
      return `${difficulty}/${primaryTopic}`;
    case "difficulty":
    default:
      return difficulty;
  }
}

function buildReadme(question) {
  const tags = (question.topicTags || []).map((t) => t.name).join(", ");
  return `# ${question.title}\n\n**Difficulty:** ${question.difficulty}\n**Topics:** ${tags}\n\n[View on LeetCode](https://leetcode.com/problems/${question.titleSlug}/)\n`;
}

// ---------- GitHub ----------

async function commitFileToGithub(settings, path, content, skipIfExists = false, isRetry = false) {
  const apiBase = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodeURIComponent(
    path
  ).replace(/%2F/g, "/")}`;

  const headers = {
    Authorization: `Bearer ${settings.githubToken}`,
    Accept: "application/vnd.github+json",
  };

  // Look up existing file sha (needed to update rather than create).
  let sha;
  const existing = await fetch(`${apiBase}?ref=${settings.branch || "main"}`, { headers });
  if (existing.status === 200) {
    const json = await existing.json();
    sha = json.sha;
    if (skipIfExists) return; // e.g. don't overwrite an existing README each time
  }

  const body = {
    message: sha ? `Update ${path}` : `Add ${path}`,
    content: b64EncodeUnicode(content),
    branch: settings.branch || "main",
    ...(sha ? { sha } : {}),
  };

  const res = await fetch(apiBase, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    if (res.status === 409 && !isRetry) {
      // The sha we fetched went stale between GET and PUT — refetch and retry once.
      return commitFileToGithub(settings, path, content, skipIfExists, true);
    }
    const errText = await res.text();
    throw new Error(`GitHub commit failed (${res.status}): ${errText}`);
  }
}

// ---------- Helpers ----------

function sanitize(name) {
  return name.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9\-_.]/g, "");
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function b64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      {
        githubToken: "",
        owner: "",
        repo: "",
        branch: "main",
        organizeBy: "difficulty-topic",
        includeReadme: true,
      },
      resolve
    );
  });
}
