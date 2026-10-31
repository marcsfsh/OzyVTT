import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { useSwitchMoments } from "./phoneSwitch";

// The phone Switch's moments (table spec 2.4): choosing a target turns to Map and back again after, and an owed prompt
// or the start of the player's turn turns to Turn.

function Harness({ choosing, owed, start = "log" }: Readonly<{ choosing: boolean; owed: boolean; start?: string }>) {
  const [tab, setTab] = useState(start);
  useSwitchMoments({ enabled: true, tab, setTab, choosing, turnTo: { when: owed, view: "turn" } });
  return <p>{tab}</p>;
}

describe("the Switch's moments", () => {
  it("turns to Map while a target is chosen, and back to the view it left after", () => {
    const { rerender } = render(<Harness choosing={false} owed={false} />);
    expect(screen.getByText("log")).toBeTruthy();
    rerender(<Harness choosing owed={false} />);
    expect(screen.getByText("map")).toBeTruthy();
    rerender(<Harness choosing={false} owed={false} />);
    expect(screen.getByText("log")).toBeTruthy();
  });

  it("turns to Turn when a prompt is owed or the turn starts", () => {
    const { rerender } = render(<Harness choosing={false} owed={false} start="map" />);
    rerender(<Harness choosing={false} owed />);
    expect(screen.getByText("turn")).toBeTruthy();
  });
});
