import { Component, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ErrorBoundaryProps {
  /** One sentence, shown instead of the part that failed. */
  message: string;
  children: ReactNode;
  /** One line, for a spot in the bottom bar. */
  compact?: boolean;
  /** When this changes (another channel, another view), the part is drawn again. */
  resetKey?: string | null;
  /** Default: draw the part again. */
  onRetry?: () => void;
  retryLabel?: string;
  onClear?: () => void;
  clearLabel?: string;
}

const buttonClass =
  "border border-border bg-background px-2 py-1 text-xs font-medium text-foreground outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Keeps one failed part from blanking the whole window. The fallback is plain text and buttons on purpose: it reads
 * no app state while drawing, so whatever broke the part can't break the fallback too.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: Pick<ErrorBoundaryProps, "resetKey">) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { message, compact, onRetry, retryLabel, onClear, clearLabel } = this.props;
    return (
      <div
        role="alert"
        data-testid="error-fallback"
        className={cn(
          "flex min-w-0 items-center justify-center gap-2 bg-background text-center text-muted-foreground",
          compact ? "min-h-8 flex-1 text-xs" : "h-full w-full flex-1 flex-col p-4 text-sm",
        )}
      >
        <p className="min-w-0">{message}</p>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" className={buttonClass} onClick={onRetry ?? (() => this.setState({ failed: false }))}>
            {retryLabel ?? "Try again"}
          </button>
          {onClear && clearLabel ? (
            <button type="button" className={buttonClass} onClick={onClear}>
              {clearLabel}
            </button>
          ) : null}
        </div>
      </div>
    );
  }
}
