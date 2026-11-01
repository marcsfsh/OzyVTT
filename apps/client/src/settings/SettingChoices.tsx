import type { ComponentProps } from "react";
import { SegmentedControl, cx } from "@vtt/ui";
import { useMediaQuery } from "../lib/useMediaQuery";

/** Past this many letters the choices don't fit one line of a phone. */
const ONE_LINE = 24;

/**
 * A setting's few short choices as Base line options (settings rule 3.6). On a phone, choices too long for one line
 * stand as a list instead, one under the other at full width (settings spec 2.2).
 */
export function SettingChoices(props: ComponentProps<typeof SegmentedControl>) {
  const phone = useMediaQuery("(max-width: 760px)");
  const letters = props.options.reduce(
    (count, option) =>
      count + (typeof option.label === "string" ? option.label.length : (option.ariaLabel?.length ?? 0)),
    0
  );
  return <SegmentedControl {...props} className={cx(props.className, phone && letters > ONE_LINE && "is-choices")} />;
}
