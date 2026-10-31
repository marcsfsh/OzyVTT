import { Component, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { Button, Eyebrow } from "@vtt/ui";
import { LandingScene } from "../shell/LandingScene";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("The VTT client encountered an unrecoverable error.", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <SomethingBroke message={this.state.error.message} />;
  }
}

/**
 * Something broke (frame rule 3.8): the arrival's sunset with one card, the eyebrow, the title, the error in a box
 * with Copy, and Reload as the primary. Nothing else on screen, since nothing else can be trusted to draw.
 */
export function SomethingBroke({ message }: Readonly<{ message: string }>) {
  const box = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  // The clipboard write stays inside the click, which is what lets a browser allow it. Where it is refused or
  // missing, the text is selected so the person can copy it themselves.
  const copy = () => {
    const selectText = () => {
      const node = box.current;
      const selection = window.getSelection();
      if (!node || !selection) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
    };
    if (!navigator.clipboard?.writeText) {
      selectText();
      return;
    }
    navigator.clipboard.writeText(message).then(
      () => setCopied(true),
      () => selectText()
    );
  };
  return (
    <main className="landing broke">
      <LandingScene />
      <section className="broke-card" role="alert">
        <Eyebrow>Something broke</Eyebrow>
        <h1 className="broke-title">The table couldn't finish loading.</h1>
        <div className="broke-message">
          <pre ref={box} className="broke-message-text scroll-y">
            {message}
          </pre>
          <Button size="sm" variant="ghost" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="broke-hint">
          Reload the page. If this keeps happening, copy this message and the browser console's error.
        </p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </section>
    </main>
  );
}
