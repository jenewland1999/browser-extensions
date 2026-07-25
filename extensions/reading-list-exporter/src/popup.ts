import {
  createBookmarksHtml,
  createExportFilename,
  parseBookmarksHtml,
  type ReadingListItem,
} from "./export.js";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing popup element: ${selector}`);
  return element;
}

const count = requireElement<HTMLElement>("#count");
const summary = requireElement<HTMLElement>("#summary");
const status = requireElement<HTMLParagraphElement>("#status");
const importButton = requireElement<HTMLButtonElement>("#import");
const fileInput = requireElement<HTMLInputElement>("#import-file");
const exportButton = requireElement<HTMLButtonElement>("#export");
const deleteButton = requireElement<HTMLButtonElement>("#delete");

function showStatus(message: string, isError = false): void {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function loadItems(): Promise<ReadingListItem[]> {
  const items = await chrome.readingList.query({});
  const unreadCount = items.filter((item) => !item.hasBeenRead).length;
  count.textContent = String(items.length);
  summary.textContent = `${unreadCount} unread · ${items.length - unreadCount} read`;
  exportButton.disabled = items.length === 0;
  deleteButton.disabled = items.length === 0;
  return items;
}

function setBusy(busy: boolean): void {
  importButton.disabled = busy;
  exportButton.disabled = busy;
  deleteButton.disabled = busy;
}

importButton.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;

  setBusy(true);
  showStatus("Importing bookmarks...");

  try {
    const entries = parseBookmarksHtml(await file.text());
    const existingUrls = new Set((await chrome.readingList.query({})).map((item) => item.url));
    const additions = entries.filter((entry) => !existingUrls.has(entry.url));
    const results = await Promise.allSettled(
      additions.map((entry) => chrome.readingList.addEntry(entry)),
    );
    const imported = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.length - imported;
    showStatus(
      entries.length === 0
        ? "No valid web links found in that file."
        : `Imported ${imported}; skipped ${entries.length - additions.length + failed}.`,
      entries.length === 0 || failed > 0,
    );
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Import failed.", true);
  } finally {
    setBusy(false);
    await loadItems();
  }
});

exportButton.addEventListener("click", async () => {
  setBusy(true);
  showStatus("Preparing export...");

  try {
    const items = await chrome.readingList.query({});
    const url = URL.createObjectURL(new Blob([createBookmarksHtml(items)], { type: "text/html" }));
    try {
      await chrome.downloads.download({
        url,
        filename: createExportFilename(new Date()),
        saveAs: true,
      });
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }

    showStatus(`Exported ${items.length} ${items.length === 1 ? "item" : "items"}.`);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Export failed.", true);
  } finally {
    setBusy(false);
    await loadItems();
  }
});

deleteButton.addEventListener("click", async () => {
  const items = await chrome.readingList.query({});
  if (
    items.length === 0 ||
    !window.confirm(
      `Clear all ${items.length} ${items.length === 1 ? "item" : "items"} from Chrome Reading List? This cannot be undone.`,
    )
  )
    return;

  setBusy(true);
  showStatus("Clearing Reading List...");

  const results = await Promise.allSettled(
    items.map((item) => chrome.readingList.removeEntry({ url: item.url })),
  );
  const failed = results.filter((result) => result.status === "rejected").length;

  try {
    await loadItems();
    showStatus(
      failed === 0
        ? "Reading List cleared."
        : `Removed ${results.length - failed} items; ${failed} could not be removed.`,
      failed > 0,
    );
  } catch (error) {
    showStatus(
      error instanceof Error ? error.message : "Could not refresh the Reading List.",
      true,
    );
  } finally {
    setBusy(false);
    await loadItems();
  }
});

void loadItems().catch((error: unknown) => {
  showStatus(error instanceof Error ? error.message : "Could not read the Reading List.", true);
});
