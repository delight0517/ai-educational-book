export type ConversationSource = 'chatgpt' | 'gemini' | 'other';
export type ConversationRole = 'user' | 'assistant' | 'unknown';

export type ConversationTurn = {
  id: string;
  role: ConversationRole;
  sourceSpeaker: string;
  content: string;
};

export type ConversationRecord = {
  id: string;
  title: string;
  source: ConversationSource;
  conversationDate: string;
  rawText: string;
  turns: ConversationTurn[];
  tags: string[];
  summary: string;
  notes: string;
  favorite: boolean;
  parseWarnings: string[];
  createdAt: string;
  updatedAt: string;
};

type ParsedTurnHeader = {
  speaker: string;
  content: string;
};

const DB_NAME = 'ai-educational-book-conversation-archive';
const DB_VERSION = 1;
const STORE_NAME = 'conversations';
const SOURCE_NAMES: Record<ConversationSource, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  other: '직접 입력 / 기타',
};

const createId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const getConversationSourceLabel = (source: ConversationSource) => SOURCE_NAMES[source];

export const getLocalDate = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const inferConversationSource = (rawText: string): ConversationSource => {
  if (/\b(chatgpt|chat\s*gpt|openai)\b/i.test(rawText)) return 'chatgpt';
  if (/\b(gemini|google\s+ai|bard)\b/i.test(rawText)) return 'gemini';
  return 'other';
};

export const inferConversationDate = (rawText: string) => {
  const header = rawText.split(/\r\n?|\n/).slice(0, 30).join('\n');
  const labeledDate = header.match(/(?:conversation\s+date|created(?:\s+at)?|date)\s*[:：-]\s*(20\d{2}-\d{2}-\d{2})/i);
  const match = labeledDate?.[1] ?? header.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (!match) return null;
  const date = new Date(`${match}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match ? null : match;
};

const parseRoleHeader = (line: string): ParsedTurnHeader | null => {
  const speakers = 'You|User|Human|ChatGPT|Gemini|Assistant|AI|Model';
  const patterns = [
    new RegExp(`^\\s*(?:#{1,6}\\s*)?\\*\\*(${speakers}):\\*\\*\\s*(.*)$`, 'i'),
    new RegExp(`^\\s*(?:#{1,6}\\s*)?(${speakers})(?:\\s+(?:said|says))?\\s*:\\s*(.*)$`, 'i'),
    new RegExp(`^\\s*#{1,6}\\s+(${speakers})\\s*$`, 'i'),
    new RegExp(`^\\s*(${speakers})\\s+(?:said|says)\\s*:?\\s*$`, 'i'),
    new RegExp(`^\\s*(${speakers})\\s*$`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) return { speaker: match[1] ?? 'unknown', content: match[2] ?? '' };
  }
  return null;
};

const roleForSpeaker = (speaker: string): ConversationRole => {
  if (/^(you|user|human)$/i.test(speaker)) return 'user';
  if (/^(chatgpt|gemini|assistant|ai|model)$/i.test(speaker)) return 'assistant';
  return 'unknown';
};

export const parseConversationText = (rawText: string) => {
  const lines = rawText.replace(/\r\n?/g, '\n').split('\n');
  const turns: ConversationTurn[] = [];
  const preamble: string[] = [];
  let current: { speaker: string; lines: string[] } | null = null;
  let codeFence: string | null = null;

  const finishTurn = () => {
    if (!current) return;
    turns.push({
      id: createId(),
      role: roleForSpeaker(current.speaker),
      sourceSpeaker: current.speaker,
      content: current.lines.join('\n').trimEnd(),
    });
    current = null;
  };

  for (const line of lines) {
    const trimmed = line.trimStart();
    const fence = trimmed.match(/^(```+|~~~+)/)?.[1];
    if (fence) {
      if (!codeFence) codeFence = fence.slice(0, 3);
      else if (fence.startsWith(codeFence)) codeFence = null;
      (current ? current.lines : preamble).push(line);
      continue;
    }

    const header = codeFence ? null : parseRoleHeader(line);
    if (header) {
      finishTurn();
      current = { speaker: header.speaker, lines: header.content ? [header.content] : [] };
    } else {
      (current ? current.lines : preamble).push(line);
    }
  }
  finishTurn();

  if (preamble.some((line) => line.trim())) {
    turns.unshift({
      id: createId(),
      role: 'unknown',
      sourceSpeaker: '원문 앞부분',
      content: preamble.join('\n').trim(),
    });
  }

  const userTurns = turns.filter((turn) => turn.role === 'user').length;
  const assistantTurns = turns.filter((turn) => turn.role === 'assistant').length;
  const hasUnknown = turns.some((turn) => turn.role === 'unknown');
  const warnings: string[] = [];

  if (userTurns === 0 && assistantTurns === 0) {
    warnings.push('화자 표시를 찾지 못했습니다. 원문 전체를 보존했으니 발화 구분을 직접 확인해 주세요.');
  } else if (userTurns === 0 || assistantTurns === 0 || hasUnknown) {
    warnings.push('일부 발화의 화자 구분이 불확실합니다. 원문을 펼쳐 비교하고 필요한 발화를 수정해 주세요.');
  }

  if (turns.length === 0 && rawText.trim()) {
    turns.push({
      id: createId(),
      role: 'unknown',
      sourceSpeaker: '원문',
      content: rawText,
    });
  }

  return { turns, warnings };
};

const guessTitle = (turns: ConversationTurn[], rawText: string) => {
  const firstUserText = turns.find((turn) => turn.role === 'user')?.content;
  const candidate = (firstUserText || rawText).split('\n').find((line) => line.trim()) || '새 대화';
  return candidate.replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|>\s*)/, '').trim().slice(0, 72) || '새 대화';
};

export const createConversationRecord = (options: {
  rawText: string;
  source?: ConversationSource;
  title?: string;
  conversationDate?: string;
}) => {
  const parsed = parseConversationText(options.rawText);
  const now = new Date().toISOString();
  const source = options.source ?? inferConversationSource(options.rawText);
  const title = options.title?.trim() || guessTitle(parsed.turns, options.rawText);

  return {
    id: createId(),
    title,
    source,
    conversationDate: options.conversationDate || inferConversationDate(options.rawText) || getLocalDate(),
    rawText: options.rawText,
    turns: parsed.turns,
    tags: [],
    summary: '',
    notes: '',
    favorite: false,
    parseWarnings: parsed.warnings,
    createdAt: now,
    updatedAt: now,
  } satisfies ConversationRecord;
};

export const normalizeConversationText = (value: string) => value.replace(/\r\n?/g, '\n').trim();

const openDatabase = () => {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('이 환경에서는 로컬 대화 저장소를 사용할 수 없습니다.'));
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('로컬 대화 저장소를 열지 못했습니다.'));
    request.onblocked = () => reject(new Error('다른 창이 로컬 대화 저장소 업데이트를 막고 있습니다.'));
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
    transaction.onerror = () => reject(transaction.error ?? new Error('로컬 저장에 실패했습니다.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('로컬 저장이 중단되었습니다.'));
  });

export const listConversations = async () => {
  const db = await getDatabase();
  return new Promise<ConversationRecord[]>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).getAll() as IDBRequest<ConversationRecord[]>;
    request.onsuccess = () => {
      resolve(request.result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    };
    request.onerror = () => reject(request.error ?? new Error('대화 목록을 읽지 못했습니다.'));
  });
};

export const saveConversation = async (record: ConversationRecord) => {
  const db = await getDatabase();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).put({ ...record, updatedAt: new Date().toISOString() });
  await completeTransaction(transaction);
};

export const deleteConversation = async (id: string) => {
  const db = await getDatabase();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).delete(id);
  await completeTransaction(transaction);
};

export const serializeConversationMarkdown = (record: ConversationRecord) => {
  const tags = record.tags.length ? record.tags.join(', ') : '없음';
  const turns = record.turns
    .map((turn) => `## ${turn.role === 'user' ? '사용자' : turn.role === 'assistant' ? 'AI' : turn.sourceSpeaker}\n\n${turn.content}`)
    .join('\n\n');
  const metadata = [
    `- 출처: ${getConversationSourceLabel(record.source)}`,
    `- 대화 날짜: ${record.conversationDate}`,
    `- 태그: ${tags}`,
    record.summary.trim() ? `- 요약: ${record.summary.trim()}` : '',
  ].filter(Boolean);
  const notes = record.notes.trim() ? `\n\n## 내 메모\n\n${record.notes.trim()}` : '';

  return `# ${record.title.trim() || '대화 기록'}\n\n${metadata.join('\n')}\n\n## 정리된 대화\n\n${turns || record.rawText}${notes}\n\n## 붙여넣은 원문\n\n${record.rawText}`;
};
