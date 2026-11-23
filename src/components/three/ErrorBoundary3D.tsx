"use client";

/**
 * ErrorBoundary3D — v3.1 safety net for every WebGL / React-Three-Fiber mount.
 *
 * A 3D canvas is the only part of the dashboard that can hard-fail at runtime
 * (missing WebGL context, GPU driver quirk, shader crash on an exotic browser).
 * This class boundary guarantees the page NEVER goes down with it: any render
 * error inside the subtree is caught and swapped for a graceful neon glass
 * fallback card (Obsidian Carbon, violet accent) that explains the situation
 * in Persian and offers a one-click retry — the rest of the dashboard keeps
 * working untouched.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundary3DProps {
  children: ReactNode;
  /** Optional context label rendered inside the fallback (defaults to the hero). */
  label?: string;
}

interface ErrorBoundary3DState {
  hasError: boolean;
  message: string | null;
}

export class ErrorBoundary3D extends Component<ErrorBoundary3DProps, ErrorBoundary3DState> {
  state: ErrorBoundary3DState = { hasError: false, message: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundary3DState {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Console-only telemetry — never thrown, never crashes the parent tree.
    console.error("[ErrorBoundary3D] 3D render failed:", error, info.componentStack);
  }

  private reset = () => this.setState({ hasError: false, message: null });

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="status"
        aria-live="polite"
        className="relative flex min-h-[260px] w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-violet-500/25 bg-[#050810] p-6 text-center md:min-h-[340px]"
      >
        {/* soft violet halo — keeps the Obsidian Carbon neon identity */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.14),transparent_65%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#050810] to-transparent" />

        <div className="relative flex size-12 items-center justify-center rounded-2xl border border-violet-400/40 bg-violet-500/10 shadow-[0_0_22px_rgba(139,92,246,0.35)]">
          <span className="pulse-dot size-2 rounded-full bg-violet-400 text-violet-400" />
        </div>

        <p className="relative text-sm font-bold text-violet-200">
          رندر سه‌بعدی موقتاً غیرفعال است
        </p>
        <p className="relative max-w-sm text-[11px] leading-5 text-muted-foreground">
          موتور گرافیک WebGL در این مرورگر در دسترس نیست؛ باقی داشبورد بدون وقفه
          کار می‌کند
          {this.props.label ? ` — ${this.props.label}` : "."}
        </p>

        {this.state.message && (
          <p className="num relative max-w-full truncate text-[10px] text-slate-600" dir="ltr" title={this.state.message}>
            {this.state.message}
          </p>
        )}

        <button
          type="button"
          onClick={this.reset}
          className="relative rounded-lg border border-violet-400/40 bg-violet-500/10 px-3 py-1.5 text-[11px] font-semibold text-violet-300 transition-colors hover:bg-violet-500/20 hover:text-violet-200"
        >
          تلاش دوباره
        </button>
      </div>
    );
  }
}

export default ErrorBoundary3D;
