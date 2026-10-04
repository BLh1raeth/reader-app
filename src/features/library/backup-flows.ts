import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { File } from 'expo-file-system';
import { Alert } from 'react-native';

import { uiText } from '../../localization';
import { BackupImportError, exportBackup, importBackup } from './backup-service';

function importErrorMessage(error: unknown): string {
  if (error instanceof BackupImportError) {
    switch (error.code) {
      case 'not-a-reader-backup':
        return uiText.library.backupErrorNotAReaderBackup;
      case 'unsupported-backup':
        return uiText.library.backupErrorUnsupportedBackup;
      case 'missing-database':
        return uiText.library.backupErrorMissingDatabase;
      case 'not-a-database':
        return uiText.library.backupErrorNotADatabase;
      case 'backup-from-newer-app':
        return uiText.library.backupErrorBackupFromNewerApp;
      case 'incomplete-backup':
        return uiText.library.backupErrorIncomplete;
    }
  }
  return uiText.library.backupErrorGeneric;
}

/** Pack the library into a zip and open the system share sheet. */
export async function exportBackupFlow(onProgress?: (fraction: number | null) => void): Promise<void> {
  let uri: string | null = null;
  try {
    onProgress?.(0);
    const backup = await exportBackup(new Date(), { onProgress });
    uri = backup.uri;
    const { fileName } = backup;
    await Sharing.shareAsync(uri, { dialogTitle: fileName });
    Alert.alert(uiText.library.backupSheetTitle, uiText.library.exportBackupDone(fileName));
  } catch (error) {
    Alert.alert(uiText.library.backupSheetTitle, error instanceof Error ? error.message : uiText.library.backupErrorGeneric);
  } finally {
    onProgress?.(null);
    try { if (uri) new File(uri).delete(); } catch { /* Temporary share copy only. */ }
  }
}

/**
 * Confirm (destructive) -> pick a zip -> import, replacing all library data.
 * Reload immediately after commit, before further library actions.
 */
export function importBackupFlow(onImported: () => void, onBusy?: (busy: boolean) => void): void {
  Alert.alert(
    uiText.library.importBackupConfirmTitle,
    uiText.library.importBackupConfirmMessage,
    [
      { text: uiText.library.cancel, style: 'cancel' },
      {
        text: uiText.library.importBackupConfirm,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              const result = await DocumentPicker.getDocumentAsync({
                type: 'application/zip',
                copyToCacheDirectory: true,
              });
              if (result.canceled || !('assets' in result) || result.assets.length === 0) return;
              onBusy?.(true);
              const { bookCount } = await importBackup(result.assets[0].uri);
              onImported();
              Alert.alert(
                uiText.library.backupSheetTitle,
                uiText.library.importBackupDone(bookCount),
                [{ text: uiText.library.ok }],
              );
            } catch (error) {
              Alert.alert(uiText.library.backupSheetTitle, importErrorMessage(error));
            } finally {
              onBusy?.(false);
            }
          })();
        },
      },
    ],
  );
}
