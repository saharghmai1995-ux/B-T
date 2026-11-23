"use client";

/**
 * SubtabErrorBoundary — v3.2 safety cage for the 4 Calibration-Lab subtabs
 * (کالیبراسیون / زمین فوتبال 3D / زمین تنیس 3D / کنسول QQL & AI RCA).
 *
 * Design (mirrors LabErrorBoundary, but subtab-scoped):
 *  - A React CLASS ErrorBoundary (no hooks — boundaries must be classes) that
 *    catches ANY render-time crash inside a subtab so the SuperAgent
 *    dashboard NEVER resets the whole app back to Overview.
 *  - Fallback is a COMPACT "Obsidian Carbon" glass card with Persian text:
 *    «خطا در زیرتب … — موتور اصلی کالیبراسیون دست‌نخورده است» — the main
 *    calibration engine, the header, the channel and the rest of the app are
 *    explicitly declared intact.
 *  - RETRY: «بازنشانی زیرتب» clears the error state. When the boundary renders
 *    its fallback the crashed subtree is unmounted, so clearing the state
 *    remounts the subtab from scratch (fresh hooks/state) — a true retry.
 *  - Console-only telemetry; never throws, never navigates.
 */

import { Component } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface SubtabErrorBoundaryProps {
  /** Persian label of the guarded subtab (shown in the fallback). */
  subtab: string;
  children: React.ReactNode;
}

interface SubtabErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class SubtabErrorBoundary extends Component<
  SubtabErrorBoundaryProps,
  SubtabErrorBoundaryState
> {
  constructor(props: SubtabErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error: unknown): SubtabErrorBoundaryState {
    return {
      hasError: true,
      error:
        error instanceof Error
          ? error
          : new Error(String(error ?? "unknown render crash")),
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    // Console-only telemetry — never throws, never navigates.
    console.error(
      `[SubtabErrorBoundary:${this.props.subtab}] render crash contained:`,
      error,
      "\ncomponent stack:",
      info.componentStack,
    );
  }

  /** Retry = clear the error so React re-mounts the guarded subtab fresh. */
  handleReset(): void {
    this.setState({ hasError: false, error: null });
  }

  render(): React.ReactNode {
    const { hasError, error } = this.state;
    const { subtab, children } = this.props;

    if (hasError) {
      return (
        <div
          className="glass flex flex-col items-center justify-center gap-3 rounded-2xl p-6 text-center"
          data-testid="subtab-error-fallback"
          role="alert"
        >
          <div className="grid size-11 place-items-center rounded-xl border border-red-500/30 bg-red-500/10 shadow-[0_0_20px_-6px_rgba(248,113,113,0.6)]">
            <ShieldAlert className="size-5 text-red-300" aria-hidden />
          </div>
          <div className="text-sm font-bold text-red-200">
            خطا در زیرتب {subtab} — موتور اصلی کالیبراسیون دست‌نخورده است
          </div>
          {error && (
            <code
              dir="ltr"
              className="num max-w-lg overflow-x-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-[#0A0F1C] p-2 text-left text-[10px] leading-5 text-red-300/80"
            >
              {error.message}
            </code>
          )}
          <button
            type="button"
            onClick={this.handleReset}
            className={cn(
              "mt-1 inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15",
              "px-3.5 py-2 text-[11px] font-bold text-emerald-200 transition-all",
              "hover:bg-emerald-500/25 hover:shadow-[0_0_16px_rgba(52,211,153,0.25)] focus-visible:outline-2 focus-visible:outline-emerald-400",
            )}
            aria-label="بازنشانی زیرتب"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            بازنشانی زیرتب
          </button>
        </div>
      );
    }

    // Transparent wrapper — the subtab body layout stays exactly as before.
    return <>{children}</>;
  }
}
