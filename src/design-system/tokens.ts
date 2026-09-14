import { PlatformColor } from 'react-native';

export const tokens = {
  spacing: {
    screen: 20,
    section: 24,
    item: 12,
    compact: 8,
  },
  radius: {
    control: 10,
    cover: 6,
  },
  typography: {
    largeTitle: 34,
    body: 17,
    sectionTitle: 22,
    bookTitle: 16,
    metadata: 15,
  },
  animation: {
    layoutDuration: 200,
    pressDuration: 120,
  },
  cover: {
    gridAspectRatio: 0.67,
    listWidth: 58,
    continueWidth: 92,
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
