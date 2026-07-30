const LC_GRAPHQL = "https://leetcode.com/graphql";
const DEFAULT_REPO_NAME = "leetcode-solutions";

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
      console.error("[LeetCode Auto Sync] sync failed:", err)
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
// 3. Once we have the token, WE take it from here: look up the user's
//    GitHub username and make sure a solutions repo exists (creating one
//    if needed) so the person never has to type owner/repo/branch by hand.

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

  // Figure out who the user is — no need to ask them.
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${access_token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!userRes.ok) throw new Error("Could not fetch GitHub username after connecting.");
  const userData = await userRes.json();
  const username = userData.login;

  const settings = await getSettings();
  // Respect an explicit repo name if the person set one under Advanced,
  // otherwise fall back to a sensible default and create it if missing.
  const repoName = settings.repo || DEFAULT_REPO_NAME;
  const { branch } = await ensureRepoExists(access_token, username, repoName);

  await chrome.storage.sync.set({
    ...settings,
    githubToken: access_token,
    owner: username,
    repo: repoName,
    branch,
    clientId,
    backendUrl,
  });

  return { username, repo: repoName };
}

async function ensureRepoExists(token, owner, repoName) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  const existing = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, { headers });
  if (existing.status === 200) {
    const repoData = await existing.json();
    return { branch: repoData.default_branch || "main" };
  }

  const created = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: repoName,
      description: "My LeetCode solutions, auto-synced by LeetCode Auto-Organizer Sync.",
      private: false,
      auto_init: true, // gives it a default branch immediately, so first commit doesn't need special-casing
    }),
  });

  if (!created.ok) {
    const errText = await created.text();
    throw new Error(`Could not create GitHub repo "${repoName}": ${errText}`);
  }

  const repoData = await created.json();
  return { branch: repoData.default_branch || "main" };
}

// ---------- Sync flow ----------

async function handleAcceptedSubmission(submissionId, titleSlug) {
  const settings = await getSettings();
  if (!settings.githubToken || !settings.owner || !settings.repo) {
    console.warn("[LeetCode Auto Sync] Extension not configured yet — open the popup and connect GitHub.");
    return;
  }

  const [submission, question] = await Promise.all([
    fetchSubmissionDetails(submissionId),
    fetchQuestionMeta(titleSlug),
  ]);

  // Every submission for the same problem always lands in the same
  // per-problem folder, regardless of language or resubmission.
  const folderPath = buildFolderPath(question, settings.organizeBy);
  const ext = LANG_EXT[submission.langSlug?.toLowerCase()] || "txt";
  const fileName = `Solution.${ext}`;
  const fullPath = `${folderPath}/${fileName}`;
  const readmePath = `${folderPath}/README.md`;

  const readme = buildReadme(question);
  const commitMessage = buildCommitMessage(submission);

  await Promise.all([
    commitFileToGithub(settings, fullPath, submission.code, { commitMessage }),
    commitFileToGithub(settings, readmePath, readme, {
      commitMessage: `Add README for ${question.title} - LeetSync`,
      skipIfExists: true, // one README per problem, created once
    }),
  ]);

  await updateStats(question.titleSlug);

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
        runtimeDisplay
        runtimePercentile
        memoryDisplay
        memoryPercentile
        question { titleSlug }
      }
    }
  `;
  const data = await lcGraphql(query, { submissionId: Number(submissionId) });
  const details = data.submissionDetails;
  return {
    code: details.code,
    langSlug: details.lang?.name,
    runtimeDisplay: details.runtimeDisplay,
    runtimePercentile: details.runtimePercentile,
    memoryDisplay: details.memoryDisplay,
    memoryPercentile: details.memoryPercentile,
  };
}

async function fetchQuestionMeta(titleSlug) {
  const query = `
    query questionData($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        title
        titleSlug
        difficulty
        content
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

// ---------- Folder / file naming ----------

function buildFolderPath(question, organizeBy) {
  const difficulty = capitalize(question.difficulty || "Unknown");
  const primaryTopic = question.topicTags?.[0]?.name
    ? sanitize(question.topicTags[0].name)
    : "Uncategorized";
  const questionFolder = sanitize(question.title);

  let categoryPath;
  switch (organizeBy) {
    case "topic":
      categoryPath = primaryTopic;
      break;
    case "topic-difficulty":
      categoryPath = `${primaryTopic}/${difficulty}`;
      break;
    case "difficulty-topic":
      categoryPath = `${difficulty}/${primaryTopic}`;
      break;
    case "difficulty":
    default:
      categoryPath = difficulty;
  }

  // Every problem gets its own folder within the category path, so
  // resubmissions (any language) always land in the same place.
  return `${categoryPath}/${questionFolder}`;
}

function buildCommitMessage(submission) {
  const time = submission.runtimeDisplay || "N/A";
  const timePct =
    typeof submission.runtimePercentile === "number" ? submission.runtimePercentile.toFixed(2) : "N/A";
  const mem = submission.memoryDisplay || "N/A";
  const memPct =
    typeof submission.memoryPercentile === "number" ? submission.memoryPercentile.toFixed(2) : "N/A";
  return `Time: ${time} (${timePct}%) | Memory: ${mem} (${memPct}%) - LeetSync`;
}

function buildReadme(question) {
  const difficulty = question.difficulty || "Unknown";
  const badgeColor =
    { easy: "brightgreen", medium: "yellow", hard: "red" }[difficulty.toLowerCase()] || "lightgrey";
  const badge = `![Difficulty](https://img.shields.io/badge/Difficulty-${difficulty}-${badgeColor})`;
  const topics = (question.topicTags || []).map((t) => t.name).join(", ") || "—";
  const problemUrl = `https://leetcode.com/problems/${question.titleSlug}/`;
  const description = htmlToMarkdown(question.content);

  return `# [${question.title}](${problemUrl})

${badge}

**Topics:** ${topics}

---

${description}

---

*Synced automatically by **LeetCode Auto-Organizer Sync** — inspired by [LeetSync](https://github.com/LeetSync/LeetSync), the original LeetCode → GitHub sync extension. 🙏*
`;
}

// ---------- Minimal HTML -> Markdown for LeetCode's problem "content" field ----------

function htmlToMarkdown(html) {
  if (!html) return "_No problem description available._";
  let md = html;

  md = md.replace(/<br\s*\/?>/gi, "  \n");
  md = md.replace(/<\/p>/gi, "\n\n");
  md = md.replace(/<p[^>]*>/gi, "");

  md = md.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, text) => `\n**${stripTags(text)}**\n`);

  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => "\n```\n" + decodeEntities(stripTags(code)).trim() + "\n```\n");
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => "`" + decodeEntities(stripTags(code)) + "`");

  md = md.replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  md = md.replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, "_$2_");
  md = md.replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, "^$1");

  md = md.replace(/<ul[^>]*>/gi, "\n").replace(/<\/ul>/gi, "\n");
  md = md.replace(/<ol[^>]*>/gi, "\n").replace(/<\/ol>/gi, "\n");
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, item) => `- ${decodeEntities(stripTags(item)).trim()}\n`);

  md = stripTags(md);
  md = decodeEntities(md);
  md = md.replace(/\n{3,}/g, "\n\n").trim();

  return md;
}

function stripTags(str) {
  return str.replace(/<[^>]+>/g, "");
}

function decodeEntities(str) {
  return str
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&ldquo;/g, "\u201c")
    .replace(/&rdquo;/g, "\u201d");
}

// ---------- Stats (streak + solved count) ----------

function localDateKey(date = new Date()) {
  // en-CA gives YYYY-MM-DD, in the browser's local timezone.
  return date.toLocaleDateString("en-CA");
}

function computeStreak(syncDays) {
  const daySet = new Set(syncDays);
  let cursor = new Date();
  // Grace period: if today hasn't been solved yet, start counting from
  // yesterday so the streak doesn't drop to 0 before the day is over.
  if (!daySet.has(localDateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  while (daySet.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

async function updateStats(titleSlug) {
  const { stats } = await chrome.storage.local.get({
    stats: { solvedSlugs: [], syncDays: [] },
  });

  const solvedSet = new Set(stats.solvedSlugs);
  solvedSet.add(titleSlug);

  const daySet = new Set(stats.syncDays);
  daySet.add(localDateKey());

  const syncDays = Array.from(daySet);
  const newStats = {
    solvedSlugs: Array.from(solvedSet),
    syncDays,
    totalSolved: solvedSet.size,
    streak: computeStreak(syncDays),
  };

  await chrome.storage.local.set({ stats: newStats });
}

// ---------- GitHub ----------

async function commitFileToGithub(settings, path, content, { commitMessage, skipIfExists = false } = {}, isRetry = false) {
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
    if (skipIfExists) return; // e.g. don't overwrite an existing per-problem README
  }

  const body = {
    message: commitMessage || (sha ? `Update ${path}` : `Add ${path}`),
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
      return commitFileToGithub(settings, path, content, { commitMessage, skipIfExists }, true);
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
        clientId: "",
        backendUrl: "",
      },
      resolve
    );
  });
}
