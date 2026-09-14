import { create } from 'zustand';
import { openDB } from 'idb';
import { ScoredOnion } from '@/lib/ai/pipeline'; 

const DB_NAME = 'onionvision-db';
const STORE_NAME = 'batches';

async function initDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    },
  });
}

export interface ProcessedImage {
  id: string;
  imageUrl: string;
  onions: ScoredOnion[];
}

interface BatchState {
  currentBatch: ProcessedImage[];
  addProcessedImage: (img: ProcessedImage) => void;
  clearCurrentBatch: () => void;
  finishBatch: () => Promise<void>;
  syncOfflineBatches: () => Promise<void>;
}

export const useBatchStore = create<BatchState>((set, get) => ({
  currentBatch: [],
  
  addProcessedImage: (img) => set((state) => ({ 
    currentBatch: [...state.currentBatch, img] 
  })),
  
  clearCurrentBatch: () => set({ currentBatch: [] }),
  
  finishBatch: async () => {
    const { currentBatch, clearCurrentBatch, syncOfflineBatches } = get();
    if (currentBatch.length === 0) return;

    let gradeA = 0, gradeURS = 0, rejected = 0, totalItems = 0;
    
    currentBatch.forEach(img => {
      img.onions.forEach(o => {
        totalItems++;
        if (o.grading?.grade === 'Grade A') gradeA++;
        else if (o.grading?.grade === 'Grade URS') gradeURS++;
        else if (o.grading?.grade === 'Reject') rejected++;
      });
    });

    // Strip non-serializable canvases before saving to IndexedDB
    const serializableImages = currentBatch.map(img => ({
      ...img,
      onions: img.onions.map(o => {
        const { cropCanvas, ...serializableData } = o;
        return serializableData;
      })
    }));

    const batchRecord = {
      id: `batch_${Date.now()}`,
      timestamp: Date.now(),
      totalItems,
      gradeA,
      gradeURS,
      rejected,
      images: serializableImages,
      synced: false
    };

    const db = await initDB();
    await db.put(STORE_NAME, batchRecord);
    clearCurrentBatch();
    syncOfflineBatches();
  },

  syncOfflineBatches: async () => {
    if (!navigator.onLine) return;
    const db = await initDB();
    const allBatches = await db.getAll(STORE_NAME);
    const unsynced = allBatches.filter(b => !b.synced);

    for (const batch of unsynced) {
      try {
        console.log(`[Sync] Batch ${batch.id} synced to backend.`);
        batch.synced = true;
        await db.put(STORE_NAME, batch);
      } catch (err) {
        console.error(`[Sync] Failed to sync batch ${batch.id}`, err);
      }
    }
  }
}));

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    useBatchStore.getState().syncOfflineBatches();
  });
}