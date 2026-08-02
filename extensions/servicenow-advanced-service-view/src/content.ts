const serviceNowRedirectApi = globalThis as typeof globalThis & {
  getAdvancedApplicationServiceUrl: (value: string) => string | null;
};
const APPLICATION_SERVICE_ORIGIN = "https://thespot.elanco.com";
const APPLICATION_SERVICE_LIST_PATH = "/now/nav/ui/classic/params/target/csdm_app_services_list.do";
const rewrittenApplicationServiceLinks = new WeakSet<HTMLAnchorElement>();

function rewriteApplicationServiceLink(link: HTMLAnchorElement): void {
  const destination = serviceNowRedirectApi.getAdvancedApplicationServiceUrl(link.href);
  if (destination !== null && link.href !== destination) {
    link.href = destination;
    rewrittenApplicationServiceLinks.add(link);
  }
}

function rewriteApplicationServiceLinks(root: ParentNode): void {
  for (const link of root.querySelectorAll("a[href]")) {
    if (link instanceof HTMLAnchorElement) rewriteApplicationServiceLink(link);
  }
}

function findApplicationServiceLink(event: MouseEvent): HTMLAnchorElement | null {
  if (event.target instanceof HTMLAnchorElement) return event.target;
  if (!(event.target instanceof Element)) return null;

  const link = event.target.closest("a[href]");
  return link instanceof HTMLAnchorElement ? link : null;
}

function preserveApplicationServiceTableHistory(topWindow: Window): void {
  if (
    topWindow.location.origin !== APPLICATION_SERVICE_ORIGIN ||
    !topWindow.location.pathname.startsWith(APPLICATION_SERVICE_LIST_PATH)
  ) {
    return;
  }

  topWindow.history.pushState(
    { serviceNowApplicationServiceTable: true },
    "",
    topWindow.location.href,
  );
}

function handleLinkActivation(event: MouseEvent): void {
  const link = findApplicationServiceLink(event);
  if (link === null) return;

  const destination =
    serviceNowRedirectApi.getAdvancedApplicationServiceUrl(link.href) ??
    (rewrittenApplicationServiceLinks.has(link) ? link.href : null);
  if (destination === null) return;
  link.href = destination;

  const target = link.target.trim().toLowerCase();
  const opensCurrentDocument =
    target === "" || target === "_self" || target === "_top" || target === "_parent";
  const isUnmodifiedCurrentTabClick =
    event.type === "click" &&
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !link.hasAttribute("download") &&
    opensCurrentDocument;

  if (isUnmodifiedCurrentTabClick) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const topWindow = window.top ?? window;
    preserveApplicationServiceTableHistory(topWindow);
    topWindow.location.replace(destination);
  }
}

const linkObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === "attributes" && mutation.target instanceof HTMLAnchorElement) {
      rewriteApplicationServiceLink(mutation.target);
      continue;
    }

    for (const node of mutation.addedNodes) {
      if (node instanceof HTMLAnchorElement) rewriteApplicationServiceLink(node);
      if (node instanceof Element) rewriteApplicationServiceLinks(node);
    }
  }
});

linkObserver.observe(document, {
  attributes: true,
  attributeFilter: ["href"],
  childList: true,
  subtree: true,
});
rewriteApplicationServiceLinks(document);
document.addEventListener("click", handleLinkActivation, true);
document.addEventListener("auxclick", handleLinkActivation, true);
