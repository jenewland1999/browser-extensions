import { getSettings, saveSettings, type Settings } from "./settings.js";

const formControls = [...document.querySelectorAll<HTMLInputElement>("input")];
const routes = document.querySelector("fieldset");
let settings = await getSettings();

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

for (const control of formControls) {
  control.addEventListener("change", async () => {
    if (!isSettingName(control.name)) return;
    settings = await saveSettings({ ...settings, [control.name]: control.checked });
    render();
  });
}

render();
