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
  const OPEN_TIMEOUT_MS = 1200;
  let dbPromise = null;
  let idbBroken = false; // set true if IndexedDB proves unusable (e.g. file:// origin)

  function openDB() {
    if (idbBroken) return Promise.reject(new Error('IndexedDB unavailable'));
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB not supported')); return; }

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        idbBroken = true; // don't keep retrying a browser/origin that can't open it
        reject(new Error('IndexedDB open() timed out (likely unsupported on this origin)'));
      }, OPEN_TIMEOUT_MS);

      let req;
      try {
        req = indexedDB.open(DB_NAME, VERSION);
      } catch (e) {
        clearTimeout(timer);
        settled = true;
        idbBroken = true;
        reject(e);
        return;
      }

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = (e) => {
        if (settled) { try { e.target.result.close(); } catch(_){} return; }
        settled = true; clearTimeout(timer);
        resolve(e.target.result);
      };
      req.onerror = (e) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        idbBroken = true;
        reject(e.target.error || new Error('IndexedDB open() failed'));
      };
      req.onblocked = () => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        idbBroken = true;
        reject(new Error('IndexedDB open() blocked'));
      };
    });
    return dbPromise;
  }

  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error((label||'operation') + ' timed out')), ms);
      promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }

  async function getItem(key) {
    try {
      const db = await openDB();
      return await withTimeout(new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
        req.onerror = () => reject(req.error);
      }), 1500, 'getItem');
    } catch (e) {
      // Fallback for browsers without IndexedDB (e.g. some private modes, file:// origins)
      return localStorage.getItem(key);
    }
  }

  async function setItem(key, value) {
    try {
      const db = await openDB();
      await withTimeout(new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const req = store.put(value, key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      }), 3000, 'setItem');
      return true;
    } catch (e) {
      // Fallback — may throw QuotaExceededError on very large values
      try { localStorage.setItem(key, value); return true; }
      catch (e2) { throw e2; }
    }
  }

  async function removeItem(key) {
    try {
      const db = await openDB();
      await withTimeout(new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const req = store.delete(key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      }), 1500, 'removeItem');
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
