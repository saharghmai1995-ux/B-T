"use client";

/**
 * LabErrorBoundary — v3.1 safety cage for every CSS-3D lab module.
 *
 * Design:
 *  - A React class ErrorBoundary that catches ANY render-time crash inside
 *    <Pitch3D> / <Court3D> so the SuperAgent dashboard NEVER resets the page.
 *  - Fallback is a graceful "Obsidian Carbon" glass panel with Persian text:
 *    «بازگشت به حالت امن» + the raw error message (dir=ltr mono, for diagnosis).
 *  - RETRY: the button bumps an internal `attempt` counter that becomes the
 *    React `key` of the wrapper → React unmounts the crashed subtree and
 *    remounts the child from scratch (fresh hooks/state/animation timelines).
 *  - The wrapper renders `display: contents` so the parent grid layout of the
 *    tab body is untouched by the cage itself.
 */

import { Component } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface LabErrorBoundaryProps {
  /** Human label of the guarded module (shown in the fallback). */
  label: string;
  /** testid suffix so orchestrator checks can target the cage. */
  testId?: string;
  children: React.ReactNode;
}

interface LabErrorBoundaryState {
  hasError: boolean;
  message: string | null;
  attempt: number;
}

export class LabErrorBoundary extends Component<
  LabErrorBoundaryProps,
  LabErrorBoundaryState
> {
  constructor(props: LabErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: null, attempt: 0 };
    this.handleRetry = this.handleRetry.bind(this);
  }

  static getDerivedStateFromError(error: unknown): LabErrorBoundaryState {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown render crash");
    // attempt is inherited implicitly by not returning it → keep prior attempt
    return { hasError: true, message, attempt: 0 };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    // Console-only telemetry — never throws, never navigates.
    console.error(
      `[LabErrorBoundary:${this.props.label}] render crash contained:`,
      error,
      "\ncomponent stack:",
      info.componentStack,
    );
  }

  /** Retry = remount the guarded child from zero via a fresh React key. */
  handleRetry(): void {
    this.setState((s) => ({ hasError: false, message: null, attempt: s.attempt + 1 }));
  }

  render(): React.ReactNode {
    const { hasError, message, attempt } = this.state;
    const { label, children } = this.props;

    if (hasError) {
      return (
        <div
          className="glass flex flex-col items-center justify-center gap-3 rounded-2xl p-8 text-center"
          data-testid={this.props.testId ?? "lab-error-fallback"}
          role="alert"
        >
          <div className="grid size-14 place-items-center rounded-2xl border border-red-500/30 bg-red-500/10 shadow-[0_0_24px_-6px_rgba(248,113,113,0.6)]">
            <ShieldAlert className="size-7 text-red-300" aria-hidden />
          </div>
          <div className="text-sm font-bold text-red-200">حالت امن فعال شد — {label}</div>
          <p className="max-w-md text-[11px] leading-6 text-slate-300">
            رندر ماژول سه‌بعدی با خطا متوقف شد؛ داشبورد اصلی کانال سالم است و هیچ داده‌ای از دست
            نرفته. می‌توانید ماژول را از نو بارگذاری کنید.
          </p>
          {message && (
            <code
              dir="ltr"
              className="num max-w-lg overflow-x-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-[#0A0F1C] p-2.5 text-left text-[10px] leading-5 text-red-300/80"
            >
              {message}
            </code>
          )}
          <button
            type="button"
            onClick={this.handleRetry}
            className={cn(
              "mt-1 inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15",
              "px-4 py-2.5 text-xs font-bold text-emerald-200 transition-all",
              "hover:bg-emerald-500/25 hover:shadow-[0_0_18px_rgba(52,211,153,0.25)] focus-visible:outline-2 focus-visible:outline-emerald-400",
            )}
            aria-label="بارگذاری مجدد ماژول"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            بازگشت به حالت امن
          </button>
        </div>
      );
    }

    // Key-bump wrapper: changing `attempt` remounts the whole subtree.
    // `display: contents` keeps the parent grid/flex layout transparent.
    return (
      <div key={attempt} style={{ display: "contents" }} data-lab-cage={label}>
        {children}
      </div>
    );
  }
}
