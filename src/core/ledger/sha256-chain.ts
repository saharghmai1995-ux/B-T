/**
 * SHA-256 Pre-Match Lock — deterministic signal sealing & verification.
 * The hash is computed from a canonical (sorted-key) JSON snapshot of the
 * signal BEFORE the match starts; verification recomputes it byte-for-byte.
 */

import { createHash } from "crypto";

/** Canonical JSON: sorted keys, no insignificant whitespace. */
export function canonicalJson(obj: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const rec = v as Record<string, unknown>;
      return Object.keys(rec).sort().reduce((acc, k) => {
        acc[k] = walk(rec[k]);
        return acc;
      }, {} as Record<string, unknown>);
    }
    return v;
  };
  return JSON.stringify(walk(obj));
}

export function sha256Hex(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

export interface LockPayload {
  matchInfo: string;
  sport: string;
  line: string;
  marketKey: string;
  selection: string;
  price: number;
  modelProb: number;
  evPct: number;
  stake: number;
  issuedAt: string;
}

/** Lock a signal — returns the pre-match SHA-256 hex digest. */
export function lockSignal(p: LockPayload): string {
  return sha256Hex(canonicalJson(p));
}

/** Verify an existing signal against its locked hash. */
export function verifySignal(payload: LockPayload, hash: string): boolean {
  const recomputed = lockSignal(payload);
  return recomputed.toLowerCase() === hash.toLowerCase();
}

/** Chain link: hash of a node includes the previous node's hash. */
export function chainHash(prevHash: string, node: LockPayload): string {
  return sha256Hex(canonicalJson({ prevHash, node }));
}

/** Truncate a hash for UI chips. */
export function shortHash(hash: string, n: number = 10): string {
  return hash.slice(0, n).toUpperCase();
}
