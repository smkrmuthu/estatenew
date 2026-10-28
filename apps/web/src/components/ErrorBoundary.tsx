import { Component, type ReactNode } from "react";

/** Never leave a blank screen: entries are safe in IndexedDB, so reloading is always OK. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-bold">Something went wrong</h1>
        <p className="mt-2">Entries saved on this phone are safe. Reload to continue.</p>
        <button type="button" className="mt-4 min-h-12 rounded-xl bg-roast px-4 font-semibold text-roast-ink" onClick={() => location.reload()}>
          Reload
        </button>
      </main>
    );
  }
}
