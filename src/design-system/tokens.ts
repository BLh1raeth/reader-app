import { PlatformColor } from 'react-native';

export const tokens = {
  spacing: {
    screen: 28,
    section: 20,
    medium: 16,
    grid: 24,
    gridRow: 34,
    listGap: 14,
    item: 12,
    compact: 6,
    listRowVertical: 8,
    coverInset: 10,
  },
  radius: {
    control: 10,
    cover: 3,
  },
  typography: {
    largeTitle: 34,
    body: 17,
    sectionTitle: 20,
    bookTitle: 15,
    metadata: 14,
  },
  animation: {
    layoutDuration: 200,
    pressDuration: 120,
  },
  cover: {
    gridAspectRatio: 0.67,
    listWidth: 52,
    continueWidth: 92,
  },
  shadows: {
    // The broad layer stays narrower than the grid gutter, so it reads as a
    // shadow beneath a book rather than bleeding into its neighbour.
    coverGrid: { color: '#000000', opacity: 0.29, radius: 11, offsetY: 11 },
    coverGridTight: { color: '#000000', opacity: 0.3, radius: 4, offsetY: 1 },
    coverContinue: { color: '#000000', opacity: 0.24, radius: 9, offsetY: 8 },
    coverContinueTight: { color: '#000000', opacity: 0.24, radius: 3, offsetY: 1 },
    coverList: { color: '#000000', opacity: 0.18, radius: 7, offsetY: 5 },
    coverListTight: { color: '#000000', opacity: 0.2, radius: 2, offsetY: 1 },
  },
  colors: {
    background: '#F3F2F8',
    label: PlatformColor('label'),
    secondaryLabel: PlatformColor('secondaryLabel'),
    tertiaryLabel: PlatformColor('tertiaryLabel'),
    separator: PlatformColor('separator'),
    fill: PlatformColor('tertiarySystemFill'),
    blue: PlatformColor('systemBlue'),
    destructive: PlatformColor('systemRed'),
  },
  coverTones: {
    paper: '#F4F0E7',
    coral: '#C86255',
    mist: '#CAD0D2',
    ink: '#34404B',
    sage: '#82947E',
    plum: '#76556F',
    ocean: '#3D7282',
  },
} as const;
