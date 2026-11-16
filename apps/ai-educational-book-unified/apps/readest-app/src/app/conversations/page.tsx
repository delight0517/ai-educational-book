'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useRouter } from 'next/navigation';
import {
  ConversationRecord,
  ConversationRole,
  ConversationSource,
  ConversationTurn,
  createConversationRecord,
  deleteConversation,
  getConversationSourceLabel,
  getLocalDate,
  inferConversationDate,
  inferConversationSource,
  listConversations,
  normalizeConversationText,
  saveConversation,
  serializeConversationMarkdown,
} from '@/services/conversationArchive';

type ImportSource = 'auto' | ConversationSource;

const sourceChoices: { value: ImportSource; label: string }[] = [
  { value: 'auto', label: '자동 감지' },
  { value: 'chatgpt', label: 'ChatGPT' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'other', label: '직접 입력 / 기타' },
];

const roleLabel = (role: ConversationRole) =>
  role === 'user' ? '나' : role === 'assistant' ? 'AI' : '확인 필요';

const downloadMarkdown = (record: ConversationRecord) => {
  const safeTitle = record.title.trim().replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || '대화 기록';
  const url = URL.createObjectURL(
    new Blob([serializeConversationMarkdown(record)], { type: 'text/markdown;charset=utf-8' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeTitle}.md`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export default function ConversationsPage() {
  const router = useRouter();
  const [records, setRecords] = useState<ConversationRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importSource, setImportSource] = useState<ImportSource>('auto');
  const [importTitle, setImportTitle] = useState('');
  const [importDate, setImportDate] = useState('');
  const [importDateEdited, setImportDateEdited] = useState(false);
  const [rawText, setRawText] = useState('');
  const [saveStatus, setSaveStatus] = useState('불러오는 중…');
  const [loadError, setLoadError] = useState<string | null>(null);
  const loaded = useRef(false);
  const dirtyId = useRef<string | null>(null);
  const editRevision = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void listConversations()
      .then((items) => {
        if (cancelled) return;
        setRecords(items);
        setSelectedId(items[0]?.id ?? null);
        setSaveStatus('이 기기에 저장됩니다');
        loaded.current = true;
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : '대화 보관함을 열지 못했습니다.');
        setSaveStatus('저장소 오류');
        loaded.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedRecord = records.find((record) => record.id === selectedId) ?? null;

  useEffect(() => {
    if (!importOpen || importDateEdited) return;
    setImportDate(inferConversationDate(rawText) || getLocalDate());
  }, [importDateEdited, importOpen, rawText]);

  useEffect(() => {
    if (!loaded.current || !dirtyId.current) return;
    const pending = records.find((record) => record.id === dirtyId.current);
    if (!pending) return;
    const revision = editRevision.current;
    const timeout = window.setTimeout(() => {
      if (dirtyId.current !== pending.id || editRevision.current !== revision) return;
      void saveConversation(pending)
        .then(() => {
          const unchanged = dirtyId.current === pending.id && editRevision.current === revision;
          if (unchanged) {
            dirtyId.current = null;
            setSaveStatus('자동 저장됨');
          }
          setRecords((current) =>
            current.map((record) =>
              record.id === pending.id ? { ...record, updatedAt: new Date().toISOString() } : record,
            ),
          );
        })
        .catch((error: unknown) => {
          setSaveStatus(error instanceof Error ? error.message : '저장 오류');
        });
    }, 650);
    setSaveStatus('저장 중…');
    return () => window.clearTimeout(timeout);
  }, [records]);

  const visibleRecords = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return records;
    return records.filter((record) =>
      [
        record.title,
        record.summary,
        record.notes,
        record.source,
        ...record.tags,
        record.rawText,
        ...record.turns.map((turn) => turn.content),
      ]
        .join('\n')
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [query, records]);

  const updateSelected = useCallback(
    (patch: Partial<ConversationRecord>) => {
      if (!selectedId) return;
      dirtyId.current = selectedId;
        editRevision.current += 1;
      setRecords((current) =>
        current.map((record) =>
          record.id === selectedId ? { ...record, ...patch, updatedAt: new Date().toISOString() } : record,
        ),
      );
    },
    [selectedId],
  );

  const saveSelected = useCallback(async () => {
    if (!selectedRecord) return;
    const revision = editRevision.current;
    dirtyId.current = null;
    setSaveStatus('저장 중…');
    try {
      const saved = { ...selectedRecord, updatedAt: new Date().toISOString() };
      await saveConversation(saved);
      const unchanged = editRevision.current === revision;
      setRecords((current) =>
        current.map((record) =>
          record.id === saved.id
            ? unchanged
              ? saved
              : { ...record, updatedAt: new Date().toISOString() }
            : record,
        ),
      );
      setSaveStatus(unchanged ? '저장됨' : '수정한 내용을 자동 저장 중…');
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : '저장 오류');
    }
  }, [selectedRecord]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveSelected();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [saveSelected]);

  const beginImport = () => {
    setImportSource('auto');
    setImportTitle('');
    setImportDate(getLocalDate());
    setImportDateEdited(false);
    setRawText('');
    setImportOpen(true);
    setLoadError(null);
  };

  const importConversation = async () => {
    if (!rawText.trim()) return;
    const normalized = normalizeConversationText(rawText);
    const duplicate = records.find((record) => normalizeConversationText(record.rawText) === normalized);
    if (duplicate) {
      setSelectedId(duplicate.id);
      setImportOpen(false);
      setSaveStatus('같은 원문이 이미 저장되어 있어 기존 대화를 열었습니다.');
      return;
    }

    const source = importSource === 'auto' ? inferConversationSource(rawText) : importSource;
    const record = createConversationRecord({
      rawText,
      source,
      title: importTitle,
      conversationDate: importDate,
    });
    try {
      await saveConversation(record);
      setRecords((current) => [record, ...current]);
      setSelectedId(record.id);
      setImportOpen(false);
      setSaveStatus('대화를 이 기기에 저장했습니다');
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : '대화 저장에 실패했습니다.');
    }
  };

  const removeSelected = async () => {
    if (!selectedRecord || !window.confirm('이 대화를 이 기기에서 삭제할까요?')) return;
    try {
      await deleteConversation(selectedRecord.id);
      const remaining = records.filter((record) => record.id !== selectedRecord.id);
      setRecords(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setSaveStatus('대화를 삭제했습니다');
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : '대화 삭제에 실패했습니다.');
    }
  };

  const updateTurn = (turnId: string, patch: Partial<ConversationTurn>) => {
    if (!selectedRecord) return;
    updateSelected({
      turns: selectedRecord.turns.map((turn) => (turn.id === turnId ? { ...turn, ...patch } : turn)),
    });
  };

  return (
    <main className='bg-base-100 text-base-content flex h-screen min-h-0 flex-col'>
      <header className='border-base-300 flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-3'>
        <button type='button' className='btn btn-sm' onClick={() => router.push('/library')}>
          서재
        </button>
        <button type='button' className='btn btn-sm' onClick={() => router.push('/writer')}>
          내 책 쓰기
        </button>
        <h1 className='text-lg font-semibold'>대화 보관함</h1>
        <span className='text-neutral-content ms-auto text-xs' role='status' aria-live='polite'>
          {saveStatus}
        </span>
        <button type='button' className='btn btn-sm btn-primary' onClick={beginImport}>
          대화 붙여넣기
        </button>
      </header>

      <div className='grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(220px,300px)_1fr]'>
        <aside className='border-base-300 flex min-h-0 flex-col border-b md:border-b-0 md:border-e'>
          <div className='flex items-center gap-2 p-3'>
            <input
              type='search'
              className='input input-sm w-full'
              placeholder='제목, 태그, 대화 검색'
              aria-label='대화 검색'
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type='button' className='btn btn-sm' onClick={beginImport} aria-label='새 대화 추가'>
              +
            </button>
          </div>
          {loadError && (
            <p className='text-error px-4 pb-3 text-sm' role='alert'>
              {loadError}
            </p>
          )}
          <ul className='min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3'>
            {visibleRecords.map((record) => (
              <li key={record.id}>
                <button
                  type='button'
                  className={`hover:bg-base-200 w-full rounded-box px-3 py-2 text-start ${selectedId === record.id ? 'bg-base-200' : ''}`}
                  onClick={() => {
                    setSelectedId(record.id);
                    setImportOpen(false);
                  }}
                >
                  <span className='block truncate text-sm font-medium'>
                    {record.favorite ? '★ ' : ''}
                    {record.title}
                  </span>
                  <span className='text-neutral-content mt-1 block text-xs'>
                    {getConversationSourceLabel(record.source)} · {record.conversationDate}
                  </span>
                  {record.tags.length > 0 && (
                    <span className='text-neutral-content mt-1 block truncate text-xs'>
                      {record.tags.join(' · ')}
                    </span>
                  )}
                </button>
              </li>
            ))}
            {visibleRecords.length === 0 && (
              <li className='text-neutral-content px-3 py-5 text-sm'>
                {query ? '검색 결과가 없습니다.' : '아직 저장된 대화가 없습니다.'}
              </li>
            )}
          </ul>
        </aside>

        <section className='min-h-0 overflow-y-auto p-4 md:p-6'>
          {importOpen ? (
            <div className='mx-auto flex max-w-4xl flex-col gap-4'>
              <div>
                <h2 className='text-xl font-semibold'>대화 붙여넣기</h2>
                <p className='text-base-content/70 mt-1 text-sm'>
                  붙여넣은 텍스트만 이 기기에 저장합니다. 계정 대화나 원문을 자동으로 가져오거나 AI로 보내지 않습니다.
                </p>
              </div>
              <div className='grid gap-3 sm:grid-cols-3'>
                <label className='flex flex-col gap-1 text-sm'>
                  출처
                  <select
                    className='select select-sm w-full'
                    value={importSource}
                    onChange={(event) => setImportSource(event.target.value as ImportSource)}
                  >
                    {sourceChoices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className='flex flex-col gap-1 text-sm'>
                  제목
                  <input
                    className='input input-sm w-full'
                    value={importTitle}
                    onChange={(event) => setImportTitle(event.target.value)}
                    placeholder='첫 사용자 발화에서 자동 제안'
                  />
                </label>
                <label className='flex flex-col gap-1 text-sm'>
                  대화 날짜
                  <input
                    type='date'
                    className='input input-sm w-full'
                    value={importDate}
                    onChange={(event) => {
                      setImportDateEdited(true);
                      setImportDate(event.target.value);
                    }}
                  />
                </label>
              </div>
              <label className='flex min-h-0 flex-1 flex-col gap-1 text-sm'>
                대화 원문
                <textarea
                  autoFocus
                  className='textarea min-h-[38vh] w-full font-mono text-sm leading-6'
                  value={rawText}
                  onChange={(event) => setRawText(event.target.value)}
                  placeholder={'You said:\n질문을 입력합니다.\n\nChatGPT said:\n답변을 입력합니다.'}
                />
              </label>
              <p className='text-base-content/65 text-xs'>
                코드 블록과 Markdown 원문은 그대로 보관합니다. 화자 표시가 모호하면 원문을 함께 보여 드립니다.
              </p>
              <div className='flex flex-wrap justify-end gap-2'>
                <button type='button' className='btn btn-sm' onClick={() => setImportOpen(false)}>
                  취소
                </button>
                <button
                  type='button'
                  className='btn btn-primary btn-sm'
                  onClick={() => void importConversation()}
                  disabled={!rawText.trim()}
                >
                  이 기기에 저장하고 정리하기
                </button>
              </div>
            </div>
          ) : selectedRecord ? (
            <article className='mx-auto flex max-w-4xl flex-col gap-5'>
              <div className='flex flex-wrap items-start gap-2'>
                <input
                  className='input input-lg min-w-[220px] flex-1 font-semibold'
                  aria-label='대화 제목'
                  value={selectedRecord.title}
                  onChange={(event) => updateSelected({ title: event.target.value })}
                />
                <button type='button' className='btn btn-sm' onClick={() => void saveSelected()}>
                  Ctrl+S 저장
                </button>
                <button type='button' className='btn btn-sm' onClick={() => downloadMarkdown(selectedRecord)}>
                  Markdown 내보내기
                </button>
                <button type='button' className='btn btn-sm btn-ghost text-error' onClick={() => void removeSelected()}>
                  삭제
                </button>
              </div>

              <div className='grid gap-3 sm:grid-cols-3'>
                <label className='flex flex-col gap-1 text-sm'>
                  출처
                  <select
                    className='select select-sm w-full'
                    value={selectedRecord.source}
                    onChange={(event) => updateSelected({ source: event.target.value as ConversationSource })}
                  >
                    {sourceChoices
                      .filter((choice) => choice.value !== 'auto')
                      .map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {choice.label}
                        </option>
                      ))}
                  </select>
                </label>
                <label className='flex flex-col gap-1 text-sm'>
                  대화 날짜
                  <input
                    type='date'
                    className='input input-sm w-full'
                    value={selectedRecord.conversationDate}
                    onChange={(event) => updateSelected({ conversationDate: event.target.value })}
                  />
                </label>
                <label className='flex flex-col justify-end gap-2 text-sm'>
                  <span>태그 (쉼표로 구분)</span>
                  <input
                    className='input input-sm w-full'
                    value={selectedRecord.tags.join(', ')}
                    onChange={(event) =>
                      updateSelected({
                        tags: event.target.value
                          .split(',')
                          .map((tag) => tag.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder='예: 글쓰기, 학습'
                  />
                </label>
              </div>

              <div className='flex items-center justify-between gap-3'>
                <h2 className='text-lg font-semibold'>정리된 대화 · {selectedRecord.turns.length}개 발화</h2>
                <label className='flex items-center gap-2 text-sm'>
                  <input
                    type='checkbox'
                    className='checkbox checkbox-sm'
                    checked={selectedRecord.favorite}
                    onChange={(event) => updateSelected({ favorite: event.target.checked })}
                  />
                  즐겨찾기
                </label>
              </div>

              {selectedRecord.parseWarnings.length > 0 && (
                <div className='alert alert-warning' role='status'>
                  <div>
                    <strong>화자 구분을 확인해 주세요.</strong>
                    {selectedRecord.parseWarnings.map((warning) => (
                      <p key={warning} className='mt-1 text-sm'>
                        {warning}
                      </p>
                    ))}
                    <p className='mt-1 text-xs'>붙여넣은 원문은 수정하지 않고 별도로 보존했습니다.</p>
                  </div>
                </div>
              )}

              <div className='space-y-4'>
                {selectedRecord.turns.map((turn, index) => (
                  <section key={turn.id} className='border-base-300 rounded-box border p-4'>
                    <div className='mb-3 flex items-center gap-3'>
                      <label className='flex items-center gap-2 text-sm font-medium'>
                        화자
                        <select
                          className='select select-xs'
                          value={turn.role}
                          onChange={(event) =>
                            updateTurn(turn.id, { role: event.target.value as ConversationRole })
                          }
                        >
                          <option value='user'>나</option>
                          <option value='assistant'>AI</option>
                          <option value='unknown'>확인 필요</option>
                        </select>
                      </label>
                      <span className='text-neutral-content text-xs'>발화 {index + 1}</span>
                    </div>
                    <div className='prose prose-neutral dark:prose-invert max-w-none overflow-x-auto'>
                      <ReactMarkdown>{turn.content}</ReactMarkdown>
                    </div>
                    <details className='mt-4'>
                      <summary className='text-base-content/70 cursor-pointer text-xs'>발화 내용 수정</summary>
                      <textarea
                        className='textarea mt-2 min-h-28 w-full font-mono text-xs leading-5'
                        aria-label={`${roleLabel(turn.role)} 발화 ${index + 1} 수정`}
                        value={turn.content}
                        onChange={(event) => updateTurn(turn.id, { content: event.target.value })}
                      />
                    </details>
                  </section>
                ))}
              </div>

              <section className='grid gap-4 md:grid-cols-2'>
                <label className='flex flex-col gap-1 text-sm'>
                  내 요약
                  <textarea
                    className='textarea min-h-28 w-full'
                    value={selectedRecord.summary}
                    onChange={(event) => updateSelected({ summary: event.target.value })}
                    placeholder='직접 요약을 적어 둘 수 있습니다. AI로 자동 전송하지 않습니다.'
                  />
                </label>
                <label className='flex flex-col gap-1 text-sm'>
                  내 메모
                  <textarea
                    className='textarea min-h-28 w-full'
                    value={selectedRecord.notes}
                    onChange={(event) => updateSelected({ notes: event.target.value })}
                    placeholder='나중에 책에 넣고 싶은 생각을 기록합니다.'
                  />
                </label>
              </section>

              <details className='border-base-300 rounded-box border p-4'>
                <summary className='cursor-pointer text-sm font-medium'>붙여넣은 원문 보기</summary>
                <pre className='bg-base-200 mt-3 max-h-[50vh] overflow-auto whitespace-pre-wrap rounded p-3 text-xs leading-5'>
                  {selectedRecord.rawText}
                </pre>
              </details>
            </article>
          ) : (
            <div className='mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-3 text-center'>
              <h2 className='text-xl font-semibold'>대화를 책으로 쌓아 보세요</h2>
              <p className='text-base-content/70 text-sm leading-relaxed'>
                ChatGPT나 Gemini에서 복사한 대화를 붙여넣으면 화자를 정리하고, 이 기기에 보관합니다. 이후 태그·요약·메모를 편집하고 Markdown으로 내보낼 수 있습니다.
              </p>
              <button type='button' className='btn btn-primary btn-sm' onClick={beginImport}>
                첫 대화 붙여넣기
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
