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
  coverUri?: string;
  hasGeneratedCover?: boolean;
};

// Flip this local-only mock switch to exercise the empty-library state.
export const USE_EMPTY_LIBRARY_MOCK = false;

export const mockBooks: MockBook[] = [
  {
    id: 'woman-in-white',
    title: '白衣女人',
    author: '威尔基·柯林斯',
    progress: 36,
    state: 'reading',
    addedAt: '2026-09-01T09:00:00.000Z',
    lastReadAt: '2026-09-12T20:30:00.000Z',
    coverTone: 'paper',
    coverUri: 'https://commons.wikimedia.org/wiki/Special:FilePath/The_Woman_In_White_-_Cover.jpg?width=900',
  },
  {
    id: 'at-earths-core',
    title: '地心世界',
    author: '埃德加·赖斯·巴勒斯',
    progress: 0,
    state: 'unread',
    addedAt: '2026-09-13T11:00:00.000Z',
    coverTone: 'coral',
    coverUri: 'https://commons.wikimedia.org/wiki/Special:FilePath/At_the_Earths_Core_1922_Dusk_Jacket.jpg?width=900',
  },
  {
    id: 'boys-king-arthur',
    title: '少年亚瑟王',
    author: '安德鲁·朗',
    progress: 100,
    state: 'finished',
    addedAt: '2026-08-20T10:00:00.000Z',
    lastReadAt: '2026-09-10T18:00:00.000Z',
    coverTone: 'mist',
    coverUri: 'https://commons.wikimedia.org/wiki/Special:FilePath/Boys_King_Arthur_-_N._C._Wyeth_-_cover.jpg?width=900',
  },
  {
    id: 'hound-of-baskervilles',
    title: '巴斯克维尔的猎犬',
    author: '阿瑟·柯南·道尔',
    progress: 12,
    state: 'reading',
    addedAt: '2026-09-05T10:00:00.000Z',
    lastReadAt: '2026-09-08T22:10:00.000Z',
    coverTone: 'ink',
    coverUri: 'https://commons.wikimedia.org/wiki/Special:FilePath/AGJHoundofBaskervilles.jpg?width=900',
  },
  {
    id: 'to-the-lighthouse',
    title: '到灯塔去',
    author: '弗吉尼亚·伍尔夫',
    progress: 0,
    state: 'unread',
    addedAt: '2026-09-11T08:00:00.000Z',
    coverTone: 'sage',
    coverUri: 'https://commons.wikimedia.org/wiki/Special:FilePath/Al_faro._Virginia_Woolf,_1927.jpg?width=900',
  },
  {
    id: 'sunrise',
    title: '日出',
    author: '威廉·布莱克',
    progress: 100,
    state: 'finished',
    addedAt: '2026-08-18T13:00:00.000Z',
    lastReadAt: '2026-09-02T19:20:00.000Z',
    coverTone: 'plum',
    coverUri: 'https://commons.wikimedia.org/wiki/Special:FilePath/Sunrise_by_William_Black_-_Book_Cover_-_John_B._Alden_-_New_York_-_1883_-_Project_Gutenberg_eText17308.jpg?width=900',
  },
  {
    id: 'modern-utopia',
    title: '现代乌托邦',
    author: 'H. G. 威尔斯',
    progress: 64,
    state: 'reading',
    addedAt: '2026-09-03T16:00:00.000Z',
    lastReadAt: '2026-09-06T15:00:00.000Z',
    coverTone: 'ocean',
    coverUri: 'https://commons.wikimedia.org/wiki/Special:FilePath/A_Modern_Utopia_cover.jpg?width=900',
  },
];
