export type ReadingState = 'unread' | 'reading' | 'finished';

export type MockBook = {
  id: string;
  title: string;
  author: string;
  progress: number;
  state: ReadingState;
  addedAt: string;
  lastReadAt?: string;
  coverTone: 'paper' | 'coral' | 'mist' | 'ink' | 'sage' | 'plum' | 'ocean';
  hasGeneratedCover?: boolean;
};

// Flip this local-only mock switch to exercise the empty-library state.
export const USE_EMPTY_LIBRARY_MOCK = false;

export const mockBooks: MockBook[] = [
  {
    id: 'algernon',
    title: '献给阿尔吉侬的花束',
    author: '丹尼尔·凯斯',
    progress: 36,
    state: 'reading',
    addedAt: '2026-09-01T09:00:00.000Z',
    lastReadAt: '2026-09-12T20:30:00.000Z',
    coverTone: 'paper',
  },
  {
    id: 'letters-from-a-small-island',
    title: '小岛来信：在缓慢时间里阅读',
    author: '林岚',
    progress: 0,
    state: 'unread',
    addedAt: '2026-09-13T11:00:00.000Z',
    coverTone: 'coral',
    hasGeneratedCover: true,
  },
  {
    id: 'moss-and-stone',
    title: '苔与石',
    author: '陈静',
    progress: 100,
    state: 'finished',
    addedAt: '2026-08-20T10:00:00.000Z',
    lastReadAt: '2026-09-10T18:00:00.000Z',
    coverTone: 'mist',
  },
  {
    id: 'night-train',
    title: '夜行列车',
    author: '伊恩·麦克尤恩',
    progress: 12,
    state: 'reading',
    addedAt: '2026-09-05T10:00:00.000Z',
    lastReadAt: '2026-09-08T22:10:00.000Z',
    coverTone: 'ink',
  },
  {
    id: 'quiet-garden',
    title: '安静的花园',
    author: '伍尔夫',
    progress: 0,
    state: 'unread',
    addedAt: '2026-09-11T08:00:00.000Z',
    coverTone: 'sage',
  },
  {
    id: 'a-room-of-rain',
    title: '一间下雨的房子',
    author: '周嘉宁',
    progress: 100,
    state: 'finished',
    addedAt: '2026-08-18T13:00:00.000Z',
    lastReadAt: '2026-09-02T19:20:00.000Z',
    coverTone: 'plum',
  },
  {
    id: 'deep-blue-afternoon',
    title: '深蓝色的下午',
    author: '玛格丽特·杜拉斯',
    progress: 64,
    state: 'reading',
    addedAt: '2026-09-03T16:00:00.000Z',
    lastReadAt: '2026-09-06T15:00:00.000Z',
    coverTone: 'ocean',
  },
];
