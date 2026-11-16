'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';

export default function BookCreationShortcut() {
  const pathname = usePathname();
  const router = useRouter();
  const creationInProgress = useRef(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        event.shiftKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'n'
      ) {
        return;
      }

      event.preventDefault();

      if (pathname?.endsWith('/writer')) {
        window.dispatchEvent(new Event('ai-educational-book:new-book'));
        return;
      }

      if (creationInProgress.current) return;
      creationInProgress.current = true;

      void (async () => {
        try {
          const { createBookDocument, loadBookWorkspace, saveBookWorkspace } = await import(
            '@/services/bookDocuments'
          );
          const workspace = await loadBookWorkspace();
          const nextWorkspace = createBookDocument(workspace);
          await saveBookWorkspace(nextWorkspace);
          router.push(`/writer?bookId=${encodeURIComponent(nextWorkspace.activeId)}`);
        } catch (error) {
          console.error('Could not create a new local book:', error);
        } finally {
          creationInProgress.current = false;
        }
      })();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [pathname, router]);

  return null;
}
