import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FindField, Kind, ListToolbar } from "./ListToolbar";

// A list's toolbar (theme rule 17), a find field (rule 18) and a kind (rule 19).

describe("a list's toolbar", () => {
  it("counts in plain words at the right, before the sort", () => {
    render(
      <ListToolbar
        filters={<button type="button">Filters</button>}
        count="6 maps"
        sort={<button type="button">Name</button>}
      />
    );
    const count = screen.getByRole("status");
    expect(count).toHaveTextContent("6 maps");
    expect(count).toHaveClass("nh-listbar-count");
    expect(count.nextElementSibling).toHaveTextContent("Name");
  });
});

describe("a find field", () => {
  it("draws the search icon beside a field with a muted placeholder", () => {
    const { container } = render(<FindField aria-label="Find a page by name" placeholder="Find a page by name" />);
    expect(screen.getByRole("searchbox", { name: "Find a page by name" })).toHaveClass("nh-input");
    expect(container.querySelector(".nh-findfield-icon")).not.toBeNull();
  });
});

describe("a kind", () => {
  it("is its icon and its word, unboxed", () => {
    render(<Kind icon={<svg data-testid="map" />}>Battle map</Kind>);
    expect(screen.getByText("Battle map").parentElement).toHaveClass("nh-kind");
    expect(screen.getByTestId("map")).toBeInTheDocument();
  });
});
