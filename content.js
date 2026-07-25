chrome.runtime.onMessage.addListener((message) => {
  if (
    message &&
    message.type === "redirect" &&
    typeof message.url === "string" &&
    new URL(message.url).origin === "https://npmx.dev"
  ) {
    window.location.replace(message.url);
  }
});
