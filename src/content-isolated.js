// Runs in the isolated content-script world, so it CAN talk to the
// extension via chrome.runtime, but can't see page fetch calls directly.
// It just relays what content-main.js posts to it.

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== "leetcode-auto-sync") return;

  if (msg.type === "SUBMISSION_ACCEPTED") {
    chrome.runtime.sendMessage({
      type: "SUBMISSION_ACCEPTED",
      submissionId: msg.submissionId,
      titleSlug: msg.titleSlug,
    });
  }
});
