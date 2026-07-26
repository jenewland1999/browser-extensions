import {
  createBookmarksHtml,
  createExportFilename,
  MAX_IMPORT_FILE_BYTES,
  OPERATION_CONCURRENCY,
  parseBookmarksHtml,
  settleWithConcurrency,
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
let itemCount = 0;
let busy = false;

function showStatus(message: string, isError = false): void {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function loadItems(): Promise<ReadingListItem[]> {
  const items = await chrome.readingList.query({});
  itemCount = items.length;
  const unreadCount = items.filter((item) => !item.hasBeenRead).length;
  count.textContent = String(items.length);
  summary.textContent = `${unreadCount} unread · ${items.length - unreadCount} read`;
  exportButton.disabled = items.length === 0;
  deleteButton.disabled = items.length === 0;
  return items;
}

function setBusy(nextBusy: boolean): void {
  busy = nextBusy;
  importButton.disabled = nextBusy;
  exportButton.disabled = nextBusy || itemCount === 0;
  deleteButton.disabled = nextBusy || itemCount === 0;
}

async function refreshItems(): Promise<string | null> {
  try {
    await loadItems();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Could not refresh the Reading List.";
  }
}

importButton.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;

  setBusy(true);
  showStatus("Importing bookmarks...");

  try {
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      throw new Error("Import files must be 10 MB or smaller.");
    }
    const entries = parseBookmarksHtml(await file.text());
    const existingUrls = new Set((await chrome.readingList.query({})).map((item) => item.url));
    const additions = entries.filter((entry) => !existingUrls.has(entry.url));
    const results = await settleWithConcurrency(
      additions,
      OPERATION_CONCURRENCY,
      (entry) => chrome.readingList.addEntry(entry),
      (completed, total) => showStatus(`Importing bookmarks... ${completed}/${total}`),
    );
    const imported = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.length - imported;
    const message =
      entries.length === 0
        ? "No valid web links found in that file."
        : `Imported ${imported}; skipped ${entries.length - additions.length}; failed ${failed}.`;
    const refreshError = await refreshItems();
    showStatus(
      refreshError ? `${message} ${refreshError}` : message,
      entries.length === 0 || failed > 0 || !!refreshError,
    );
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Import failed.", true);
  } finally {
    setBusy(false);
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
  }
});

deleteButton.addEventListener("click", async () => {
  if (busy) return;
  setBusy(true);
  let items: ReadingListItem[];
  try {
    items = await chrome.readingList.query({});
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Could not read the Reading List.", true);
    setBusy(false);
    return;
  }
  if (
    items.length === 0 ||
    !window.confirm(
      `Clear all ${items.length} ${items.length === 1 ? "item" : "items"} from Chrome Reading List? This cannot be undone.`,
    )
  ) {
    setBusy(false);
    return;
  }

  showStatus("Clearing Reading List...");

  try {
    const results = await settleWithConcurrency(
      items,
      OPERATION_CONCURRENCY,
      (item) => chrome.readingList.removeEntry({ url: item.url }),
      (completed, total) => showStatus(`Clearing Reading List... ${completed}/${total}`),
    );
    const failed = results.filter((result) => result.status === "rejected").length;
    const message =
      failed === 0
        ? "Reading List cleared."
        : `Removed ${results.length - failed} items; ${failed} could not be removed.`;
    const refreshError = await refreshItems();
    showStatus(refreshError ? `${message} ${refreshError}` : message, failed > 0 || !!refreshError);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Could not clear the Reading List.", true);
  } finally {
    setBusy(false);
  }
});

void loadItems()
  .then(() => {
    document.documentElement.dataset["extensionReady"] = "true";
  })
  .catch((error: unknown) => {
    showStatus(error instanceof Error ? error.message : "Could not read the Reading List.", true);
  });
