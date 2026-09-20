export type SavedSticker = {
  id: string;
  image: string;
  aspectRatio: number;
  name: string;
  created: number;
};

export type SavedJournal = {
  id: string;
  image: string;
  created: number;
  stickerCount: number;
  tapeCount: number;
};

async function artifactDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('grounding-artifacts', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('stickers')) {
        request.result.createObjectStore('stickers', { keyPath:'id' });
      }
      if (!request.result.objectStoreNames.contains('journals')) {
        request.result.createObjectStore('journals', { keyPath:'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSticker(sticker: SavedSticker) {
  const db = await artifactDatabase();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('stickers', 'readwrite');
    tx.objectStore('stickers').put(sticker);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}

export async function loadStickers(): Promise<SavedSticker[]> {
  const db = await artifactDatabase();
  try { return await new Promise<SavedSticker[]>((resolve, reject) => {
    const request = db.transaction('stickers').objectStore('stickers').getAll();
    request.onsuccess = () => resolve(request.result.sort((a: SavedSticker, b: SavedSticker) => b.created-a.created));
    request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}

export async function deleteSticker(id: string) {
  const db = await artifactDatabase();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('stickers', 'readwrite');
    tx.objectStore('stickers').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}

export async function saveJournal(journal: SavedJournal) {
  const db = await artifactDatabase();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('journals', 'readwrite');
    tx.objectStore('journals').put(journal);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}

export async function loadJournals(): Promise<SavedJournal[]> {
  const db = await artifactDatabase();
  try { return await new Promise<SavedJournal[]>((resolve, reject) => {
    const request = db.transaction('journals').objectStore('journals').getAll();
    request.onsuccess = () => resolve(request.result.sort((a: SavedJournal, b: SavedJournal) => b.created-a.created));
    request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}

export async function deleteJournal(id: string) {
  const db = await artifactDatabase();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('journals', 'readwrite');
    tx.objectStore('journals').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
