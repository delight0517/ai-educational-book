import { useEffect, useState } from 'react';
import Image from 'next/image';
import { invoke } from '@tauri-apps/api/core';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { isTauriAppPlatform } from '@/services/environment';
import { parseWebViewInfo } from '@/utils/ua';
import { getAppVersion } from '@/utils/version';
import { writeTextToClipboard } from '@/utils/clipboard';
import { eventDispatcher } from '@/utils/event';
import Dialog from './Dialog';
import Link from './Link';

export const setAboutDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('about_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

type ShareStatus = 'checking' | 'copied' | 'unavailable' | 'error';

const UNIFIED_RELEASES_API =
  'https://api.github.com/repos/delight0517/ai-educational-book/releases?per_page=100';
const WINDOWS_PACKAGE_NAME = 'AI-Educational-Book-Windows-x64.zip';

export const AboutWindow = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [browserInfo, setBrowserInfo] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [shareStatus, setShareStatus] = useState<ShareStatus | null>(null);

  useEffect(() => {
    setBrowserInfo(parseWebViewInfo(appService));

    // The User-Agent is reduced to a stub on Windows WebView2, so ask the
    // Rust side for the runtime's real version and upgrade the label when it
    // answers. The component mounts with the library/reader pages, so this
    // fires on page mount rather than when the dialog opens; the UA-derived
    // label is on screen meanwhile, so nothing blocks on it.
    let cancelled = false;
    if (isTauriAppPlatform()) {
      invoke<{ engine: string; version: string } | null>('get_webview_version')
        .then((info) => {
          if (info && !cancelled) setBrowserInfo(`${info.engine} ${info.version}`);
        })
        .catch((error) => {
          if (!cancelled) {
            console.warn('[AboutWindow] get_webview_version failed:', error);
          }
        });
    }

    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
    };

    const el = document.getElementById('about_window');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      cancelled = true;
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    setIsOpen(false);
  };

  const versionInfo = `${_('Version {{version}}', { version: getAppVersion() })} (${browserInfo})`;

  // Mobile users can't select the version string to paste it into a bug
  // report (#5285), so tapping the label copies it. The label itself stays
  // localized; the copied string is locale-neutral and names the app first.
  const handleCopyVersion = async () => {
    const copied = await writeTextToClipboard(
      `AI Educational Book ${getAppVersion()} (${browserInfo})`,
    );
    if (!copied) return;
    eventDispatcher.dispatch('toast', {
      type: 'info',
      message: _('Copied to clipboard'),
      className: 'whitespace-nowrap',
      timeout: 2000,
    });
  };

  const handleShareWindowsApp = async () => {
    setShareStatus('checking');
    try {
      const response = await fetch(UNIFIED_RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) throw new Error(`Release lookup failed (${response.status})`);

      const releases = (await response.json()) as Array<{
        draft: boolean;
        prerelease: boolean;
        tag_name: string;
        assets: Array<{ name: string; browser_download_url: string }>;
      }>;
      const release = releases.find(
        (item) => !item.draft && !item.prerelease && item.tag_name.startsWith('unified-'),
      );
      const packageAsset = release?.assets.find((asset) => asset.name === WINDOWS_PACKAGE_NAME);
      if (!packageAsset) {
        setShareStatus('unavailable');
        return;
      }

      const copied = await writeTextToClipboard(packageAsset.browser_download_url);
      setShareStatus(copied ? 'copied' : 'error');
      if (copied) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: 'Windows 다운로드 링크를 복사했어요.',
          className: 'whitespace-nowrap',
          timeout: 3000,
        });
      }
    } catch (error) {
      console.warn('[AboutWindow] share link unavailable:', error);
      setShareStatus('error');
    }
  };

  return (
    <Dialog
      id='about_window'
      isOpen={isOpen}
      title='AI Educational Book'
      onClose={handleClose}
      boxClassName='sm:w-[480px]! sm:max-w-(--breakpoint-sm)! sm:h-auto'
    >
      {isOpen && (
        <div className='about-content flex flex-col items-center justify-center gap-4 pb-10 sm:pb-0'>
          <div className='flex flex-1 flex-col items-center justify-end gap-2 px-8 py-2'>
            <div className='mb-2 mt-6'>
              <Image src='/icon.png' alt='App Logo' className='h-20 w-20' width={64} height={64} />
            </div>
            <div className='flex select-text flex-col items-center'>
              <h2 className='mb-2 text-2xl font-bold'>AI Educational Book</h2>
              <button
                type='button'
                title={_('Copy')}
                className='text-neutral-content text-center text-sm'
                onClick={handleCopyVersion}
              >
                {versionInfo}
              </button>
            </div>
            <div className='my-1 flex min-h-5 flex-col items-center gap-2'>
              <p className='text-neutral-content text-xs'>
                업데이트할 때는 공유 링크에서 최신 Windows 설치 파일을 내려받아 실행하세요.
              </p>
              <button
                type='button'
                className='btn btn-sm btn-secondary cursor-pointer p-1 text-xs'
                onClick={handleShareWindowsApp}
                disabled={shareStatus === 'checking'}
              >
                {shareStatus === 'checking' ? '다운로드 링크 확인 중…' : 'Windows 앱 공유하기'}
              </button>
              {shareStatus === 'unavailable' && (
                <p className='text-neutral-content max-w-72 text-xs' role='status'>
                  새 통합 Windows 설치 파일이 공개되면 여기서 바로 다운로드 링크를 복사할 수
                  있습니다.
                </p>
              )}
              {shareStatus === 'error' && (
                <p className='text-error max-w-72 text-xs' role='status'>
                  링크를 확인하거나 복사하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.
                </p>
              )}
              {shareStatus === 'copied' && (
                <p className='text-neutral-content text-xs' role='status'>
                  다운로드 링크를 복사했습니다. 메시지에 붙여 넣어 보내세요.
                </p>
              )}
            </div>
          </div>

          <hr aria-hidden='true' className='border-base-300 my-12 w-full sm:my-4' />

          <div
            className='flex flex-1 flex-col items-center justify-start gap-2 px-4 text-center'
            dir='ltr'
          >
            <p className='text-neutral-content text-sm'>
              AI Educational Book is an independent writing and reading app built on the Readest
              open-source project.
            </p>

            <p className='text-neutral-content text-xs'>
              The Readest components are licensed under the{' '}
              <Link
                href='https://www.gnu.org/licenses/agpl-3.0.html'
                className='text-blue-500 underline'
              >
                GNU Affero General Public License v3.0
              </Link>
              . Please see the source repository for the applicable license and notices.
            </p>
            <p className='text-neutral-content text-xs'>
              Readest open-source foundation and license:{' '}
              <Link href='https://github.com/readest/readest' className='text-blue-500 underline'>
                Readest source
              </Link>
              .
            </p>
            <p className='text-neutral-content text-xs'>
              AI Educational Book downloads and matching source:{' '}
              <Link
                href='https://github.com/delight0517/ai-educational-book/releases'
                className='text-blue-500 underline'
              >
                Releases
              </Link>
              .
            </p>

          </div>
        </div>
      )}
    </Dialog>
  );
};
