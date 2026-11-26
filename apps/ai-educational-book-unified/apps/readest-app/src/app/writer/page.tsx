'use client';

import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isTauriAppPlatform } from '@/services/environment';
import { useTranslation } from '@/hooks/useTranslation';
import {
  createBookDocument,
  importBookMarkdownDocument,
  loadBookWorkspace,
  saveBookWorkspace,
  selectBookDocument,
  serializeBookDocument,
  updateBookDocument,
  type BookDocument,
  type BookWorkspace,
} from '@/services/bookDocuments';
import { toggleFullScreen } from '@/utils/window';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import SettingsDialog from '@/components/settings/SettingsDialog';
import StenoPanel from '@/components/steno/StenoPanel';
import OnlyChatMiniPanel from '@/components/chat/OnlyChatMiniPanel';
import GoogleDriveSyncModal from '@/components/sync/GoogleDriveSyncModal';
import NotionFloatingToolbar, {
  type FormatType,
  type FloatingToolbarPosition,
} from '@/components/writer/NotionFloatingToolbar';
import NotionTopRibbon from '@/components/writer/NotionTopRibbon';
import HighlightMarkdown from '@/components/writer/HighlightMarkdown';
import UpdateFloatingBadge from '@/components/update/UpdateFloatingBadge';
import MinimalWindowControls from '@/components/window/MinimalWindowControls';
import AppShareModal from '@/components/share/AppShareModal';
import {
  AiSparkleIcon,
  MoonIcon,
  SunIcon,
  BookShelfIcon,
  PanelLeftIcon,
  PanelRightIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  CloudSyncIcon,
  SettingsGearIcon,
} from '@/components/icons/CustomWriterIcons';
import {
  getGoogleDriveSyncStatus,
  syncBookWorkspaceWithGoogleDrive,
  isGoogleDriveAutoSyncEnabled,
} from '@/services/sync/googleDriveBookSync';
import {
  checkPloverRunning,
  CORE_STENO_DICTIONARY,
} from '@/services/steno/ploverService';
import {
  writeEmergencyMirror,
  flushEmergencyMirror,
  detectUnsavedContentLoss,
  pushSnapshotBackup,
} from '@/services/DocumentRecoveryStore';
import { publishManuscriptTo3F } from '@/services/chat/onlyChatService';

type SaveState = 'loading' | 'saved' | 'saving' | 'savingFile' | 'error';
type BackdropTheme = 'dune' | 'slate' | 'paper' | 'white' | 'dark';
type DeskWidth = 'compact' | 'normal' | 'wide' | 'full';

const LAYOUT_STORAGE_KEY = 'aieb_writer_layout_v2';
const SCRATCHPAD_STORAGE_KEY = 'aieb_writer_scratchpad_v1';

const BACKDROP_THEMES: Record<
  BackdropTheme,
  {
    label: string;
    isDark: boolean;
    containerClass: string;
    deskClass: string;
    textClass: string;
    wingClass: string;
    headerClass: string;
  }
> = {
  // Light Modes
  paper: {
    label: '웜 리넨 페이퍼 (라이트)',
    isDark: false,
    containerClass: 'bg-[#f4efe6] text-[#2c241c]',
    deskClass: 'bg-[#fffdfa] text-[#2c241c] border-[#e2d7c7] shadow-xl',
    textClass: 'text-[#2c241c]',
    wingClass: 'bg-[#ede6d9]/95 border-[#dacfc0] text-[#2c241c]',
    headerClass: 'bg-[#faf6f0]/95 border-[#e2d7c7] text-[#2c241c]',
  },
  white: {
    label: '모던 퓨어 화이트 (라이트)',
    isDark: false,
    containerClass: 'bg-[#f8fafc] text-[#0f172a]',
    deskClass: 'bg-[#ffffff] text-[#0f172a] border-[#e2e8f0] shadow-xl',
    textClass: 'text-[#0f172a]',
    wingClass: 'bg-[#f1f5f9]/95 border-[#cbd5e1] text-[#0f172a]',
    headerClass: 'bg-[#ffffff]/95 border-[#e2e8f0] text-[#0f172a]',
  },
  // Dark Modes
  dune: {
    label: '듄 아라키스 (다크)',
    isDark: true,
    containerClass: 'bg-[#181512] text-[#f5efe6]',
    deskClass: 'bg-[#221e1a] text-[#f5efe6] border-[#383129] shadow-2xl',
    textClass: 'text-[#f5efe6]',
    wingClass: 'bg-[#1e1b17]/95 border-[#342d25] text-[#f5efe6]',
    headerClass: 'bg-[#1c1915]/95 border-[#342d25] text-[#f5efe6]',
  },
  slate: {
    label: '슬레이트 흑연 (다크)',
    isDark: true,
    containerClass: 'bg-[#0f172a] text-[#f8fafc]',
    deskClass: 'bg-[#1e293b] text-[#f8fafc] border-[#334155] shadow-2xl',
    textClass: 'text-[#f8fafc]',
    wingClass: 'bg-[#182234]/95 border-[#283548] text-[#f8fafc]',
    headerClass: 'bg-[#131c2e]/95 border-[#283548] text-[#f8fafc]',
  },
  dark: {
    label: '모던 벨벳 딥 블랙 (다크)',
    isDark: true,
    containerClass: 'bg-[#0a0a0c] text-[#f4f4f5]',
    deskClass: 'bg-[#141417] text-[#f4f4f5] border-[#27272a] shadow-2xl',
    textClass: 'text-[#f4f4f5]',
    wingClass: 'bg-[#111113]/95 border-[#27272a] text-[#f4f4f5]',
    headerClass: 'bg-[#101012]/95 border-[#27272a] text-[#f4f4f5]',
  },
};

const DESK_WIDTH_CLASSES: Record<DeskWidth, string> = {
  compact: 'max-w-[820px]',
  normal: 'max-w-[1020px]',
  wide: 'max-w-[1260px]',
  full: 'max-w-none w-full',
};

const toMarkdownFileName = (title: string) => {
  const safeTitle = title
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .slice(0, 80);
  return `${safeTitle || 'my-book'}.md`;
};

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
  const { appService } = useEnv();
  const { settings, setSettings, isSettingsDialogOpen, setSettingsDialogOpen } = useSettingsStore();
  const [settingsError, setSettingsError] = useState('');
  const ensureWriterSettings = useCallback(async () => {
    // Writer boots directly, without the library page that normally seeds this store.
    if (settings.globalViewSettings) return;
    if (!appService) throw new Error('Settings service is not ready');
    const loaded = await appService.loadSettings();
    if (!loaded.globalViewSettings) throw new Error('Global settings are unavailable');
    setSettings(loaded);
  }, [appService, settings.globalViewSettings, setSettings]);
  useEffect(() => {
    if (!appService) return;
    let mounted = true;
    void ensureWriterSettings().catch((error) => {
      console.error('Could not initialize writer settings:', error);
      if (mounted) setSettingsError('환경설정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    });
    return () => { mounted = false; };
  }, [appService, ensureWriterSettings]);
  const openWriterSettings = useCallback(async () => {
    try {
      await ensureWriterSettings();
      setSettingsError('');
      setSettingsDialogOpen(true);
    } catch (error) {
      console.error('Could not load writer settings:', error);
      setSettingsError('환경설정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }, [ensureWriterSettings, setSettingsDialogOpen]);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  const [workspace, setWorkspace] = useState<BookWorkspace | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [viewMode, setViewMode] = useState<'edit' | 'read'>('edit');
  const [fileSaveFailed, setFileSaveFailed] = useState(false);

  // Sliding side and top extension panel states (우측 분할 화면 강제 방지: 기본 단일 페이지 집필)
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [topHeaderExpanded, setTopHeaderExpanded] = useState(true);
  const [deskWidth, setDeskWidth] = useState<DeskWidth>('normal');
  const [backdropTheme, setBackdropTheme] = useState<BackdropTheme>('dune');
  const [rightPanelTab, setRightPanelTab] = useState<'preview' | 'stats' | 'steno' | 'chat'>('chat');
  const [ploverRunning, setPloverRunning] = useState<boolean | null>(null);
  const [documentSearch, setDocumentSearch] = useState('');
  const [scratchpad, setScratchpad] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Notion-style floating toolbar selection state
  const [floatingToolbarPos, setFloatingToolbarPos] = useState<FloatingToolbarPosition | null>(null);
  const [selectedSnippet, setSelectedSnippet] = useState<string>('');

  // Crash recovery notification banner state
  const [recoveryPrompt, setRecoveryPrompt] = useState<{
    documentId: string;
    title: string;
    body: string;
    timestamp: number;
    charDiff: number;
  } | null>(null);

  // Undo / Redo engine state and refs
  const [history, setHistory] = useState<Array<{ title: string; body: string; timestamp: number; label: string }>>([]);
  const historyRef = useRef<Array<{ title: string; body: string; timestamp: number; label: string }>>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const historyIndexRef = useRef<number>(-1);
  const [historyFeedback, setHistoryFeedback] = useState<string | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const isHistoryApplyingRef = useRef(false);

  // Google Drive cloud sync states
  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);
  const [driveSyncState, setDriveSyncState] = useState<{
    connected: boolean;
    accountLabel: string | null;
    isSyncing: boolean;
    lastSyncedAt: string | null;
  }>({
    connected: false,
    accountLabel: null,
    isSyncing: false,
    lastSyncedAt: null,
  });

  const checkDriveStatus = useCallback(async () => {
    try {
      const s = await getGoogleDriveSyncStatus();
      setDriveSyncState((prev) => ({
        ...prev,
        connected: s.connected,
        accountLabel: s.accountLabel,
        lastSyncedAt: s.lastSyncedAt,
      }));
    } catch {
      // Ignored
    }
  }, []);

  useEffect(() => {
    void checkDriveStatus();
    const interval = setInterval(() => {
      void checkDriveStatus();
    }, 15000);
    return () => clearInterval(interval);
  }, [checkDriveStatus]);

  // Zero-latency IME-safe text state and DOM refs (eliminates React/DOM/GPU lag while typing)
  const [liveBody, setLiveBody] = useState<string>('');
  const [liveTitle, setLiveTitle] = useState<string>('');
  const liveBodyRef = useRef<string>('');
  const liveTitleRef = useRef<string>('');
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const isBodyComposingRef = useRef(false);
  const isTitleComposingRef = useRef(false);
  const uiSyncBodyTimerRef = useRef<number | null>(null);
  const uiSyncTitleTimerRef = useRef<number | null>(null);
  const syncBodyTimerRef = useRef<number | null>(null);
  const syncTitleTimerRef = useRef<number | null>(null);
  const historyDebounceTimerRef = useRef<number | null>(null);
  const hasSelectionRef = useRef(false);
  const floatingToolbarOpenRef = useRef(false);

  const workspaceRef = useRef<BookWorkspace | null>(null);
  const workspaceRevision = useRef(0);
  const loaded = useRef(false);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const titleInputRef = useRef<HTMLInputElement>(null);
  const focusNewBookTitle = useRef(false);
  const pendingNewBook = useRef(false);

  // Restore layout preferences from localStorage
  useEffect(() => {
    try {
      const savedLayout = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (savedLayout) {
        const parsed = JSON.parse(savedLayout);
        if (typeof parsed.leftPanelOpen === 'boolean') setLeftPanelOpen(parsed.leftPanelOpen);
        // Do not force-open duplicate side preview by default
        if (typeof parsed.rightPanelOpen === 'boolean') {
          if (parsed.rightPanelTab === 'preview') {
            setRightPanelOpen(false);
          } else {
            setRightPanelOpen(parsed.rightPanelOpen);
          }
        }
        if (typeof parsed.topHeaderExpanded === 'boolean') setTopHeaderExpanded(parsed.topHeaderExpanded);
        if (parsed.deskWidth && DESK_WIDTH_CLASSES[parsed.deskWidth as DeskWidth]) {
          setDeskWidth(parsed.deskWidth as DeskWidth);
        }
        if (parsed.backdropTheme && BACKDROP_THEMES[parsed.backdropTheme as BackdropTheme]) {
          const t = parsed.backdropTheme as BackdropTheme;
          setBackdropTheme(t);
          const isDark = BACKDROP_THEMES[t].isDark;
          if (typeof document !== 'undefined') {
            document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
            document.documentElement.classList.toggle('dark', isDark);
          }
        }
        if (
          parsed.rightPanelTab === 'preview' ||
          parsed.rightPanelTab === 'stats' ||
          parsed.rightPanelTab === 'steno' ||
          parsed.rightPanelTab === 'chat'
        ) {
          setRightPanelTab(parsed.rightPanelTab);
        }
      }
      const savedScratch = localStorage.getItem(SCRATCHPAD_STORAGE_KEY);
      if (savedScratch) setScratchpad(savedScratch);
    } catch (e) {
      console.warn('Failed to parse saved writer layout:', e);
    }

    // Check Plover Steno running status
    void checkPloverRunning().then((running) => setPloverRunning(running));
  }, []);

  // Save layout preferences to localStorage
  const persistLayout = useCallback(
    (overrides?: Partial<{
      leftPanelOpen: boolean;
      rightPanelOpen: boolean;
      topHeaderExpanded: boolean;
      deskWidth: DeskWidth;
      backdropTheme: BackdropTheme;
      rightPanelTab: 'preview' | 'stats' | 'steno' | 'chat';
    }>) => {
      try {
        const payload = {
          leftPanelOpen: overrides?.leftPanelOpen ?? leftPanelOpen,
          rightPanelOpen: overrides?.rightPanelOpen ?? rightPanelOpen,
          topHeaderExpanded: overrides?.topHeaderExpanded ?? topHeaderExpanded,
          deskWidth: overrides?.deskWidth ?? deskWidth,
          backdropTheme: overrides?.backdropTheme ?? backdropTheme,
          rightPanelTab: overrides?.rightPanelTab ?? rightPanelTab,
        };
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(payload));
      } catch (e) {
        console.warn('Failed to persist writer layout:', e);
      }
    },
    [leftPanelOpen, rightPanelOpen, topHeaderExpanded, deskWidth, backdropTheme, rightPanelTab],
  );

  const toggleLeftPanel = useCallback(() => {
    setLeftPanelOpen((prev) => {
      const next = !prev;
      persistLayout({ leftPanelOpen: next });
      return next;
    });
  }, [persistLayout]);

  const toggleRightPanel = useCallback(() => {
    setRightPanelOpen((prev) => {
      const next = !prev;
      persistLayout({ rightPanelOpen: next });
      return next;
    });
  }, [persistLayout]);

  const toggleTopHeader = useCallback(() => {
    setTopHeaderExpanded((prev) => {
      const next = !prev;
      persistLayout({ topHeaderExpanded: next });
      return next;
    });
  }, [persistLayout]);

  const toggleBothWings = useCallback(() => {
    setLeftPanelOpen((prevLeft) => {
      const next = !prevLeft;
      setRightPanelOpen(next);
      persistLayout({ leftPanelOpen: next, rightPanelOpen: next });
      return next;
    });
  }, [persistLayout]);

  const changeDeskWidth = useCallback(
    (width: DeskWidth) => {
      setDeskWidth(width);
      persistLayout({ deskWidth: width });
    },
    [persistLayout],
  );

  const changeBackdropTheme = useCallback(
    (theme: BackdropTheme) => {
      setBackdropTheme(theme);
      persistLayout({ backdropTheme: theme });
      const isDark = BACKDROP_THEMES[theme]?.isDark ?? true;
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
        document.documentElement.classList.toggle('dark', isDark);
      }
    },
    [persistLayout],
  );

  const toggleColorMode = useCallback(() => {
    const currentInfo = BACKDROP_THEMES[backdropTheme];
    const willBeDark = !currentInfo.isDark;
    const nextTheme: BackdropTheme = willBeDark ? 'dune' : 'paper';
    changeBackdropTheme(nextTheme);
  }, [backdropTheme, changeBackdropTheme]);

  const handleScratchpadChange = useCallback((val: string) => {
    setScratchpad(val);
    try {
      localStorage.setItem(SCRATCHPAD_STORAGE_KEY, val);
    } catch {}
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    try {
      await toggleFullScreen(appService ?? null);
      setIsFullscreen((prev) => !prev);
    } catch (e) {
      console.error('Fullscreen toggle failed:', e);
    }
  }, [appService]);

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

        // Automatically pull latest changes from Google Drive if connected (e.g. edited at the office)
        void getGoogleDriveSyncStatus().then((status) => {
          if (status.connected && isGoogleDriveAutoSyncEnabled()) {
            setDriveSyncState((prev) => ({ ...prev, isSyncing: true }));
            void syncBookWorkspaceWithGoogleDrive(initialWorkspace)
              .then((result) => {
                if (!cancelled) {
                  installWorkspace(result.workspace);
                  setDriveSyncState((prev) => ({
                    ...prev,
                    isSyncing: false,
                    lastSyncedAt: result.syncedAt,
                  }));
                }
              })
              .catch((err) => {
                console.warn('Initial background Google Drive sync failed:', err);
                if (!cancelled) {
                  setDriveSyncState((prev) => ({ ...prev, isSyncing: false }));
                }
              });
          }
        });
      })
      .catch((error: unknown) => {
        console.error('Could not load book documents:', error);
        if (!cancelled) setSaveState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cloudSyncTimerRef = useRef<number | null>(null);
  const triggerCloudAutoSync = useCallback(
    (ws: BookWorkspace) => {
      if (!driveSyncState.connected || !isGoogleDriveAutoSyncEnabled()) return;
      if (cloudSyncTimerRef.current) window.clearTimeout(cloudSyncTimerRef.current);
      cloudSyncTimerRef.current = window.setTimeout(() => {
        setDriveSyncState((prev) => ({ ...prev, isSyncing: true }));
        void syncBookWorkspaceWithGoogleDrive(ws)
          .then((res) => {
            setDriveSyncState((prev) => ({
              ...prev,
              isSyncing: false,
              lastSyncedAt: res.syncedAt,
            }));
          })
          .catch((e) => {
            console.warn('Background auto-sync to Google Drive failed:', e);
            setDriveSyncState((prev) => ({ ...prev, isSyncing: false }));
          });
      }, 3500);
    },
    [driveSyncState.connected],
  );

  useEffect(() => {
    if (!loaded.current || !workspace) return;
    const revision = workspaceRevision.current;
    setSaveState('saving');
    const timeout = window.setTimeout(() => {
      void enqueueSave(workspace)
        .then(() => {
          if (revision === workspaceRevision.current) {
            setSaveState('saved');
            triggerCloudAutoSync(workspace);
          }
        })
        .catch((error: unknown) => {
          console.error('Could not save the local book document:', error);
          if (revision === workspaceRevision.current) setSaveState('error');
        });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [enqueueSave, workspace, triggerCloudAutoSync]);

  // 10-second periodic rolling time-machine snapshot backup (stable interval; never reset while typing)
  const isWorkspaceLoaded = Boolean(workspace);
  useEffect(() => {
    if (!loaded.current || !isWorkspaceLoaded) return;
    const interval = window.setInterval(() => {
      const cur = workspaceRef.current;
      if (!cur) return;
      const active = cur.documents.find((d) => d.id === cur.activeId);
      const curTitle = titleInputRef.current?.value ?? liveTitleRef.current;
      const curBody = bodyTextareaRef.current?.value ?? liveBodyRef.current;
      if (active && (curBody || curTitle)) {
        pushSnapshotBackup({
          documentId: active.id,
          title: curTitle,
          body: curBody,
          timestamp: Date.now(),
          reason: 'interval',
        });
      }
    }, 10000);
    return () => window.clearInterval(interval);
  }, [isWorkspaceLoaded]);

  useEffect(() => {
    const persistBeforePageHide = () => {
      const current = workspaceRef.current;
      if (loaded.current && current) {
        const active = current.documents.find((d) => d.id === current.activeId);
        if (active) {
          const directTitle = titleInputRef.current?.value ?? liveTitleRef.current;
          const directBody = bodyTextareaRef.current?.value ?? liveBodyRef.current;
          const patched =
            directTitle !== active.title || directBody !== active.body
              ? updateBookDocument(current, active.id, {
                  title: directTitle,
                  body: directBody,
                  fileDirty: Boolean(active.filePath),
                })
              : current;
          workspaceRef.current = patched;
          void enqueueSave(patched);
          writeEmergencyMirror(active.id, directTitle, directBody);
          flushEmergencyMirror(active.id);
          pushSnapshotBackup({
            documentId: active.id,
            title: directTitle,
            body: directBody,
            timestamp: Date.now(),
            reason: 'pagehide',
          });
        } else {
          void enqueueSave(current);
        }
      }
    };
    window.addEventListener('pagehide', persistBeforePageHide);
    window.addEventListener('beforeunload', persistBeforePageHide);
    return () => {
      window.removeEventListener('pagehide', persistBeforePageHide);
      window.removeEventListener('beforeunload', persistBeforePageHide);
    };
  }, [enqueueSave]);

  const activeDocument = workspace?.documents.find((document) => document.id === workspace.activeId) ?? null;

  useEffect(() => {
    if (!activeDocument || !focusNewBookTitle.current) return;
    focusNewBookTitle.current = false;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [activeDocument?.id]);

  // Synchronize DOM inputs and live text when active document changes
  useEffect(() => {
    if (uiSyncBodyTimerRef.current) window.clearTimeout(uiSyncBodyTimerRef.current);
    if (uiSyncTitleTimerRef.current) window.clearTimeout(uiSyncTitleTimerRef.current);
    if (syncBodyTimerRef.current) window.clearTimeout(syncBodyTimerRef.current);
    if (syncTitleTimerRef.current) window.clearTimeout(syncTitleTimerRef.current);
    if (activeDocument) {
      const nextBody = activeDocument.body || '';
      const nextTitle = activeDocument.title || '';
      liveBodyRef.current = nextBody;
      liveTitleRef.current = nextTitle;
      setLiveBody(nextBody);
      setLiveTitle(nextTitle);
      if (bodyTextareaRef.current && bodyTextareaRef.current.value !== nextBody) {
        bodyTextareaRef.current.value = nextBody;
      }
      if (titleInputRef.current && titleInputRef.current.value !== nextTitle) {
        titleInputRef.current.value = nextTitle;
      }
      // Initialize undo/redo history for newly opened document
      const initialSnapshot = {
        title: nextTitle,
        body: nextBody,
        timestamp: Date.now(),
        label: '원고 열기',
      };
      const initHist = [initialSnapshot];
      historyRef.current = initHist;
      setHistory(initHist);
      historyIndexRef.current = 0;
      setHistoryIndex(0);

      // Check for any unsaved crash recovery data (더 긴 비상 백업이 존재하는지 검사)
      const unsaved = detectUnsavedContentLoss(activeDocument.id, nextTitle, nextBody);
      if (unsaved && (unsaved.charDiff > 0 || (unsaved.body && !nextBody))) {
        setRecoveryPrompt({
          documentId: activeDocument.id,
          title: unsaved.title || nextTitle,
          body: unsaved.body,
          timestamp: unsaved.timestamp,
          charDiff: unsaved.charDiff,
        });
      } else {
        setRecoveryPrompt(null);
      }
    }
  }, [activeDocument?.id]);

  const showHistoryFeedback = useCallback((msg: string) => {
    setHistoryFeedback(msg);
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setHistoryFeedback(null), 3500);
  }, []);

  const recordHistorySnapshot = useCallback((title: string, body: string, label: string) => {
    if (isHistoryApplyingRef.current) return;
    setHistory((prev) => {
      const currentIndex = historyIndexRef.current;
      const base = currentIndex >= 0 ? prev.slice(0, currentIndex + 1) : [];
      const last = base[base.length - 1];
      if (last && last.title === title && last.body === body) return prev;
      const next = [...base, { title, body, timestamp: Date.now(), label }];
      if (next.length > 60) next.shift();
      const newIdx = next.length - 1;
      historyIndexRef.current = newIdx;
      historyRef.current = next;
      setHistoryIndex(newIdx);
      return next;
    });
  }, []);

  const updateActiveDocument = useCallback(
    (changes: Partial<Pick<BookDocument, 'title' | 'body' | 'filePath' | 'fileDirty'>>) => {
      const current = workspaceRef.current;
      if (!current) return;
      installWorkspace(updateBookDocument(current, current.activeId, changes));
      setFileSaveFailed(false);
    },
    [installWorkspace],
  );

  const commitBodyChange = useCallback(
    (newBody: string) => {
      const current = workspaceRef.current;
      if (!current) return;
      const doc = current.documents.find((d) => d.id === current.activeId);
      if (!doc || doc.body === newBody) return;
      updateActiveDocument({
        body: newBody,
        fileDirty: Boolean(doc.filePath),
      });
    },
    [updateActiveDocument],
  );

  const commitTitleChange = useCallback(
    (newTitle: string) => {
      const current = workspaceRef.current;
      if (!current) return;
      const doc = current.documents.find((d) => d.id === current.activeId);
      if (!doc || doc.title === newTitle) return;
      updateActiveDocument({
        title: newTitle,
        fileDirty: Boolean(doc.filePath),
      });
    },
    [updateActiveDocument],
  );

  const handleUndo = useCallback(() => {
    const currentIndex = historyIndexRef.current;
    const hist = historyRef.current;
    if (currentIndex <= 0 || hist.length === 0) {
      showHistoryFeedback('더 이상 되돌릴 이전 내역이 없습니다.');
      return;
    }
    const targetIndex = currentIndex - 1;
    const target = hist[targetIndex];
    if (!target) return;

    isHistoryApplyingRef.current = true;
    historyIndexRef.current = targetIndex;
    setHistoryIndex(targetIndex);

    liveBodyRef.current = target.body;
    liveTitleRef.current = target.title;
    setLiveBody(target.body);
    setLiveTitle(target.title);
    if (bodyTextareaRef.current) {
      bodyTextareaRef.current.value = target.body;
      bodyTextareaRef.current.focus();
    }
    if (titleInputRef.current) {
      titleInputRef.current.value = target.title;
    }
    commitBodyChange(target.body);
    commitTitleChange(target.title);

    window.setTimeout(() => {
      isHistoryApplyingRef.current = false;
    }, 80);

    showHistoryFeedback(`↶ [실행 취소] ${target.label} (Ctrl+Y: 다시 실행)`);
  }, [commitBodyChange, commitTitleChange, showHistoryFeedback]);

  const handleRedo = useCallback(() => {
    const currentIndex = historyIndexRef.current;
    const hist = historyRef.current;
    if (currentIndex >= hist.length - 1 || hist.length === 0) {
      showHistoryFeedback('더 이상 다시 실행할 내역이 없습니다.');
      return;
    }
    const targetIndex = currentIndex + 1;
    const target = hist[targetIndex];
    if (!target) return;

    isHistoryApplyingRef.current = true;
    historyIndexRef.current = targetIndex;
    setHistoryIndex(targetIndex);

    liveBodyRef.current = target.body;
    liveTitleRef.current = target.title;
    setLiveBody(target.body);
    setLiveTitle(target.title);
    if (bodyTextareaRef.current) {
      bodyTextareaRef.current.value = target.body;
      bodyTextareaRef.current.focus();
    }
    if (titleInputRef.current) {
      titleInputRef.current.value = target.title;
    }
    commitBodyChange(target.body);
    commitTitleChange(target.title);

    window.setTimeout(() => {
      isHistoryApplyingRef.current = false;
    }, 80);

    showHistoryFeedback(`↷ [다시 실행] ${target.label} (Ctrl+Z: 실행 취소)`);
  }, [commitBodyChange, commitTitleChange, showHistoryFeedback]);

  // Handle User Crash Recovery Restoration
  const handleRestoreRecoveryData = useCallback(() => {
    if (!recoveryPrompt) return;
    const { title, body, charDiff } = recoveryPrompt;
    const curTitle = titleInputRef.current?.value ?? liveTitleRef.current ?? activeDocument?.title ?? '';
    const curBody = bodyTextareaRef.current?.value ?? liveBodyRef.current;

    // Backup current state to history first so user can undo if desired
    recordHistorySnapshot(curTitle, curBody, '복구 전 현재 상태');

    // Apply recovered content
    liveBodyRef.current = body;
    liveTitleRef.current = title;
    setLiveBody(body);
    setLiveTitle(title);
    if (bodyTextareaRef.current) {
      bodyTextareaRef.current.value = body;
      bodyTextareaRef.current.focus();
    }
    if (titleInputRef.current) {
      titleInputRef.current.value = title;
    }
    commitBodyChange(body);
    commitTitleChange(title);

    // Record recovered snapshot
    recordHistorySnapshot(title, body, '비정상 종료 안전 복구');

    // Dismiss banner and clear prompt
    setRecoveryPrompt(null);
    showHistoryFeedback(`🛡️ 비정상 종료 이전 작성 글 ${Math.abs(charDiff)}자 안전 복구 완료! (Ctrl+Z로 취소 가능)`);
  }, [recoveryPrompt, activeDocument?.title, recordHistorySnapshot, commitBodyChange, commitTitleChange, showHistoryFeedback]);

  const handleDismissRecoveryPrompt = useCallback(() => {
    if (recoveryPrompt) {
      // User explicitly dismissed; clear prompt
      setRecoveryPrompt(null);
      showHistoryFeedback('복구 알림을 닫았습니다.');
    }
  }, [recoveryPrompt, showHistoryFeedback]);

  const handleApplyAiRevision = useCallback(
    (revisedBody: string, actionLabel: string, revisedTitle?: string) => {
      const curTitle = titleInputRef.current?.value ?? liveTitleRef.current ?? activeDocument?.title ?? '';
      const curBody = bodyTextareaRef.current?.value ?? liveBodyRef.current;

      // 1. Record snapshot of original user state before AI replacement
      recordHistorySnapshot(curTitle, curBody, 'AI 교정 전 원본');

      const nextTitle = revisedTitle ?? curTitle;
      const nextBody = revisedBody;

      // 2. Apply to DOM and state
      liveBodyRef.current = nextBody;
      setLiveBody(nextBody);
      if (bodyTextareaRef.current) {
        bodyTextareaRef.current.value = nextBody;
        bodyTextareaRef.current.focus();
      }
      commitBodyChange(nextBody);

      if (revisedTitle && revisedTitle !== curTitle) {
        liveTitleRef.current = nextTitle;
        setLiveTitle(nextTitle);
        if (titleInputRef.current) titleInputRef.current.value = nextTitle;
        commitTitleChange(nextTitle);
      }

      // 3. Record snapshot of AI modified state
      recordHistorySnapshot(nextTitle, nextBody, `AI: ${actionLabel}`);

      showHistoryFeedback(`🪄 AI 수정 반영 완료 (${actionLabel}) · Ctrl+Z로 언제든 되돌릴 수 있습니다.`);
    },
    [activeDocument?.title, commitBodyChange, commitTitleChange, recordHistorySnapshot, showHistoryFeedback],
  );

  const handleBodyInput = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = event.target.value;
      liveBodyRef.current = val;
      const currentDocId = workspaceRef.current?.activeId;
      const currentTitle = titleInputRef.current?.value ?? liveTitleRef.current;

      // 1. Leading + 600ms throttled mirror (prevents blocking localStorage IPC on every keystroke)
      if (currentDocId) {
        writeEmergencyMirror(currentDocId, currentTitle, val);
      }

      // 2. Debounced undo/redo history recording during continuous typing
      if (historyDebounceTimerRef.current) window.clearTimeout(historyDebounceTimerRef.current);
      historyDebounceTimerRef.current = window.setTimeout(() => {
        recordHistorySnapshot(titleInputRef.current?.value ?? liveTitleRef.current, liveBodyRef.current, '타이핑 편집');
      }, 700);

      // 3. Defer React UI state updates (metrics/sidebar) so keystrokes render with zero React tree cost
      if (uiSyncBodyTimerRef.current) window.clearTimeout(uiSyncBodyTimerRef.current);
      uiSyncBodyTimerRef.current = window.setTimeout(() => {
        uiSyncBodyTimerRef.current = null;
        startTransition(() => {
          setLiveBody(liveBodyRef.current);
        });
      }, 220);

      // 4. Debounce heavy IndexedDB workspace clone + save outside the active typing burst
      if (syncBodyTimerRef.current) window.clearTimeout(syncBodyTimerRef.current);
      syncBodyTimerRef.current = window.setTimeout(() => {
        syncBodyTimerRef.current = null;
        commitBodyChange(liveBodyRef.current);
      }, isBodyComposingRef.current ? 500 : 450);
    },
    [commitBodyChange, recordHistorySnapshot],
  );

  const handleBodyBlur = useCallback(() => {
    if (uiSyncBodyTimerRef.current) {
      window.clearTimeout(uiSyncBodyTimerRef.current);
      uiSyncBodyTimerRef.current = null;
    }
    if (syncBodyTimerRef.current) {
      window.clearTimeout(syncBodyTimerRef.current);
      syncBodyTimerRef.current = null;
    }
    const val = bodyTextareaRef.current?.value ?? liveBodyRef.current;
    liveBodyRef.current = val;
    setLiveBody(val);
    commitBodyChange(val);
    const activeId = workspaceRef.current?.activeId;
    if (activeId) {
      writeEmergencyMirror(activeId, titleInputRef.current?.value ?? liveTitleRef.current, val);
      flushEmergencyMirror(activeId);
    }
  }, [commitBodyChange]);

  const handleBodyCompositionStart = useCallback(() => {
    isBodyComposingRef.current = true;
  }, []);

  const handleBodyCompositionEnd = useCallback(
    (event: React.CompositionEvent<HTMLTextAreaElement>) => {
      isBodyComposingRef.current = false;
      const val = event.currentTarget.value;
      liveBodyRef.current = val;
      const currentDocId = workspaceRef.current?.activeId;
      const currentTitle = titleInputRef.current?.value ?? liveTitleRef.current;
      if (currentDocId) {
        writeEmergencyMirror(currentDocId, currentTitle, val);
        recordHistorySnapshot(currentTitle, val, '한글 입력');
      }
      if (uiSyncBodyTimerRef.current) window.clearTimeout(uiSyncBodyTimerRef.current);
      uiSyncBodyTimerRef.current = window.setTimeout(() => {
        uiSyncBodyTimerRef.current = null;
        startTransition(() => {
          setLiveBody(liveBodyRef.current);
        });
      }, 180);
      if (syncBodyTimerRef.current) window.clearTimeout(syncBodyTimerRef.current);
      syncBodyTimerRef.current = window.setTimeout(() => {
        syncBodyTimerRef.current = null;
        commitBodyChange(liveBodyRef.current);
      }, 450);
    },
    [commitBodyChange, recordHistorySnapshot],
  );

  // Notion-style text selection detection & floating bubble position (no-op fast path while typing)
  const handleBodySelect = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start !== end) {
      hasSelectionRef.current = true;
      setSelectedSnippet(textarea.value.slice(start, end));
    } else if (hasSelectionRef.current || floatingToolbarOpenRef.current) {
      hasSelectionRef.current = false;
      floatingToolbarOpenRef.current = false;
      setSelectedSnippet('');
      setFloatingToolbarPos(null);
    }
  }, []);

  const handleBodyMouseUp = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start !== end) {
      hasSelectionRef.current = true;
      floatingToolbarOpenRef.current = true;
      setSelectedSnippet(textarea.value.slice(start, end));
      setFloatingToolbarPos({
        top: e.clientY - 52,
        left: Math.max(10, e.clientX - 100),
      });
    } else if (hasSelectionRef.current || floatingToolbarOpenRef.current) {
      hasSelectionRef.current = false;
      floatingToolbarOpenRef.current = false;
      setSelectedSnippet('');
      setFloatingToolbarPos(null);
    }
  }, []);

  const handleBodyKeyUp = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.shiftKey) {
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      if (start !== end) {
        hasSelectionRef.current = true;
        floatingToolbarOpenRef.current = true;
        setSelectedSnippet(textarea.value.slice(start, end));
        const rect = textarea.getBoundingClientRect();
        setFloatingToolbarPos({
          top: Math.max(10, rect.top + 20),
          left: Math.max(10, rect.left + 40),
        });
        return;
      }
    }
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey && floatingToolbarOpenRef.current) {
      floatingToolbarOpenRef.current = false;
      setFloatingToolbarPos(null);
    }
  }, []);

  // Notion-style formatting engine (Bold, Italic, Underline, Strike, Highlighter colors, Headings, Lists, Quotes)
  const handleApplyFormat = useCallback(
    (format: FormatType) => {
      const textarea = bodyTextareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;
      const selected = val.slice(start, end);

      let newText = '';
      let newStart = start;
      let newEnd = end;

      if (format === 'bold') {
        if (selected.startsWith('**') && selected.endsWith('**') && selected.length >= 4) {
          newText = val.slice(0, start) + selected.slice(2, -2) + val.slice(end);
          newEnd = end - 4;
        } else {
          const content = selected || '굵은 텍스트';
          newText = val.slice(0, start) + `**${content}**` + val.slice(end);
          newStart = start + 2;
          newEnd = start + 2 + content.length;
        }
      } else if (format === 'italic') {
        if (selected.startsWith('*') && selected.endsWith('*') && !selected.startsWith('**') && selected.length >= 2) {
          newText = val.slice(0, start) + selected.slice(1, -1) + val.slice(end);
          newEnd = end - 2;
        } else {
          const content = selected || '기울임 텍스트';
          newText = val.slice(0, start) + `*${content}*` + val.slice(end);
          newStart = start + 1;
          newEnd = start + 1 + content.length;
        }
      } else if (format === 'underline') {
        if (selected.startsWith('<u>') && selected.endsWith('</u>') && selected.length >= 7) {
          newText = val.slice(0, start) + selected.slice(3, -4) + val.slice(end);
          newEnd = end - 7;
        } else {
          const content = selected || '밑줄 텍스트';
          newText = val.slice(0, start) + `<u>${content}</u>` + val.slice(end);
          newStart = start + 3;
          newEnd = start + 3 + content.length;
        }
      } else if (format === 'strike') {
        if (selected.startsWith('~~') && selected.endsWith('~~') && selected.length >= 4) {
          newText = val.slice(0, start) + selected.slice(2, -2) + val.slice(end);
          newEnd = end - 4;
        } else {
          const content = selected || '취소선 텍스트';
          newText = val.slice(0, start) + `~~${content}~~` + val.slice(end);
          newStart = start + 2;
          newEnd = start + 2 + content.length;
        }
      } else if (format.startsWith('highlight-')) {
        const color = format.replace('highlight-', '');
        const cleanContent = selected.replace(/^==(?:[a-z]+:)?(.*?)==$/i, '$1') || '형광펜 강조';
        const tag = color === 'yellow' ? `==${cleanContent}==` : `==${color}:${cleanContent}==`;
        newText = val.slice(0, start) + tag + val.slice(end);
        newStart = start;
        newEnd = start + tag.length;
      } else if (format === 'code') {
        if (selected.startsWith('`') && selected.endsWith('`') && selected.length >= 2) {
          newText = val.slice(0, start) + selected.slice(1, -1) + val.slice(end);
          newEnd = end - 2;
        } else {
          const content = selected || '코드';
          newText = val.slice(0, start) + `\`${content}\`` + val.slice(end);
          newStart = start + 1;
          newEnd = start + 1 + content.length;
        }
      } else if (
        format === 'h1' ||
        format === 'h2' ||
        format === 'h3' ||
        format === 'quote' ||
        format === 'bullet' ||
        format === 'number'
      ) {
        const lineStart = val.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = val.indexOf('\n', end);
        const actualLineEnd = lineEnd === -1 ? val.length : lineEnd;
        const fullLine = val.slice(lineStart, actualLineEnd);

        let marker = '# ';
        if (format === 'h2') marker = '## ';
        else if (format === 'h3') marker = '### ';
        else if (format === 'quote') marker = '> ';
        else if (format === 'bullet') marker = '- ';
        else if (format === 'number') marker = '1. ';

        const cleanLine = fullLine.replace(/^(\#{1,6}\s+|>\s+|-\s+|\d+\.\s+)/, '');
        const modifiedLine = marker + cleanLine;
        newText = val.slice(0, lineStart) + modifiedLine + val.slice(actualLineEnd);
        newStart = lineStart + marker.length;
        newEnd = lineStart + modifiedLine.length;
      }

      const curTitle = titleInputRef.current?.value ?? liveTitleRef.current ?? activeDocument?.title ?? '';
      recordHistorySnapshot(curTitle, newText, `노션 서식 적용 (${format})`);

      textarea.value = newText;
      liveBodyRef.current = newText;
      setLiveBody(newText);
      commitBodyChange(newText);

      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(newStart, newEnd);
      }, 10);

      setFloatingToolbarPos(null);
    },
    [activeDocument?.title, commitBodyChange, liveTitle, recordHistorySnapshot],
  );

  const handleAiFeedbackFromSelection = useCallback(
    (textToReview?: string) => {
      const snippet = textToReview || selectedSnippet;
      setRightPanelTab('chat');
      setRightPanelOpen(true);
      persistLayout({ rightPanelOpen: true, rightPanelTab: 'chat' });
      setFloatingToolbarPos(null);
      if (snippet) {
        showHistoryFeedback(`💬 선택된 ${snippet.length}글자 문장을 Only Chat에 연결했습니다.`);
      }
    },
    [persistLayout, selectedSnippet, showHistoryFeedback],
  );

  const handleTitleInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const val = event.target.value;
      liveTitleRef.current = val;
      const currentDocId = workspaceRef.current?.activeId;
      const currentBody = bodyTextareaRef.current?.value ?? liveBodyRef.current;

      // 1. Leading + 600ms throttled crash mirror
      if (currentDocId) {
        writeEmergencyMirror(currentDocId, val, currentBody);
      }

      // 2. Debounced undo/redo history recording for title changes
      if (historyDebounceTimerRef.current) window.clearTimeout(historyDebounceTimerRef.current);
      historyDebounceTimerRef.current = window.setTimeout(() => {
        recordHistorySnapshot(titleInputRef.current?.value ?? liveTitleRef.current, bodyTextareaRef.current?.value ?? liveBodyRef.current, '제목 수정');
      }, 700);

      // 3. Defer React UI state & workspace save outside the active typing burst
      if (uiSyncTitleTimerRef.current) window.clearTimeout(uiSyncTitleTimerRef.current);
      uiSyncTitleTimerRef.current = window.setTimeout(() => {
        uiSyncTitleTimerRef.current = null;
        startTransition(() => {
          setLiveTitle(liveTitleRef.current);
        });
      }, 220);

      if (syncTitleTimerRef.current) window.clearTimeout(syncTitleTimerRef.current);
      syncTitleTimerRef.current = window.setTimeout(() => {
        syncTitleTimerRef.current = null;
        commitTitleChange(liveTitleRef.current);
      }, isTitleComposingRef.current ? 500 : 450);
    },
    [commitTitleChange, recordHistorySnapshot],
  );

  const handleTitleBlur = useCallback(() => {
    if (uiSyncTitleTimerRef.current) {
      window.clearTimeout(uiSyncTitleTimerRef.current);
      uiSyncTitleTimerRef.current = null;
    }
    if (syncTitleTimerRef.current) {
      window.clearTimeout(syncTitleTimerRef.current);
      syncTitleTimerRef.current = null;
    }
    const val = titleInputRef.current?.value ?? liveTitleRef.current;
    liveTitleRef.current = val;
    setLiveTitle(val);
    commitTitleChange(val);
    const activeId = workspaceRef.current?.activeId;
    if (activeId) {
      writeEmergencyMirror(activeId, val, bodyTextareaRef.current?.value ?? liveBodyRef.current);
      flushEmergencyMirror(activeId);
    }
  }, [commitTitleChange]);

  const handleTitleCompositionStart = useCallback(() => {
    isTitleComposingRef.current = true;
  }, []);

  const handleTitleCompositionEnd = useCallback(
    (event: React.CompositionEvent<HTMLInputElement>) => {
      isTitleComposingRef.current = false;
      const val = event.currentTarget.value;
      liveTitleRef.current = val;
      const currentDocId = workspaceRef.current?.activeId;
      const currentBody = bodyTextareaRef.current?.value ?? liveBodyRef.current;
      if (currentDocId) {
        writeEmergencyMirror(currentDocId, val, currentBody);
      }
      if (uiSyncTitleTimerRef.current) window.clearTimeout(uiSyncTitleTimerRef.current);
      uiSyncTitleTimerRef.current = window.setTimeout(() => {
        uiSyncTitleTimerRef.current = null;
        startTransition(() => {
          setLiveTitle(liveTitleRef.current);
        });
      }, 180);
      if (syncTitleTimerRef.current) window.clearTimeout(syncTitleTimerRef.current);
      syncTitleTimerRef.current = window.setTimeout(() => {
        syncTitleTimerRef.current = null;
        commitTitleChange(liveTitleRef.current);
      }, 450);
    },
    [commitTitleChange],
  );

  const flushSave = useCallback(async () => {
    const current = workspaceRef.current;
    if (!current) return false;

    if (uiSyncBodyTimerRef.current) {
      window.clearTimeout(uiSyncBodyTimerRef.current);
      uiSyncBodyTimerRef.current = null;
    }
    if (uiSyncTitleTimerRef.current) {
      window.clearTimeout(uiSyncTitleTimerRef.current);
      uiSyncTitleTimerRef.current = null;
    }
    if (syncBodyTimerRef.current) {
      window.clearTimeout(syncBodyTimerRef.current);
      syncBodyTimerRef.current = null;
    }
    if (syncTitleTimerRef.current) {
      window.clearTimeout(syncTitleTimerRef.current);
      syncTitleTimerRef.current = null;
    }

    // Immediately flush any debounced inputs from real DOM values before saving
    const directBody = bodyTextareaRef.current?.value;
    const directTitle = titleInputRef.current?.value;
    if (directBody !== undefined && directBody !== liveBodyRef.current) {
      liveBodyRef.current = directBody;
      setLiveBody(directBody);
    }
    if (directTitle !== undefined && directTitle !== liveTitleRef.current) {
      liveTitleRef.current = directTitle;
      setLiveTitle(directTitle);
    }
    const activeDoc = current.documents.find((item) => item.id === current.activeId);
    if (activeDoc) {
      const flushTitle = directTitle ?? liveTitleRef.current ?? activeDoc.title;
      const flushBody = directBody ?? liveBodyRef.current ?? activeDoc.body;
      writeEmergencyMirror(activeDoc.id, flushTitle, flushBody);
      flushEmergencyMirror(activeDoc.id);
    }
    let workingWorkspace = current;
    if (activeDoc && (directBody !== undefined || directTitle !== undefined)) {
      const nextBody = directBody ?? activeDoc.body;
      const nextTitle = directTitle ?? activeDoc.title;
      if (nextBody !== activeDoc.body || nextTitle !== activeDoc.title) {
        workingWorkspace = updateBookDocument(current, current.activeId, {
          body: nextBody,
          title: nextTitle,
          fileDirty: Boolean(activeDoc.filePath),
        });
        installWorkspace(workingWorkspace);
      }
    }

    let revision = workspaceRevision.current;
    setSaveState('saving');
    try {
      await enqueueSave(workingWorkspace);
      const document = workingWorkspace.documents.find((item) => item.id === workingWorkspace.activeId);
      if (document?.filePath && document.fileDirty && isTauriAppPlatform()) {
        setSaveState('savingFile');
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        await writeTextFile(document.filePath, serializeBookDocument(document));
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

  const importMarkdownFile = async (
    fileName: string,
    filePath: string | null,
    readText: () => Promise<string>,
  ) => {
    if (!(await flushSave())) return;
    setSaveState('savingFile');
    setFileSaveFailed(false);
    try {
      const markdown = await readText();
      const current = workspaceRef.current;
      if (!current) throw new Error('책 작업 공간이 준비되지 않았습니다.');
      const next = importBookMarkdownDocument(current, filePath, fileName, markdown);
      const document = next.documents.find((item) => item.id === next.activeId);
      if (!document) throw new Error('가져온 책 원고를 찾을 수 없습니다.');

      installWorkspace(next);
      liveTitleRef.current = document.title;
      liveBodyRef.current = document.body;
      setLiveTitle(document.title);
      setLiveBody(document.body);
      const openedHistory = [{ title: document.title, body: document.body, timestamp: Date.now(), label: '파일 열기' }];
      historyRef.current = openedHistory;
      setHistory(openedHistory);
      historyIndexRef.current = 0;
      setHistoryIndex(0);
      await enqueueSave(next);
      setSaveState('saved');
      setFileSaveFailed(false);
      showHistoryFeedback('Markdown 파일을 열었습니다.');
    } catch (error) {
      console.error('Could not import the Markdown book:', error);
      setFileSaveFailed(false);
      setSaveState('error');
    }
  };

  const openMarkdownFile = async () => {
    if (isTauriAppPlatform()) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const path = await open({
          multiple: false,
          filters: [{ name: 'Markdown or text', extensions: ['md', 'markdown', 'txt'] }],
        });
        if (!path) return;
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        await importMarkdownFile(path, path, () => readTextFile(path));
      } catch (error) {
        console.error('Could not open the Markdown book:', error);
        setFileSaveFailed(false);
        setSaveState('error');
      }
      return;
    }

    const input = window.document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt,text/markdown,text/plain';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void importMarkdownFile(file.name, null, () => file.text());
    }, { once: true });
    input.click();
  };

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
        await writeTextFile(path, serializeBookDocument(document));
        updateActiveDocument({ filePath: path, fileDirty: false });
        const latest = workspaceRef.current;
        if (latest) await enqueueSave(latest);
      } else {
        downloadMarkdown(serializeBookDocument(document), document.title);
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
      // Ctrl/Cmd + [ : Toggle Left Panel
      if ((event.ctrlKey || event.metaKey) && event.key === '[') {
        event.preventDefault();
        toggleLeftPanel();
        return;
      }
      // Ctrl/Cmd + ] : Toggle Right Panel
      if ((event.ctrlKey || event.metaKey) && event.key === ']') {
        event.preventDefault();
        toggleRightPanel();
        return;
      }
      // Ctrl/Cmd + \ : Toggle Both Wings (Zen Mode)
      if ((event.ctrlKey || event.metaKey) && event.key === '\\') {
        event.preventDefault();
        toggleBothWings();
        return;
      }
      // Ctrl/Cmd + N : New book
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        createBook();
        return;
      }
      // Ctrl/Cmd + S : Save
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void flushSave();
        return;
      }
      // Ctrl/Cmd + Z : Undo History (Works with AI revisions & writing)
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        if (historyIndexRef.current > 0) {
          event.preventDefault();
          handleUndo();
          return;
        }
      }
      // Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z : Redo History
      if (
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') ||
        ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'z')
      ) {
        if (historyIndexRef.current < historyRef.current.length - 1) {
          event.preventDefault();
          handleRedo();
          return;
        }
      }
      // Ctrl/Cmd + Shift + L : Toggle Dark / Light Mode
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        toggleColorMode();
        return;
      }
      // Ctrl/Cmd + B : Toggle Bold
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        handleApplyFormat('bold');
        return;
      }
      // Ctrl/Cmd + I : Toggle Italic
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        handleApplyFormat('italic');
        return;
      }
      // Ctrl/Cmd + U : Toggle Underline
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'u') {
        event.preventDefault();
        handleApplyFormat('underline');
        return;
      }
      // Ctrl/Cmd + H : Toggle Highlighter (Yellow)
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'h') {
        event.preventDefault();
        handleApplyFormat('highlight-yellow');
        return;
      }
      // Ctrl/Cmd + , : Open Settings Dialog (환경설정 열기)
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        void openWriterSettings();
        return;
      }
      // F11: Fullscreen toggle
      if (event.key === 'F11') {
        event.preventDefault();
        void handleToggleFullscreen();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [
    createBook,
    flushSave,
    toggleLeftPanel,
    toggleRightPanel,
    toggleBothWings,
    handleToggleFullscreen,
    handleUndo,
    handleRedo,
    toggleColorMode,
    handleApplyFormat,
    openWriterSettings,
  ]);

  const navigateAfterSave = async (path: string) => {
    if (await flushSave()) router.push(path);
  };

  const deferredContent = useDeferredValue(liveBody);
  const documentTitle = liveTitle || activeDocument?.title || '새 책';
  const hasFileChanges = activeDocument?.fileDirty === true;

  // Text metrics (deferred so typing bursts never pay full-document regex/split cost on keystroke frame)
  const charCountWithSpaces = deferredContent.length;
  const charCountNoSpaces = useMemo(() => deferredContent.replace(/\s+/g, '').length, [deferredContent]);
  const wordCount = useMemo(() => {
    const trimmed = deferredContent.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }, [deferredContent]);
  const estimatedReadingMinutes = useMemo(() => Math.max(1, Math.ceil(charCountNoSpaces / 500)), [charCountNoSpaces]);

  // Current word steno hint computed from trailing 64 chars only (O(1) vs O(docLength))
  const currentWordSteno = useMemo(() => {
    if (!deferredContent) return null;
    const tail = deferredContent.slice(-64).trimEnd();
    const words = tail ? tail.split(/\s+/) : [];
    const lastWord = words[words.length - 1]?.replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (!lastWord) return null;
    return (
      CORE_STENO_DICTIONARY.find(
        (item) => item.translation.toLowerCase() === lastWord,
      ) ?? null
    );
  }, [deferredContent]);

  // Filtered documents for the left sliding drawer
  const filteredDocuments = useMemo(() => {
    if (!workspace?.documents) return [];
    if (!documentSearch.trim()) return workspace.documents;
    const query = documentSearch.toLowerCase();
    return workspace.documents.filter(
      (doc) => doc.title.toLowerCase().includes(query) || doc.body.toLowerCase().includes(query),
    );
  }, [workspace?.documents, documentSearch]);

  const activeTheme = BACKDROP_THEMES[backdropTheme];
  const isCurrentDark = activeTheme.isDark;

  const handleWindowDrag = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !isTauriAppPlatform()) return;
    if (event.target instanceof Element && event.target.closest('button,input,textarea,select,a,[role="button"]')) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startDragging().catch((error: unknown) => {
      console.warn('Could not move the writing window:', error);
    });
  };

  return (
    <main
      data-theme={activeTheme.isDark ? 'dark' : 'light'}
      className={`relative flex h-screen min-h-0 w-screen flex-col overflow-hidden transition-colors duration-300 ${activeTheme.containerClass}`}
    >
      {isTauriAppPlatform() && (
        <div
          data-testid='writer-window-drag-region'
          className={`flex h-8 shrink-0 select-none items-center justify-between border-b px-3 ${activeTheme.headerClass}`}
          onMouseDown={(event) => void handleWindowDrag(event)}
        >
          <span className='text-xs opacity-70'>AI Educational Book</span>
          <MinimalWindowControls onFullscreenToggle={() => void handleToggleFullscreen()} isFullscreen={isFullscreen} />
        </div>
      )}
      {/* ===================== TOP EXTENSION / SLIDING HEADER ===================== */}
      <header
        className={`z-30 shrink-0 border-b transition-colors duration-150 ${
          activeTheme.headerClass
        } ${topHeaderExpanded ? 'py-2.5 px-4 shadow-sm' : 'py-1 px-3 shadow-sm'}`}
      >
        {topHeaderExpanded ? (
          <div className='flex flex-col gap-2'>
            {/* Main Navigation & Actions Row */}
            <div className='flex flex-wrap items-center gap-2'>
              <button
                type='button'
                className='btn btn-sm btn-ghost gap-1'
                onClick={() => void navigateAfterSave('/library')}
                title='서재로 이동'
              >
                ← 서재로
              </button>
              <h1 className='me-1 text-base font-bold tracking-tight md:text-lg'>내 책 원고</h1>

              <label className='sr-only' htmlFor='writer-book-select'>
                책 원고 선택
              </label>
              <select
                id='writer-book-select'
                className='select select-sm max-w-52 border-base-300 font-medium'
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
                className='btn btn-sm btn-outline'
                onClick={createBook}
                disabled={!workspace}
                title='새 노트 작성 (Ctrl+N)'
                aria-keyshortcuts='Control+N Meta+N'
              >
                + 새 노트 (Ctrl+N)
              </button>

              <div className='hidden items-center gap-1 sm:flex'>
                <button
                  type='button'
                  className='btn btn-sm btn-ghost'
                  onClick={() => void navigateAfterSave('/conversations')}
                >
                  대화 보관함
                </button>
                <button
                  type='button'
                  className='btn btn-sm btn-ghost'
                  onClick={() => void navigateAfterSave('/inbox')}
                >
                  {_('Link Inbox')}
                </button>
                <button
                  type='button'
                  className='btn btn-sm btn-ghost'
                  onClick={() => void navigateAfterSave('/notion')}
                >
                  {_('Notion data sync')}
                </button>
                <button
                  type='button'
                  className={`btn btn-sm gap-1.5 ${
                    driveSyncState.connected
                      ? 'btn-ghost text-[#d4884e] font-semibold'
                      : 'btn-outline border-base-300'
                  }`}
                  onClick={() => setIsDriveModalOpen(true)}
                  title='Google Drive 클라우드 동기화 (회사 ↔ 집 연동)'
                >
                  <CloudSyncIcon size={15} color={driveSyncState.connected ? '#8cf0d0' : 'currentColor'} />
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      driveSyncState.connected
                        ? driveSyncState.isSyncing
                          ? 'bg-[#d4884e] animate-spin'
                          : 'bg-[#8cf0d0]'
                        : 'bg-zinc-400'
                    }`}
                  />
                  <span>구글 드라이브 동기화</span>
                </button>
                <button
                  type='button'
                  onClick={toggleColorMode}
                  className='btn btn-sm btn-ghost gap-1.5 font-medium'
                  title={`클릭하여 ${isCurrentDark ? '라이트 모드' : '다크 모드'}로 전환 (단축키: Ctrl+Shift+L)`}
                >
                  {isCurrentDark ? (
                    <MoonIcon size={15} color='#38bdf8' />
                  ) : (
                    <SunIcon size={15} color='#f59e0b' />
                  )}
                  <span className='hidden md:inline'>
                    {isCurrentDark ? '다크 모드' : '라이트 모드'}
                  </span>
                </button>
                <button
                  type='button'
                  onClick={() => void openWriterSettings()}
                  className='btn btn-sm btn-ghost gap-1.5'
                  title='환경설정 열기 (폰트, 테마, 레이아웃) · 단축키: Ctrl+,'
                >
                  <SettingsGearIcon size={15} />
                  <span className='hidden md:inline font-semibold'>설정</span>
                  <kbd className='kbd kbd-xs opacity-60 hidden lg:inline'>Ctrl+,</kbd>
                </button>
              </div>

              <div className='ms-auto flex items-center gap-2'>
                <span className='text-xs opacity-70' role='status' aria-live='polite'>
                  {saveState === 'loading'
                    ? '불러오는 중…'
                    : saveState === 'savingFile'
                      ? '파일 저장 중…'
                      : saveState === 'saving'
                        ? '저장 중…'
                        : saveState === 'error'
                          ? fileSaveFailed
                            ? '저장 오류'
                            : '불러오기 실패'
                          : hasFileChanges
                            ? '저장됨 · 파일 수정됨'
                            : driveSyncState.isSyncing
                              ? '클라우드 동기화 중…'
                              : driveSyncState.connected
                                ? '이 기기 & 클라우드 연동됨'
                                : '이 기기에 저장됨'}
                </span>
                <button
                  type='button'
                  className='btn btn-sm btn-ghost'
                  onClick={() => void openMarkdownFile()}
                  disabled={saveState === 'loading'}
                  title='Markdown 또는 텍스트 원고 열기'
                >
                  파일 열기
                </button>
                <button
                  type='button'
                  className='btn btn-sm btn-primary'
                  onClick={() => void flushSave()}
                  disabled={!activeDocument}
                  title='변경사항 저장 (Ctrl+S)'
                >
                  Ctrl+S 저장
                </button>
                <button
                  type='button'
                  className='btn btn-sm btn-ghost hidden md:inline-flex'
                  onClick={() => void saveMarkdownFile()}
                  disabled={!activeDocument}
                >
                  내보내기
                </button>
                <button
                  type='button'
                  className='btn btn-sm btn-ghost gap-1 font-semibold text-primary hover:bg-primary/10'
                  onClick={toggleTopHeader}
                  title='상단 도구 모음 접기/숨기기'
                >
                  <ChevronUpIcon size={16} />
                  <span className='text-xs'>도구 접기</span>
                </button>
              </div>
            </div>

            {/* Quick Workbench & Sliding Panel Controls Row */}
            <div className='flex flex-wrap items-center justify-between gap-2 border-t border-base-300/40 pt-2 text-xs'>
              {/* Left / Right Panel Sliders */}
              <div className='flex items-center gap-1.5'>
                <button
                  type='button'
                  onClick={toggleLeftPanel}
                  className={`btn btn-xs ${leftPanelOpen ? 'btn-neutral' : 'btn-outline'} gap-1.5 font-semibold`}
                  title='좌측 원고 목록 미닫이 패널 토글 (Ctrl+[)'
                >
                  <PanelLeftIcon size={14} />
                  <span>{leftPanelOpen ? '원고 목록 닫기' : '원고 목록'}</span>
                </button>
                <button
                  type='button'
                  onClick={toggleRightPanel}
                  className={`btn btn-xs ${rightPanelOpen ? 'btn-neutral' : 'btn-outline'} gap-1.5 font-semibold`}
                  title='우측 미리보기/도구 미닫이 패널 토글 (Ctrl+])'
                >
                  <PanelRightIcon size={14} />
                  <span>{rightPanelOpen ? '도구 패널 닫기' : '도구 패널'}</span>
                </button>
                <button
                  type='button'
                  onClick={toggleBothWings}
                  className='btn btn-xs btn-ghost gap-1'
                  title='양쪽 패널 동시 토글 / 초집중 모드 (Ctrl+\)'
                >
                  ⚡ 집중 모드
                </button>
                <button
                  type='button'
                  onClick={() => {
                    setRightPanelTab('steno');
                    setRightPanelOpen(true);
                    persistLayout({ rightPanelOpen: true, rightPanelTab: 'steno' });
                  }}
                  className={`btn btn-xs ${
                    rightPanelOpen && rightPanelTab === 'steno'
                      ? 'bg-[#2a241e] text-[#d4884e] border-[#d4884e] font-semibold'
                      : 'btn-outline border-base-300'
                  } gap-1`}
                  title='Plover 속기(Stenography) 패널 열기'
                >
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      ploverRunning ? 'bg-[#8cf0d0]' : 'bg-zinc-400'
                    }`}
                  />
                  ⌨️ 속기
                </button>
                <button
                  type='button'
                  onClick={() => {
                    setRightPanelTab('chat');
                    setRightPanelOpen(true);
                    persistLayout({ rightPanelOpen: true, rightPanelTab: 'chat' });
                  }}
                  className={`btn btn-xs ${
                    rightPanelOpen && rightPanelTab === 'chat'
                      ? 'bg-[#0284c7] text-white border-[#38bdf8] font-semibold shadow-sm'
                      : 'btn-outline border-sky-400/40 text-sky-400 hover:bg-sky-500/10'
                  } gap-1.5 cursor-pointer`}
                  title='실시간 AI 피드백 및 어시스턴트 열기'
                >
                  <AiSparkleIcon size={13} color={rightPanelOpen && rightPanelTab === 'chat' ? '#ffffff' : '#38bdf8'} />
                  <span>AI 도구함</span>
                </button>
              </div>

              {/* Desk Width & Backdrop Customization Controls */}
              <div className='flex items-center gap-2'>
                <div className='flex items-center gap-1'>
                  <span className='opacity-60'>집필 폭:</span>
                  {(['compact', 'normal', 'wide', 'full'] as DeskWidth[]).map((width) => (
                    <button
                      key={width}
                      type='button'
                      onClick={() => changeDeskWidth(width)}
                      className={`btn btn-xs ${
                        deskWidth === width ? 'btn-primary font-bold' : 'btn-ghost opacity-80'
                      }`}
                    >
                      {width === 'compact'
                        ? '보통'
                        : width === 'normal'
                          ? '표준'
                          : width === 'wide'
                            ? '넓게'
                            : '전체 채우기'}
                    </button>
                  ))}
                </div>

                <div className='hidden items-center gap-1 sm:flex'>
                  <span className='opacity-60'>테마:</span>
                  <button
                    type='button'
                    onClick={toggleColorMode}
                    className={`btn btn-xs gap-1 font-bold ${
                      isCurrentDark ? 'btn-neutral text-yellow-300' : 'btn-outline text-amber-700'
                    }`}
                    title='다크/라이트 모드 빠른 전환 (Ctrl+Shift+L)'
                  >
                    <span>{isCurrentDark ? '🌙' : '☀️'}</span>
                    <span>{isCurrentDark ? '다크' : '라이트'}</span>
                  </button>
                  {([
                    { key: 'paper', label: '☀️ 리넨', dark: false },
                    { key: 'white', label: '☀️ 화이트', dark: false },
                    { key: 'dune', label: '🌙 듄', dark: true },
                    { key: 'slate', label: '🌙 슬레이트', dark: true },
                    { key: 'dark', label: '🌙 블랙', dark: true },
                  ] as const).map(({ key, label }) => (
                    <button
                      key={key}
                      type='button'
                      onClick={() => changeBackdropTheme(key)}
                      className={`btn btn-xs ${
                        backdropTheme === key ? 'btn-accent font-bold' : 'btn-ghost opacity-80'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <button
                  type='button'
                  onClick={() => void handleToggleFullscreen()}
                  className={`btn btn-xs ${isFullscreen ? 'btn-info' : 'btn-outline'} gap-1`}
                  title='전체화면 배경 가림 토글 (F11)'
                >
                  🖥️ {isFullscreen ? '화면 복귀' : '배경 가림 전체화면'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Compact Minimal Header when collapsed */
          <div className='flex items-center justify-between gap-2 text-xs'>
            <div className='flex items-center gap-2'>
              <button
                type='button'
                className='btn btn-xs btn-ghost'
                onClick={() => void navigateAfterSave('/library')}
              >
                ← 서재
              </button>
              <span className='font-bold'>{documentTitle}</span>
              <span className='opacity-60'>({wordCount.toLocaleString()}단어 · {charCountNoSpaces.toLocaleString()}자)</span>
            </div>

            <div className='flex items-center gap-1.5'>
              <button
                type='button'
                onClick={toggleLeftPanel}
                className={`btn btn-xs ${leftPanelOpen ? 'btn-neutral' : 'btn-outline'} gap-1`}
                title='좌측 원고 목록 미닫이 패널 토글 (Ctrl+[)'
              >
                <PanelLeftIcon size={13} />
                <span>{leftPanelOpen ? '목록 닫기' : '목록'}</span>
              </button>
              <button
                type='button'
                onClick={toggleRightPanel}
                className={`btn btn-xs ${rightPanelOpen ? 'btn-neutral' : 'btn-outline'} gap-1`}
                title='우측 미리보기 미닫이 패널 토글 (Ctrl+])'
              >
                <PanelRightIcon size={13} />
                <span>{rightPanelOpen ? '도구 닫기' : '도구'}</span>
              </button>
              <button
                type='button'
                onClick={() => {
                  setRightPanelTab('steno');
                  setRightPanelOpen(true);
                  persistLayout({ rightPanelOpen: true, rightPanelTab: 'steno' });
                }}
                className='btn btn-xs btn-ghost gap-1'
                title='Plover 속기 패널 열기'
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    ploverRunning ? 'bg-emerald-400' : 'bg-zinc-400'
                  }`}
                />
                속기
              </button>
              <button
                type='button'
                className='btn btn-xs btn-outline border-[#8cf0d0]/60 text-[#8cf0d0] hover:bg-[#8cf0d0]/10 gap-1'
                onClick={() => setIsShareModalOpen(true)}
                title='이 앱 공유하기'
              >
                🎁 공유
              </button>
              <button
                type='button'
                onClick={() => void handleToggleFullscreen()}
                className='btn btn-xs btn-ghost'
                title='배경 가림 전체화면 (F11)'
              >
                🖥️ 전체화면
              </button>
              <button
                type='button'
                onClick={toggleColorMode}
                className='btn btn-xs btn-ghost p-1'
                title={`다크/라이트 모드 전환 (${isCurrentDark ? '현재 다크 모드' : '현재 라이트 모드'}, 단축키: Ctrl+Shift+L)`}
              >
                {isCurrentDark ? <MoonIcon size={14} color='#38bdf8' /> : <SunIcon size={14} color='#f59e0b' />}
              </button>
              <button
                type='button'
                className={`btn btn-xs gap-1.5 ${
                  rightPanelOpen && rightPanelTab === 'chat'
                    ? 'bg-[#0284c7] text-white border border-[#38bdf8] font-semibold'
                    : 'btn-ghost text-sky-400 hover:bg-sky-500/10'
                }`}
                onClick={() => {
                  setRightPanelTab('chat');
                  setRightPanelOpen(true);
                  persistLayout({ rightPanelOpen: true, rightPanelTab: 'chat' });
                }}
                title='AI 실시간 피드백 및 어시스턴트'
              >
                <AiSparkleIcon size={13} color={rightPanelOpen && rightPanelTab === 'chat' ? '#ffffff' : '#38bdf8'} />
                <span>AI</span>
              </button>
              <button
                type='button'
                className='btn btn-xs btn-outline btn-warning gap-1 font-semibold'
                onClick={() => {
                  setRightPanelTab('chat');
                  setRightPanelOpen(true);
                  persistLayout({ rightPanelOpen: true, rightPanelTab: 'chat' });
                  const title = titleInputRef.current?.value ?? (liveTitleRef.current || documentTitle || '무제');
                  const body = liveBodyRef.current || deferredContent || '';
                  void publishManuscriptTo3F('brunch', title, body);
                }}
                title='브런치스토리 3F 발행 가이드 및 원고 자동 입력'
              >
                ☕ 브런치
              </button>
              <button
                type='button'
                className='btn btn-xs btn-outline btn-success gap-1 font-semibold'
                onClick={() => {
                  setRightPanelTab('chat');
                  setRightPanelOpen(true);
                  persistLayout({ rightPanelOpen: true, rightPanelTab: 'chat' });
                  const title = titleInputRef.current?.value ?? (liveTitleRef.current || documentTitle || '무제');
                  const body = liveBodyRef.current || deferredContent || '';
                  void publishManuscriptTo3F('naver', title, body);
                }}
                title='네이버 블로그 3F 발행 가이드 및 브라우저 열기'
              >
                🟢 네이버
              </button>
              <button
                type='button'
                className={`btn btn-xs gap-1 ${
                  driveSyncState.connected ? 'btn-ghost text-emerald-500 font-bold' : 'btn-ghost'
                }`}
                onClick={() => setIsDriveModalOpen(true)}
                title='Google Drive 클라우드 동기화'
              >
                ☁️
              </button>
              <button
                type='button'
                className='btn btn-xs btn-primary'
                onClick={() => void flushSave()}
                title='저장 (Ctrl+S)'
              >
                Ctrl+S
              </button>
              <button
                type='button'
                className='btn btn-xs btn-circle btn-primary shadow-sm hover:scale-105 transition-transform'
                onClick={toggleTopHeader}
                title='상단 도구 모음 펼치기'
              >
                <ChevronDownIcon size={14} color='#ffffff' />
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ===================== WORKSPACE WITH SLIDING SIDE PANELS ===================== */}
      <div className='relative flex min-h-0 flex-1 flex-row overflow-hidden'>
        {/* ----------------- LEFT SLIDING PANEL (원고 서재 및 목차 드로어) ----------------- */}
        <aside
          className={`relative z-20 flex shrink-0 flex-col overflow-hidden border-e transition-all duration-300 ease-in-out ${
            activeTheme.wingClass
          } ${leftPanelOpen ? 'w-80 md:w-88 shadow-2xl' : 'w-0 border-transparent shadow-none'}`}
        >
          {leftPanelOpen && (
            <div className='flex h-full w-80 md:w-88 flex-col min-h-0 p-4'>
              {/* Panel Header */}
              <div className='flex items-center justify-between border-b border-black/15 pb-3'>
                <div className='flex items-center gap-2'>
                  <span className='text-lg'>📖</span>
                  <h2 className='text-sm font-bold uppercase tracking-wider'>책 원고 서재</h2>
                  <span className='badge badge-sm badge-neutral font-mono'>
                    {workspace?.documents.length ?? 0}
                  </span>
                </div>
                <div className='flex items-center gap-1'>
                  <button
                    type='button'
                    className='btn btn-xs btn-primary'
                    onClick={createBook}
                    title='새 책 생성'
                  >
                    + 새 책
                  </button>
                  <button
                    type='button'
                    className='btn btn-xs btn-ghost'
                    onClick={toggleLeftPanel}
                    title='좌측 미닫이 패널 닫기 (Ctrl+[)'
                  >
                    ◀
                  </button>
                </div>
              </div>

              {/* Search documents */}
              <div className='py-2.5'>
                <input
                  type='text'
                  className='input input-xs w-full bg-base-100/60 border-base-300 placeholder:opacity-50'
                  placeholder='원고 제목 또는 본문 검색…'
                  value={documentSearch}
                  onChange={(e) => setDocumentSearch(e.target.value)}
                />
              </div>

              {/* Manuscript List */}
              <div className='flex-1 min-h-0 space-y-1.5 overflow-y-auto pe-1'>
                {filteredDocuments.map((doc) => {
                  const isSelected = doc.id === workspace?.activeId;
                  const previewSnippet = doc.body.trim().slice(0, 50).replace(/\n/g, ' ');
                  return (
                    <button
                      key={doc.id}
                      type='button'
                      onClick={() => selectBook(doc.id)}
                      className={`w-full text-start rounded-xl p-3 transition-all ${
                        isSelected
                          ? 'bg-primary text-primary-content shadow-md font-semibold'
                          : 'bg-base-100/40 hover:bg-base-100/80 border border-base-300/40 text-inherit'
                      }`}
                    >
                      <div className='flex items-center justify-between gap-1'>
                        <span className='truncate font-medium text-sm'>
                          {doc.title.trim() || '제목 없는 책'}
                        </span>
                        {isSelected && <span className='badge badge-xs badge-accent'>집필 중</span>}
                      </div>
                      <p className='mt-1 line-clamp-2 text-xs opacity-75'>
                        {previewSnippet || '작성된 내용이 없습니다.'}
                      </p>
                      <div className='mt-2 flex items-center justify-between text-[11px] opacity-60'>
                        <span>{doc.body.length.toLocaleString()} 글자</span>
                        <span>{doc.filePath ? '📄 로컬 파일' : '💾 인앱 저장'}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Quick Navigation Footer */}
              <div className='mt-auto border-t border-black/15 pt-3'>
                <div className='grid grid-cols-2 gap-1.5 text-xs'>
                  <button
                    type='button'
                    className='btn btn-xs btn-ghost justify-start truncate'
                    onClick={() => void navigateAfterSave('/conversations')}
                  >
                    💬 대화 보관함
                  </button>
                  <button
                    type='button'
                    className='btn btn-xs btn-ghost justify-start truncate'
                    onClick={() => void navigateAfterSave('/inbox')}
                  >
                    📥 Link Inbox
                  </button>
                  <button
                    type='button'
                    className='btn btn-xs btn-ghost justify-start truncate'
                    onClick={() => void navigateAfterSave('/notion')}
                  >
                    🔄 Notion sync
                  </button>
                  <button
                    type='button'
                    className='btn btn-xs btn-ghost justify-start truncate'
                    onClick={() => void navigateAfterSave('/library')}
                  >
                    📚 책 서재로
                  </button>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* LEFT FLOATING HANDLE (Visible when Left Panel is closed) - Clean Icon & Moon Aesthetic */}
        {!leftPanelOpen && (
          <button
            type='button'
            onClick={toggleLeftPanel}
            className='absolute left-0 top-1/2 z-30 -translate-y-1/2 rounded-r-2xl border-y border-r border-sky-400/30 bg-[#081826]/95 hover:bg-[#0c2338] px-2.5 py-4 text-sky-300 shadow-xl transition-colors hover:px-3.5 hover:text-white cursor-pointer group'
            title='원고 서재 열기 (Ctrl+[)'
          >
            <div className='flex flex-col items-center gap-2'>
              <BookShelfIcon size={18} color='#38bdf8' className='group-hover:scale-110 transition-transform' />
              <PanelLeftIcon size={14} color='#94a3b8' />
            </div>
          </button>
        )}

        {/* ----------------- CENTER WRITING DESK (코너링 원천 방지 중앙 집필대) ----------------- */}
        <section className='relative z-10 flex min-h-0 flex-1 flex-col items-center justify-start overflow-y-auto p-3 md:p-6'>
          {activeDocument ? (
            <div
              className={`flex min-h-full w-full flex-col rounded-2xl border transition-colors duration-150 ${activeTheme.deskClass} ${DESK_WIDTH_CLASSES[deskWidth]}`}
              style={{ contain: 'layout style' }}
            >
              {/* Desk Top Tab & Controls */}
              {recoveryPrompt && (
                <div className='flex items-center justify-between gap-3 bg-amber-500/15 border-b border-amber-500/30 px-5 py-2.5 text-xs text-amber-900 dark:text-amber-200 animate-fade-in'>
                  <div className='flex items-center gap-2'>
                    <span className='text-base'>🛡️</span>
                    <div>
                      <strong className='font-bold'>비정상 종료 자동 복구 감지:</strong>{' '}
                      <span>
                        이전 세션에서 저장되지 않고 종료된 {Math.abs(recoveryPrompt.charDiff)}글자의 원고가 발견되었습니다.
                      </span>
                    </div>
                  </div>
                  <div className='flex items-center gap-2'>
                    <button
                      type='button'
                      onClick={handleRestoreRecoveryData}
                      className='btn btn-xs btn-warning font-bold gap-1'
                      title='비정상 종료 전 작성된 원고로 복구합니다'
                    >
                      <span>🔄 즉시 복구</span>
                    </button>
                    <button
                      type='button'
                      onClick={handleDismissRecoveryPrompt}
                      className='btn btn-xs btn-ghost'
                      title='현재 원고 유지'
                    >
                      무시
                    </button>
                  </div>
                </div>
              )}

              <div className='flex shrink-0 flex-wrap items-center justify-between border-b border-black/10 px-5 py-3'>
                <div className='flex items-center gap-2'>
                  <div className='join border border-base-300'>
                    <button
                      type='button'
                      className={`join-item btn btn-xs ${viewMode === 'edit' ? 'btn-primary font-bold' : 'btn-ghost'}`}
                      aria-pressed={viewMode === 'edit'}
                      onClick={() => setViewMode('edit')}
                    >
                      ✏️ 집필
                    </button>
                    <button
                      type='button'
                      className={`join-item btn btn-xs ${viewMode === 'read' ? 'btn-primary font-bold' : 'btn-ghost'}`}
                      aria-pressed={viewMode === 'read'}
                      onClick={() => setViewMode('read')}
                    >
                      📖 읽기
                    </button>
                  </div>
                  <span className='hidden text-xs opacity-60 sm:inline'>
                    {viewMode === 'edit'
                      ? rightPanelOpen
                        ? '우측 패널에서 실시간 미리보기가 동작 중입니다.'
                        : '중앙 집중 집필 모드입니다.'
                      : '작성된 원고의 책 레이아웃을 확인합니다.'}
                  </span>
                </div>

                {/* Undo / Redo Toolbar Controls */}
                <div className='flex items-center gap-1.5'>
                  <button
                    type='button'
                    onClick={handleUndo}
                    disabled={historyIndex <= 0}
                    className='btn btn-xs btn-ghost gap-1 disabled:opacity-25'
                    title='실행 취소 (Ctrl+Z)'
                  >
                    <span>↶</span>
                    <span className='hidden md:inline'>실행 취소</span>
                    <kbd className='kbd kbd-xs opacity-70'>Ctrl+Z</kbd>
                  </button>
                  <button
                    type='button'
                    onClick={handleRedo}
                    disabled={historyIndex >= history.length - 1}
                    className='btn btn-xs btn-ghost gap-1 disabled:opacity-25'
                    title='다시 실행 (Ctrl+Y / Ctrl+Shift+Z)'
                  >
                    <span>↷</span>
                    <span className='hidden md:inline'>다시 실행</span>
                    <kbd className='kbd kbd-xs opacity-70'>Ctrl+Y</kbd>
                  </button>
                  {historyFeedback && (
                    <span className='text-[10px] text-primary font-medium px-2 py-0.5 rounded bg-primary/10 border border-primary/20 animate-fade-in truncate max-w-[220px]'>
                      {historyFeedback}
                    </span>
                  )}
                </div>

                <div className='flex items-center gap-2 text-xs opacity-75'>
                  <span>
                    <strong>{wordCount.toLocaleString()}</strong> 단어
                  </span>
                  <span>·</span>
                  <span>
                    <strong>{charCountNoSpaces.toLocaleString()}</strong> 글자
                  </span>
                  <span>·</span>
                  <span>완독 약 {estimatedReadingMinutes}분</span>
                </div>
              </div>

              {/* Desk Main Body */}
              {viewMode === 'edit' ? (
                <div className='flex min-h-[500px] flex-1 flex-col'>
                  {/* Notion Top Quick Format Ribbon */}
                  <NotionTopRibbon
                    onApplyFormat={handleApplyFormat}
                    onAiFeedback={() => handleAiFeedbackFromSelection()}
                    hasSelection={!!selectedSnippet}
                  />

                  <div className='flex flex-1 flex-col p-5 md:p-8 relative' style={{ contain: 'layout style' }}>
                    <label className='sr-only' htmlFor='writer-title'>
                      책 제목
                    </label>
                    <input
                      id='writer-title'
                      ref={titleInputRef}
                      className='mb-4 w-full border-b border-black/10 bg-transparent pb-3 text-2xl md:text-3xl font-bold tracking-tight outline-none placeholder:opacity-40 font-sans'
                      defaultValue={activeDocument.title}
                      onChange={handleTitleInput}
                      onBlur={handleTitleBlur}
                      onCompositionStart={handleTitleCompositionStart}
                      onCompositionEnd={handleTitleCompositionEnd}
                      placeholder='책 제목을 입력하세요'
                      spellCheck={false}
                      autoComplete='off'
                      autoCorrect='off'
                      autoCapitalize='off'
                      style={{
                        imeMode: 'active',
                        caretColor: 'currentColor',
                      }}
                    />

                    <label className='sr-only' htmlFor='writer-body'>
                      책 본문
                    </label>
                    <textarea
                      id='writer-body'
                      ref={bodyTextareaRef}
                      className='min-h-[420px] flex-1 resize-none bg-transparent text-base md:text-lg leading-relaxed outline-none placeholder:opacity-30 font-sans'
                      defaultValue={activeDocument.body}
                      onChange={handleBodyInput}
                      onBlur={handleBodyBlur}
                      onSelect={handleBodySelect}
                      onMouseUp={handleBodyMouseUp}
                      onKeyUp={handleBodyKeyUp}
                      onCompositionStart={handleBodyCompositionStart}
                      onCompositionEnd={handleBodyCompositionEnd}
                      onPaste={(event) => {
                        const items = Array.from(event.clipboardData?.items ?? []);
                        const imageFiles = items
                          .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
                          .map((item) => item.getAsFile())
                          .filter((file): file is File => Boolean(file));
                        const fallbackFiles = Array.from(event.clipboardData?.files ?? []).filter((file) =>
                          file.type.startsWith('image/')
                        );
                        const files = imageFiles.length > 0 ? imageFiles : fallbackFiles;
                        if (files.length === 0) return;
                        event.preventDefault();
                        const textarea = bodyTextareaRef.current;
                        if (!textarea) return;
                        void Promise.all(
                          files.map(
                            (file) =>
                              new Promise<string>((resolve) => {
                                const reader = new FileReader();
                                reader.onload = () => {
                                  const result = typeof reader.result === 'string' ? reader.result : '';
                                  resolve(result ? `![${file.name || 'image'}](${result})` : '');
                                };
                                reader.onerror = () => resolve('');
                                reader.readAsDataURL(file);
                              })
                          )
                        ).then((snippets) => {
                          const valid = snippets.filter(Boolean);
                          if (valid.length === 0) return;
                          const insertText = `\n${valid.join('\n')}\n`;
                          const start = textarea.selectionStart ?? textarea.value.length;
                          const end = textarea.selectionEnd ?? textarea.value.length;
                          textarea.setRangeText(insertText, start, end, 'end');
                          textarea.dispatchEvent(new Event('input', { bubbles: true }));
                        });
                      }}
                      onDragOver={(event) => {
                        if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
                          event.preventDefault();
                        }
                      }}
                      onDrop={(event) => {
                        const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
                          file.type.startsWith('image/')
                        );
                        if (files.length === 0) return;
                        event.preventDefault();
                        const textarea = bodyTextareaRef.current;
                        if (!textarea) return;
                        void Promise.all(
                          files.map(
                            (file) =>
                              new Promise<string>((resolve) => {
                                const reader = new FileReader();
                                reader.onload = () => {
                                  const result = typeof reader.result === 'string' ? reader.result : '';
                                  resolve(result ? `![${file.name || 'image'}](${result})` : '');
                                };
                                reader.onerror = () => resolve('');
                                reader.readAsDataURL(file);
                              })
                          )
                        ).then((snippets) => {
                          const valid = snippets.filter(Boolean);
                          if (valid.length === 0) return;
                          const insertText = `\n${valid.join('\n')}\n`;
                          const start = textarea.selectionStart ?? textarea.value.length;
                          const end = textarea.selectionEnd ?? textarea.value.length;
                          textarea.setRangeText(insertText, start, end, 'end');
                          textarea.dispatchEvent(new Event('input', { bubbles: true }));
                        });
                      }}
                      placeholder={
                        '여기에 자유롭게 글을 작성하세요. 노션처럼 텍스트를 드래그하면 볼드체(B), 형광펜(🖍️), 밑줄(U), 제목(H1/H2), 인용구 등을 바로 적용할 수 있습니다.'
                      }
                      spellCheck={false}
                      autoComplete='off'
                      autoCorrect='off'
                      autoCapitalize='off'
                      style={{
                        imeMode: 'active',
                        caretColor: 'currentColor',
                      }}
                    />

                    {/* Notion Floating Bubble Toolbar (Appears on text selection/drag) */}
                    <NotionFloatingToolbar
                      position={floatingToolbarPos}
                      selectedText={selectedSnippet}
                      onApplyFormat={handleApplyFormat}
                      onAiFeedback={handleAiFeedbackFromSelection}
                      onClose={() => {
                        floatingToolbarOpenRef.current = false;
                        setFloatingToolbarPos(null);
                      }}
                    />

                    {/* Steno Live Hint & Comfort Status Bar */}
                    <div className='flex flex-wrap items-center justify-between border-t border-black/10 pt-2.5 px-1 text-[11px] opacity-80 gap-2'>
                      <div className='flex items-center gap-2'>
                        <button
                          type='button'
                          onClick={() => {
                            setRightPanelTab('steno');
                            setRightPanelOpen(true);
                            persistLayout({ rightPanelOpen: true, rightPanelTab: 'steno' });
                          }}
                          className='flex items-center gap-1.5 hover:text-primary transition-colors cursor-pointer'
                          title='클릭하여 Plover 속기 도우미 패널 열기'
                        >
                          <span
                            className={`h-2 w-2 rounded-full ${
                              ploverRunning ? 'bg-emerald-500' : 'bg-zinc-400'
                            }`}
                          />
                          <span className='font-bold'>Plover 속기 가이드:</span>
                          {currentWordSteno ? (
                            <span className='flex items-center gap-1 font-mono font-bold bg-primary/15 text-primary border border-primary/30 px-2 py-0.5 rounded'>
                              ⚡ {currentWordSteno.translation} ➔ {currentWordSteno.chord}
                            </span>
                          ) : (
                            <span className='opacity-60'>단어 입력 시 실시간 속기 코드 추천</span>
                          )}
                        </button>
                      </div>

                      <div className='flex items-center gap-2'>
                        <span className='opacity-60'>손가락 관절 피로 완화</span>
                        <button
                          type='button'
                          onClick={() => {
                            setRightPanelTab('steno');
                            setRightPanelOpen(true);
                            persistLayout({ rightPanelOpen: true, rightPanelTab: 'steno' });
                          }}
                          className='btn btn-ghost btn-xs text-[11px] text-primary font-bold'
                        >
                          속기 패널 열기 ▶
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* Read View with Highlighting support */
                <article className='prose prose-neutral dark:prose-invert mx-auto w-full max-w-3xl flex-1 p-6 md:p-12 overflow-y-auto'>
                  <h1 className='text-3xl font-extrabold tracking-tight'>{documentTitle}</h1>
                  {deferredContent ? (
                    <HighlightMarkdown content={deferredContent} />
                  ) : (
                    <p className='opacity-60'>아직 작성된 내용이 없습니다. 집필 탭으로 이동하여 글을 시작해 보세요.</p>
                  )}
                </article>
              )}
            </div>
          ) : (
            <div className='flex min-h-0 flex-1 items-center justify-center p-8' role='status'>
              {saveState === 'error'
                ? '저장된 책 원고를 불러오지 못했습니다. 기존 초안은 보존되어 있습니다.'
                : '책 원고를 불러오는 중…'}
            </div>
          )}
        </section>

        {/* RIGHT FLOATING HANDLE (Visible when Right Panel is closed) - Clean AI Sparkle & Tool Icon */}
        {!rightPanelOpen && (
          <button
            type='button'
            onClick={toggleRightPanel}
            className='absolute right-0 top-1/2 z-30 -translate-y-1/2 rounded-l-2xl border-y border-l border-sky-400/30 bg-[#081826]/95 hover:bg-[#0c2338] px-2.5 py-4 text-sky-300 shadow-xl transition-colors hover:px-3.5 hover:text-white cursor-pointer group'
            title='AI 어시스턴트 도구함 열기 (Ctrl+])'
          >
            <div className='flex flex-col items-center gap-2'>
              <AiSparkleIcon size={18} color='#38bdf8' className='group-hover:scale-110 transition-transform' />
              <PanelRightIcon size={14} color='#94a3b8' />
            </div>
          </button>
        )}

        {/* ----------------- RIGHT SLIDING PANEL (Only Chat AI & 집필 도구함) ----------------- */}
        <aside
          className={`relative z-20 flex shrink-0 flex-col overflow-hidden border-s transition-all duration-300 ease-in-out ${
            activeTheme.wingClass
          } ${rightPanelOpen ? 'w-96 md:w-[440px] shadow-2xl' : 'w-0 border-transparent shadow-none'}`}
        >
          {rightPanelOpen && (
            <div className='flex h-full w-96 md:w-[440px] flex-col min-h-0 p-4'>
              {/* Panel Header & Tabs */}
              <div className='flex items-center justify-between border-b border-black/15 pb-3'>
                <div className='flex items-center gap-1'>
                  <div className='join border border-base-300'>
                    <button
                      type='button'
                      className={`join-item btn btn-xs ${
                        rightPanelTab === 'chat' ? 'btn-secondary font-bold' : 'btn-ghost'
                      }`}
                      onClick={() => setRightPanelTab('chat')}
                    >
                      💬 Only Chat
                    </button>
                    <button
                      type='button'
                      className={`join-item btn btn-xs ${
                        rightPanelTab === 'steno' ? 'btn-accent font-bold' : 'btn-ghost'
                      }`}
                      onClick={() => setRightPanelTab('steno')}
                    >
                      ⌨️ 속기
                    </button>
                    <button
                      type='button'
                      className={`join-item btn btn-xs ${
                        rightPanelTab === 'stats' ? 'btn-primary font-bold' : 'btn-ghost'
                      }`}
                      onClick={() => setRightPanelTab('stats')}
                    >
                      📊 통계 / 메모
                    </button>
                    <button
                      type='button'
                      className={`join-item btn btn-xs ${
                        rightPanelTab === 'preview' ? 'btn-neutral font-bold' : 'btn-ghost'
                      }`}
                      onClick={() => setRightPanelTab('preview')}
                    >
                      👁️ 미리보기
                    </button>
                  </div>
                </div>

                <button
                  type='button'
                  className='btn btn-xs btn-ghost'
                  onClick={toggleRightPanel}
                  title='우측 미닫이 패널 닫기 (Ctrl+])'
                >
                  접기 ▶
                </button>
              </div>

              {/* Tab 1: Live Markdown Preview */}
              {rightPanelTab === 'preview' ? (
                <div className='flex-1 min-h-0 overflow-y-auto py-4 pe-1'>
                  <article className='prose prose-neutral dark:prose-invert max-w-none text-sm leading-relaxed'>
                    <h2 className='text-xl font-bold tracking-tight mb-3'>
                      {documentTitle}
                    </h2>
                    {deferredContent ? (
                      <HighlightMarkdown content={deferredContent} />
                    ) : (
                      <p className='text-xs opacity-50 italic'>
                        본문에 마크다운을 입력하면 이 패널에 실시간으로 서식이 반영되어 표시됩니다.
                      </p>
                    )}
                  </article>
                </div>
              ) : rightPanelTab === 'stats' ? (
                /* Tab 2: Statistics & Scratchpad */
                <div className='flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto py-3 pe-1'>
                  {/* Detailed Metric Cards */}
                  <div className='grid grid-cols-2 gap-2 text-xs'>
                    <div className='rounded-xl border border-base-300/40 bg-base-100/50 p-3'>
                      <div className='opacity-60'>단어 수 (Words)</div>
                      <div className='mt-1 text-lg font-bold text-primary'>
                        {wordCount.toLocaleString()}
                      </div>
                    </div>
                    <div className='rounded-xl border border-base-300/40 bg-base-100/50 p-3'>
                      <div className='opacity-60'>글자 수 (공백 제외)</div>
                      <div className='mt-1 text-lg font-bold text-primary'>
                        {charCountNoSpaces.toLocaleString()}
                      </div>
                    </div>
                    <div className='rounded-xl border border-base-300/40 bg-base-100/50 p-3'>
                      <div className='opacity-60'>글자 수 (공백 포함)</div>
                      <div className='mt-1 text-sm font-semibold'>
                        {charCountWithSpaces.toLocaleString()}
                      </div>
                    </div>
                    <div className='rounded-xl border border-base-300/40 bg-base-100/50 p-3'>
                      <div className='opacity-60'>예상 완독 시간</div>
                      <div className='mt-1 text-sm font-semibold'>
                        약 {estimatedReadingMinutes}분
                      </div>
                    </div>
                  </div>

                  {/* Storage Info */}
                  <div className='rounded-xl border border-base-300/40 bg-base-100/40 p-3 text-xs'>
                    <div className='font-semibold mb-1'>저장 상태</div>
                    <p className='opacity-70 truncate'>
                      경로: {activeDocument?.filePath || '인앱 로컬 데이터베이스 (IndexedDB)'}
                    </p>
                  </div>

                  {/* Quick Idea Scratchpad */}
                  <div className='flex flex-1 min-h-[160px] flex-col rounded-xl border border-base-300/40 bg-base-100/40 p-3'>
                    <div className='flex items-center justify-between text-xs font-semibold mb-1'>
                      <span>💡 빠른 아이디어 메모장</span>
                      <span className='text-[10px] opacity-50'>자동 보존</span>
                    </div>
                    <textarea
                      className='flex-1 resize-none bg-transparent text-xs leading-normal outline-none placeholder:opacity-40'
                      placeholder='집필 중 떠오른 영감이나 메모를 자유롭게 적어 두세요.'
                      value={scratchpad}
                      onChange={(e) => handleScratchpadChange(e.target.value)}
                    />
                  </div>
                </div>
              ) : rightPanelTab === 'steno' ? (
                /* Tab 3: Plover Steno Companion */
                <StenoPanel
                  wordCount={wordCount}
                  charCountWithSpaces={charCountWithSpaces}
                  onInsertText={(text) => {
                    if (!activeDocument) return;
                    const currentVal = bodyTextareaRef.current?.value ?? liveBodyRef.current;
                    const nextVal =
                      currentVal + (currentVal.endsWith(' ') ? '' : ' ') + text;
                    if (bodyTextareaRef.current) {
                      bodyTextareaRef.current.value = nextVal;
                      bodyTextareaRef.current.focus();
                    }
                    liveBodyRef.current = nextVal;
                    setLiveBody(nextVal);
                    commitBodyChange(nextVal);
                  }}
                />
              ) : (
                /* Tab 4: Only Chat Mini Panel */
                <div className='flex-1 min-h-0 flex flex-col'>
                  <OnlyChatMiniPanel
                    manuscriptTitle={documentTitle}
                    manuscriptBody={deferredContent}
                    onApplyRevision={handleApplyAiRevision}
                    onClose={() => setRightPanelTab('preview')}
                  />
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      <AppShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        documentTitle={titleInputRef.current?.value ?? (liveTitleRef.current || activeDocument?.title || '새 책')}
        documentBody={bodyTextareaRef.current?.value ?? liveBodyRef.current}
      />

      {/* Google Drive Cloud Synchronization Modal */}
      <GoogleDriveSyncModal
        isOpen={isDriveModalOpen}
        onClose={() => setIsDriveModalOpen(false)}
        workspace={workspace}
        onWorkspaceSynced={(merged) => {
          installWorkspace(merged);
          setDriveSyncState((prev) => ({
            ...prev,
            lastSyncedAt: new Date().toLocaleTimeString(),
          }));
        }}
      />

      {/* Global Settings Dialog (Ctrl + ,) */}
      {settingsError && <p role='alert'>{settingsError}</p>}
      {isSettingsDialogOpen && settings.globalViewSettings && <SettingsDialog bookKey='' />}

      {/* Floating Auto-Update Badge (Bottom-Right, only visible when update is available) */}
      <UpdateFloatingBadge />
    </main>
  );
}
