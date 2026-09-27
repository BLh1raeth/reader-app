import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
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
export async function exportBackupFlow(): Promise<void> {
  try {
    const { uri, fileName } = await exportBackup();
    await Sharing.shareAsync(uri, { dialogTitle: fileName });
    Alert.alert(uiText.library.backupSheetTitle, uiText.library.exportBackupDone(fileName));
  } catch {
    Alert.alert(uiText.library.backupSheetTitle, uiText.library.backupErrorGeneric);
  }
}

/**
 * Confirm (destructive) -> pick a zip -> import, replacing all library data.
 * onImported fires after the user acknowledges success, so the caller can
 * reload from the new database.
 */
export function importBackupFlow(onImported: () => void): void {
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
            const result = await DocumentPicker.getDocumentAsync({
              type: 'application/zip',
              copyToCacheDirectory: true,
            });
            if (result.canceled || !('assets' in result) || result.assets.length === 0) return;
            try {
              const { bookCount } = await importBackup(result.assets[0].uri);
              Alert.alert(
                uiText.library.backupSheetTitle,
                uiText.library.importBackupDone(bookCount),
                [{ text: uiText.library.ok, onPress: onImported }],
              );
            } catch (error) {
              Alert.alert(uiText.library.backupSheetTitle, importErrorMessage(error));
            }
          })();
        },
      },
    ],
  );
}
