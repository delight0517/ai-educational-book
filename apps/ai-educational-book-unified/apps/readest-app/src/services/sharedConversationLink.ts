import type { WebBrowserPage } from '@/services/webBrowser/webBrowser';

export type SharedConversationProvider = 'chatgpt' | 'gemini';

const shareIdPattern = /^[a-z\d_-]+$/i;

export const getSharedConversationProvider = (value: string): SharedConversationProvider | null => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  if (
    url.hostname === 'chatgpt.com' &&
    segments.length === 2 &&
    segments[0] === 'share' &&
    shareIdPattern.test(segments[1] ?? '')
  ) {
    return 'chatgpt';
  }
  if (
    url.hostname === 'gemini.google.com' &&
    segments.length === 2 &&
    segments[0] === 'share' &&
    shareIdPattern.test(segments[1] ?? '')
  ) {
    return 'gemini';
  }
  if (
    url.hostname === 'g.co' &&
    segments.length === 3 &&
    segments[0] === 'gemini' &&
    segments[1] === 'share' &&
    shareIdPattern.test(segments[2] ?? '')
  ) {
    return 'gemini';
  }
  return null;
};

const cleanMessageText = (element: Element) => {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('button, svg, script, style, [aria-hidden="true"]').forEach((item) => item.remove());
  return (clone.innerText || clone.textContent || '').replace(/\r\n?/g, '\n').trim();
};

const findTurns = (document: Document, provider: SharedConversationProvider) => {
  const selectors =
    provider === 'chatgpt'
      ? ['[data-message-author-role="user"]', '[data-message-author-role="assistant"]']
      : [
          '[data-message-author-role="user"]',
          '[data-message-author-role="assistant"]',
          'user-query',
          'model-response',
          '[data-test-id="user-query"]',
          '[data-test-id="model-response"]',
        ];
  const candidates = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
  const unique = [...new Set(candidates)].filter((element) => {
    const parent = element.parentElement?.closest(selectors.join(','));
    return !parent;
  });

  return unique
    .map((element) => {
      const role =
        element.getAttribute('data-message-author-role') ??
        element.getAttribute('data-test-id') ??
        element.tagName.toLowerCase();
      const speaker = /^(user|user-query)$/i.test(role) || role === 'user-query' ? 'You' : provider === 'chatgpt' ? 'ChatGPT' : 'Gemini';
      return { speaker, content: cleanMessageText(element) };
    })
    .filter((turn) => turn.content);
};

export type CapturedSharedConversation = {
  provider: SharedConversationProvider;
  title: string;
  sourceUrl: string;
  rawText: string;
  warning: string | null;
};

export const captureSharedConversation = (
  page: WebBrowserPage,
  expectedProvider: SharedConversationProvider,
  fallbackTitle: string,
): CapturedSharedConversation => {
  const provider = getSharedConversationProvider(page.url);
  if (provider !== expectedProvider) {
    throw new Error('The captured page is not the same supported ChatGPT or Gemini share link. Reopen the link and try again.');
  }

  const document = new DOMParser().parseFromString(page.html, 'text/html');
  const turns = findTurns(document, provider);
  let rawText = '';
  let warning: string | null = 'Scroll through the whole shared conversation before clipping. Review the captured text for missing turns.';
  if (turns.length) {
    rawText = turns.map(({ speaker, content }) => `${speaker}:\n${content}`).join('\n\n');
  } else {
    const main = document.querySelector('main') ?? document.body;
    const clone = main.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('button, nav, header, footer, script, style, svg, [aria-hidden="true"]').forEach((item) => item.remove());
    rawText = (clone.innerText || clone.textContent || '').replace(/\r\n?/g, '\n').trim();
    warning = 'Speaker labels were not recognized. The visible page text is preserved; review the full transcript before adding it.';
  }

  if (!rawText.trim()) throw new Error('No conversation text was found on the captured page. Scroll to load the conversation and try again.');
  if (rawText.length > 1_000_000) throw new Error('This captured conversation is too large to add safely. Capture a smaller shared conversation.');

  const title = document.querySelector('h1')?.textContent?.trim() || document.title.trim() || fallbackTitle;
  return { provider, title, sourceUrl: page.url, rawText, warning };
};
