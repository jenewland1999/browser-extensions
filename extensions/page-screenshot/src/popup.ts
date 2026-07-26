import {
  defaultSettings,
  normalizeSettings,
  type CaptureSettings,
  type ScreenshotFormat,
} from "./capture.js";

type CaptureType = "viewport" | "full-page";
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing popup element: ${selector}`);
  return element;
}

const status = requireElement<HTMLParagraphElement>("#status");
const askWhere = requireElement<HTMLInputElement>("#ask-where");
const format = requireElement<HTMLSelectElement>("#format");
const filenameTemplate = requireElement<HTMLInputElement>("#filename-template");
const qualityField = requireElement<HTMLLabelElement>("#quality-field");
const quality = requireElement<HTMLInputElement>("#quality");
const qualityValue = requireElement<HTMLOutputElement>("#quality-value");
const qualityNote = requireElement<HTMLElement>("#quality-note");
const configureShortcuts = requireElement<HTMLButtonElement>("#configure-shortcuts");
const buttons = [...document.querySelectorAll<HTMLButtonElement>("button[data-capture]")];

function renderSettings(settings: CaptureSettings): void {
  askWhere.checked = settings.askWhereToSave;
  format.value = settings.format;
  filenameTemplate.value = settings.filenameTemplate;
  quality.value = String(settings.quality);
  qualityValue.value = `${settings.quality}%`;
  const lossless = settings.format === "png";
  qualityField.hidden = lossless;
  quality.disabled = lossless;
  qualityNote.textContent = `Applied to ${settings.format === "jpeg" ? "JPEG" : "WebP"} files`;
}

async function loadSettings(): Promise<void> {
  const stored = (await chrome.storage.local.get(defaultSettings)) as CaptureSettings;
  renderSettings(normalizeSettings(stored));
}

async function saveSettings(): Promise<CaptureSettings> {
  const settings = normalizeSettings({
    askWhereToSave: askWhere.checked,
    filenameTemplate: filenameTemplate.value,
    format: format.value as ScreenshotFormat,
    quality: Number(quality.value),
  });
  await chrome.storage.local.set(settings);
  renderSettings(settings);
  return settings;
}

for (const button of buttons) {
  button.addEventListener("click", async () => {
    const captureType = button.dataset["capture"] as CaptureType;
    for (const item of buttons) item.disabled = true;
    status.classList.remove("error");
    status.textContent = "Capturing...";

    try {
      const settings = await saveSettings();
      const response = (await chrome.runtime.sendMessage({
        type: "capture",
        captureType,
        settings,
      })) as { error?: string; saved?: boolean };
      if (response.error) throw new Error(response.error);
      status.textContent = response.saved ? "Saved." : "Screenshot failed.";
    } catch (error) {
      status.classList.add("error");
      status.textContent = error instanceof Error ? error.message : "Screenshot failed.";
    } finally {
      for (const item of buttons) item.disabled = false;
    }
  });
}

for (const control of [askWhere, format, quality, filenameTemplate]) {
  control.addEventListener("change", () => void saveSettings());
}
quality.addEventListener("input", () => void saveSettings());
configureShortcuts.addEventListener("click", () => {
  void chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

void Promise.all([loadSettings(), chrome.commands.getAll()]).then(([, commands]) => {
  for (const command of commands) {
    const suffix = command.name === "capture-viewport" ? "viewport" : "full-page";
    const shortcut = requireElement<HTMLElement>(`#shortcut-${suffix}`);
    shortcut.textContent = command.shortcut ?? "";
    shortcut.hidden = !command.shortcut;
  }
  document.documentElement.dataset["extensionReady"] = "true";
});

void chrome.runtime
  .sendMessage({ type: "capture-result" })
  .then((response: { error?: string; saved?: boolean }) => {
    if (response.error) {
      status.classList.add("error");
      status.textContent = response.error;
    } else if (response.saved) {
      status.textContent = "Saved.";
    }
  });
