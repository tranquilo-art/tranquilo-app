// A horizontal rail that only a touchscreen could scroll. .shelf-row had
// `overflow-x:auto` but hid its scrollbar three ways (correct for touch,
// where you swipe and a bar is chrome) -- leaving a mouse with neither
// affordance nor gesture, since a vertical wheel doesn't scroll a
// horizontal container. Stayed invisible while every shelf fit on screen;
// a 12th storyline pushed the rail past a 2560px viewport and the dead end
// became reachable.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// .shelf-row and its pointer:fine scrollbar treatment moved out of
// css/style.css into the Shelves mode component's own stylesheet.
const css = readFileSync(
  new URL("../css/components/tranquilo-shelves-mode.css", import.meta.url),
  "utf8",
);

function ruleFor(selector: string) {
  // Grabs the first declaration block for an exact selector.
  const i = css.indexOf(`${selector}{`);
  if (i === -1) return null;
  return css.slice(i, css.indexOf("}", i));
}

describe("shelf rails are scrollable with a mouse", () => {
  it("still scrolls horizontally at all", () => {
    expect(ruleFor(".shelf-row")).toContain("overflow-x:auto");
  });

  it("still hides the scrollbar by default, which is correct for touch", () => {
    expect(ruleFor(".shelf-row")).toContain("scrollbar-width:none");
  });

  it("shows a scrollbar where the pointer is fine", () => {
    // `pointer: fine` is the precise question, not screen width, which
    // gets a tablet wrong in both directions.
    expect(css).toMatch(/@media\s*\(pointer:\s*fine\)/);
  });

  it("re-enables the webkit scrollbar for that case", () => {
    // Chrome and Safari ignore scrollbar-width.
    const scoped = css.slice(css.search(/@media\s*\(pointer:\s*fine\)/));
    expect(scoped).toMatch(
      /\.shelf-row::-webkit-scrollbar\s*\{[^}]*display:\s*block/,
    );
  });

  it("gives that scrollbar a height, or webkit renders it zero-tall", () => {
    const scoped = css.slice(css.search(/@media\s*\(pointer:\s*fine\)/));
    expect(scoped).toMatch(/\.shelf-row::-webkit-scrollbar\s*\{[^}]*height:/);
  });
});
