import { render, screen } from "@testing-library/react";
import ScrollHero, { drawCover, easeToward, FRAME_COUNT, frameFor, frameSrc, progressFor } from "./ScrollHero";

describe("scroll-to-frame mapping", () => {
  test("progress runs 0 → 1 across the section's scrollable height", () => {
    expect(progressFor(0, 4000, 1000)).toBe(0); // section top at viewport top
    expect(progressFor(-1500, 4000, 1000)).toBe(0.5);
    expect(progressFor(-3000, 4000, 1000)).toBe(1); // section bottom at viewport bottom
    expect(progressFor(200, 4000, 1000)).toBe(0); // not reached yet
    expect(progressFor(-9999, 4000, 1000)).toBe(1); // scrolled past
    expect(progressFor(0, 800, 1000)).toBe(1); // nothing to scroll
  });

  test("frames advance with progress and stay in range", () => {
    expect(frameFor(0)).toBe(0);
    expect(frameFor(0.5)).toBe(FRAME_COUNT / 2);
    expect(frameFor(1)).toBe(FRAME_COUNT - 1);
    expect(frameFor(1.2)).toBe(FRAME_COUNT - 1);
    expect(frameFor(-1)).toBe(0);
  });

  test("the film eases toward the scroll position instead of jumping, whatever the frame rate", () => {
    const after16 = easeToward(0, 0.1, 16);
    expect(after16).toBeGreaterThan(0);
    expect(after16).toBeLessThan(0.1); // part of the way, so the frames in between get painted
    let p = 0;
    for (let i = 0; i < 2; i++) p = easeToward(p, 0.1, 16);
    expect(p).toBeCloseTo(easeToward(0, 0.1, 32), 10); // two 16 ms ticks = one 32 ms tick
    let t = 0;
    for (let i = 0; i < 60; i++) t = easeToward(t, 0.1, 16);
    expect(t).toBe(0.1); // and it settles exactly, so the animation loop stops
    expect(easeToward(0.5, 0.2, 16)).toBeLessThan(0.5); // scrolling back up works too
  });

  test("frame file names are 1-based and zero-padded", () => {
    expect(frameSrc(0)).toBe("/hero/frames/frame_001.webp");
    expect(frameSrc(FRAME_COUNT - 1)).toBe("/hero/frames/frame_150.webp");
  });

  test("drawCover fills the canvas like object-fit: cover", () => {
    const ctx = { drawImage: jest.fn() };
    drawCover(ctx, { naturalWidth: 1280, naturalHeight: 720 }, 400, 800); // portrait phone
    const [, x, y, w, h] = ctx.drawImage.mock.calls[0];
    expect(h).toBeCloseTo(800);
    expect(w).toBeCloseTo((1280 * 800) / 720);
    expect(x).toBeCloseTo((400 - w) / 2);
    expect(y).toBeCloseTo(0);
  });
});

describe("ScrollHero", () => {
  afterEach(() => {
    delete window.matchMedia;
  });

  test("reduced motion shows the finished still and the finale, without scroll-jacking", () => {
    window.matchMedia = () => ({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() });
    const { container } = render(<ScrollHero intro={<h1>Intro</h1>} hint={<p>Scroll down</p>} finale={<p>Finale</p>} />);
    expect(screen.getByText("Finale")).toBeVisible();
    expect(screen.queryByText("Scroll down")).toBeNull(); // nothing to scroll through, so no nudge
    expect(container.querySelector("img").getAttribute("src")).toBe(frameSrc(FRAME_COUNT - 1));
    expect(container.querySelector("canvas")).toBeNull();
  });

  test("full motion renders a decorative canvas inside a tall scroll section", () => {
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: jest.fn() });
    render(<ScrollHero intro={<h1>Intro</h1>} hint={<p>Scroll down</p>} finale={<p>Finale</p>} />);
    const section = screen.getByTestId("scroll-hero");
    expect(section.querySelector("canvas")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Scroll down")).toBeInTheDocument();
    expect(screen.getByText("Intro")).toBeInTheDocument(); // jsdom has no layout, so progress can't be asserted here
  });
});
