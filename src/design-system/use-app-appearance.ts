import { useEffect } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import { readerSettingsRepository, subscribeReaderSettings } from '../features/reader/reader-settings-repository';
import type { ReaderSettings } from '../features/reader/reader-settings';

export function useAppAppearance() {
  const scheme = useColorScheme();
  useEffect(() => {
    let active = true;
    let revision = 0;
    const apply = (settings: ReaderSettings) => {
      Appearance.setColorScheme(settings.appearance === 'system' ? 'unspecified' : settings.appearance);
    };
    const unsubscribe = subscribeReaderSettings((settings) => { revision++; if (active) apply(settings); });
    const startedAt = revision;
    void readerSettingsRepository.get().then((settings) => {
      if (active && startedAt === revision) apply(settings);
    }).catch(() => undefined);
    return () => { active = false; unsubscribe(); };
  }, []);
  return scheme;
}
