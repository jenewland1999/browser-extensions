chrome.runtime.onMessage.addListener((message) => {
  if (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "redirect" &&
    "url" in message &&
    typeof message.url === "string" &&
    new URL(message.url).origin === "https://npmx.dev"
  ) {
    window.location.replace(message.url);
  }
});
