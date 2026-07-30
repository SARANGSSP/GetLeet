import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitize,
  capitalize,
  buildFolderPath,
  buildCommitMessage,
  buildReadme,
  htmlToMarkdown,
  decodeEntities,
  localDateKey,
  computeStreak,
  b64EncodeUnicode,
  isSchemaError,
  withRetry,
  LANG_EXT,
} from "../src/lib.js";

// ---------- sanitize / capitalize ----------

test("sanitize collapses whitespace and strips unsafe characters", () => {
  assert.equal(sanitize("Two Sum"), "Two-Sum");
  assert.equal(sanitize("  Valid   Anagram  "), "Valid-Anagram");
  assert.equal(sanitize("3Sum Closest!"), "3Sum-Closest");
});

test("capitalize only uppercases the first letter", () => {
  assert.equal(capitalize("MEDIUM"), "Medium");
  assert.equal(capitalize("easy"), "Easy");
});

// ---------- buildFolderPath ----------

test("buildFolderPath: difficulty-topic puts difficulty first, then a per-problem folder", () => {
  const question = {
    title: "Two Sum",
    difficulty: "Easy",
    topicTags: [{ name: "Array" }, { name: "Hash Table" }],
  };
  assert.equal(buildFolderPath(question, "difficulty-topic"), "Easy/Array/Two-Sum");
});

test("buildFolderPath: topic-difficulty reverses the order", () => {
  const question = { title: "Two Sum", difficulty: "Easy", topicTags: [{ name: "Array" }] };
  assert.equal(buildFolderPath(question, "topic-difficulty"), "Array/Easy/Two-Sum");
});

test("buildFolderPath: difficulty-only and topic-only ignore the other axis", () => {
  const question = { title: "Two Sum", difficulty: "Easy", topicTags: [{ name: "Array" }] };
  assert.equal(buildFolderPath(question, "difficulty"), "Easy/Two-Sum");
  assert.equal(buildFolderPath(question, "topic"), "Array/Two-Sum");
});

test("buildFolderPath: missing topic tags fall back to Uncategorized", () => {
  const question = { title: "Mystery Problem", difficulty: "Hard", topicTags: [] };
  assert.equal(buildFolderPath(question, "difficulty-topic"), "Hard/Uncategorized/Mystery-Problem");
});

test("buildFolderPath: same problem always yields the same folder regardless of resubmission", () => {
  const question = { title: "Two Sum", difficulty: "Easy", topicTags: [{ name: "Array" }] };
  const first = buildFolderPath(question, "difficulty-topic");
  const second = buildFolderPath(question, "difficulty-topic");
  assert.equal(first, second);
});

// ---------- buildCommitMessage ----------

test("buildCommitMessage formats runtime/memory percentiles to 2 decimals", () => {
  const msg = buildCommitMessage({
    runtimeDisplay: "0 ms",
    runtimePercentile: 100,
    memoryDisplay: "19.2 MB",
    memoryPercentile: 88.884,
  });
  assert.equal(msg, "Time: 0 ms (100.00%) | Memory: 19.2 MB (88.88%) - GetLeet");
});

test("buildCommitMessage falls back to N/A when stats are missing", () => {
  const msg = buildCommitMessage({});
  assert.equal(msg, "Time: N/A (N/A%) | Memory: N/A (N/A%) - GetLeet");
});

// ---------- buildReadme / htmlToMarkdown ----------

test("buildReadme includes title, difficulty badge, topics, and link", () => {
  const readme = buildReadme({
    title: "Two Sum",
    titleSlug: "two-sum",
    difficulty: "Easy",
    topicTags: [{ name: "Array" }],
    content: "<p>Given an array...</p>",
  });
  assert.match(readme, /# \[Two Sum\]\(https:\/\/leetcode\.com\/problems\/two-sum\/\)/);
  assert.match(readme, /Difficulty-Easy-brightgreen/);
  assert.match(readme, /\*\*Topics:\*\* Array/);
  assert.match(readme, /Given an array/);
  assert.match(readme, /GetLeet/);
});

test("htmlToMarkdown converts common LeetCode markup", () => {
  const html =
    "<p>Given <code>nums</code> and <strong>target</strong>.</p>" +
    "<pre>Input: [2,7]\nOutput: [0,1]</pre>" +
    "<ul><li>1 &lt;= n &lt;= 10<sup>4</sup></li></ul>";
  const md = htmlToMarkdown(html);
  assert.match(md, /`nums`/);
  assert.match(md, /\*\*target\*\*/);
  assert.match(md, /```\nInput: \[2,7\]\nOutput: \[0,1\]\n```/);
  assert.match(md, /- 1 <= n <= 10\^4/);
});

test("htmlToMarkdown converts links", () => {
  const md = htmlToMarkdown('<a href="https://example.com">click here</a>');
  assert.equal(md, "[click here](https://example.com)");
});

test("htmlToMarkdown handles missing content gracefully", () => {
  assert.equal(htmlToMarkdown(""), "_No problem description available._");
  assert.equal(htmlToMarkdown(null), "_No problem description available._");
});

test("decodeEntities handles common LeetCode entities", () => {
  assert.equal(decodeEntities("10 &lt;= n &lt;= 10&sup;4&#39;"), "10 <= n <= 10&sup;4'");
  assert.equal(decodeEntities("a &times; b &le; c"), "a \u00d7 b \u2264 c");
});

// ---------- streak / date logic ----------

test("localDateKey returns YYYY-MM-DD", () => {
  const key = localDateKey(new Date("2026-07-30T12:00:00"));
  assert.equal(key, "2026-07-30");
});

test("computeStreak counts consecutive days ending today", () => {
  const now = new Date("2026-07-30T20:00:00");
  const days = ["2026-07-28", "2026-07-29", "2026-07-30"];
  assert.equal(computeStreak(days, now), 3);
});

test("computeStreak has a same-day grace period", () => {
  const now = new Date("2026-07-30T09:00:00");
  // Nothing solved yet today, but yesterday and the day before were solved.
  const days = ["2026-07-28", "2026-07-29"];
  assert.equal(computeStreak(days, now), 2);
});

test("computeStreak breaks on a gap", () => {
  const now = new Date("2026-07-30T20:00:00");
  const days = ["2026-07-25", "2026-07-30"];
  assert.equal(computeStreak(days, now), 1);
});

test("computeStreak is 0 with no history", () => {
  assert.equal(computeStreak([], new Date("2026-07-30T20:00:00")), 0);
});

// ---------- misc ----------

test("b64EncodeUnicode round-trips ASCII and unicode content", () => {
  const encoded = b64EncodeUnicode("hello world");
  assert.equal(Buffer.from(encoded, "base64").toString("utf-8"), "hello world");

  const unicodeEncoded = b64EncodeUnicode("héllo \u2705 wörld");
  assert.equal(Buffer.from(unicodeEncoded, "base64").toString("utf-8"), "héllo \u2705 wörld");
});

test("isSchemaError recognizes GraphQL schema-mismatch messages", () => {
  assert.equal(isSchemaError(new Error('Cannot query field "runtimeDisplay" on type Submission')), true);
  assert.equal(isSchemaError(new Error("LeetCode GraphQL error: 500")), false);
  assert.equal(isSchemaError(undefined), false);
});

test("withRetry succeeds without retrying when the function succeeds immediately", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;
      return "ok";
    },
    { sleepFn: async () => {} }
  );
  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("withRetry retries on failure and eventually succeeds", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error("transient");
      return "ok";
    },
    { retries: 3, sleepFn: async () => {} }
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withRetry throws the last error after exhausting retries", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1;
          throw new Error(`fail-${calls}`);
        },
        { retries: 2, sleepFn: async () => {} }
      ),
    /fail-3/
  );
  assert.equal(calls, 3);
});

test("every LANG_EXT value is a short lowercase extension", () => {
  for (const [lang, ext] of Object.entries(LANG_EXT)) {
    assert.match(ext, /^[a-z0-9]{1,6}$/, `unexpected extension for ${lang}: ${ext}`);
  }
});
