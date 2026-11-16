export type LocalNotionPage = {
  id: string;
  title: string;
  sourceName: string;
  relativePath: string;
  content: string;
  updatedAt: number;
};

export type LocalNotionMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  sources?: string[];
};

const DB_NAME = 'ai-educational-book-local-notion';
const DB_VERSION = 1;
const PAGES_STORE = 'pages';
const MESSAGES_STORE = 'messages';
const MAX_ENTRIES = 250;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'csv', 'html', 'htm']);

const openDatabase = () => {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('This environment does not support local Notion storage.'));
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PAGES_STORE)) db.createObjectStore(PAGES_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(MESSAGES_STORE)) db.createObjectStore(MESSAGES_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local Notion storage.'));
    request.onblocked = () => reject(new Error('Another app window is blocking local Notion storage.'));
  });
};

let dbPromise: Promise<IDBDatabase> | null = null;
const getDatabase = () => {
  dbPromise ??= openDatabase().catch((error: unknown) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
};

const requestValue = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Local Notion storage request failed.'));
  });

const safeRelativePath = (path: string) =>
  path.replaceAll('\\', '/').split('/').filter((part) => part && part !== '.' && part !== '..').join('/');

const extensionOf = (path: string) => path.split('.').at(-1)?.toLowerCase() ?? '';
const titleFrom = (path: string, content: string) => {
  const heading = content.match(/^\s*#\s+(.+)$/m)?.[1]?.trim();
  const fileName = path.split('/').at(-1) ?? path;
  return heading || fileName.replace(/\.(md|markdown|txt|csv|html?)$/i, '') || 'Untitled Notion page';
};

const pageFrom = (sourceName: string, relativePath: string, content: string): LocalNotionPage => {
  const safePath = safeRelativePath(relativePath);
  return {
    id: `${sourceName}::${safePath}`,
    title: titleFrom(safePath, content),
    sourceName,
    relativePath: safePath,
    content,
    updatedAt: Date.now(),
  };
};

export async function listLocalNotionPages(): Promise<LocalNotionPage[]> {
  const db = await getDatabase();
  const rows = await requestValue<LocalNotionPage[]>(db.transaction(PAGES_STORE, 'readonly').objectStore(PAGES_STORE).getAll());
  return rows.sort((a, b) => a.title.localeCompare(b.title));
}

export async function saveLocalNotionMessages(messages: LocalNotionMessage[]): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(MESSAGES_STORE, 'readwrite');
  const store = tx.objectStore(MESSAGES_STORE);
  for (const message of messages) store.put(message);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not save the local conversation.'));
    tx.onabort = () => reject(tx.error ?? new Error('Saving the local conversation was cancelled.'));
  });
}

export async function listLocalNotionMessages(): Promise<LocalNotionMessage[]> {
  const db = await getDatabase();
  const rows = await requestValue<LocalNotionMessage[]>(db.transaction(MESSAGES_STORE, 'readonly').objectStore(MESSAGES_STORE).getAll());
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

async function persistPages(pages: LocalNotionPage[]) {
  if (!pages.length) return;
  const db = await getDatabase();
  const tx = db.transaction(PAGES_STORE, 'readwrite');
  const store = tx.objectStore(PAGES_STORE);
  for (const page of pages) store.put(page);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not save imported Notion pages.'));
    tx.onabort = () => reject(tx.error ?? new Error('Saving imported Notion pages was cancelled.'));
  });
}

export async function importLocalNotionFiles(files: File[]): Promise<{ imported: number; skipped: number }> {
  const pages: LocalNotionPage[] = [];
  let skipped = 0;
  let totalBytes = 0;
  for (const file of files) {
    if (file.size > MAX_TOTAL_BYTES) throw new Error(`${file.name} is larger than the 64 MB import limit.`);
    if (extensionOf(file.name) === 'zip') {
      const { BlobReader, TextWriter, ZipReader } = await import('@zip.js/zip.js');
      const reader = new ZipReader(new BlobReader(file));
      try {
        const entries = await reader.getEntries();
        let visited = 0;
        for (const entry of entries) {
          if (entry.directory) continue;
          visited += 1;
          if (visited > MAX_ENTRIES) throw new Error('A ZIP archive can contain at most 250 files.');
          const relativePath = safeRelativePath(entry.filename);
          if (!relativePath || !ALLOWED_EXTENSIONS.has(extensionOf(relativePath))) {
            skipped += 1;
            continue;
          }
          const size = entry.uncompressedSize ?? 0;
          if (size > MAX_FILE_BYTES || totalBytes + size > MAX_TOTAL_BYTES) {
            throw new Error('The archive exceeds the 8 MB per-file or 64 MB total text limit.');
          }
          const content = await entry.getData(new TextWriter());
          const contentBytes = new TextEncoder().encode(content).byteLength;
          if (contentBytes > MAX_FILE_BYTES) throw new Error(`${relativePath} exceeds the 8 MB per-file import limit.`);
          totalBytes += contentBytes;
          if (totalBytes > MAX_TOTAL_BYTES) throw new Error('The archive exceeds the 64 MB total text limit.');
          pages.push(pageFrom(file.name, relativePath, content));
        }
      } finally {
        await reader.close();
      }
      continue;
    }
    if (!ALLOWED_EXTENSIONS.has(extensionOf(file.name))) {
      skipped += 1;
      continue;
    }
    if (file.size > MAX_FILE_BYTES || totalBytes + file.size > MAX_TOTAL_BYTES) {
      throw new Error('Selected text files exceed the 8 MB per-file or 64 MB total limit.');
    }
    const content = await file.text();
    const contentBytes = new TextEncoder().encode(content).byteLength;
    if (contentBytes > MAX_FILE_BYTES) throw new Error(`${file.name} exceeds the 8 MB per-file import limit.`);
    totalBytes += contentBytes;
    pages.push(pageFrom(file.name, file.name, content));
  }
  await persistPages(pages);
  return { imported: pages.length, skipped };
}

const searchableText = (content: string) => content
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/!?(\[[^\]]*\])\([^)]*\)/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/[#>*_`~|]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export function findLocalNotionPassages(pages: LocalNotionPage[], question: string) {
  const terms = [...new Set(question.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])];
  if (!terms.length) return [];
  return pages.flatMap((page) => searchableText(page.content).split(/(?<=[.!?。！？])\s+|\n{2,}/).map((text) => {
    const lower = text.toLocaleLowerCase();
    const score = terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0);
    return { page, text: text.trim(), score };
  }))
    .filter((passage) => passage.score > 0 && passage.text)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ page, text }) => ({
      title: page.title,
      source: `${page.sourceName} / ${page.relativePath}`,
      text: text.slice(0, 1200),
    }));
}
