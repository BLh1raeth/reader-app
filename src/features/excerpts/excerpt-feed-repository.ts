import { getLibraryDatabase } from '../library/library-database';

/**
 * Excerpts Tab 的统一 read model。
 *
 * UI 拿到的是一条可以直接渲染的 Feed Item，而不是 raw DB row。
 *
 * 数据审计结论（2026-09-20）：
 * - reader_excerpts 真实存在：id / book_id(FK cascade) / text / start_cfi /
 *   end_cfi / range_cfi / chapter_title / section_index / created_at /
 *   updated_at，UNIQUE(book_id, range_cfi)。
 * - reader_highlights 真实存在，但纯高亮不进入 Feed。
 * - note 不存在：没有 note 表、没有 note repository，Reader 里的 note
 *   action 目前只是 DEV stub（用户此前已决定暂缓笔记功能）。
 *   因此本轮 Feed 只返回摘录；`kind: 'note'` 与 `noteText` 字段为笔记
 *   落地后预留，UI 渲染路径已就绪，无需返工。
 */
export type ExcerptFeedItem = {
  /** Feed 内的稳定 id：`excerpt-<rowId>`（笔记落地后为 `note-<rowId>`）。 */
  id: string;

  kind: 'excerpt' | 'note';

  bookId: string;

  bookTitle: string;
  author?: string | null;

  chapterTitle?: string | null;

  quoteText: string;

  /** 仅 note kind 有值；excerpt 为 null。 */
  noteText?: string | null;

  rangeCfi: string;

  sectionIndex?: number | null;

  createdAt: string;
  updatedAt: string;
};

type ExcerptFeedRow = {
  id: number;
  book_id: string;
  text: string;
  start_cfi: string;
  end_cfi: string;
  range_cfi: string;
  chapter_title: string | null;
  section_index: number;
  created_at: string;
  updated_at: string;
  book_title: string | null;
  book_author: string | null;
};

function mapRow(row: ExcerptFeedRow): ExcerptFeedItem {
  return {
    id: `excerpt-${row.id}`,
    kind: 'excerpt',
    bookId: row.book_id,
    bookTitle: row.book_title ?? '未知书籍',
    author: row.book_author,
    chapterTitle: row.chapter_title,
    quoteText: row.text,
    noteText: null,
    rangeCfi: row.range_cfi,
    sectionIndex: row.section_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 去重规则（当前为 no-op，但规则已锁死）：
 *
 * 笔记功能落地后，如果一条 Note 明确关联某条 Excerpt（通过 excerpt 外键，
 * 或同一 (book_id, range_cfi)），两者合并为 1 条 kind='note' 的 item，
 * 同时展示 quoteText + noteText，不再保留单独的 excerpt-only item。
 * 去重绝不只依赖 quoteText 文本相同。
 *
 * 当前 notes 数据源不存在，本函数直接返回输入；调用点保留，笔记落地时
 * 只需在此接入 note 查询与合并逻辑。
 */
function dedupeFeedItems(items: ExcerptFeedItem[]): ExcerptFeedItem[] {
  // 笔记数据源尚未实现：无合并发生。
  return items;
}

async function queryExcerptRows(): Promise<ExcerptFeedRow[]> {
  const database = await getLibraryDatabase();
  return database.getAllAsync<ExcerptFeedRow>(
    `SELECT e.id, e.book_id, e.text, e.start_cfi, e.end_cfi, e.range_cfi,
            e.chapter_title, e.section_index, e.created_at, e.updated_at,
            b.title AS book_title, b.author AS book_author
     FROM reader_excerpts AS e
     LEFT JOIN books AS b ON b.id = e.book_id
     ORDER BY e.created_at DESC, e.id DESC;`,
  );
}

/**
 * 摘录 Tab Feed 查询层。只读，不触碰任何 annotation 写入逻辑。
 *
 * - 只返回摘录（kind='excerpt'）；纯高亮、书签不进入 Feed。
 * - book 删除时 annotation 经 FK cascade 删除，下次 refresh 自动消失，
 *   本层不维护任何持久缓存。
 * - 列表展示不需要 rangeCFI → DOM Range，本层只读 DB metadata，不 resolve CFI。
 */
export async function listExcerptFeedItems(): Promise<ExcerptFeedItem[]> {
  const rows = await queryExcerptRows();
  const items = rows.map(mapRow);
  const before = items.length;
  const deduped = dedupeFeedItems(items);
  if (__DEV__) {
    console.log(
      '[EXCERPT_FEED_LOAD]',
      JSON.stringify({
        totalItems: deduped.length,
        excerptCount: deduped.filter((item) => item.kind === 'excerpt').length,
        noteCount: deduped.filter((item) => item.kind === 'note').length,
        // sectionCount 由 UI 分组后确定，这里只给 feed 层数字
        feedItemCount: deduped.length,
      }),
    );
    if (deduped.length !== before) {
      console.log(
        '[EXCERPT_FEED_DEDUP]',
        JSON.stringify({
          relationType: 'note-merge',
          before,
          after: deduped.length,
        }),
      );
    }
  }
  return deduped;
}
