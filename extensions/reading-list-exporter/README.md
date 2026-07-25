# Reading List Manager

Manifest V3 Chrome extension for importing, exporting, and clearing Reading List entries.

## What it does

- Exports every Chrome Reading List entry as standard Netscape bookmarks HTML.
- Groups entries into `Unread` and `Read` folders and preserves creation dates.
- Imports links from the extension's exports or standard browser bookmarks HTML.
- Skips duplicate and unsupported URLs when importing; generic bookmarks are added as unread.
- Clears the entire Reading List after a confirmation prompt.
- Performs no network requests and requests no access to website content.

## Use it

1. Run `pnpm --filter @browser-extensions/reading-list-manager build` from the repository root.
2. Open `chrome://extensions`, enable **Developer mode**, and select **Load unpacked**.
3. Choose `extensions/reading-list-exporter/dist`.
4. Open the extension and select **Export for Raindrop**.
5. In Raindrop, open **Settings → Import → HTML file**, then import the downloaded file.
6. Check that the imported links are present in Raindrop.
7. Select **Delete / Clear** in the extension and confirm to empty Chrome's Reading List.

Keep the exported HTML file until you are satisfied that the migration is complete.
