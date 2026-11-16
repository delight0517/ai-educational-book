export type LinkInboxRecord = {
  id: string;
  title: string;
  url: string;
  originalUrl: string;
  addedAt: string;
  updatedAt: string;
  notes: string;
  tags: string[];
  read: boolean;
};

export type InboxFileRecord = {
  id: string;
  kind: 'file';
  title: string;
  name: string;
  mimeType: string;
  size: number;
  lastModified: number;
  fingerprint: string;
  file: Blob;
  addedAt: string;
  updatedAt: string;
  notes: string;
  tags: string[];
  read: boolean;
};

export type StagedLibraryImportFile = {
  name: string;
  mimeType: string;
  size: number;
  lastModified: number;
  file: Blob;
};

export type StagedLibraryImport = {
  id: string;
  files: StagedLibraryImportFile[];
  sourceInboxIds: string[];
  createdAt: string;
};

export type DroppedLink = { url: string; title?: string };

const DB_NAME = 'ai-educational-book-link-inbox';
const DB_VERSION = 2;
const LINK_STORE_NAME = 'links';
const FILE_STORE_NAME = 'files';
const LIBRARY_IMPORT_STORE_NAME = 'library-imports';
const WRITER_DRAFT_KEY = 'ai-educational-book.writer.v1';

const createId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `link-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const normalizeWebUrl = (input: string) => {
  const value = input.trim();
  if (!value) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    if (!/^(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(value)) return null;
    try {
      parsed = new URL(`https://${value}`);
    } catch {
      return null;
    }
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    return null;
  }
  return parsed;
};

export const canonicalizeWebUrl = (input: string) => normalizeWebUrl(input)?.href ?? null;

export const createLinkInboxRecord = (input: DroppedLink): LinkInboxRecord => {
  const parsed = normalizeWebUrl(input.url);
  if (!parsed) throw new Error('Only http and https links are accepted.');
  const now = new Date().toISOString();
  return {
    id: createId(),
    title: input.title?.trim() || parsed.hostname,
    url: parsed.href,
    originalUrl: input.url.trim(),
    addedAt: now,
    updatedAt: now,
    notes: '',
    tags: [],
    read: false,
  };
};

export const classifyInboxFile = (name: string) => {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'pdf') return 'PDF';
  if (['doc', 'docx', 'odt', 'rtf'].includes(extension)) return 'Document';
  if (['txt', 'md', 'html', 'htm', 'mht', 'mhtml'].includes(extension)) return 'Text file';
  if (['epub', 'mobi', 'azw', 'azw3', 'fb2', 'zip', 'cbz', 'rbooks'].includes(extension)) return 'Book file';
  return 'Other file';
};

const LIBRARY_FILE_EXTENSIONS = new Set([
  'epub', 'mobi', 'azw', 'azw3', 'fb2', 'zip', 'cbz', 'pdf', 'txt', 'md', 'html', 'htm', 'mhtml', 'mht',
  'rbooks', 'docx', 'rtf',
]);

export const isInboxLibraryFile = (name: string) =>
  LIBRARY_FILE_EXTENSIONS.has(name.split('.').pop()?.toLowerCase() ?? '');

export const createInboxFileFingerprint = (name: string, size: number, lastModified: number) =>
  `${name.trim().toLocaleLowerCase()}|${size}|${lastModified}`;

export const createInboxFileRecord = (input: {
  name: string;
  mimeType: string;
  size: number;
  lastModified: number;
  file: Blob;
}): InboxFileRecord => {
  const now = new Date().toISOString();
  return {
    id: createId(),
    kind: 'file',
    title: input.name,
    name: input.name,
    mimeType: input.mimeType || 'application/octet-stream',
    size: input.size,
    lastModified: input.lastModified,
    fingerprint: createInboxFileFingerprint(input.name, input.size, input.lastModified),
    file: input.file,
    addedAt: now,
    updatedAt: now,
    notes: '',
    tags: [],
    read: false,
  };
};

const openDatabase = () => {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('This device cannot store items in the local Inbox.'));
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LINK_STORE_NAME)) {
        const store = db.createObjectStore(LINK_STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(FILE_STORE_NAME)) {
        const store = db.createObjectStore(FILE_STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
        store.createIndex('fingerprint', 'fingerprint', { unique: false });
      }
      if (!db.objectStoreNames.contains(LIBRARY_IMPORT_STORE_NAME)) {
        db.createObjectStore(LIBRARY_IMPORT_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the local Inbox.'));
    request.onblocked = () => reject(new Error('Another window is blocking the local Inbox update.'));
  });
};

let databasePromise: Promise<IDBDatabase> | null = null;
const getDatabase = () => {
  databasePromise ??= openDatabase().catch((error: unknown) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
};

const completeTransaction = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the Inbox item.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Saving the Inbox item was interrupted.'));
  });

export const listLinkInboxRecords = async () => {
  const db = await getDatabase();
  return new Promise<LinkInboxRecord[]>((resolve, reject) => {
    const transaction = db.transaction(LINK_STORE_NAME, 'readonly');
    const request = transaction.objectStore(LINK_STORE_NAME).getAll() as IDBRequest<LinkInboxRecord[]>;
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    request.onerror = () => reject(request.error ?? new Error('Could not read the local Inbox.'));
  });
};

export const saveLinkInboxRecord = async (record: LinkInboxRecord) => {
  const db = await getDatabase();
  const transaction = db.transaction(LINK_STORE_NAME, 'readwrite');
  transaction.objectStore(LINK_STORE_NAME).put(record);
  await completeTransaction(transaction);
};

export const deleteLinkInboxRecord = async (id: string) => {
  const db = await getDatabase();
  const transaction = db.transaction(LINK_STORE_NAME, 'readwrite');
  transaction.objectStore(LINK_STORE_NAME).delete(id);
  await completeTransaction(transaction);
};

export const listInboxFileRecords = async () => {
  const db = await getDatabase();
  return new Promise<InboxFileRecord[]>((resolve, reject) => {
    const transaction = db.transaction(FILE_STORE_NAME, 'readonly');
    const request = transaction.objectStore(FILE_STORE_NAME).getAll() as IDBRequest<InboxFileRecord[]>;
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    request.onerror = () => reject(request.error ?? new Error('Could not read the local Inbox.'));
  });
};

export const saveInboxFileRecord = async (record: InboxFileRecord) => {
  const db = await getDatabase();
  const transaction = db.transaction(FILE_STORE_NAME, 'readwrite');
  transaction.objectStore(FILE_STORE_NAME).put(record);
  await completeTransaction(transaction);
};

export const deleteInboxFileRecord = async (id: string) => {
  const db = await getDatabase();
  const transaction = db.transaction(FILE_STORE_NAME, 'readwrite');
  transaction.objectStore(FILE_STORE_NAME).delete(id);
  await completeTransaction(transaction);
};

export const stageInboxLibraryImport = async (
  files: StagedLibraryImportFile[],
  sourceInboxIds: string[] = [],
) => {
  if (!files.length) throw new Error('Choose at least one supported file.');
  const db = await getDatabase();
  const record: StagedLibraryImport = {
    id: createId(),
    files,
    sourceInboxIds,
    createdAt: new Date().toISOString(),
  };
  const transaction = db.transaction(LIBRARY_IMPORT_STORE_NAME, 'readwrite');
  transaction.objectStore(LIBRARY_IMPORT_STORE_NAME).put(record);
  await completeTransaction(transaction);
  return record.id;
};

export const getStagedInboxLibraryImport = async (id: string) => {
  const db = await getDatabase();
  return new Promise<StagedLibraryImport | null>((resolve, reject) => {
    const transaction = db.transaction(LIBRARY_IMPORT_STORE_NAME, 'readonly');
    const request = transaction.objectStore(LIBRARY_IMPORT_STORE_NAME).get(id) as IDBRequest<StagedLibraryImport | undefined>;
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error ?? new Error('Could not read the local file handoff.'));
  });
};

export const deleteStagedInboxLibraryImport = async (id: string) => {
  const db = await getDatabase();
  const transaction = db.transaction(LIBRARY_IMPORT_STORE_NAME, 'readwrite');
  transaction.objectStore(LIBRARY_IMPORT_STORE_NAME).delete(id);
  await completeTransaction(transaction);
};

export const appendLinkToWriterDraft = (record: LinkInboxRecord) => {
  const stored = window.localStorage.getItem(WRITER_DRAFT_KEY);
  let draft: Record<string, unknown> = {};
  if (stored) {
    const parsed: unknown = JSON.parse(stored);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      draft = parsed as Record<string, unknown>;
    }
  }

  const body = typeof draft['body'] === 'string' ? draft['body'] : '';
  const title = typeof draft['title'] === 'string' && draft['title'].trim() ? draft['title'] : '새 책';
  const reference = `${record.title.trim() || record.url}: ${record.url}`;
  const nextBody = body.trim() ? `${body.trimEnd()}\n\n${reference}` : reference;
  window.localStorage.setItem(
    WRITER_DRAFT_KEY,
    JSON.stringify({
      ...draft,
      title,
      body: nextBody,
      fileDirty: Boolean(draft['filePath']) || draft['fileDirty'] === true,
    }),
  );
};

export const appendConversationToWriterDraft = (input: {
  title: string;
  source: 'chatgpt' | 'gemini';
  sourceUrl: string;
  rawText: string;
}) => {
  const stored = window.localStorage.getItem(WRITER_DRAFT_KEY);
  let draft: Record<string, unknown> = {};
  if (stored) {
    const parsed: unknown = JSON.parse(stored);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      draft = parsed as Record<string, unknown>;
    }
  }

  const body = typeof draft['body'] === 'string' ? draft['body'] : '';
  const bookTitle = typeof draft['title'] === 'string' && draft['title'].trim() ? draft['title'] : '새 책';
  const sourceName = input.source === 'chatgpt' ? 'ChatGPT' : 'Gemini';
  const marker = `<!-- shared-conversation-url:${input.sourceUrl} -->`;
  if (body.includes(marker)) return false;
  const section = `## ${input.title.trim() || `${sourceName} conversation`}\n\nSource: ${sourceName} (${input.sourceUrl})\n\n### Original conversation\n\n${input.rawText}`;
  const markedSection = `${marker}\n${section}`;
  const nextBody = body.trim() ? `${body.trimEnd()}\n\n${markedSection}` : markedSection;

  window.localStorage.setItem(
    WRITER_DRAFT_KEY,
    JSON.stringify({
      ...draft,
      title: bookTitle,
      body: nextBody,
      fileDirty: Boolean(draft['filePath']) || draft['fileDirty'] === true,
    }),
  );
  return true;
};

export const parseDroppedLink = (data: { html?: string; uriList?: string; plainText?: string }): DroppedLink | null => {
  if (data.html && typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(data.html, 'text/html');
    const anchor = document.querySelector('a[href]');
    const href = anchor?.getAttribute('href') ?? '';
    if (normalizeWebUrl(href)) {
      const title = anchor?.textContent?.trim();
      return { url: href, ...(title ? { title } : {}) };
    }
  }

  const uri = data.uriList
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'));
  if (uri && normalizeWebUrl(uri)) return { url: uri };

  const plainText = data.plainText?.trim() ?? '';
  const candidate = plainText.match(/https?:\/\/[^\s<>"']+/i)?.[0] ?? plainText.split(/\r?\n/)[0] ?? '';
  const cleaned = candidate.replace(/[),.;!?]+$/, '');
  return normalizeWebUrl(cleaned) ? { url: cleaned } : null;
};
