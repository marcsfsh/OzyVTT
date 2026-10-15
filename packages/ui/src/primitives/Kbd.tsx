import type { ReactNode } from "react";
import { cx } from "./util";
import "./Kbd.css";

interface KbdProps {
  children: ReactNode;
  className?: string;
}

/** A single keyboard key cap for shortcut hints. Compose several for a chord: <Kbd>⌘</Kbd><Kbd>K</Kbd>. */
export function Kbd({ children, className }: KbdProps) {
  return <kbd className={cx("nh-kbd", className)}>{children}</kbd>;
}
