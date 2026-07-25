import { getSettings, saveSettings } from "./settings.js";

const formControls = [...document.querySelectorAll("input")];
const routes = document.querySelector("fieldset");
let settings = await getSettings();

function render() {
  for (const control of formControls) {
    control.checked = settings[control.name];
  }
  routes.disabled = !settings.enabled;
}

for (const control of formControls) {
  control.addEventListener("change", async () => {
    settings = await saveSettings({ ...settings, [control.name]: control.checked });
    render();
  });
}

render();
