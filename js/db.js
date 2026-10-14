/* Stopbath — catalog persistence (IndexedDB). */
(function () {
  'use strict';
  const LR = (window.LR = window.LR || {});
  const NAME = 'weblightroom-catalog';
  const VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('thumbs')) db.createObjectStore('thumbs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  function wrap(req) {
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  async function store(name, mode) {
    const db = await open();
    return db.transaction(name, mode || 'readonly').objectStore(name);
  }

  const DB = {
    async all(name) { return wrap((await store(name)).getAll()); },
    async get(name, key) { return wrap((await store(name)).get(key)); },
    async put(name, value) { return wrap((await store(name, 'readwrite')).put(value)); },
    async del(name, key) { return wrap((await store(name, 'readwrite')).delete(key)); },
    async getKV(key, fallback) {
      const r = await DB.get('kv', key);
      return r ? r.value : fallback;
    },
    async setKV(key, value) { return DB.put('kv', { key, value }); },
  };

  // debounced photo saving
  const pending = new Map();
  let timer = null;
  DB.savePhoto = function (photo) {
    pending.set(photo.id, photo);
    clearTimeout(timer);
    timer = setTimeout(DB.flush, 400);
  };
  DB.flush = async function () {
    const items = [...pending.values()];
    pending.clear();
    if (!items.length) return;
    const db = await open();
    const tx = db.transaction('photos', 'readwrite');
    const st = tx.objectStore('photos');
    for (const p of items) st.put(p);
    return new Promise((res) => { tx.oncomplete = res; tx.onerror = res; });
  };
  window.addEventListener('beforeunload', () => { DB.flush(); });

  LR.DB = DB;
})();
