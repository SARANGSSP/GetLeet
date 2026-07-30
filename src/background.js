import {
  DEFAULT_REPO_NAME,
  LANG_EXT,
  buildFolderPath,
  buildCommitMessage,
  buildReadme,
  localDateKey,
  computeStreak,
  b64EncodeUnicode,
  isSchemaError,
  withRetry,
} from "./lib.js";

const LC_GRAPHQL = "https://leetcode.com/graphql";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "SUBMISSION_ACCEPTED") {
    handleAcceptedSubmission(msg.submissionId, msg.titleSlug).catch((err) =>
      reportSyncFailure(err)
    );
    return false;
  }

  if (msg?.type === "START_GITHUB_OAUTH") {
    startGithubOAuth(msg.clientId, msg.backendUrl, msg.privateRepo)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep the message channel open for the async response
  }

  return false;
});

function reportSyncFailure(err) {
  console.error("[GetLeet] sync failed:", err);
  chrome.storage.local.set({ lastError: { message: err.message, time: Date.now() } });
  chrome.action.setBadgeText({ text: "!" });
  chrome.action.setBadgeBackgroundColor({ color: "#d73a49" });
}

// ---------- GitHub OAuth (Authorization Code flow) ----------
//
// 1. We open GitHub's authorize page via chrome.identity.launchWebAuthFlow,
//    with a random CSRF `state` value that we verify on the way back.
//    Chrome intercepts the redirect to https://<ext-id>.chromiumapp.org/
//    itself — no real page load happens, and the "code"/"state" GitHub
//    appended to that URL are handed straight back to us in JS.
// 2. We send the code to YOUR backend (which holds the client secret) to
//    exchange it for a real access token.
// 3. Once we have the token, WE take it from here: look up the user's
//    GitHub username and make sure a solutions repo exists (creating one
//    if needed) so the person never has to type owner/repo/branch by hand.

async function startGithubOAuth(clientId, backendUrl, privateRepo) {
  if (!clientId || !backendUrl) {
    throw new Error("Client ID and backend URL are required.");
  }

  const redirectUri = chrome.identity.getRedirectURL(); // https://<ext-id>.chromiumapp.org/
  const state = crypto.randomUUID();
  const authUrl = new URL("https://github.com/login/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "repo");
  authUrl.searchParams.set("state", state);

  const resultUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });

  const resultParams = new URL(resultUrl).searchParams;
  const returnedState = resultParams.get("state");
  if (returnedState !== state) {
    throw new Error("OAuth state mismatch (possible CSRF) — aborting. Please try connecting again.");
  }

  const code = resultParams.get("code");
  if (!code) throw new Error("GitHub did not return an authorization code.");

  const tokenRes = await withRetry(() =>
    fetch(`${backendUrl.replace(/\/$/, "")}/api/github/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirectUri }),
    })
  );

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    throw new Error(`Backend token exchange failed: ${errBody}`);
  }

  const { access_token } = await tokenRes.json();
  if (!access_token) throw new Error("Backend response missing access_token.");

  // Figure out who the user is — no need to ask them.
  const userRes = await withRetry(() =>
    fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${access_token}`,
        Accept: "application/vnd.github+json",
      },
    })
  );
  if (!userRes.ok) throw new Error("Could not fetch GitHub username after connecting.");
  const userData = await userRes.json();
  const username = userData.login;

  const settings = await getSettings();
  // Respect an explicit repo name if the person set one under Advanced,
  // otherwise fall back to a sensible default and create it if missing.
  const repoName = settings.repo || DEFAULT_REPO_NAME;
  const { branch } = await ensureRepoExists(access_token, username, repoName, Boolean(privateRepo));

  await chrome.storage.sync.set({
    ...settings,
    githubToken: access_token,
    owner: username,
    repo: repoName,
    branch,
    clientId,
    backendUrl,
    privateRepo: Boolean(privateRepo),
  });

  await chrome.storage.local.remove("lastError");

  return { username, repo: repoName };
}

async function ensureRepoExists(token, owner, repoName, privateRepo) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  const existing = await withRetry(() =>
    fetch(`https://api.github.com/repos/${owner}/${repoName}`, { headers })
  );
  if (existing.status === 200) {
    const repoData = await existing.json();
    return { branch: repoData.default_branch || "main" };
  }

  const created = await withRetry(() =>
    fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: repoName,
        description: "My LeetCode solutions, auto-synced by GetLeet.",
        private: privateRepo,
        auto_init: true, // gives it a default branch immediately, so first commit doesn't need special-casing
      }),
    })
  );

  if (!created.ok) {
    const errText = await created.text();
    throw new Error(`Could not create GitHub repo "${repoName}": ${errText}`);
  }

  const repoData = await created.json();
  return { branch: repoData.default_branch || "main" };
}

// ---------- Sync flow ----------

// Persisted across page reloads and service-worker restarts, unlike the
// in-memory Set in content-main.js (which only guards against duplicate
// events within a single page load). Capped so it can't grow forever.
const MAX_SEEN_SUBMISSIONS = 300;

async function isDuplicateSubmission(submissionId) {
  const { seenSubmissionIds = [] } = await chrome.storage.local.get({ seenSubmissionIds: [] });
  return seenSubmissionIds.includes(submissionId);
}

async function markSubmissionSeen(submissionId) {
  const { seenSubmissionIds = [] } = await chrome.storage.local.get({ seenSubmissionIds: [] });
  const updated = [...seenSubmissionIds, submissionId].slice(-MAX_SEEN_SUBMISSIONS);
  await chrome.storage.local.set({ seenSubmissionIds: updated });
}

async function unmarkSubmissionSeen(submissionId) {
  const { seenSubmissionIds = [] } = await chrome.storage.local.get({ seenSubmissionIds: [] });
  await chrome.storage.local.set({
    seenSubmissionIds: seenSubmissionIds.filter((id) => id !== submissionId),
  });
}

async function handleAcceptedSubmission(submissionId, titleSlug) {
  const settings = await getSettings();
  if (!settings.githubToken || !settings.owner || !settings.repo) {
    console.warn("[GetLeet] Extension not configured yet — open the popup and connect GitHub.");
    return;
  }

  if (await isDuplicateSubmission(submissionId)) {
    console.log(`[GetLeet] Submission ${submissionId} already synced, skipping.`);
    return;
  }
  await markSubmissionSeen(submissionId);

  try {
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
        commitMessage: `Add README for ${question.title} - GetLeet`,
        skipIfExists: true, // one README per problem, created once
      }),
    ]);

    await updateStats(question.titleSlug);
    await chrome.storage.local.remove("lastError");

    chrome.storage.local.set({
      lastSync: { title: question.title, path: fullPath, time: Date.now() },
    });

    chrome.action.setBadgeText({ text: "\u2713" });
    chrome.action.setBadgeBackgroundColor({ color: "#2ea44f" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
  } catch (err) {
    // Don't let a failed sync permanently "use up" this submission —
    // allow a later retry (e.g. a manual resubmission) to try again.
    await unmarkSubmissionSeen(submissionId);
    throw err;
  }
}

// ---------- LeetCode GraphQL ----------
//
// LeetCode's GraphQL API is undocumented and can change shape without
// notice (see BUG_AUDIT.md #10). To keep the extension working even if a
// field we rely on gets renamed/removed, each query has a reduced
// fallback version that's used automatically if the full query errors
// with what looks like a schema mismatch.

async function fetchSubmissionDetails(submissionId) {
  const fullQuery = `
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
  const basicQuery = `
    query submissionDetails($submissionId: Int!) {
      submissionDetails(submissionId: $submissionId) {
        code
        lang { name }
        question { titleSlug }
      }
    }
  `;

  let details;
  try {
    const data = await lcGraphql(fullQuery, { submissionId: Number(submissionId) });
    details = data.submissionDetails;
  } catch (err) {
    if (!isSchemaError(err)) throw err;
    console.warn("[GetLeet] submissionDetails query fields unavailable, falling back:", err.message);
    const data = await lcGraphql(basicQuery, { submissionId: Number(submissionId) });
    details = data.submissionDetails;
  }

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
  const fullQuery = `
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
  const basicQuery = `
    query questionData($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        title
        titleSlug
        difficulty
        topicTags { name slug }
      }
    }
  `;

  try {
    const data = await lcGraphql(fullQuery, { titleSlug });
    return data.question;
  } catch (err) {
    if (!isSchemaError(err)) throw err;
    console.warn("[GetLeet] question content field unavailable, falling back:", err.message);
    const data = await lcGraphql(basicQuery, { titleSlug });
    return data.question;
  }
}

async function lcGraphql(query, variables) {
  const res = await withRetry(() =>
    fetch(LC_GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include", // reuse the user's logged-in leetcode.com session cookies
      body: JSON.stringify({ query, variables }),
    })
  );
  if (!res.ok) throw new Error(`LeetCode GraphQL error: ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// ---------- Stats (streak + solved count) ----------

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

// Per-path write queue: serializes commits to the same file path so two
// overlapping syncs (e.g. a rapid resubmission of the same problem) can't
// race each other's GET-sha-then-PUT sequence within a single service
// worker lifetime. This doesn't survive a service worker restart, so it's
// a mitigation for the common case, not a full distributed lock — see
// BUG_AUDIT.md #8.
const writeQueues = new Map();

function enqueueWrite(path, taskFn) {
  const previous = writeQueues.get(path) || Promise.resolve();
  const run = previous.catch(() => {}).then(taskFn);
  writeQueues.set(
    path,
    run.catch(() => {})
  );
  return run;
}

async function commitFileToGithub(settings, path, content, { commitMessage, skipIfExists = false } = {}) {
  return enqueueWrite(path, () => doCommitFileToGithub(settings, path, content, { commitMessage, skipIfExists }));
}

async function doCommitFileToGithub(settings, path, content, { commitMessage, skipIfExists }, isRetry = false) {
  const apiBase = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodeURIComponent(
    path
  ).replace(/%2F/g, "/")}`;

  const headers = {
    Authorization: `Bearer ${settings.githubToken}`,
    Accept: "application/vnd.github+json",
  };

  // Look up existing file sha (needed to update rather than create).
  let sha;
  const existing = await withRetry(() => fetch(`${apiBase}?ref=${settings.branch || "main"}`, { headers }));
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
      return doCommitFileToGithub(settings, path, content, { commitMessage, skipIfExists }, true);
    }
    const errText = await res.text();
    throw new Error(`GitHub commit failed (${res.status}): ${errText}`);
  }
}

// ---------- Settings ----------

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
        privateRepo: false,
      },
      resolve
    );
  });
}
