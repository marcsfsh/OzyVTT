import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("The VTT client encountered an unrecoverable error.", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main><section className="card" role="alert"><span className="eyebrow">SOMETHING BROKE</span><h2>The table couldn't finish loading.</h2><p>{this.state.error.message}</p><p>Reload the page. If this keeps happening, copy this message and the browser console error.</p><button onClick={() => window.location.reload()}>Reload</button></section></main>;
  }
}
