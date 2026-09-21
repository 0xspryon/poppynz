import { describe, expect, test } from "bun:test";
import { classes, html, imageRef, link, str, svgRef, videoRef } from "./props";

describe("props", () => {
  test("str", () => expect(str("x")).toEqual({ $$type: "string", value: "x" }));
  test("html wraps in html-v3", () => {
    expect(html("Hi <strong>there</strong>")).toEqual({
      $$type: "html-v3",
      value: { content: { $$type: "string", value: "Hi <strong>there</strong>" }, children: [] },
    });
  });
  test("html rejects disallowed tags and attributes", () => {
    expect(() => html("<div>x</div>")).toThrow(/div/);
    expect(() => html('<span class="x">x</span>')).toThrow(/attribute/);
    expect(() => html('<a href="/x">ok</a>')).not.toThrow();
    expect(() => html("a<br/>b")).not.toThrow();
    expect(() => html("a<br />b")).not.toThrow();
  });
  test("classes validates names", () => {
    expect(classes(["btn-primary"])).toEqual({ $$type: "classes", value: ["btn-primary"] });
    expect(() => classes(["1bad"])).toThrow();
  });
  test("link", () => {
    expect(link("https://app.poppynz.com/auth/sign-up")).toEqual({
      $$type: "link",
      value: {
        destination: { $$type: "url", value: "https://app.poppynz.com/auth/sign-up" },
        isTargetBlank: { $$type: "boolean", value: false },
        tag: { $$type: "string", value: "a" },
      },
    });
  });
  test("media refs carry a hash placeholder", () => {
    expect(svgRef("abc123def456").value.id).toEqual({ $$type: "media-hash", value: "abc123def456" });
    expect(imageRef("abc123def456", "Logo").value.src.value.alt).toEqual({ $$type: "string", value: "Logo" });
    expect(videoRef("https://v/x.mp4").value.url).toEqual({ $$type: "url", value: "https://v/x.mp4" });
  });
});
