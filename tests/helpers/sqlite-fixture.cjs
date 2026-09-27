const { DatabaseSync } = require('node:sqlite');

function createDatabase(bytes) {
  const native = new DatabaseSync(':memory:');
  if (bytes) native.deserialize(bytes);
  let transactionCount = 0;
  let interruptBeforeTransaction = null;
  const database = {
    native,
    get transactionCount() { return transactionCount; },
    interruptBefore(number) { interruptBeforeTransaction = number; },
    async execAsync(sql) { native.exec(sql); },
    async getFirstAsync(sql, ...params) {
      const values = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      return native.prepare(sql).get(...values) ?? null;
    },
    async getAllAsync(sql, ...params) {
      const values = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      return native.prepare(sql).all(...values);
    },
    async runAsync(sql, ...params) {
      const values = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      return native.prepare(sql).run(...values);
    },
    async withExclusiveTransactionAsync(callback) {
      transactionCount += 1;
      if (transactionCount === interruptBeforeTransaction) throw new Error('simulated interruption');
      native.exec('BEGIN EXCLUSIVE;');
      try {
        const result = await callback(database);
        native.exec('COMMIT;');
        return result;
      } catch (error) {
        native.exec('ROLLBACK;');
        throw error;
      }
    },
    async serializeAsync() { return native.serialize(); },
    async closeAsync() { native.close(); },
  };
  return database;
}

function createSQLiteMock() {
  let live = createDatabase();
  let backupCalls = 0;
  let failNextBackup = false;
  return {
    async openDatabaseAsync() { return live; },
    async deserializeDatabaseAsync(bytes) { return createDatabase(bytes); },
    async backupDatabaseAsync({ sourceDatabase, destDatabase }) {
      backupCalls += 1;
      if (failNextBackup) {
        failNextBackup = false;
        throw new Error('simulated SQLite backup failure');
      }
      destDatabase.native.deserialize(sourceDatabase.native.serialize());
    },
    failBackupOnce() { failNextBackup = true; },
    get live() { return live; },
    get backupCalls() { return backupCalls; },
  };
}

module.exports = { createDatabase, createSQLiteMock };
