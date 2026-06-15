/* ════════════════════════════════════════════════════
   PortfolioDB — shared IndexedDB storage wrapper
   Provides large storage (hundreds of MB+) for the
   portfolio site, with automatic fallback to localStorage
   and one-time migration of existing localStorage data.
   ════════════════════════════════════════════════════ */
const PortfolioDB = (function () {
  const DB_NAME = 'portfolio_studio_db';
  const STORE = 'kv';
  const VERSION = 1;
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB not supported')); return; }
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return dbPromise;
  }

  async function getItem(key) {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      // Fallback for browsers without IndexedDB (e.g. some private modes)
      return localStorage.getItem(key);
    }
  }

  async function setItem(key, value) {
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const req = store.put(value, key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
      return true;
    } catch (e) {
      // Fallback — may throw QuotaExceededError on very large values
      localStorage.setItem(key, value);
      return true;
    }
  }

  async function removeItem(key) {
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const req = store.delete(key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      localStorage.removeItem(key);
    }
  }

  // One-time migration: copy any existing localStorage values for the
  // given keys into IndexedDB, but only if IndexedDB doesn't already
  // have a value for that key (so it never overwrites newer data).
  async function migrateFromLocalStorage(keys) {
    for (const key of keys) {
      try {
        const existing = await getItem(key);
        if (existing === null) {
          const old = localStorage.getItem(key);
          if (old !== null) {
            await setItem(key, old);
          }
        }
      } catch (e) { /* ignore individual key failures */ }
    }
  }

  return { getItem, setItem, removeItem, migrateFromLocalStorage };
})();
