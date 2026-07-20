import { Fragment, type ReactNode } from "react";

/**
 * Renders the small markdown subset the SRD reference text uses - **bold**, newlines, and "- "/"* "
 * bullets - as inline-safe JSX (only <strong>, <br>, and text), so it drops straight into the
 * existing <p> entries. Display only: it never executes or trusts the content, it just formats the
 * bundled reference prose that would otherwise show raw "**At Will:**" markers.
 */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => {
    const bold = /^\*\*([\s\S]+)\*\*$/.exec(part);
    return bold ? <strong key={index}>{bold[1]}</strong> : <Fragment key={index}>{part}</Fragment>;
  });
}

export function RichText({ text }: Readonly<{ text: string }>) {
  // Normalize em-dashes to " - " at render so bundled SRD prose never shows one in the UI, without
  // mutating the licensed content in storage (house style: no em-dashes anywhere on screen).
  const lines = text.replace(/\s*—\s*/g, " - ").split("\n").map((line) => line.trim()).filter(Boolean);
  return <>{lines.map((line, index) => {
    const bullet = line.startsWith("- ") || line.startsWith("* ");
    return <Fragment key={index}>
      {index > 0 && <br />}
      {bullet ? <>• {inline(line.slice(2))}</> : inline(line)}
    </Fragment>;
  })}</>;
}
