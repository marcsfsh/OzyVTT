import type { ReactNode } from "react";

/**
 * A waiting screen on the TV (table screen spec 2.2, ADR-0056): the void with the horizon line across it at 46% of its
 * height, what this is above the line and its detail below it. No sun and no sky, so it stays quiet in a dark room.
 */
export function HorizonScreen({
  eyebrow,
  heading,
  headingId,
  children,
  after
}: Readonly<{
  eyebrow: string;
  heading: string;
  headingId?: string;
  /** The detail under the line. */
  children?: ReactNode;
  /** What stays on the screen beside it (the sound button). */
  after?: ReactNode;
}>) {
  return (
    <main className="viewer-horizon" aria-labelledby={headingId}>
      <div className="viewer-horizon-above">
        <span className="viewer-eyebrow">{eyebrow}</span>
        <h1 id={headingId}>{heading}</h1>
      </div>
      <span className="viewer-horizon-line" aria-hidden="true" />
      <div className="viewer-horizon-below">{children}</div>
      {after}
    </main>
  );
}
