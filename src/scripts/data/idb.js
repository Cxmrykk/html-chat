/** Minimal IndexedDB key/value driver with cached database connection. */

const DB_NAME = 'HTMLChatDB';
const DB_VERSION = 1;
const STORE_NAME = 'keyval';

let connection = null;

function openDatabase() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onclose = () => {
        connection = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      connection = null;
      reject(request.error);
    };
  });
  return connection;
}

async function withStore(mode, run) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    result = run(store, transaction, (value) => {
      result = value;
    });
  });
}

function boundRange(prefix) {
  return IDBKeyRange.bound(prefix, `${prefix}\uffff`);
}

export async function get(key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function set(key, value) {
  return withStore('readwrite', (store) => {
    store.put(value, key);
  });
}

export async function setMany(entries) {
  if (!entries.length) return undefined;
  return withStore('readwrite', (store) => {
    for (const [key, value] of entries) store.put(value, key);
  });
}

export async function remove(key) {
  return withStore('readwrite', (store) => {
    store.delete(key);
  });
}

export async function removeByPrefix(prefix) {
  return withStore('readwrite', (store) => {
    store.delete(boundRange(prefix));
  });
}

export async function getByPrefix(prefix) {
  const results = [];
  await scanByPrefix(prefix, (value) => {
    results.push(value);
  });
  return results;
}

/**
 * Walk every record under a prefix without materialising them all.
 * Return `false` from `visit` to stop early.
 */
export async function scanByPrefix(prefix, visit) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(STORE_NAME, 'readonly')
      .objectStore(STORE_NAME)
      .openCursor(boundRange(prefix));
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) {
        resolve();
        return;
      }
      if (visit(cursor.value) === false) {
        resolve();
        return;
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}
