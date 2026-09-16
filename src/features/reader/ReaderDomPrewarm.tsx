'use dom';

import { useEffect } from 'react';

type Props = {
  onReady: () => Promise<void>;
  dom?: import('expo/dom').DOMProps;
};

/**
 * Starts one disposable DOM surface while the Library is idle. It deliberately
 * opens no EPUB and holds no book data; the formal Reader still owns all book
 * loading, CFI restoration, and interaction.
 */
export default function ReaderDomPrewarm({ onReady }: Props) {
  useEffect(() => {
    let disposed = false;
    void import('foliate-js/view.js')
      .catch(() => undefined)
      .finally(() => {
        if (!disposed) void onReady();
      });
    return () => { disposed = true; };
  }, [onReady]);

  return <div aria-hidden="true" style={{ height: '1px', opacity: 0, overflow: 'hidden', pointerEvents: 'none', width: '1px' }} />;
}
