import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QrCode } from "./QrCode";
import { encodeQr } from "./qr-encode";

const draw = (matrix: ReturnType<typeof encodeQr>) =>
  matrix.map((row) => row.map((dark) => (dark ? "#" : ".")).join("")).join("\n");

// Checked with a separate decoder when it was pinned: it reads back as the address. A change here is a change to
// the symbol a phone scans, so it needs that check again.
const JOIN_ADDRESS = `
#######..#....#...#######
#.....#..#....##..#.....#
#.###.#.#.###.#.#.#.###.#
#.###.#.#.####....#.###.#
#.###.#.#...#.#...#.###.#
#.....#.#.###..##.#.....#
#######.#.#.#.#.#.#######
........##.....#.........
#.#####...#.##.##.#####..
..####...#.####..#.....#.
..#..###.#.###.#..##.#.##
###....#.##.....#...#...#
...####.####.#....###.###
#.#.#..#.#..#.#......#.#.
#.#.###.#....#.#.#.#.#.##
#.###....#..#.##.....#..#
#.#.###..#..##..#####.#..
........##....#.#...###..
#######..####...#.#.#####
#.....#.#.##...##...##..#
#.###.#.##.###.########..
#.###.#.#.#.#.###.###.###
#.###.#.#........#....#.#
#.....#.....#...#.####..#
#######.#....#.#.########`.trim();

describe("the QR encoder", () => {
  it("draws a join address as the symbol a phone reads", () => {
    expect(draw(encodeQr("http://192.168.1.50:3001"))).toBe(JOIN_ADDRESS);
  });

  it("grows the symbol with the text and refuses what doesn't fit", () => {
    expect(encodeQr("a")).toHaveLength(21);
    expect(encodeQr("http://192.168.100.200:3001")).toHaveLength(29);
    expect(encodeQr("x".repeat(100))).toHaveLength(41);
    // Version 8, with the version blocks that version 7 and up carry.
    expect(encodeQr("x".repeat(130))).toHaveLength(49);
    expect(() => encodeQr("x".repeat(300))).toThrow(RangeError);
  });

  it("keeps the three finder patterns and the timing lines on every mask", () => {
    for (let mask = 0; mask < 8; mask++) {
      const matrix = encodeQr("http://10.0.0.7:5173", mask);
      const size = matrix.length;
      for (const [left, top] of [
        [0, 0],
        [size - 7, 0],
        [0, size - 7]
      ])
        expect(
          matrix[top + 3]
            .slice(left, left + 7)
            .map((dark) => (dark ? "#" : "."))
            .join("")
        ).toBe("#.###.#");
      for (let index = 8; index < size - 8; index++) {
        expect(matrix[6][index]).toBe(index % 2 === 0);
        expect(matrix[index][6]).toBe(index % 2 === 0);
      }
    }
  });
});

describe("QrCode", () => {
  it("is one labelled image with a quiet zone around the symbol", () => {
    const { getByRole } = render(<QrCode value="http://192.168.1.50:3001" label="Join address as a QR code" />);
    const svg = getByRole("img", { name: "Join address as a QR code" });
    // 25 modules and four on each side.
    expect(svg.getAttribute("viewBox")).toBe("0 0 33 33");
  });
});
