import type { ReaderEngineDiagnostic, ReaderLocation, ReaderRestoreState, ReaderTocItem } from '../reader-types';

type FoliateRawLocation = {
  cfi?: string;
  fraction?: number;
  section?: { current?: number };
};

type FoliateSection = { cfi?: string };

type FoliateView = HTMLElement & {
  book?: { sections?: FoliateSection[]; toc?: unknown[] };
  renderer?: HTMLElement;
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
  private restoreState: ReaderRestoreState = 'opening';

  constructor(
    private readonly host: HTMLElement,
    private readonly onLocation: (location: ReaderLocation, restoreState: ReaderRestoreState) => void,
    private readonly onCenterTap: () => void,
    private readonly onDiagnostic: (diagnostic: ReaderEngineDiagnostic) => void,
  ) {}

  async open(input: FoliateOpenInput): Promise<ReaderLocation> {
    this.destroy();
    this.restoreState = 'opening';
    await import('foliate-js/view.js');

    const view = document.createElement('foliate-view') as FoliateView;
    view.style.display = 'block';
    view.style.width = '100%';
    view.style.height = '100%';
    view.style.visibility = 'hidden';
    view.setAttribute('flow', 'paginated');
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
    this.onDiagnostic({ event: 'ENGINE_OPENED' });
    // `foliate-view` owns an internal `foliate-paginator`; its margin is not
    // inherited from the outer custom element. Give the reader a deliberate
    // top/bottom breathing area without adding a visible container or card.
    view.renderer?.setAttribute('margin', '88px');
    view.renderer?.setAttribute('gap', '7%');
    // First let foliate finish its own deterministic text-start layout. A
    // direct restore after that avoids a delayed initial relocate event
    // replacing a valid saved CFI with the beginning of the book.
    this.restoreState = 'restoring';
    const targetCfi = input.restoreCfi?.startsWith('epubcfi(') ? input.restoreCfi : null;
    this.onDiagnostic({ event: 'RESTORE_REQUEST', targetCfi });
    await view.init({ lastLocation: null, showTextStart: true });
    if (targetCfi) {
      try {
        await view.goTo(targetCfi);
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      } catch {
        // A CFI can become invalid if its EPUB was replaced. Keep the already
        // loaded first text position rather than showing a white reader.
      }
    }

    const location = this.getLocation();
    this.onDiagnostic({ event: 'RESTORE_RESULT', targetCfi, actualCurrentCfi: location.cfi });
    this.restoreState = 'active';
    view.style.visibility = 'visible';
    this.onLocation(location, this.restoreState);
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
    if (this.view) this.onDiagnostic({ event: 'ENGINE_DESTROY' });
    this.restoreState = 'opening';
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
      const location = this.getLocation();
      this.onDiagnostic({ event: 'LOCATION_CHANGED', cfi: location.cfi, restoreState: this.restoreState });
      this.onLocation(location, this.restoreState);
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
    for (const image of Array.from(doc.images)) this.markStandaloneImageContainer(image);
    const style = doc.createElement('style');
    style.textContent = `
      html, body { max-width: 100% !important; overflow-x: hidden !important; }
      img {
        display: block !important;
        max-width: 100% !important;
        max-height: calc(100vh - 176px) !important;
        width: auto !important;
        height: auto !important;
        margin: 14px auto 20px !important;
        object-fit: contain !important;
        break-inside: avoid !important;
        -webkit-column-break-inside: avoid !important;
      }
      /* A paragraph/figure containing only one image is a visual page, not
         normal text flow. Match its height to foliate's 88px top + bottom
         paginator margins so the artwork is vertically centered and never
         sliced between two columns. */
      .reader-standalone-image {
        box-sizing: border-box !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        height: calc(100vh - 176px) !important;
        min-height: calc(100vh - 176px) !important;
        margin: 0 !important;
        padding: 0 !important;
        break-inside: avoid !important;
        -webkit-column-break-inside: avoid !important;
      }
      .reader-standalone-image img {
        max-height: 100% !important;
        max-width: 100% !important;
        margin: 0 auto !important;
      }
      table { max-width: 100% !important; }
    `;
    doc.head.append(style);
  }

  private markStandaloneImageContainer(image: HTMLImageElement) {
    let container: HTMLElement | null = image.parentElement;
    // An image may be wrapped in a link; use its visual paragraph/figure/div
    // only when that wrapper contains no actual reading text or sibling media.
    if (container?.tagName === 'A') container = container.parentElement;
    if (!container || !['P', 'FIGURE', 'DIV'].includes(container.tagName)) return;
    const meaningfulChildren = Array.from(container.childNodes).filter((node) => {
      if (node.nodeType === Node.TEXT_NODE) return Boolean(node.textContent?.trim());
      if (!(node instanceof HTMLElement)) return false;
      if (node === image || node.contains(image)) return false;
      return true;
    });
    if (meaningfulChildren.length === 0) container.classList.add('reader-standalone-image');
  }
}
