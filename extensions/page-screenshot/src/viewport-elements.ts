export type ViewportCapturePhase = "single" | "first" | "middle" | "last";

export function setViewportElementsForCapture(phase: ViewportCapturePhase): void {
  const hiddenAttribute = "data-page-screenshot-hidden";
  const styleAttribute = "pageScreenshotStyle";
  const hadStyleAttribute = "pageScreenshotHadStyle";
  const edgeTolerance = 2;
  const viewportHeight = window.innerHeight;

  const restoreElement = (element: HTMLElement): void => {
    if (!element.hasAttribute(hiddenAttribute)) return;
    const style = element.dataset[styleAttribute] ?? "";
    const hadStyle = element.dataset[hadStyleAttribute] === "true";
    delete element.dataset[styleAttribute];
    delete element.dataset[hadStyleAttribute];
    delete element.dataset["pageScreenshotHidden"];
    if (hadStyle) element.setAttribute("style", style);
    else element.removeAttribute("style");
  };

  const hideElement = (element: HTMLElement): void => {
    if (element.hasAttribute(hiddenAttribute)) return;
    element.dataset[styleAttribute] = element.getAttribute("style") ?? "";
    element.dataset[hadStyleAttribute] = String(element.hasAttribute("style"));
    element.dataset["pageScreenshotHidden"] = "";
    element.style.setProperty("opacity", "0", "important");
    element.style.setProperty("pointer-events", "none", "important");
  };

  const isInsetSet = (value: string): boolean => value !== "" && value !== "auto";

  const getAttachment = (element: HTMLElement): "top" | "bottom" | "side" => {
    const computedStyle = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const top = isInsetSet(computedStyle.top) || rect.top <= edgeTolerance;
    const bottom =
      isInsetSet(computedStyle.bottom) || rect.bottom >= viewportHeight - edgeTolerance;
    const left = isInsetSet(computedStyle.left) || rect.left <= edgeTolerance;
    const right =
      isInsetSet(computedStyle.right) || rect.right >= window.innerWidth - edgeTolerance;
    const spansMostViewportHeight = rect.height >= viewportHeight * 0.75 && (top || bottom);

    if ((left || right) && spansMostViewportHeight) return "side";
    if (bottom) return "bottom";
    if (top) return "top";
    if (left || right) return "side";
    return "top";
  };

  const shouldShow = (attachment: "top" | "bottom" | "side"): boolean =>
    phase === "single" || (attachment === "bottom" ? phase === "last" : phase === "first");

  for (const element of document.querySelectorAll<HTMLElement>("body *")) {
    const position = getComputedStyle(element).position;
    if (position !== "fixed" && position !== "sticky") continue;

    if (shouldShow(getAttachment(element))) restoreElement(element);
    else hideElement(element);
  }
}

export function restoreViewportElements(): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-page-screenshot-hidden]")) {
    const style = element.dataset["pageScreenshotStyle"] ?? "";
    const hadStyle = element.dataset["pageScreenshotHadStyle"] === "true";
    delete element.dataset["pageScreenshotStyle"];
    delete element.dataset["pageScreenshotHadStyle"];
    delete element.dataset["pageScreenshotHidden"];
    if (hadStyle) element.setAttribute("style", style);
    else element.removeAttribute("style");
  }
}
