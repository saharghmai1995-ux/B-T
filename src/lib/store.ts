"use client";

/**
 * Client store — UI state only. Zero financial math happens here:
 * the store holds server-computed values and user selections.
 * v2.0: the paywall tier is GONE — this web-app is VIP-only (owner + members).
 */

import { create } from "zustand";

export type ViewKey = "overview" | "signals" | "lab" | "ledger" | "telegram" | "vault";
// v3.3 — "basketball" (NBA) joins the global sport filter.
export type SportFilter = "all" | "football" | "tennis" | "basketball";

export interface BetslipItem {
  signalId: string;
  matchInfo: string;
  league: string;
  sport: string;
  marketKey: string;
  marketLabel: string;
  selection: string;
  price: number;
  modelProb: number;
  evPct: number;
  stake: number;
  stakeMode: string;
  shaHash: string;
}

interface AppState {
  view: ViewKey;
  sportFilter: SportFilter;
  betslipOpen: boolean;
  betslip: BetslipItem[];
  searchQuery: string;
  syncing: boolean;
  setView: (v: ViewKey) => void;
  setSportFilter: (f: SportFilter) => void;
  setBetslipOpen: (open: boolean) => void;
  setSearchQuery: (q: string) => void;
  setSyncing: (s: boolean) => void;
  addToBetslip: (item: BetslipItem) => void;
  removeFromBetslip: (signalId: string) => void;
  clearBetslip: () => void;
  convertToAcca: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: "overview",
  sportFilter: "all",
  betslipOpen: false,
  betslip: [],
  searchQuery: "",
  syncing: false,
  setView: (v) => set({ view: v }),
  setSportFilter: (f) => set({ sportFilter: f }),
  setBetslipOpen: (open) => set({ betslipOpen: open }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSyncing: (s) => set({ syncing: s }),
  addToBetslip: (item) =>
    set((st) =>
      st.betslip.some((b) => b.signalId === item.signalId)
        ? st
        : { betslip: [...st.betslip, item], betslipOpen: true },
    ),
  removeFromBetslip: (signalId) =>
    set((st) => ({ betslip: st.betslip.filter((b) => b.signalId !== signalId) })),
  clearBetslip: () => set({ betslip: [] }),
  convertToAcca: () => set((st) => ({ betslipOpen: true })),
}));
