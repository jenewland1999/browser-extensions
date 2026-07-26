export interface ReadingListItem {
  title: string;
  url: string;
  hasBeenRead: boolean;
  creationTime: number;
}

export const MAX_IMPORT_FILE_BYTES = 10 * 1_024 * 1_024;
export const MAX_IMPORT_ENTRIES = 10_000;
export const OPERATION_CONCURRENCY = 8;

export async function settleWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T, index: number) => Promise<void>,
  onProgress?: (completed: number, total: number) => void,
): Promise<PromiseSettledResult<void>[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Concurrency must be a positive integer.");
  }

  const results: PromiseSettledResult<void>[] = Array.from({ length: items.length }, () => ({
    status: "fulfilled",
    value: undefined,
  }));
  let nextIndex = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index]!;

      try {
        await operation(item, index);
        results[index] = { status: "fulfilled", value: undefined };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
      onProgress?.(++completed, items.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => worker()),
  );
  return results;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderFolder(name: string, items: ReadingListItem[]): string[] {
  return [
    `        <DT><H3>${name}</H3>`,
    "        <DL><p>",
    ...items.map(
      (item) =>
        `            <DT><A HREF="${escapeHtml(item.url)}" ADD_DATE="${Math.floor(item.creationTime / 1_000)}" READING_LIST_READ="${String(item.hasBeenRead)}">${escapeHtml(item.title || item.url)}</A>`,
    ),
    "        </DL><p>",
  ];
}

export function createBookmarksHtml(items: ReadingListItem[]): string {
  const unread = items.filter((item) => !item.hasBeenRead);
  const read = items.filter((item) => item.hasBeenRead);

  return [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Chrome Reading List</TITLE>",
    "<H1>Chrome Reading List</H1>",
    "<DL><p>",
    '    <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Chrome Reading List</H3>',
    "    <DL><p>",
    ...renderFolder("Unread", unread),
    ...renderFolder("Read", read),
    "    </DL><p>",
    "</DL><p>",
    "",
  ].join("\n");
}

export function createExportFilename(date: Date): string {
  return `chrome-reading-list-${date.toISOString().slice(0, 10)}.html`;
}

export function parseBookmarksHtml(html: string): Omit<ReadingListItem, "creationTime">[] {
  const document = new DOMParser().parseFromString(html, "text/html");
  const entries: Omit<ReadingListItem, "creationTime">[] = [];
  const urls = new Set<string>();

  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    let url: URL;
    try {
      url = new URL(link.href);
    } catch {
      continue;
    }

    if (!["http:", "https:"].includes(url.protocol) || urls.has(url.href)) continue;
    if (entries.length === MAX_IMPORT_ENTRIES) {
      throw new Error(`Import files can contain at most ${MAX_IMPORT_ENTRIES} web links.`);
    }
    urls.add(url.href);
    entries.push({
      title: link.textContent?.trim() || url.href,
      url: url.href,
      hasBeenRead: link.getAttribute("reading_list_read") === "true",
    });
  }

  return entries;
}
