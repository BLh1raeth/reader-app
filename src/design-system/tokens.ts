import { PlatformColor } from 'react-native';

export const tokens = {
  spacing: {
    screen: 20,
    section: 20,
    medium: 16,
    grid: 14,
    gridRow: 22,
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
    coverGrid: { color: '#000000', opacity: 0.15, radius: 8, offsetY: 4 },
    coverContinue: { color: '#000000', opacity: 0.12, radius: 6, offsetY: 3 },
    coverList: { color: '#000000', opacity: 0.1, radius: 4, offsetY: 2 },
  },
  colors: {
    background: PlatformColor('systemBackground'),
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
