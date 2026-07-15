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
    return <main><section className="card" role="alert"><span className="eyebrow">CLIENT ERROR</span><h2>The table could not finish loading.</h2><p>{this.state.error.message}</p><p>Reload once. If this message returns, copy it together with the browser console error.</p><button onClick={() => window.location.reload()}>Reload VTT</button></section></main>;
  }
}
