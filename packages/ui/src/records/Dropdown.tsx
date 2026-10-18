import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "../primitives/Button";
import { IconChevron } from "../primitives/icons";
import { cx } from "../primitives/util";
import "./Dropdown.css";

/**
 * A button that opens a panel of controls under it and keeps it open while they are used (several checkboxes, two
 * dates), closing on Escape or a press outside. A `Menu` closes on each pick, so it suits one choice; this suits
 * filters set several at a time.
 */
export function Dropdown({
  label,
  icon,
  children,
  className,
  panelClassName,
  align = "start"
}: Readonly<{
  /** The button's words, which say the current setting ("Type: all 13"). */
  label: ReactNode;
  icon?: ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
  panelClassName?: string;
  align?: "start" | "end";
}>) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);
  const close = () => {
    setOpen(false);
    box.current?.querySelector<HTMLElement>(".nh-dropdown-button")?.focus();
  };
  return (
    <div
      ref={box}
      className={cx("nh-dropdown", className)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <Button
        size="sm"
        className={cx("nh-dropdown-button", open && "is-on")}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        {label}
        <IconChevron />
      </Button>
      {open && (
        <div id={id} className={cx("nh-dropdown-panel", `is-${align}`, "anim-popover", panelClassName)}>
          {children(close)}
        </div>
      )}
    </div>
  );
}
