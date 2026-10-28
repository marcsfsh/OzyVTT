import { useRef, type ReactNode } from "react";
import { usePipLight } from "@vtt/ui";

/**
 * A row of pips or boxes on the sheet (uses, slots, hit dice, exhaustion) that lights as its count moves (ADR-0045):
 * spending one cools it, and a rest relights them in order. Exhaustion rising fills its next box red.
 */
export function PipRow({
  lit,
  className,
  tone = "gold",
  children,
  ...aria
}: Readonly<{
  lit: number;
  className: string;
  tone?: "gold" | "red";
  children: ReactNode;
  role?: string;
  "aria-label"?: string;
  "aria-hidden"?: boolean;
}>) {
  const row = useRef<HTMLSpanElement>(null);
  usePipLight(row, lit, { pip: ":scope > i, :scope > .cs-pip", tone });
  return (
    <span ref={row} className={className} {...aria}>
      {children}
    </span>
  );
}
