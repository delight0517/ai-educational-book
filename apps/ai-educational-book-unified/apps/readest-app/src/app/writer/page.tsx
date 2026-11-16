'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useRouter } from 'next/navigation';
import { isTauriAppPlatform } from '@/services/environment';
import { useTranslation } from '@/hooks/useTranslation';
import {
  createBookDocument,
  loadBookWorkspace,
  saveBookWorkspace,
  selectBookDocument,
  updateBookDocument,
  type BookDocument,
  type BookWorkspace,
} from '@/services/bookDocuments';

type SaveState = 'loading' | 'saved' | 'saving' | 'savingFile' | 'error';

const toMarkdownFileName = (title: string) => {
  const safeTitle = title
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .slice(0, 80);
  return `${safeTitle || 'my-book'}.md`;
};

const serializeDocument = (document: BookDocument) =>
  `# ${document.title.trim() || '새 책'}\n\n${document.body}`;

const downloadMarkdown = (markdown: string, title: string) => {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = toMarkdownFileName(title);
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export default function WriterPage() {
  const router = useRouter();
  const _ = useTranslation();
  const [workspace, setWorkspace] = useState<BookWorkspace | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [viewMode, setViewMode] = useState<'edit' | 'read'>('edit');
  const [fileSaveFailed, setFileSaveFailed] = useState(false);
  const workspaceRef = useRef<BookWorkspace | null>(null);
  const workspaceRevision = useRef(0);
  const loaded = useRef(false);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const titleInputRef = useRef<HTMLInputElement>(null);
  const focusNewBookTitle = useRef(false);
  const pendingNewBook = useRef(false);

  const installWorkspace = useCallback((next: BookWorkspace) => {
    workspaceRef.current = next;
    workspaceRevision.current += 1;
    setWorkspace(next);
  }, []);

  const enqueueSave = useCallback((snapshot: BookWorkspace) => {
    const operation = saveQueue.current.catch(() => undefined).then(() => saveBookWorkspace(snapshot));
    saveQueue.current = operation.catch(() => undefined);
    return operation;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadBookWorkspace()
      .then((loadedWorkspace) => {
        if (cancelled) return;
        const requestedBookId = new URL(window.location.href).searchParams.get('bookId');
        const selectedWorkspace = requestedBookId
          ? selectBookDocument(loadedWorkspace, requestedBookId)
          : loadedWorkspace;
        if (requestedBookId) {
          focusNewBookTitle.current = true;
          const currentUrl = new URL(window.location.href);
          currentUrl.searchParams.delete('bookId');
          window.history.replaceState(null, '', currentUrl);
        }
        const initialWorkspace = pendingNewBook.current
          ? createBookDocument(selectedWorkspace)
          : selectedWorkspace;
        pendingNewBook.current = false;
        if (initialWorkspace !== selectedWorkspace) {
          focusNewBookTitle.current = true;
          setViewMode('edit');
        }
        workspaceRef.current = initialWorkspace;
        setWorkspace(initialWorkspace);
        loaded.current = true;
        setSaveState('saved');
      })
      .catch((error: unknown) => {
        console.error('Could not load book documents:', error);
        if (!cancelled) setSaveState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded.current || !workspace) return;
    const revision = workspaceRevision.current;
    setSaveState('saving');
    const timeout = window.setTimeout(() => {
      void enqueueSave(workspace)
        .then(() => {
          if (revision === workspaceRevision.current) setSaveState('saved');
        })
        .catch((error: unknown) => {
          console.error('Could not save the local book document:', error);
          if (revision === workspaceRevision.current) setSaveState('error');
        });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [enqueueSave, workspace]);

  useEffect(() => {
    const persistBeforePageHide = () => {
      const current = workspaceRef.current;
      if (loaded.current && current) void enqueueSave(current);
    };
    window.addEventListener('pagehide', persistBeforePageHide);
    return () => window.removeEventListener('pagehide', persistBeforePageHide);
  }, [enqueueSave]);

  const activeDocument = workspace?.documents.find((document) => document.id === workspace.activeId) ?? null;

  useEffect(() => {
    if (!activeDocument || !focusNewBookTitle.current) return;
    focusNewBookTitle.current = false;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [activeDocument?.id]);

  const updateActiveDocument = useCallback(
    (changes: Partial<Pick<BookDocument, 'title' | 'body' | 'filePath' | 'fileDirty'>>) => {
      const current = workspaceRef.current;
      if (!current) return;
      installWorkspace(updateBookDocument(current, current.activeId, changes));
      setFileSaveFailed(false);
    },
    [installWorkspace],
  );

  const flushSave = useCallback(async () => {
    const current = workspaceRef.current;
    if (!current) return false;
    let revision = workspaceRevision.current;
    setSaveState('saving');
    try {
      await enqueueSave(current);
      const document = current.documents.find((item) => item.id === current.activeId);
      if (document?.filePath && document.fileDirty && isTauriAppPlatform()) {
        setSaveState('savingFile');
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        await writeTextFile(document.filePath, serializeDocument(document));
        const latest = workspaceRef.current;
        if (latest) {
          const updated = updateBookDocument(latest, document.id, { fileDirty: false });
          installWorkspace(updated);
          revision = workspaceRevision.current;
          await enqueueSave(updated);
        }
      }
      if (revision === workspaceRevision.current) setSaveState('saved');
      setFileSaveFailed(false);
      return true;
    } catch (error) {
      console.error('Could not save the book document:', error);
      setFileSaveFailed(true);
      setSaveState('error');
      return false;
    }
  }, [enqueueSave, installWorkspace]);

  const saveMarkdownFile = async () => {
    const current = workspaceRef.current;
    const document = current?.documents.find((item) => item.id === current.activeId);
    if (!document) return;
    setSaveState('savingFile');
    setFileSaveFailed(false);
    try {
      if (current) await enqueueSave(current);
      if (isTauriAppPlatform()) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const path = await save({
          defaultPath: toMarkdownFileName(document.title),
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        });
        if (!path) {
          setSaveState('saved');
          return;
        }
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        await writeTextFile(path, serializeDocument(document));
        updateActiveDocument({ filePath: path, fileDirty: false });
        const latest = workspaceRef.current;
        if (latest) await enqueueSave(latest);
      } else {
        downloadMarkdown(serializeDocument(document), document.title);
      }
      setSaveState('saved');
    } catch (error) {
      console.error('Could not export the Markdown book:', error);
      setFileSaveFailed(true);
      setSaveState('error');
    }
  };

  const createBook = useCallback(() => {
    const current = workspaceRef.current;
    if (!current) {
      pendingNewBook.current = true;
      return;
    }
    focusNewBookTitle.current = true;
    installWorkspace(createBookDocument(current));
    setViewMode('edit');
  }, [installWorkspace]);

  const selectBook = (id: string) => {
    const current = workspaceRef.current;
    if (!current) return;
    installWorkspace(selectBookDocument(current, id));
  };

  useEffect(() => {
    window.addEventListener('ai-educational-book:new-book', createBook);
    return () => window.removeEventListener('ai-educational-book:new-book', createBook);
  }, [createBook]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void flushSave();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [flushSave]);

  const navigateAfterSave = async (path: string) => {
    if (await flushSave()) router.push(path);
  };

  const documentContent = activeDocument?.body ?? '';
  const hasFileChanges = activeDocument?.fileDirty === true;

  return (
    <main className='bg-base-100 text-base-content flex h-screen min-h-0 flex-col'>
      <header className='border-base-300 flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3'>
        <button type='button' className='btn btn-sm' onClick={() => void navigateAfterSave('/library')}>
          서재로
        </button>
        <h1 className='me-1 text-lg font-semibold'>내 책 원고</h1>
        <label className='sr-only' htmlFor='writer-book-select'>책 원고 선택</label>
        <select
          id='writer-book-select'
          className='select select-sm max-w-56'
          value={workspace?.activeId ?? ''}
          disabled={!workspace}
          onChange={(event) => selectBook(event.target.value)}
        >
          {workspace?.documents.map((document) => (
            <option key={document.id} value={document.id}>
              {document.title.trim() || '제목 없는 책'}
            </option>
          ))}
        </select>
        <button
          type='button'
          className='btn btn-sm'
          onClick={createBook}
          disabled={!workspace}
          aria-keyshortcuts='Control+N Meta+N'
        >
          새 책
        </button>
        <button type='button' className='btn btn-sm' onClick={() => void navigateAfterSave('/conversations')}>
          대화 보관함
        </button>
        <button type='button' className='btn btn-sm' onClick={() => void navigateAfterSave('/inbox')}>
          {_('Link Inbox')}
        </button>
        <button type='button' className='btn btn-sm' onClick={() => void navigateAfterSave('/notion')}>
          {_('Notion data sync')}
        </button>
        <div className='ms-auto flex items-center gap-2'>
          <span className='text-neutral-content text-xs' role='status' aria-live='polite'>
            {saveState === 'loading'
              ? '불러오는 중…'
              : saveState === 'savingFile'
                ? '파일 저장 중…'
                : saveState === 'saving'
                  ? '저장 중…'
                  : saveState === 'error'
                    ? fileSaveFailed
                      ? '원고 저장/내보내기 오류'
                      : '원고를 불러오지 못함'
                    : hasFileChanges
                      ? '이 기기에 저장됨 · 파일 변경 필요'
                      : '이 기기에 저장됨'}
          </span>
          <button type='button' className='btn btn-sm btn-primary' onClick={() => void flushSave()} disabled={!activeDocument}>
            Ctrl+S 저장
          </button>
          <button type='button' className='btn btn-sm' onClick={() => void saveMarkdownFile()} disabled={!activeDocument}>
            Markdown 내보내기
          </button>
        </div>
      </header>

      {activeDocument ? (
        <>
          <nav className='border-base-300 flex shrink-0 items-center gap-2 border-b px-4 py-2' aria-label='원고 보기 방식'>
            <button
              type='button'
              className={`btn btn-sm ${viewMode === 'edit' ? 'btn-primary' : ''}`}
              aria-pressed={viewMode === 'edit'}
              onClick={() => setViewMode('edit')}
            >
              편집
            </button>
            <button
              type='button'
              className={`btn btn-sm ${viewMode === 'read' ? 'btn-primary' : ''}`}
              aria-pressed={viewMode === 'read'}
              onClick={() => setViewMode('read')}
            >
              읽기
            </button>
            <span className='text-neutral-content text-xs'>같은 원고를 편집하고 읽습니다.</span>
          </nav>

          {viewMode === 'edit' ? (
            <section className='grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2'>
              <div className='border-base-300 flex min-h-0 flex-col border-e'>
                <label className='sr-only' htmlFor='writer-title'>책 제목</label>
                <input
                  id='writer-title'
                  ref={titleInputRef}
                  className='border-base-300 bg-base-100 border-b px-5 py-3 text-xl font-semibold outline-none'
                  value={activeDocument.title}
                  onChange={(event) =>
                    updateActiveDocument({
                      title: event.target.value,
                      fileDirty: Boolean(activeDocument.filePath),
                    })
                  }
                  placeholder='책 제목'
                  spellCheck
                />
                <label className='sr-only' htmlFor='writer-body'>책 본문</label>
                <textarea
                  id='writer-body'
                  className='bg-base-100 min-h-0 flex-1 resize-none p-5 leading-7 outline-none'
                  value={documentContent}
                  onChange={(event) =>
                    updateActiveDocument({
                      body: event.target.value,
                      fileDirty: Boolean(activeDocument.filePath),
                    })
                  }
                  placeholder={'여기에 책을 쓰세요.\n\n# 장 제목\n\n작성한 내용은 자동으로 이 기기에 저장됩니다.'}
                  spellCheck
                />
              </div>
              <article className='prose prose-neutral dark:prose-invert min-h-0 overflow-auto p-6'>
                <ReactMarkdown>
                  {`# ${activeDocument.title || '새 책'}\n\n${documentContent || '여기에 작성한 내용이 표시됩니다.'}`}
                </ReactMarkdown>
              </article>
            </section>
          ) : (
            <section className='min-h-0 flex-1 overflow-auto px-5 py-8 md:px-10'>
              <article className='prose prose-neutral dark:prose-invert mx-auto min-h-full max-w-4xl py-6'>
                <h1>{activeDocument.title || '새 책'}</h1>
                {documentContent ? (
                  <ReactMarkdown>{documentContent}</ReactMarkdown>
                ) : (
                  <p className='text-base-content/60'>아직 쓴 내용이 없습니다. 편집으로 돌아가 첫 문장을 적어 보세요.</p>
                )}
              </article>
            </section>
          )}
        </>
      ) : (
        <div className='flex min-h-0 flex-1 items-center justify-center p-8' role='status'>
          {saveState === 'error'
            ? '저장된 책 원고를 불러오지 못했습니다. 기존 초안은 보존되어 있습니다.'
            : '책 원고를 불러오는 중…'}
        </div>
      )}
    </main>
  );
}
