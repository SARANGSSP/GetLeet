// Runs in the page's own JS context (world: "MAIN") so it can see the
// fetch calls LeetCode's React app makes. We can't call chrome.runtime.*
// from here, so we relay findings via postMessage to content-isolated.js.

(function () {
  const originalFetch = window.fetch;
  const seenSubmissionIds = new Set();

  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";

      // LeetCode polls this endpoint after you hit "Submit" until the
      // judge finishes. When it reports SUCCESS + "Accepted", we're done.
      const match = url.match(/\/submissions\/detail\/(\d+)\/(?:v2\/)?check\//);
      if (match) {
        const submissionId = match[1];
        const cloned = response.clone();
        cloned
          .json()
          .then((data) => {
            if (
              data &&
              data.state === "SUCCESS" &&
              data.status_msg === "Accepted" &&
              !seenSubmissionIds.has(submissionId)
            ) {
              seenSubmissionIds.add(submissionId);

              const slugMatch = window.location.pathname.match(
                /\/problems\/([^/]+)\//
              );
              const titleSlug = slugMatch ? slugMatch[1] : null;

              window.postMessage(
                {
                  source: "leetcode-auto-sync",
                  type: "SUBMISSION_ACCEPTED",
                  submissionId,
                  titleSlug,
                },
                "*"
              );
            }
          })
          .catch(() => {});
      }
    } catch (e) {
      // Never let our instrumentation break the page.
    }

    return response;
  };
})();
