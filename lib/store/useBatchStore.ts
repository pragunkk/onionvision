import { create } from 'zustand';
import { openDB } from 'idb';
import { ScoredOnion } from '@/lib/ai/pipeline'; // Adjust import if ScoredOnion is defined elsewhere

// 1. Setup IndexedDB for Offline-First Storage
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

export interface BatchRecord {
  id: string;
  timestamp: number;
  totalItems: number;
  gradeA: number;
  gradeURS: number;
  rejected: number;
  onions: ScoredOnion[];
  synced: boolean;
}

interface BatchState {
  currentBatch: ScoredOnion[];
  addOnions: (onions: ScoredOnion[]) => void;
  clearCurrentBatch: () => void;
  finishBatch: () => Promise<void>;
  syncOfflineBatches: () => Promise<void>;
}

export const useBatchStore = create<BatchState>((set, get) => ({
  currentBatch: [],
  
  addOnions: (onions) => set((state) => ({ 
    currentBatch: [...state.currentBatch, ...onions] 
  })),
  
  clearCurrentBatch: () => set({ currentBatch: [] }),
  
  finishBatch: async () => {
    const { currentBatch, clearCurrentBatch } = get();
    if (currentBatch.length === 0) return;

    let gradeA = 0, gradeURS = 0, rejected = 0;
    currentBatch.forEach(o => {
      if (o.grading?.grade === 'Grade A') gradeA++;
      else if (o.grading?.grade === 'Grade URS') gradeURS++;
      else if (o.grading?.grade === 'Reject') rejected++;
    });

    // Strip the HTMLCanvasElement before saving to IndexedDB
    const serializableOnions = currentBatch.map((onion) => {
      const { cropCanvas, ...serializableData } = onion;
      return serializableData;
    });

    const batchRecord = {
      id: `batch_${Date.now()}`,
      timestamp: Date.now(),
      totalItems: currentBatch.length,
      gradeA,
      gradeURS,
      rejected,
      onions: serializableOnions, // Clean data
      synced: false
    };

    // Save to IndexedDB
    const db = await initDB();
    await db.put(STORE_NAME, batchRecord);
    
    // Clear the active session
    clearCurrentBatch();
    
    // Attempt immediate sync
    get().syncOfflineBatches();
  },

  syncOfflineBatches: async () => {
    if (!navigator.onLine) return;
    
    const db = await initDB();
    const allBatches = await db.getAll(STORE_NAME);
    const unsynced = allBatches.filter(b => !b.synced);

    for (const batch of unsynced) {
      try {
        // REPLACE WITH ACTUAL SUPABASE LOGIC
        // await supabase.from('batches').insert([batch]);
        console.log(`[Sync] Batch ${batch.id} synced to Supabase.`);
        
        batch.synced = true;
        await db.put(STORE_NAME, batch);
      } catch (err) {
        console.error(`[Sync] Failed to sync batch ${batch.id}`, err);
      }
    }
  }
}));

// Listen for online events to trigger background sync
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    useBatchStore.getState().syncOfflineBatches();
  });
}