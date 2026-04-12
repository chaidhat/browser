import { useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  type: 'chat' | 'page' | 'messages' | 'notes' | 'history';
}

export interface WebviewContainerHandle {
  goBack(): void;
  goForward(): void;
  reload(): void;
  loadURL(url: string): void;
  setVisibility(visible: boolean): void;
  findInPage(text: string, forward: boolean): void;
  stopFindInPage(): void;
}

interface Props {
  tabs: TabInfo[];
  activeTabId: number;
  onTabUpdate: (id: number, updates: { title?: string; url?: string }) => void;
  onLoadingChange: (tabId: number, loading: boolean) => void;
  onFaviconChange: (tabId: number, favicon: string) => void;
  onNewTab?: (url: string) => void;
  hidden?: boolean;
}

export const WebviewContainer = forwardRef<WebviewContainerHandle, Props>(
  ({ tabs, activeTabId, onTabUpdate, onLoadingChange, onFaviconChange, onNewTab, hidden }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const webviewsRef = useRef<Map<number, Electron.WebviewTag>>(new Map());
    const listenersRef = useRef<Map<number, (() => void)>>(new Map());

    const getActiveWebview = useCallback(() => {
      return webviewsRef.current.get(activeTabId);
    }, [activeTabId]);

    useImperativeHandle(ref, () => ({
      goBack() {
        getActiveWebview()?.goBack();
      },
      goForward() {
        getActiveWebview()?.goForward();
      },
      reload() {
        getActiveWebview()?.reload();
      },
      loadURL(url: string) {
        getActiveWebview()?.loadURL(url);
      },
      setVisibility(visible: boolean) {
        const container = containerRef.current;
        if (container) {
          container.style.visibility = visible ? '' : 'hidden';
        }
      },
      findInPage(text: string, forward: boolean) {
        const wv = getActiveWebview();
        if (wv) {
          const wcId = (wv as any).getWebContentsId?.();
          if (wcId) {
            window.browser.findInPage(wcId, text, forward);
          }
        }
      },
      stopFindInPage() {
        const wv = getActiveWebview();
        if (wv) {
          const wcId = (wv as any).getWebContentsId?.();
          if (wcId) {
            window.browser.stopFindInPage(wcId);
          }
        }
      },
    }), [getActiveWebview]);

    const createWebview = useCallback((tab: TabInfo) => {
      const container = containerRef.current;
      if (!container || webviewsRef.current.has(tab.id)) return;

      const wv = document.createElement('webview') as Electron.WebviewTag;
      wv.setAttribute('autosize', 'on');
      wv.setAttribute('allowpopups', '');
      wv.setAttribute('webpreferences', 'enableBlinkFeatures=WebAuthentication');
      wv.setAttribute('useragent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
      wv.className = 'w-full h-full';
      wv.style.display = 'flex';

      const tabId = tab.id;

      const onDidNavigate = (e: any) => {
        onTabUpdate(tabId, { url: e.url });
      };
      const onDidNavigateInPage = (e: any) => {
        onTabUpdate(tabId, { url: e.url });
      };
      const onPageTitleUpdated = (e: any) => {
        onTabUpdate(tabId, { title: e.title });
      };
      let stopTimer: ReturnType<typeof setTimeout> | undefined;
      const onDidStartLoading = () => {
        if (stopTimer) { clearTimeout(stopTimer); stopTimer = undefined; }
        onLoadingChange(tabId, true);
      };
      const onDidStopLoading = () => {
        if (stopTimer) clearTimeout(stopTimer);
        stopTimer = setTimeout(() => onLoadingChange(tabId, false), 500);
      };
      const onPageFaviconUpdated = (e: any) => {
        if (e.favicons && e.favicons.length > 0) {
          onFaviconChange(tabId, e.favicons[0]);
        }
      };
      wv.addEventListener('did-navigate', onDidNavigate);
      wv.addEventListener('did-navigate-in-page', onDidNavigateInPage);
      wv.addEventListener('page-title-updated', onPageTitleUpdated);
      wv.addEventListener('did-start-loading', onDidStartLoading);
      wv.addEventListener('did-stop-loading', onDidStopLoading);
      wv.addEventListener('page-favicon-updated', onPageFaviconUpdated);

      listenersRef.current.set(tabId, () => {
        wv.removeEventListener('did-navigate', onDidNavigate);
        wv.removeEventListener('did-navigate-in-page', onDidNavigateInPage);
        wv.removeEventListener('page-title-updated', onPageTitleUpdated);
        wv.removeEventListener('did-start-loading', onDidStartLoading);
        wv.removeEventListener('did-stop-loading', onDidStopLoading);
        wv.removeEventListener('page-favicon-updated', onPageFaviconUpdated);
      });

      container.appendChild(wv);
      wv.src = tab.url;
      webviewsRef.current.set(tab.id, wv);
    }, [onTabUpdate, onLoadingChange, onFaviconChange]);

    // Only create a webview for the active page tab (lazy loading)
    useEffect(() => {
      const activePageTab = tabs.find(t => t.id === activeTabId && t.type === 'page');
      if (activePageTab) {
        createWebview(activePageTab);
      }
    }, [activeTabId, tabs, createWebview]);

    // Clean up webviews for closed tabs
    useEffect(() => {
      const currentIds = new Set(tabs.filter(t => t.type === 'page').map(t => t.id));
      for (const id of webviewsRef.current.keys()) {
        if (!currentIds.has(id)) {
          const wv = webviewsRef.current.get(id);
          wv?.remove();
          webviewsRef.current.delete(id);
          listenersRef.current.get(id)?.();
          listenersRef.current.delete(id);
        }
      }
    }, [tabs]);

    useEffect(() => {
      for (const [id, wv] of webviewsRef.current) {
        const show = id === activeTabId;
        wv.style.display = show ? 'flex' : 'none';
      }
    }, [activeTabId, tabs, hidden]);

    return <div className="flex-1 h-full relative bg-white" ref={containerRef} style={hidden ? { display: 'none' } : undefined} />;
  }
);
