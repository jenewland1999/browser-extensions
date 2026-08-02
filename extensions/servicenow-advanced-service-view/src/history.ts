(() => {
  type RedirectUrl = (value: string) => string | null;
  const runtime = globalThis as typeof globalThis & {
    getAdvancedApplicationServiceUrl?: RedirectUrl;
    __serviceNowAdvancedHistoryPatched?: boolean;
  };
  const getAdvancedApplicationServiceUrl = runtime.getAdvancedApplicationServiceUrl;

  if (getAdvancedApplicationServiceUrl === undefined) return;

  type HistoryUrl = string | URL | null | undefined;
  type HistoryMethod = (data: unknown, unused: string, url?: HistoryUrl) => void;

  function rewriteHistoryUrl(value: HistoryUrl): HistoryUrl {
    if (value === null || value === undefined) return value;

    const destination = getAdvancedApplicationServiceUrl(
      new URL(value.toString(), window.location.href).href,
    );
    return destination ?? value;
  }

  function patchHistoryMethod(methodName: "pushState" | "replaceState"): void {
    const original = history[methodName] as HistoryMethod;
    history[methodName] = function (
      this: History,
      data: unknown,
      unused: string,
      url?: HistoryUrl,
    ): void {
      original.call(this, data, unused, rewriteHistoryUrl(url));
    };
  }

  if (runtime.__serviceNowAdvancedHistoryPatched) return;
  runtime.__serviceNowAdvancedHistoryPatched = true;

  patchHistoryMethod("pushState");
  patchHistoryMethod("replaceState");

  function redirectSimpleHistoryEntry(): void {
    const destination = getAdvancedApplicationServiceUrl(window.location.href);
    if (destination !== null && destination !== window.location.href) {
      window.location.replace(destination);
    }
  }

  window.addEventListener("popstate", redirectSimpleHistoryEntry, true);
  redirectSimpleHistoryEntry();
})();
