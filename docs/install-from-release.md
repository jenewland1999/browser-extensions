# Install an extension from a release

The extensions are distributed as ZIP files attached to GitHub releases. They
are not published to a browser extension store, so install and update them as
unpacked extensions.

## Install the latest stable version

1. Open the [latest release](https://github.com/jenewland1999/browser-extensions/releases/latest).
2. In **Assets**, download the ZIP named for the extension you want. Do not use
   GitHub's automatically generated **Source code** archives; those are not
   built extensions.
3. Extract the ZIP into a permanent directory. Keep this directory after
   installation because the browser loads the extension from it.
4. Open the extensions page for your browser:
   - Chrome and Chromium: `chrome://extensions`
   - Microsoft Edge: `edge://extensions`
   - Brave: `brave://extensions`
5. Enable **Developer mode**.
6. Select **Load unpacked** and choose the extracted directory that contains
   `manifest.json`.

The release contains separate assets similar to:

```text
npmjs-to-npmx-v1.2.0.zip
page-screenshot-v1.2.0.zip
reading-list-manager-v1.2.0.zip
servicenow-advanced-service-view-v1.2.0.zip
tessera-v1.2.0.zip
SHA256SUMS
```

## Verify a download

Each release includes `SHA256SUMS`. On macOS or Linux, calculate the downloaded
file's checksum and compare it with the matching line in that file:

```sh
shasum -a 256 tessera-v1.2.0.zip
```

On Windows PowerShell:

```powershell
Get-FileHash .\tessera-v1.2.0.zip -Algorithm SHA256
```

## Update an installed extension

1. Download the newer ZIP from the latest release.
2. Replace the contents of the existing extracted directory, keeping the same
   directory path.
3. Return to the browser's extensions page and select **Reload** on the
   extension.

Keeping the directory path unchanged preserves the unpacked extension identity
used by the browser. Extension data stored by the browser is not included in
the release ZIP.

## Install a canary

Canaries are marked **Pre-release** on the
[releases page](https://github.com/jenewland1999/browser-extensions/releases).
Install their ZIPs using the same steps. A canary may be unstable and is not
selected by the repository's **Latest** release link.

## Uninstall

Select **Remove** on the browser's extensions page, then delete the extracted
directory if it is no longer needed.
