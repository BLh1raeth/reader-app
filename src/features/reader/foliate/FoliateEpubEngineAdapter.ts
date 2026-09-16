import type { ReaderLocation, ReaderTocItem } from '../reader-types';

type FoliateRawLocation = {
  cfi?: string;
  fraction?: number;
  section?: { current?: number };
};

type FoliateSection = { cfi?: string };

type FoliateView = HTMLElement & {
  book?: { sections?: FoliateSection[]; toc?: unknown[] };
  lastLocation?: FoliateRawLocation | null;
  open: (book: File | Blob) => Promise<void>;
  init: (options: { lastLocation: string | null; showTextStart: boolean }) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  goTo: (target: string) => Promise<void>;
  close: () => void;
};

export type FoliateOpenInput = {
  base64: string;
  fileName: string;
  restoreCfi: string | null;
};

function base64ToBytes(base64: string) {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function clampPercentage(value: number) {
  return Math.max(0, Math.min(100, value));
}

function mapToc(items: unknown): ReaderTocItem[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item): ReaderTocItem[] => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as { label?: unknown; href?: unknown; subitems?: unknown };
    if (typeof candidate.label !== 'string' || typeof candidate.href !== 'string') return [];
    const subitems = mapToc(candidate.subitems);
    return [{ label: candidate.label, href: candidate.href, ...(subitems.length ? { subitems } : {}) }];
  });
}

/** The only formal Reader Core wrapper around foliate-js. */
export class FoliateEpubEngineAdapter {
  private view: FoliateView | null = null;
  private loadedDocuments: Document[] = [];

  constructor(
    private readonly host: HTMLElement,
    private readonly onLocation: (location: ReaderLocation) => void,
    private readonly onCenterTap: () => void,
  ) {}

  async open(input: FoliateOpenInput): Promise<ReaderLocation> {
    this.destroy();
    await import('foliate-js/view.js');

    const view = document.createElement('foliate-view') as FoliateView;
    view.style.display = 'block';
    view.style.width = '100%';
    view.style.height = '100%';
    view.style.visibility = 'hidden';
    view.setAttribute('flow', 'paginated');
    view.setAttribute('margin', '24px');
    view.setAttribute('gap', '7%');
    view.addEventListener('relocate', this.handleRelocate);
    view.addEventListener('load', this.handleDocumentLoad as EventListener);
    this.host.replaceChildren(view);
    this.view = view;

    // Do not keep a second JavaScript reference to the decoded book. Foliate
    // owns the File/Blob after open(), and this adapter never stores base64.
    const epubFile = new File([base64ToBytes(input.base64)], input.fileName, {
      type: 'application/epub+zip',
    });
    await view.open(epubFile);
    try {
      await view.init({ lastLocation: input.restoreCfi, showTextStart: true });
    } catch (error) {
      if (!input.restoreCfi) throw error;
      // A CFI can become invalid when a user replaces a book file. A clean
      // first-location fallback is safer than a white reader surface.
      await view.init({ lastLocation: null, showTextStart: true });
    }

    const location = this.getLocation();
    view.style.visibility = 'visible';
    this.onLocation(location);
    return location;
  }

  async next() {
    if (!this.view) throw new Error('Reader 尚未就绪。');
    await this.view.next();
  }

  async prev() {
    if (!this.view) throw new Error('Reader 尚未就绪。');
    await this.view.prev();
  }

  getLocation(): ReaderLocation {
    const raw = this.view?.lastLocation;
    const cfi = raw?.cfi;
    if (!cfi) throw new Error('foliate-js 未返回 EPUB CFI。');
    const sections = this.view?.book?.sections ?? [];
    const resolvedIndex = raw?.section?.current;
    const cfiIndex = sections.findIndex((section) => section.cfi && cfi.includes(section.cfi));
    return {
      cfi,
      spineIndex: typeof resolvedIndex === 'number' ? resolvedIndex : cfiIndex >= 0 ? cfiIndex : 0,
      percentage: clampPercentage((raw?.fraction ?? 0) * 100),
      // These pagination values are intentionally null for now. foliate-js
      // gives stable CFI/progress, while a global page total is reflow-dependent.
      currentPage: null,
      totalPages: null,
    };
  }

  async goTo(location: string) {
    if (!this.view) throw new Error('Reader 尚未就绪。');
    await this.view.goTo(location);
  }

  getProgress() {
    return this.getLocation().percentage;
  }

  getToc() {
    return mapToc(this.view?.book?.toc);
  }

  // Deliberate extension points for Reader Core B. No UI is implemented here.
  async search(_query: string) { return []; }
  addAnnotation() { throw new Error('Reader Core A 尚未启用标注。'); }
  removeAnnotation() { throw new Error('Reader Core A 尚未启用标注。'); }

  destroy() {
    for (const doc of this.loadedDocuments) doc.removeEventListener('click', this.handleDocumentClick);
    this.loadedDocuments = [];
    if (this.view) {
      this.view.removeEventListener('relocate', this.handleRelocate);
      this.view.removeEventListener('load', this.handleDocumentLoad as EventListener);
      this.view.close();
      this.view.remove();
      this.view = null;
    }
    this.host.replaceChildren();
  }

  private readonly handleRelocate = () => {
    try {
      this.onLocation(this.getLocation());
    } catch {
      // A transient relocation without a CFI is not a persisted position.
    }
  };

  private readonly handleDocumentLoad = (event: CustomEvent<{ doc?: Document }>) => {
    const doc = event.detail?.doc;
    if (!doc || this.loadedDocuments.includes(doc)) return;
    this.loadedDocuments.push(doc);
    this.normalizeDocument(doc);
    doc.addEventListener('click', this.handleDocumentClick);
  };

  private readonly handleDocumentClick = (event: MouseEvent) => {
    const doc = event.currentTarget as Document;
    if (doc.getSelection()?.type === 'Range') return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('a, button, input, select, textarea')) return;
    const width = doc.defaultView?.innerWidth ?? 0;
    if (!width) return;
    const ratio = event.clientX / width;
    if (ratio <= 0.27) void this.prev().catch(() => undefined);
    else if (ratio >= 0.73) void this.next().catch(() => undefined);
    else this.onCenterTap();
  };

  private normalizeDocument(doc: Document) {
    const style = doc.createElement('style');
    style.textContent = `
      html, body { max-width: 100% !important; overflow-x: hidden !important; }
      img, svg, video { max-width: 100% !important; height: auto !important; }
      table { max-width: 100% !important; }
    `;
    doc.head.append(style);
  }
}
