import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/app.tsx", import.meta.url), "utf8");
const effect = source.match(/useEffect\(\(\) => \{\n(\s+const viewport = window\.visualViewport;[\s\S]*?)\n  \}, \[(?:deviceAvailable)?\]\);/)?.[1];
assert.ok(effect, "test the mounted viewport effect, not a separate implementation");

function setup({ height = 844, width = 390, visual = true } = {}) {
  const window = Object.assign(new EventTarget(), { innerHeight: height, innerWidth: width, screen: { height: 844 }, scrollX: 0, scrollY: 0 });
  window.scrollTo = (x, y) => { window.scrollX = x; window.scrollY = y; };
  window.visualViewport = visual ? Object.assign(new EventTarget(), { height, offsetTop: 0, scale: 1 }) : undefined;
  const properties = new Map();
  const document = Object.assign(new EventTarget(), { activeElement: null, scrollingElement: { scrollTop: 0 }, body: { scrollTop: 0 }, documentElement: { style: {
    setProperty: (key, value) => properties.set(key, value), removeProperty: (key) => properties.delete(key),
  } } });
  class Element { closest(selector) { return selector === ".composer-zone"; } }
  let frameId = 0, keyboardOpen = false;
  const frames = new Map();
  window.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
  window.cancelAnimationFrame = (id) => frames.delete(id);
  const cleanup = new Function("window", "document", "HTMLElement", "setKeyboardOpen", "deviceAvailable", effect)(
    window, document, Element, (value) => { keyboardOpen = value; }, false);
  const flush = () => { for (const [id, callback] of frames) { frames.delete(id); callback(); } };
  return { window, properties, cleanup, get open() { return keyboardOpen; },
    value: (ending) => [...properties].find(([key]) => key.endsWith(ending))?.[1],
    pageScroll(value) { window.scrollY = value; document.scrollingElement.scrollTop = value; document.body.scrollTop = value; },
    focus(value = true) { document.activeElement = value ? new Element() : null; document.dispatchEvent(new Event(value ? "focusin" : "focusout")); flush(); },
    resize({ innerHeight, innerWidth, ...viewport }) {
      if (innerHeight !== undefined) window.innerHeight = innerHeight;
      if (innerWidth !== undefined) window.innerWidth = innerWidth;
      if (window.visualViewport) Object.assign(window.visualViewport, viewport);
      window.dispatchEvent(new Event("resize")); flush();
    },
  };
}

test("focused hardware keyboard and small landscape do not imply a software keyboard", () => {
  for (const height of [844, 480]) {
    const state = setup({ height }); state.focus(); assert.equal(state.open, false); state.cleanup();
  }
});
test("composer focus cancels Safari page panning without touching the message list", () => {
  const state = setup(); state.pageScroll(180); state.focus();
  assert.equal(state.window.scrollY, 0); assert.equal(state.window.scrollX, 0); state.cleanup();
});
test("panned visual viewport preserves its top without subtracting the pan from keyboard detection", () => {
  const state = setup(); state.focus(); state.resize({ height: 560, offsetTop: 190 });
  assert.equal(state.open, true); assert.equal(state.value("height"), "560px"); assert.equal(state.value("top"), "190px");
  state.focus(false);
  assert.equal(state.value("height"), "560px", "blur before keyboard animation ends must not expand the chat");
  assert.equal(state.value("top"), "190px"); state.cleanup();
});
test("Android resize-content keeps the expanded baseline even on a tall device", () => {
  const state = setup(); state.focus(); state.resize({ innerHeight: 540, height: 540 });
  assert.equal(state.open, true); state.resize({ innerHeight: 844, height: 844 }); assert.equal(state.open, false); state.cleanup();
});
test("dismissed keyboard clamps stale visual offset instead of moving the header down", () => {
  const state = setup(); state.focus(); state.resize({ height: 480, offsetTop: 90 });
  state.resize({ height: 844, offsetTop: 90 }); assert.equal(state.value("top"), "0px"); assert.equal(state.open, false); state.cleanup();
});
test("pinch zoom does not masquerade as a keyboard or halve the layout", () => {
  const state = setup(); state.focus(); state.resize({ height: 422, offsetTop: 50, scale: 2 });
  assert.equal(state.open, false); assert.equal(state.value("height"), "844px"); assert.equal(state.value("top"), "0px"); state.cleanup();
});
test("no VisualViewport still supports layout resize and cleanup", () => {
  const state = setup({ visual: false }); state.focus(); state.resize({ innerHeight: 540 });
  assert.equal(state.open, true); state.cleanup(); assert.equal(state.properties.size, 0);
  state.resize({ innerHeight: 844 }); assert.equal(state.properties.size, 0, "unmounted listener must not write styles");
});
test("width changes reset the old portrait baseline", () => {
  const state = setup(); state.focus(); state.resize({ innerWidth: 844, innerHeight: 390, height: 390 });
  assert.equal(state.open, false); state.cleanup();
});
