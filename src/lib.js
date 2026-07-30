// Pure, chrome-API-free logic, split out so it can be unit tested with
// plain Node (see tests/lib.test.mjs) instead of only being exercisable
// inside a real browser extension.

export const DEFAULT_REPO_NAME = "leetcode-solutions";

export const LANG_EXT = {
  python: "py",
  python3: "py",
  java: "java",
  "c++": "cpp",
  c: "c",
  "c#": "cs",
  csharp: "cs",
  javascript: "js",
  typescript: "ts",
  php: "php",
  swift: "swift",
  kotlin: "kt",
  dart: "dart",
  golang: "go",
  go: "go",
  ruby: "rb",
  scala: "scala",
  rust: "rs",
  racket: "rkt",
  erlang: "erl",
  elixir: "ex",
  mysql: "sql",
  mssql: "sql",
  oraclesql: "sql",
  postgresql: "sql",
  bash: "sh",
};

// ---------- Folder / file naming ----------

export function sanitize(name) {
  return name.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9\-_.]/g, "");
}

export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function buildFolderPath(question, organizeBy) {
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

export function buildCommitMessage(submission) {
  const time = submission.runtimeDisplay || "N/A";
  const timePct =
    typeof submission.runtimePercentile === "number" ? submission.runtimePercentile.toFixed(2) : "N/A";
  const mem = submission.memoryDisplay || "N/A";
  const memPct =
    typeof submission.memoryPercentile === "number" ? submission.memoryPercentile.toFixed(2) : "N/A";
  return `Time: ${time} (${timePct}%) | Memory: ${mem} (${memPct}%) - GetLeet`;
}

export function buildReadme(question) {
  const difficulty = question.difficulty || "Unknown";
  const badgeColor =
    { easy: "brightgreen", medium: "yellow", hard: "red" }[difficulty.toLowerCase()] || "lightgrey";
  const badge = `![Difficulty](https://img.shields.io/badge/Difficulty-${difficulty}-${badgeColor})`;
  const topics = (question.topicTags || []).map((t) => t.name).join(", ") || "\u2014";
  const problemUrl = `https://leetcode.com/problems/${question.titleSlug}/`;
  const description = htmlToMarkdown(question.content);

  return `# [${question.title}](${problemUrl})

${badge}

**Topics:** ${topics}

---

${description}

---

*Synced automatically by **GetLeet** \u2014 inspired by [LeetSync](https://github.com/LeetSync/LeetSync), the original LeetCode \u2192 GitHub sync extension. \u{1F64F}*
`;
}

// ---------- Minimal HTML -> Markdown for LeetCode's problem "content" field ----------
//
// Service workers have no DOM/DOMParser, so this is a sequence of regex
// substitutions rather than a real parser. It covers LeetCode's typical
// tag set. See BUG_AUDIT.md for the known limitations of this approach.

export function htmlToMarkdown(html) {
  if (!html) return "_No problem description available._";
  let md = html;

  md = md.replace(/<br\s*\/?>/gi, "  \n");
  md = md.replace(/<\/p>/gi, "\n\n");
  md = md.replace(/<p(?=[\s>])[^>]*>/gi, "");

  md = md.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, text) => `\n**${stripTags(text)}**\n`);

  md = md.replace(
    /<pre[^>]*>([\s\S]*?)<\/pre>/gi,
    (_, code) => "\n```\n" + decodeEntities(stripTags(code)).trim() + "\n```\n"
  );
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => "`" + decodeEntities(stripTags(code)) + "`");

  md = md.replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  md = md.replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, "_$2_");
  md = md.replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, "^$1");

  md = md.replace(
    /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_, href, text) => `[${decodeEntities(stripTags(text)).trim()}](${href})`
  );

  md = md.replace(/<ul[^>]*>/gi, "\n").replace(/<\/ul>/gi, "\n");
  md = md.replace(/<ol[^>]*>/gi, "\n").replace(/<\/ol>/gi, "\n");
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, item) => `- ${decodeEntities(stripTags(item)).trim()}\n`);

  md = stripTags(md);
  md = decodeEntities(md);
  md = md.replace(/\n{3,}/g, "\n\n").trim();

  return md;
}

export function stripTags(str) {
  return str.replace(/<[^>]+>/g, "");
}

export function decodeEntities(str) {
  return str
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&ldquo;/g, "\u201c")
    .replace(/&rdquo;/g, "\u201d")
    .replace(/&times;/g, "\u00d7")
    .replace(/&le;/g, "\u2264")
    .replace(/&ge;/g, "\u2265")
    .replace(/&minus;/g, "\u2212")
    .replace(/&hellip;/g, "\u2026");
}

// ---------- Stats (streak + solved count) ----------

export function localDateKey(date = new Date()) {
  // en-CA gives YYYY-MM-DD, in the browser's local timezone.
  return date.toLocaleDateString("en-CA");
}

export function computeStreak(syncDays, now = new Date()) {
  const daySet = new Set(syncDays);
  let cursor = new Date(now);
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

// ---------- Misc ----------

export function b64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

export function isSchemaError(err) {
  return /cannot query field|unknown argument|unknown field|graphql validation/i.test(err?.message || "");
}

export async function withRetry(fn, { retries = 2, baseDelayMs = 500, sleepFn } = {}) {
  const sleep = sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
      }
    }
  }
  throw lastErr;
}
