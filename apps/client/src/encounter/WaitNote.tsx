import { useRef, type ReactNode } from "react";
import { canMove, comet, fadeIn, fill, Tag, useOnChange } from "@vtt/ui";

/**
 * Something waiting on a person (ADR-0045, rule 6): WAIT on a grey, unlit line, and nothing moves. When it is
 * settled, light runs along the line, the line lights and WAIT turns to DONE.
 */
export function WaitNote({
  waiting,
  children,
  done
}: Readonly<{ waiting: boolean; children: ReactNode; done: ReactNode }>) {
  const note = useRef<HTMLParagraphElement>(null);
  useOnChange(waiting, (was, now) => {
    const el = note.current;
    const line = el?.querySelector<HTMLElement>(".wait-note-line");
    if (!was || now || !el || !line || !canMove()) return;
    comet(el, { from: 0, to: el.clientWidth, line: 1, thick: 3, delay: 40, dur: 260 });
    fill(line, { origin: "0%", delay: 60, dur: 260 });
    const tag = el.querySelector(".nh-tag");
    if (tag) fadeIn(tag, { delay: 200, dur: 140 });
  });
  return (
    <p ref={note} className={`wait-note action-save-note${waiting ? " is-waiting" : " is-done"}`}>
      <span className="wait-note-line" aria-hidden="true" />
      <Tag tone={waiting ? "wait" : "done"} size="sm">
        {waiting ? "Wait" : "Done"}
      </Tag>{" "}
      {waiting ? children : done}
    </p>
  );
}
