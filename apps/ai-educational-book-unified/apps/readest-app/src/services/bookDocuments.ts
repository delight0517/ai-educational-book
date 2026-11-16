export type BookDocument = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  filePath: string | null;
  fileDirty: boolean;
  legacyMirrorRevision: string;
};

export type BookWorkspace = {
  activeId: string;
  documents: BookDocument[];
};

type LegacyDraft = {
  title?: unknown;
  body?: unknown;
  filePath?: unknown;
  fileDirty?: unknown;
  writerDocumentId?: unknown;
  writerMirrorRevision?: unknown;
};

type WorkspaceMetadata = { id: 'workspace'; activeId: string };

const DB_NAME = 'ai-educational-book-book-documents';
const DB_VERSION = 1;
const DOCUMENTS_STORE = 'documents';
const METADATA_STORE = 'metadata';
const LEGACY_DRAFT_KEY = 'ai-educational-book.writer.v1';

const createId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `book-${crypto.randomUUID()}`
    : `book-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const createMirrorRevision = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const openDatabase = () => {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('이 환경에서는 책 원고를 로컬에 저장할 수 없습니다.'));
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCUMENTS_STORE)) {
        db.createObjectStore(DOCUMENTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        db.createObjectStore(METADATA_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('책 원고 저장소를 열지 못했습니다.'));
    request.onblocked = () => reject(new Error('다른 창이 책 원고 저장소 업데이트를 막고 있습니다.'));
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

const requestValue = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('책 원고를 읽지 못했습니다.'));
  });

const completeTransaction = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('책 원고 저장에 실패했습니다.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('책 원고 저장이 중단되었습니다.'));
  });

const readLegacyDraft = (): LegacyDraft | null => {
  const raw = window.localStorage.getItem(LEGACY_DRAFT_KEY);
  if (!raw) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('기존 책 초안을 읽을 수 없습니다. 원래 데이터는 그대로 보존했습니다.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('기존 책 초안 형식이 올바르지 않습니다. 원래 데이터는 그대로 보존했습니다.');
  }
  return value as LegacyDraft;
};

const legacyText = (value: unknown, fallback: string) =>
  typeof value === 'string' ? value : fallback;

const mirrorLegacyDraft = (document: BookDocument) => {
  try {
    window.localStorage.setItem(
      LEGACY_DRAFT_KEY,
      JSON.stringify({
        title: document.title,
        body: document.body,
        filePath: document.filePath,
        fileDirty: document.fileDirty,
        writerDocumentId: document.id,
        writerMirrorRevision: document.legacyMirrorRevision,
      }),
    );
  } catch (error) {
    // IndexedDB remains authoritative; keep the previous compatibility copy if localStorage is full.
    console.warn('The legacy Writer mirror could not be refreshed:', error);
  }
};

export const saveBookWorkspace = async (workspace: BookWorkspace) => {
  if (!workspace.documents.some((document) => document.id === workspace.activeId)) {
    throw new Error('선택한 책 원고를 찾을 수 없습니다.');
  }

  const db = await getDatabase();
  const transaction = db.transaction([DOCUMENTS_STORE, METADATA_STORE], 'readwrite');
  const done = completeTransaction(transaction);
  const documentStore = transaction.objectStore(DOCUMENTS_STORE);
  for (const document of workspace.documents) documentStore.put(document);
  transaction.objectStore(METADATA_STORE).put({ id: 'workspace', activeId: workspace.activeId } satisfies WorkspaceMetadata);
  await done;

  const activeDocument = workspace.documents.find((document) => document.id === workspace.activeId);
  if (activeDocument) mirrorLegacyDraft(activeDocument);
};

const sortDocuments = (documents: BookDocument[]) =>
  [...documents].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const loadBookWorkspace = async (): Promise<BookWorkspace> => {
  const db = await getDatabase();
  const transaction = db.transaction([DOCUMENTS_STORE, METADATA_STORE], 'readonly');
  const documentRequest = transaction.objectStore(DOCUMENTS_STORE).getAll() as IDBRequest<BookDocument[]>;
  const metadataRequest = transaction.objectStore(METADATA_STORE).get('workspace') as IDBRequest<WorkspaceMetadata | undefined>;
  const [storedDocuments, metadata] = await Promise.all([
    requestValue(documentRequest),
    requestValue(metadataRequest),
  ]);

  if (!storedDocuments.length) {
    const legacy = readLegacyDraft();
    const now = new Date().toISOString();
    const migratedDocument: BookDocument = {
      id: 'book-legacy-writer-v1',
      title: legacyText(legacy?.title, '새 책'),
      body: legacyText(legacy?.body, ''),
      createdAt: now,
      updatedAt: now,
      filePath: typeof legacy?.filePath === 'string' ? legacy.filePath : null,
      fileDirty: legacy?.fileDirty === true,
      legacyMirrorRevision: createMirrorRevision(),
    };
    const migratedWorkspace = { activeId: migratedDocument.id, documents: [migratedDocument] };
    await saveBookWorkspace(migratedWorkspace);
    return migratedWorkspace;
  }

  const documents = storedDocuments.filter(
    (document) =>
      document &&
      typeof document.id === 'string' &&
      typeof document.title === 'string' &&
      typeof document.body === 'string' &&
      typeof document.updatedAt === 'string',
  );
  if (!documents.length) throw new Error('저장된 책 원고를 읽을 수 없습니다. 데이터를 보존했습니다.');

  const sortedDocuments = sortDocuments(documents);
  const storedActiveId = metadata?.activeId;
  const activeId = storedActiveId && sortedDocuments.some((document) => document.id === storedActiveId)
    ? storedActiveId
    : (sortedDocuments[0]?.id ?? '');
  const workspace: BookWorkspace = { activeId, documents: sortedDocuments };
  const activeDocument = sortedDocuments.find((document) => document.id === activeId);
  const legacy = readLegacyDraft();

  // Link Inbox still appends to the legacy key. Its preserved bridge markers let us
  // recognize that explicit append and bring it into the durable document record.
  if (
    activeDocument &&
    legacy?.writerDocumentId === activeDocument.id &&
    legacy.writerMirrorRevision === activeDocument.legacyMirrorRevision &&
    (legacyText(legacy.title, '') !== activeDocument.title || legacyText(legacy.body, '') !== activeDocument.body)
  ) {
    const reconciled = updateBookDocument(workspace, activeId, {
      title: legacyText(legacy.title, activeDocument.title),
      body: legacyText(legacy.body, activeDocument.body),
      filePath: typeof legacy.filePath === 'string' ? legacy.filePath : activeDocument.filePath,
      fileDirty: legacy.fileDirty === true,
    });
    await saveBookWorkspace(reconciled);
    return reconciled;
  }

  if (metadata?.activeId !== activeId) await saveBookWorkspace(workspace);
  return workspace;
};

export const createBookDocument = (workspace: BookWorkspace, title = '새 책'): BookWorkspace => {
  const now = new Date().toISOString();
  const document: BookDocument = {
    id: createId(),
    title,
    body: '',
    createdAt: now,
    updatedAt: now,
    filePath: null,
    fileDirty: false,
    legacyMirrorRevision: createMirrorRevision(),
  };
  return { activeId: document.id, documents: [document, ...workspace.documents] };
};

export const selectBookDocument = (workspace: BookWorkspace, id: string): BookWorkspace => {
  if (!workspace.documents.some((document) => document.id === id)) return workspace;
  return { ...workspace, activeId: id };
};

export const updateBookDocument = (
  workspace: BookWorkspace,
  id: string,
  changes: Partial<Pick<BookDocument, 'title' | 'body' | 'filePath' | 'fileDirty'>>,
): BookWorkspace => {
  const now = new Date().toISOString();
  return {
    ...workspace,
    documents: workspace.documents.map((document) =>
      document.id === id
        ? { ...document, ...changes, updatedAt: now, legacyMirrorRevision: createMirrorRevision() }
        : document,
    ),
  };
};
