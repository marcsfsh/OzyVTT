import { describe, expect, it, vi } from "vitest";
import { revealInRegion } from "./reveal";

// What `revealInRegion` scrolls: the element's own scroll region alone. A clipping box above it stays put.

function layout(regionTop: number, regionBottom: number, top: number, bottom: number) {
  const clip = document.createElement("div");
  const region = document.createElement("div");
  region.className = "scroll-y";
  const element = document.createElement("div");
  region.append(element);
  clip.append(region);
  document.body.append(clip);
  region.getBoundingClientRect = () => ({ top: regionTop, bottom: regionBottom }) as DOMRect;
  element.getBoundingClientRect = () => ({ top, bottom }) as DOMRect;
  region.scrollTop = 100;
  region.scrollTo = vi.fn() as unknown as typeof region.scrollTo;
  clip.scrollTo = vi.fn() as unknown as typeof clip.scrollTo;
  return { clip, region, element };
}

describe("bringing an element into view inside its own region", () => {
  it("puts its top at the region's top for start", () => {
    const { clip, region, element } = layout(100, 400, 650, 900);
    revealInRegion(element, "start");
    expect(region.scrollTo).toHaveBeenCalledWith({ top: 650, behavior: "auto" });
    expect(clip.scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls only as far as it must for nearest, and not at all when it shows already", () => {
    const below = layout(100, 400, 350, 450);
    revealInRegion(below.element, "nearest", "smooth");
    expect(below.region.scrollTo).toHaveBeenCalledWith({ top: 150, behavior: "smooth" });
    const above = layout(100, 400, 60, 120);
    revealInRegion(above.element);
    expect(above.region.scrollTo).toHaveBeenCalledWith({ top: 60, behavior: "auto" });
    const inside = layout(100, 400, 150, 300);
    revealInRegion(inside.element);
    expect(inside.region.scrollTo).not.toHaveBeenCalled();
  });
});
