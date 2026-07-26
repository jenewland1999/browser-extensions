import { DEFAULT_SETTINGS, getSettings, type Settings } from "./settings.js";

const formControls = [...document.querySelectorAll<HTMLInputElement>("input")];
const routes = document.querySelector("fieldset");
const status = document.querySelector<HTMLParagraphElement>("#settings-status");
let settings = { ...DEFAULT_SETTINGS };
let committedSettings = settings;
let saveQueue = Promise.resolve();

function isSettingName(value: string): value is keyof Settings {
  return value in settings;
}

function render() {
  for (const control of formControls) {
    if (isSettingName(control.name)) {
      control.checked = settings[control.name];
    }
  }
  if (routes) routes.disabled = !settings.enabled;
}

function showStatus(message: string, isError = false): void {
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not save settings.";
}

async function persistSettings(nextSettings: Settings): Promise<void> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "save-settings",
      settings: nextSettings,
    })) as { error?: string; settings?: Settings };
    if (response.error || !response.settings) {
      throw new Error(response.error ?? "Could not save settings.");
    }
    committedSettings = response.settings;
    if (settings === nextSettings) showStatus("Settings saved.");
  } catch (error) {
    let reconciledSettings = committedSettings;
    try {
      reconciledSettings = await getSettings();
      committedSettings = reconciledSettings;
    } catch {}
    if (settings === nextSettings) {
      settings = reconciledSettings;
      render();
    }
    showStatus(`${errorMessage(error)} Previous settings restored.`, true);
  }
}

try {
  const [loadedSettings] = await Promise.all([
    getSettings(),
    chrome.runtime.sendMessage({ type: "health" }),
  ]);
  settings = loadedSettings;
  committedSettings = settings;
  document.documentElement.dataset["extensionReady"] = "true";
} catch (error) {
  showStatus(errorMessage(error), true);
}

for (const control of formControls) {
  control.addEventListener("change", () => {
    if (!isSettingName(control.name)) return;
    settings = { ...settings, [control.name]: control.checked };
    const nextSettings = settings;
    render();
    showStatus("Saving settings...");
    saveQueue = saveQueue.then(
      () => persistSettings(nextSettings),
      () => persistSettings(nextSettings),
    );
  });
}

render();
