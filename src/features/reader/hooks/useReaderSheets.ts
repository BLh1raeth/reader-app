import { useEffect, useState } from 'react';

/**
 * ReaderScreen 巨型组件拆分：三个 sheet 的 presented 状态。
 *
 * TOC / 设置 / 搜索三个 sheet 的打开函数都会关闭另外两个（互斥），
 * 把三个布尔状态集中在一个 hook 里，避免 useReaderToc 与 useReaderSearch
 * 互相传 setter 形成循环依赖。各 feature hook 只拿自己需要的 setter。
 */
export function useReaderSheets({ bookId }: { bookId: string | undefined }) {
  const [tocSheetPresented, setTocSheetPresented] = useState(false);
  const [settingsSheetPresented, setSettingsSheetPresented] = useState(false);
  const [searchSheetPresented, setSearchSheetPresented] = useState(false);

  // 换书时关闭所有 sheet（原 ReaderScreen 内 bookId 重置 effect 的一部分，
  // 按功能拆到各 hook 后各自重置自己名下的状态）。
  useEffect(() => {
    setTocSheetPresented(false);
    setSettingsSheetPresented(false);
    setSearchSheetPresented(false);
  }, [bookId]);

  return {
    tocSheetPresented,
    setTocSheetPresented,
    settingsSheetPresented,
    setSettingsSheetPresented,
    searchSheetPresented,
    setSearchSheetPresented,
  };
}
