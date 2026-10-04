import { create } from 'zustand';

import type { TransactionDraft } from '@/src/types/finance';

interface DataState {
  revision: number;
  bump: () => void;
}

export const useDataStore = create<DataState>((set) => ({
  revision: 0,
  bump: () => set((state) => ({ revision: state.revision + 1 })),
}));

interface DraftState {
  drafts: TransactionDraft[];
  notice: string | null;
  source: 'local' | 'ai' | null;
  sourceText: string;
  pendingAttachmentUri: string | null;
  setResult: (drafts: TransactionDraft[], notice: string | null, source: 'local' | 'ai', sourceText: string) => void;
  updateDraft: (id: string, patch: Partial<TransactionDraft>) => void;
  removeDraft: (id: string) => void;
  setPendingAttachmentUri: (uri: string | null) => void;
  clear: () => void;
}

export const useDraftStore = create<DraftState>((set) => ({
  drafts: [],
  notice: null,
  source: null,
  sourceText: '',
  pendingAttachmentUri: null,
  setResult: (drafts, notice, source, sourceText) => set({ drafts, notice, source, sourceText }),
  updateDraft: (id, patch) =>
    set((state) => ({
      drafts: state.drafts.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    })),
  removeDraft: (id) => set((state) => ({ drafts: state.drafts.filter((draft) => draft.id !== id) })),
  setPendingAttachmentUri: (uri) => set({ pendingAttachmentUri: uri }),
  clear: () => set({ drafts: [], notice: null, source: null, sourceText: '', pendingAttachmentUri: null }),
}));
