'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import {
  appendConversationToWriterDraft,
  appendLinkToWriterDraft,
  canonicalizeWebUrl,
  classifyInboxFile,
  createInboxFileFingerprint,
  createInboxFileRecord,
  createLinkInboxRecord,
  deleteInboxFileRecord,
  deleteLinkInboxRecord,
  InboxFileRecord,
  isInboxLibraryFile,
  listInboxFileRecords,
  listLinkInboxRecords,
  LinkInboxRecord,
  normalizeWebUrl,
  parseDroppedLink,
  saveInboxFileRecord,
  saveLinkInboxRecord,
  stageInboxLibraryImport,
} from '@/services/linkInbox';
import { createConversationRecord, listConversations, normalizeConversationText, saveConversation } from '@/services/conversationArchive';
import {
  captureSharedConversation,
  getSharedConversationProvider,
  type CapturedSharedConversation,
} from '@/services/sharedConversationLink';
import { openWebBrowser } from '@/services/webBrowser/webBrowser';
import { getWebBrowserOptions } from '@/services/webBrowser/webBrowserOptions';
import { getFilename } from '@/utils/path';
import { isTauriAppPlatform } from '@/services/environment';

const splitTags = (value: string) =>
  [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))];

type PendingFile = {
  name: string;
  mimeType: string;
  size: number;
  lastModified: number;
  file?: File;
  path?: string;
};

const getFileMimeType = (name: string, suppliedType = '') => {
  if (suppliedType) return suppliedType;
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'txt') return 'text/plain';
  if (extension === 'md') return 'text/markdown';
  if (['html', 'htm'].includes(extension ?? '')) return 'text/html';
  if (extension === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (extension === 'rtf') return 'application/rtf';
  return 'application/octet-stream';
};

export default function InboxPage() {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();
  const [records, setRecords] = useState<LinkInboxRecord[]>([]);
  const [files, setFiles] = useState<InboxFileRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [query, setQuery] = useState('');
  const [saveStatus, setSaveStatus] = useState(_('Loading…'));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [capturedConversation, setCapturedConversation] = useState<CapturedSharedConversation | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [appendBusy, setAppendBusy] = useState(false);
  const loaded = useRef(false);
  const pendingSaves = useRef(new Map<string, LinkInboxRecord>());
  const pendingFileSaves = useRef(new Map<string, InboxFileRecord>());
  const saveTimer = useRef<number | null>(null);
  const selectedRecord = records.find((record) => record.id === selectedId) ?? null;
  const selectedFileRecord = files.find((record) => record.id === selectedFileId) ?? null;
  const selectedConversationProvider = selectedRecord ? getSharedConversationProvider(selectedRecord.url) : null;

  useEffect(() => {
    setCapturedConversation(null);
  }, [selectedId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listLinkInboxRecords(), listInboxFileRecords()])
      .then(([items, savedFiles]) => {
        if (cancelled) return;
        setRecords(items);
        setFiles(savedFiles);
        setSelectedId(items[0]?.id ?? null);
        setSelectedFileId(items.length ? null : savedFiles[0]?.id ?? null);
        setSaveStatus(_('Saved on this device'));
        loaded.current = true;
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? _(error.message) : _('Could not load the Inbox.'));
        setSaveStatus(_('Storage error'));
        loaded.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [_]);

  const flushPending = useCallback(async () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const batch = [...pendingSaves.current.values()];
    const fileBatch = [...pendingFileSaves.current.values()];
    pendingSaves.current.clear();
    pendingFileSaves.current.clear();
    if (!batch.length && !fileBatch.length) return true;

    setSaveStatus(_('Saving…'));
    try {
      await Promise.all([
        ...batch.map((record) => saveLinkInboxRecord(record)),
        ...fileBatch.map((record) => saveInboxFileRecord(record)),
      ]);
      setSaveStatus(
        pendingSaves.current.size || pendingFileSaves.current.size ? _('Unsaved changes') : _('Saved on this device'),
      );
      return true;
    } catch (error) {
      for (const record of batch) {
        if (!pendingSaves.current.has(record.id)) pendingSaves.current.set(record.id, record);
      }
      for (const record of fileBatch) {
        if (!pendingFileSaves.current.has(record.id)) pendingFileSaves.current.set(record.id, record);
      }
      setSaveStatus(
        error instanceof Error
          ? _(error.message)
          : fileBatch.length
            ? _('Could not save this file. Try again.')
            : _('Could not save this link. Try again.'),
      );
      return false;
    }
  }, [_]);

  const queueSave = useCallback(
    (record: LinkInboxRecord) => {
      pendingSaves.current.set(record.id, record);
      setSaveStatus(_('Unsaved changes'));
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void flushPending(), 500);
    },
    [_, flushPending],
  );

  const queueFileSave = useCallback(
    (record: InboxFileRecord) => {
      pendingFileSaves.current.set(record.id, record);
      setSaveStatus(_('Unsaved changes'));
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void flushPending(), 500);
    },
    [_, flushPending],
  );

  const stageDroppedFiles = useCallback(
    (incoming: PendingFile[]) => {
      if (!incoming.length) return;
      setPendingFiles((current) => {
        const keys = new Set(current.map((item) => item.path ?? createInboxFileFingerprint(item.name, item.size, item.lastModified)));
        const additions = incoming.filter((item) => {
          const key = item.path ?? createInboxFileFingerprint(item.name, item.size, item.lastModified);
          if (keys.has(key)) return false;
          keys.add(key);
          return true;
        });
        return additions.length ? [...current, ...additions] : current;
      });
      setSaveStatus(_('Choose where to save these files.'));
    },
    [_],
  );

  useEffect(() => {
    if (!isTauriAppPlatform()) return;
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'over') {
        setDragActive(true);
      } else if (event.payload.type === 'drop') {
        setDragActive(false);
        stageDroppedFiles(
          event.payload.paths.map((path) => ({
            path,
            name: getFilename(path),
            mimeType: getFileMimeType(path),
            size: 0,
            lastModified: 0,
          })),
        );
      } else {
        setDragActive(false);
      }
    });
    return () => {
      unlisten.then((stopListening) => stopListening());
    };
  }, [stageDroppedFiles]);

  const updateSelectedFile = useCallback(
    (patch: Partial<InboxFileRecord>) => {
      if (!selectedFileRecord || !loaded.current) return;
      const base = pendingFileSaves.current.get(selectedFileRecord.id) ?? selectedFileRecord;
      const next = { ...base, ...patch, updatedAt: new Date().toISOString() };
      setFiles((current) => current.map((record) => (record.id === next.id ? next : record)));
      queueFileSave(next);
    },
    [queueFileSave, selectedFileRecord],
  );

  const savePendingFilesToInbox = async () => {
    if (!loaded.current) {
      setSaveStatus(_('The Inbox is still loading. Try again in a moment.'));
      return;
    }
    const incoming = pendingFiles;
    const saved: InboxFileRecord[] = [];
    const remaining: PendingFile[] = [];
    let duplicateCount = 0;

    for (let index = 0; index < incoming.length; index++) {
      const item = incoming[index];
      if (!item) continue;
      try {
        let blob: Blob;
        if (item.file) {
          blob = item.file;
        } else if (item.path && appService) {
          const contents = await appService.readFile(item.path, 'None', 'binary');
          if (typeof contents === 'string') throw new Error(_('Could not read this file from disk.'));
          blob = new Blob([contents], { type: item.mimeType });
        } else {
          throw new Error(_('Could not read this file from disk.'));
        }

        const record = createInboxFileRecord({
          name: item.name,
          mimeType: getFileMimeType(item.name, item.mimeType || item.file?.type),
          size: blob.size,
          lastModified: item.file?.lastModified ?? item.lastModified,
          file: blob,
        });
        const fingerprint = createInboxFileFingerprint(record.name, record.size, record.lastModified);
        if ([...files, ...saved].some((existing) => existing.fingerprint === fingerprint)) {
          duplicateCount++;
          continue;
        }
        await saveInboxFileRecord(record);
        saved.push(record);
      } catch (error) {
        remaining.push(...incoming.slice(index));
        setPendingFiles(remaining);
        setFiles((current) => [...saved, ...current]);
        const firstSaved = saved[0];
        if (firstSaved) {
          setSelectedId(null);
          setSelectedFileId(firstSaved.id);
        }
        setSaveStatus(error instanceof Error ? _(error.message) : _('Could not save this file. Check available storage and try again.'));
        return;
      }
    }

    setPendingFiles(remaining);
    setFiles((current) => [...saved, ...current]);
    const firstSaved = saved[0];
    if (firstSaved) {
      setSelectedId(null);
      setSelectedFileId(firstSaved.id);
    }
    setSaveStatus(
      duplicateCount ? _('This file is already in your Inbox.') : _('File saved in Inbox on this device'),
    );
  };

  const readPendingFile = async (item: PendingFile) => {
    if (item.file) return item.file;
    if (!item.path || !appService) throw new Error(_('Could not read this file from disk.'));
    const contents = await appService.readFile(item.path, 'None', 'binary');
    if (typeof contents === 'string') throw new Error(_('Could not read this file from disk.'));
    return new Blob([contents], { type: item.mimeType });
  };

  const importPendingFilesToLibrary = async () => {
    if (!loaded.current) {
      setSaveStatus(_('The Inbox is still loading. Try again in a moment.'));
      return;
    }
    if (!pendingFiles.length || pendingFiles.some((item) => !isInboxLibraryFile(item.name))) {
      setSaveStatus(_('Import each supported file separately, or save all files in the Inbox.'));
      return;
    }
    try {
      const stagedFiles = await Promise.all(
        pendingFiles.map(async (item) => {
          const file = await readPendingFile(item);
          return {
            name: item.name,
            mimeType: getFileMimeType(item.name, item.mimeType || item.file?.type),
            size: file.size,
            lastModified: item.file?.lastModified ?? item.lastModified,
            file,
          };
        }),
      );
      const importId = await stageInboxLibraryImport(stagedFiles);
      setPendingFiles([]);
      router.push(`/library?inboxImport=${encodeURIComponent(importId)}`);
    } catch (error) {
      setSaveStatus(error instanceof Error ? _(error.message) : _('Could not prepare these files for the Library.'));
    }
  };

  const importSavedFileToLibrary = async (record: InboxFileRecord) => {
    if (!isInboxLibraryFile(record.name)) {
      setSaveStatus(_('This file format cannot be imported into the Library.'));
      return;
    }
    try {
      const importId = await stageInboxLibraryImport(
        [{
          name: record.name,
          mimeType: record.mimeType,
          size: record.size,
          lastModified: record.lastModified,
          file: record.file,
        }],
        [record.id],
      );
      router.push(`/library?inboxImport=${encodeURIComponent(importId)}`);
    } catch (error) {
      setSaveStatus(error instanceof Error ? _(error.message) : _('Could not prepare this file for the Library.'));
    }
  };

  const openSavedFile = (record: InboxFileRecord) => {
    try {
      const url = URL.createObjectURL(record.file);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      updateSelectedFile({ read: true });
    } catch (error) {
      setSaveStatus(error instanceof Error ? _(error.message) : _('Could not open this file.'));
    }
  };

  const removeSelectedFile = async () => {
    if (!selectedFileRecord || !window.confirm(_('Remove this file from your Inbox on this device?'))) return;
    if (!(await flushPending())) return;
    pendingFileSaves.current.delete(selectedFileRecord.id);
    try {
      await deleteInboxFileRecord(selectedFileRecord.id);
      const remaining = files.filter((record) => record.id !== selectedFileRecord.id);
      setFiles(remaining);
      setSelectedFileId(remaining[0]?.id ?? null);
      setSaveStatus(_('File removed from this device'));
    } catch (error) {
      setSaveStatus(error instanceof Error ? _(error.message) : _('Could not remove this file.'));
    }
  };

  useEffect(() => {
    const handlePageHide = () => void flushPending();
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void flushPending();
      }
    };
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('keydown', handleShortcut);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('keydown', handleShortcut);
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      void flushPending();
    };
  }, [flushPending]);

  const visibleRecords = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const items = [
      ...records.map((record) => ({ kind: 'link' as const, record })),
      ...files.map((record) => ({ kind: 'file' as const, record })),
    ].sort((a, b) => b.record.updatedAt.localeCompare(a.record.updatedAt));
    if (!needle) return items;
    return items.filter(({ kind, record }) =>
      (kind === 'link'
        ? [record.title, record.url, record.originalUrl, record.notes, ...record.tags]
        : [record.title, record.name, record.notes, ...record.tags]
      )
        .join('\n')
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [files, query, records]);

  const addLink = useCallback(
    async (value: string, title?: string) => {
      const parsed = normalizeWebUrl(value);
      if (!parsed) {
        setSaveStatus(_('That is not a valid web address. Use an http:// or https:// link.'));
        return;
      }

      const canonical = parsed.href;
      const duplicate = records.find((record) => canonicalizeWebUrl(record.originalUrl) === canonical);
      if (duplicate) {
        setSelectedId(duplicate.id);
        setSelectedFileId(null);
        setNewUrl('');
        setSaveStatus(_('This link is already in your Inbox.'));
        return;
      }

      const record = createLinkInboxRecord({ url: value, title });
      try {
        await saveLinkInboxRecord(record);
        setRecords((current) => [record, ...current]);
        setSelectedId(record.id);
        setSelectedFileId(null);
        setNewUrl('');
        setLoadError(null);
        setSaveStatus(_('Link saved on this device'));
      } catch (error) {
        setSaveStatus(error instanceof Error ? _(error.message) : _('Could not save this link. Try again.'));
      }
    },
    [_, records],
  );

  const updateSelected = useCallback(
    (patch: Partial<LinkInboxRecord>) => {
      if (!selectedRecord || !loaded.current) return;
      const base = pendingSaves.current.get(selectedRecord.id) ?? selectedRecord;
      const next = { ...base, ...patch, updatedAt: new Date().toISOString() };
      if (patch.url !== undefined && patch.url !== base.url) setCapturedConversation(null);
      setRecords((current) => current.map((record) => (record.id === next.id ? next : record)));
      queueSave(next);
    },
    [queueSave, selectedRecord],
  );

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragActive(false);
    const droppedFiles = Array.from(event.dataTransfer.files).map((file) => ({
      file,
      name: file.name,
      mimeType: getFileMimeType(file.name, file.type),
      size: file.size,
      lastModified: file.lastModified,
    }));
    if (droppedFiles.length) {
      stageDroppedFiles(droppedFiles);
    }
    const dropped = parseDroppedLink({
      html: event.dataTransfer.getData('text/html'),
      uriList: event.dataTransfer.getData('text/uri-list'),
      plainText: event.dataTransfer.getData('text/plain'),
    });
    if (dropped) {
      void addLink(dropped.url, dropped.title);
    } else if (!droppedFiles.length) {
      setSaveStatus(_('No web link was found. Drop a webpage link or paste a URL.'));
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLElement>) => {
    const pastedFiles = Array.from(event.clipboardData.files).map((file) => ({
      file,
      name: file.name,
      mimeType: getFileMimeType(file.name, file.type),
      size: file.size,
      lastModified: file.lastModified,
    }));
    if (pastedFiles.length) {
      event.preventDefault();
      stageDroppedFiles(pastedFiles);
      return;
    }
    const dropped = parseDroppedLink({
      html: event.clipboardData.getData('text/html'),
      uriList: event.clipboardData.getData('text/uri-list'),
      plainText: event.clipboardData.getData('text/plain'),
    });
    if (!dropped) return;
    event.preventDefault();
    void addLink(dropped.url, dropped.title);
  };

  const openSelectedLink = async () => {
    if (!selectedRecord) return;
    const parsed = normalizeWebUrl(selectedRecord.url);
    if (!parsed) {
      setSaveStatus(_('That is not a valid web address. Use an http:// or https:// link.'));
      return;
    }
    updateSelected({ read: true });
    try {
      if (isTauriAppPlatform()) {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(parsed.href);
      } else {
        window.open(parsed.href, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      setSaveStatus(error instanceof Error ? _(error.message) : _('Could not open this link.'));
    }
  };

  const addSelectedToBook = async () => {
    if (!selectedRecord) return;
    const parsed = normalizeWebUrl(selectedRecord.url);
    if (!parsed) {
      setSaveStatus(_('That is not a valid web address. Use an http:// or https:// link.'));
      return;
    }
    try {
      if (!(await flushPending())) return;
      appendLinkToWriterDraft({ ...selectedRecord, url: parsed.href });
      router.push('/writer');
    } catch (error) {
      setSaveStatus(error instanceof Error ? _(error.message) : _('Could not update your book draft.'));
    }
  };

  const captureSelectedConversation = async () => {
    if (!selectedRecord || !selectedConversationProvider || captureBusy) return;
    if (!isTauriAppPlatform()) {
      setSaveStatus(_('Shared conversation capture requires the desktop app.'));
      return;
    }
    setCapturedConversation(null);
    setCaptureBusy(true);
    try {
      const result = await openWebBrowser(
        selectedRecord.url,
        getWebBrowserOptions(_, !!appService?.isEink),
      );
      if (!result.page) {
        setSaveStatus(_('No page was captured. Reopen the share link and choose Clip Page.'));
        return;
      }
      const captured = captureSharedConversation(result.page, selectedConversationProvider, selectedRecord.title);
      setCapturedConversation(captured);
      setSaveStatus(_('Conversation captured. Review the original text below.'));
    } catch (error) {
      setSaveStatus(error instanceof Error ? _(error.message) : _('Could not capture this shared conversation.'));
    } finally {
      setCaptureBusy(false);
    }
  };

  const addCapturedConversationToBook = async () => {
    if (!capturedConversation || appendBusy) return;
    setAppendBusy(true);
    try {
      const existing = await listConversations();
      const normalized = normalizeConversationText(capturedConversation.rawText);
      const alreadyArchived = existing.some(
        (record) => normalizeConversationText(record.rawText) === normalized,
      );
      if (!alreadyArchived) {
        const record = createConversationRecord({
          rawText: capturedConversation.rawText,
          source: capturedConversation.provider,
          title: capturedConversation.title,
        });
        record.notes = `Captured from shared link: ${capturedConversation.sourceUrl}`;
        await saveConversation(record);
      }
      const appended = appendConversationToWriterDraft({
        title: capturedConversation.title,
        source: capturedConversation.provider,
        sourceUrl: capturedConversation.sourceUrl,
        rawText: capturedConversation.rawText,
      });
      if (!appended) {
        setSaveStatus(_('This shared link is already in the current book.'));
      }
      setCapturedConversation(null);
      router.push('/writer');
    } catch (error) {
      setSaveStatus(error instanceof Error ? _(error.message) : _('Could not add this conversation to your book.'));
    } finally {
      setAppendBusy(false);
    }
  };

  const removeSelected = async () => {
    if (!selectedRecord || !window.confirm(_('Remove this link from your Inbox on this device?'))) return;
    if (!(await flushPending())) return;
    pendingSaves.current.delete(selectedRecord.id);
    try {
      await deleteLinkInboxRecord(selectedRecord.id);
      const remaining = records.filter((record) => record.id !== selectedRecord.id);
      setRecords(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setSaveStatus(_('Link removed from this device'));
    } catch (error) {
      setSaveStatus(error instanceof Error ? _(error.message) : _('Could not remove this link.'));
    }
  };

  const readableUrl = selectedRecord ? normalizeWebUrl(selectedRecord.url) : null;

  return (
    <main className='bg-base-100 text-base-content flex h-screen min-h-0 flex-col'>
      <header className='border-base-300 flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3'>
        <button type='button' className='btn btn-sm' onClick={() => router.push('/library')}>
          {_('Back to Library')}
        </button>
        <button type='button' className='btn btn-sm' onClick={() => router.push('/writer')}>
          {_('Write my book')}
        </button>
        <button type='button' className='btn btn-sm' onClick={() => router.push('/conversations')}>
          {_('Conversation archive')}
        </button>
        <div className='ms-auto flex min-w-0 items-center gap-3'>
          <span className='text-neutral-content truncate text-xs' role='status' aria-live='polite'>
            {saveStatus}
          </span>
          <button type='button' className='btn btn-sm btn-contrast' onClick={() => void flushPending()}>
            Ctrl+S
          </button>
        </div>
      </header>

      <section className='border-base-300 shrink-0 border-b px-4 py-3'>
        <h1 className='text-lg font-semibold tracking-tight'>{_('Link Inbox')}</h1>
        <p className='text-base-content/70 mt-1 text-sm leading-relaxed'>
          {_('Keep web links here to revisit, read, or add them to your book')}
        </p>
      </section>

      <div className='grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(220px,300px)_1fr]'>
        <aside className='border-base-300 flex min-h-0 flex-col border-b md:border-b-0 md:border-e'>
          <div className='flex items-center gap-2 p-3'>
            <input
              type='search'
              className='input input-sm w-full'
              placeholder={_('Search links, files, notes, and tags')}
              aria-label={_('Search links and files')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {loadError && (
            <p className='text-error px-4 pb-3 text-sm' role='alert'>
              {loadError}
            </p>
          )}
          <ul className='min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3'>
            {visibleRecords.map(({ kind, record }) => {
              const active = kind === 'link' ? selectedId === record.id : selectedFileId === record.id;
              const title = record.title;
              const subtitle = kind === 'link'
                ? normalizeWebUrl(record.url)?.hostname ?? record.url
                : _(classifyInboxFile(record.name));
              return (
                <li key={`${kind}-${record.id}`}>
                  <button
                    type='button'
                    className={`hover:bg-base-200 w-full rounded-box px-3 py-2 text-start ${active ? 'bg-base-200' : ''}`}
                    onClick={() => {
                      if (kind === 'link') {
                        setSelectedId(record.id);
                        setSelectedFileId(null);
                      } else {
                        setSelectedId(null);
                        setSelectedFileId(record.id);
                      }
                    }}
                  >
                    <span className='block truncate text-sm font-medium'>{title}</span>
                    <span className='text-neutral-content mt-1 block truncate text-xs'>
                      {record.read ? _('Read') : _('Unread')} · {subtitle}
                    </span>
                    {record.tags.length > 0 && (
                      <span className='text-neutral-content mt-1 block truncate text-xs'>
                        {record.tags.join(' · ')}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            {visibleRecords.length === 0 && (
              <li className='text-neutral-content px-3 py-5 text-sm'>
                {query ? _('No search results.') : _('No saved items yet.')}
              </li>
            )}
          </ul>
        </aside>

        <section className='min-h-0 overflow-y-auto p-4 md:p-6'>
          <div className='mx-auto flex max-w-4xl flex-col gap-5'>
            <section
              aria-label={_('Drop links or files here')}
              tabIndex={0}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                const relatedTarget = event.relatedTarget;
                if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
                  setDragActive(false);
                }
              }}
              onDrop={handleDrop}
              onPaste={handlePaste}
              className={`eink-bordered rounded-box border border-dashed p-5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-base-content/15 ${dragActive ? 'bg-base-200' : 'bg-base-100'}`}
            >
              <h2 className='text-base font-semibold'>{_('Drop links or files here')}</h2>
              <p className='text-base-content/70 mt-1 text-sm'>{_('or paste a web address below')}</p>
              <form
                className='mt-4 flex flex-wrap gap-2'
                onSubmit={(event) => {
                  event.preventDefault();
                  void addLink(newUrl);
                }}
              >
                <label htmlFor='inbox-new-url' className='sr-only'>
                  {_('Paste or type a web link')}
                </label>
                <input
                  id='inbox-new-url'
                  type='text'
                  inputMode='url'
                  className='input input-sm eink-bordered min-w-[220px] flex-1'
                  placeholder={_('Paste or type a web link')}
                  value={newUrl}
                  onChange={(event) => setNewUrl(event.target.value)}
                />
                <button type='submit' className='btn btn-sm btn-contrast' disabled={!newUrl.trim()}>
                  {_('Add link')}
                </button>
              </form>
              <p className='text-base-content/65 mt-3 text-xs'>
                {_('Links stay on this device. Nothing is fetched until you open it.')}
              </p>
              <p className='text-base-content/65 mt-1 text-xs'>
                {_('Inbox files stay on this device. Library imports follow your library sync settings.')}
              </p>
            </section>

            {selectedRecord ? (
              <article className='flex flex-col gap-4'>
                <div className='flex flex-wrap items-start gap-2'>
                  <label htmlFor='inbox-title' className='sr-only'>
                    {_('Title')}
                  </label>
                  <input
                    id='inbox-title'
                    className='input input-lg eink-bordered min-w-[220px] flex-1 font-semibold'
                    aria-label={_('Title')}
                    value={selectedRecord.title}
                    onChange={(event) => updateSelected({ title: event.target.value })}
                  />
                  <button
                    type='button'
                    className='btn btn-sm btn-contrast'
                    onClick={() => void openSelectedLink()}
                    disabled={!readableUrl}
                  >
                    {_('Open original')}
                  </button>
                  {selectedConversationProvider && (
                    <button
                      type='button'
                      className='btn btn-sm'
                      onClick={() => void captureSelectedConversation()}
                      disabled={captureBusy}
                    >
                      {captureBusy ? _('Opening shared conversation…') : _('Capture conversation transcript')}
                    </button>
                  )}
                  <button
                    type='button'
                    className='btn btn-sm'
                    onClick={() => void addSelectedToBook()}
                    disabled={!readableUrl}
                  >
                    {_('Add reference to book')}
                  </button>
                  <button type='button' className='btn btn-sm btn-ghost text-error' onClick={() => void removeSelected()}>
                    {_('Delete')}
                  </button>
                </div>

                <label className='flex flex-col gap-1 text-sm'>
                  {_('Web address')}
                  <input
                    type='text'
                    inputMode='url'
                    className='input input-sm eink-bordered w-full'
                    value={selectedRecord.url}
                    onChange={(event) => updateSelected({ url: event.target.value })}
                  />
                </label>
                <p className='text-base-content/65 break-all text-xs'>
                  {_('Original URL: {{url}}', { url: selectedRecord.originalUrl })}
                </p>
                <p className='text-base-content/65 text-xs'>
                  {_('Saved {{date}}', { date: new Date(selectedRecord.addedAt).toLocaleString() })}
                </p>

                {selectedConversationProvider && !capturedConversation && (
                  <p className='text-base-content/65 text-sm leading-relaxed'>
                    {_('Capture opens this public share page in the in-app browser. Scroll through the full conversation, choose Clip Page, then review it here before adding it.')}
                  </p>
                )}

                {capturedConversation && (
                  <section className='eink-bordered flex flex-col gap-3 rounded-lg border border-base-300 p-3' aria-label={_('Captured conversation preview')}>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <h2 className='font-semibold'>{_('Review captured conversation')}</h2>
                      <button type='button' className='btn btn-sm btn-ghost' onClick={() => setCapturedConversation(null)} disabled={appendBusy}>
                        {_('Discard preview')}
                      </button>
                    </div>
                    <p className='text-base-content/65 break-all text-xs'>{_('Source link: {{url}}', { url: capturedConversation.sourceUrl })}</p>
                    <label className='flex flex-col gap-1 text-sm'>
                      {_('Conversation title')}
                      <input
                        className='input input-sm eink-bordered w-full'
                        value={capturedConversation.title}
                        onChange={(event) => setCapturedConversation({ ...capturedConversation, title: event.target.value })}
                      />
                    </label>
                    {capturedConversation.warning && <p className='text-warning text-sm'>{_(capturedConversation.warning)}</p>}
                    <label className='flex flex-col gap-1 text-sm'>
                      {_('Captured text (review before adding)')}
                      <textarea
                        className='textarea eink-bordered min-h-72 w-full font-mono text-xs leading-5'
                        value={capturedConversation.rawText}
                        onChange={(event) => setCapturedConversation({ ...capturedConversation, rawText: event.target.value })}
                      />
                    </label>
                    <button
                      type='button'
                      className='btn btn-sm btn-primary self-start'
                      onClick={() => void addCapturedConversationToBook()}
                      disabled={appendBusy || !capturedConversation.rawText.trim()}
                    >
                      {appendBusy ? _('Saving conversation…') : _('Add transcript to current book')}
                    </button>
                  </section>
                )}

                <label className='flex flex-col gap-1 text-sm'>
                  {_('Tags, separated by commas')}
                  <input
                    className='input input-sm eink-bordered w-full'
                    value={selectedRecord.tags.join(', ')}
                    onChange={(event) => updateSelected({ tags: splitTags(event.target.value) })}
                    placeholder={_('Example: ideas, research')}
                  />
                </label>
                <label className='flex flex-col gap-1 text-sm'>
                  {_('Notes / quotes')}
                  <textarea
                    className='textarea eink-bordered min-h-28 w-full leading-6'
                    value={selectedRecord.notes}
                    onChange={(event) => updateSelected({ notes: event.target.value })}
                    placeholder={_('Write a note or keep a quote from this page')}
                  />
                </label>

                <div className='flex flex-wrap items-center gap-2'>
                  <button
                    type='button'
                    className='btn btn-sm'
                    onClick={() => updateSelected({ read: !selectedRecord.read })}
                  >
                    {selectedRecord.read ? _('Mark as unread') : _('Mark as read')}
                  </button>
                  {selectedRecord.url !== selectedRecord.originalUrl && (
                    <span className='text-neutral-content text-xs'>{_('The original URL is preserved.')}</span>
                  )}
                </div>
              </article>
            ) : selectedFileRecord ? (
              <article className='flex flex-col gap-4'>
                <div className='flex flex-wrap items-start gap-2'>
                  <label className='sr-only' htmlFor='inbox-file-title'>{_('Title')}</label>
                  <input
                    id='inbox-file-title'
                    className='input input-lg eink-bordered min-w-[220px] flex-1 font-semibold'
                    aria-label={_('Title')}
                    value={selectedFileRecord.title}
                    onChange={(event) => updateSelectedFile({ title: event.target.value })}
                  />
                  <button type='button' className='btn btn-sm btn-contrast' onClick={() => openSavedFile(selectedFileRecord)}>
                    {_('Open saved file')}
                  </button>
                  <button
                    type='button'
                    className='btn btn-sm'
                    onClick={() => void importSavedFileToLibrary(selectedFileRecord)}
                    disabled={!isInboxLibraryFile(selectedFileRecord.name)}
                  >
                    {_('Import to Library')}
                  </button>
                  <button type='button' className='btn btn-sm btn-ghost text-error' onClick={() => void removeSelectedFile()}>
                    {_('Delete')}
                  </button>
                </div>
                <p className='text-base-content/65 text-xs'>
                  {_('File type: {{type}} · {{size}} bytes', {
                    type: _(classifyInboxFile(selectedFileRecord.name)),
                    size: selectedFileRecord.size.toLocaleString(),
                  })}
                </p>
                <p className='text-base-content/65 text-xs'>
                  {_('Saved {{date}}', { date: new Date(selectedFileRecord.addedAt).toLocaleString() })}
                </p>
                <label className='flex flex-col gap-1 text-sm'>
                  {_('Tags, separated by commas')}
                  <input
                    className='input input-sm eink-bordered w-full'
                    value={selectedFileRecord.tags.join(', ')}
                    onChange={(event) => updateSelectedFile({ tags: splitTags(event.target.value) })}
                    placeholder={_('Example: ideas, research')}
                  />
                </label>
                <label className='flex flex-col gap-1 text-sm'>
                  {_('Notes / quotes')}
                  <textarea
                    className='textarea eink-bordered min-h-28 w-full leading-6'
                    value={selectedFileRecord.notes}
                    onChange={(event) => updateSelectedFile({ notes: event.target.value })}
                    placeholder={_('Write a note or keep a quote about this file')}
                  />
                </label>
                <button
                  type='button'
                  className='btn btn-sm self-start'
                  onClick={() => updateSelectedFile({ read: !selectedFileRecord.read })}
                >
                  {selectedFileRecord.read ? _('Mark as unread') : _('Mark as read')}
                </button>
              </article>
            ) : (
              <div className='text-base-content/70 rounded-box eink-bordered border p-6 text-sm'>
                {_('Add a web link above, or choose a saved link from the list.')}
              </div>
            )}
          </div>
        </section>
      </div>
      {pendingFiles.length > 0 && (
        <div className='fixed inset-0 z-50 grid place-items-center bg-black/50 p-4' role='presentation'>
          <section
            role='dialog'
            aria-modal='true'
            aria-labelledby='inbox-file-choice-title'
            className='bg-base-100 rounded-box eink-bordered flex max-h-[85vh] w-full max-w-xl flex-col gap-4 overflow-y-auto border p-5 shadow-xl'
          >
            <div>
              <h2 id='inbox-file-choice-title' className='text-lg font-semibold'>
                {_('Choose where to save these files.')}
              </h2>
              <p className='text-base-content/70 mt-1 text-sm'>
                {_('Inbox files stay on this device. Library imports follow your library sync settings.')}
              </p>
            </div>
            <ul className='space-y-2'>
              {pendingFiles.map((item, index) => (
                <li key={`${item.path ?? item.name}-${index}`} className='rounded-box border border-base-300 px-3 py-2'>
                  <span className='block break-all text-sm font-medium'>{item.name}</span>
                  <span className='text-neutral-content mt-1 block text-xs'>
                    {item.size > 0
                      ? _('File type: {{type}} · {{size}} bytes', {
                          type: _(classifyInboxFile(item.name)),
                          size: item.size.toLocaleString(),
                        })
                      : _('File type: {{type}}', { type: _(classifyInboxFile(item.name)) })}
                  </span>
                </li>
              ))}
            </ul>
            {pendingFiles.some((item) => !isInboxLibraryFile(item.name)) && (
              <p className='text-warning text-sm'>
                {_('Import each supported file separately, or save all files in the Inbox.')}
              </p>
            )}
            <div className='flex flex-wrap justify-end gap-2'>
              <button type='button' className='btn btn-sm' onClick={() => setPendingFiles([])}>
                {_('Cancel')}
              </button>
              <button
                type='button'
                className='btn btn-sm'
                onClick={() => void importPendingFilesToLibrary()}
                disabled={!loaded.current || pendingFiles.some((item) => !isInboxLibraryFile(item.name))}
              >
                {_('Import to Library')}
              </button>
              <button
                type='button'
                className='btn btn-sm btn-contrast'
                onClick={() => void savePendingFilesToInbox()}
                disabled={!loaded.current}
              >
                {_('Save in Inbox')}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
