import { useEffect, useRef, useState } from "react";
import { Tag } from "@vtt/ui";

/**
 * The bar under the top bar while the table can't hear this device (DESIGN.md, Reconnecting): a WAIT tag and what to
 * do. It holds until the table has sent a fresh snapshot, then says "Back at the table" for 2 seconds and goes.
 */
export function ReconnectBar({ current }: Readonly<{ current: boolean }>) {
  const [back, setBack] = useState(false);
  const wasDown = useRef(false);
  useEffect(() => {
    if (!current) {
      wasDown.current = true;
      setBack(false);
      return;
    }
    if (!wasDown.current) return;
    wasDown.current = false;
    setBack(true);
    const timer = window.setTimeout(() => setBack(false), 2000);
    return () => window.clearTimeout(timer);
  }, [current]);
  if (current && !back) return null;
  return (
    <p className={`reconnect-bar${current ? " is-back" : ""}`} role="status">
      {current ? (
        "Back at the table"
      ) : (
        <>
          <Tag tone="wait">Wait</Tag> Reconnecting. Wait before making changes.
        </>
      )}
    </p>
  );
}
