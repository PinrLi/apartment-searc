import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Store } from "../server/store";

test("global search keyboard controls, result details, rejection, no-match action and route dismissal", async () => {
  const dom = new JSDOM(
    '<!doctype html><div id="root"></div><input id="other" />',
    { url: "http://localhost/#dashboard" },
  );
  const globalKeys = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Node",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const previous = new Map(
    globalKeys.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const key of globalKeys)
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value:
        key === "IS_REACT_ACT_ENVIRONMENT" ? true : (dom.window as any)[key],
    });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  // Load React DOM after the DOM exists, so its input event support is detected correctly.
  const { createElement, act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { QuickSearch } = await import("../src/QuickSearch");
  const store = new Store(":memory:");
  const alpha = store.saveBuilding({
    name: "Alpha Apartments",
    address: "1 Test Street",
    neighborhood: "Ballard",
    aliases: ["The Alpha"],
    notes: "18-month lease",
  });
  const beta = store.saveBuilding({
    name: "Beta Apartments",
    address: "2 Test Street",
    manual_status_override: "REJECTED",
    rejection_reason: "No in-unit washer/dryer",
  });
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    await act(() =>
      root.render(
        createElement(QuickSearch, {
          buildings: store.snapshot().buildings,
          loading: false,
          route: "dashboard",
        }),
      ),
    );
    const input = dom.window.document.querySelector(
      '[role="combobox"]',
    ) as HTMLInputElement;
    const key = async (
      value: string,
      mods: Record<string, boolean> = {},
      target: EventTarget = input,
    ) =>
      act(() => {
        target.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", {
            key: value,
            bubbles: true,
            cancelable: true,
            ...mods,
          }),
        );
      });
    const type = async (value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(
          dom.window.HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, value);
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
    const options = () => [
      ...dom.window.document.querySelectorAll('[role="option"]'),
    ];
    await key("/", {}, dom.window.document.body);
    assert.equal(dom.window.document.activeElement, input);
    await type("apartments");
    assert.equal(options().length, 2);
    assert.equal(options()[0].getAttribute("aria-selected"), "true");
    assert(options()[0].textContent?.includes("18-month lease"));
    assert(options()[0].textContent?.includes("Ballard"));
    assert(options()[0].textContent?.includes("Last reviewed"));
    assert(options()[0].textContent?.includes("Score"));
    assert(options()[1].classList.contains("quick-rejected"));
    assert(options()[1].textContent?.includes("REJECTED"));
    assert(options()[1].textContent?.includes("No in-unit washer/dryer"));
    await key("ArrowDown");
    assert.equal(options()[1].getAttribute("aria-selected"), "true");
    await key("Enter");
    assert.equal(dom.window.location.hash, "#detail/" + beta.id);
    assert.equal(input.getAttribute("aria-expanded"), "false");
    await key("k", { ctrlKey: true }, dom.window.document.body);
    assert.equal(dom.window.document.activeElement, input);
    await key("ArrowUp");
    assert.equal(options()[0].getAttribute("aria-selected"), "true");
    await key("Escape");
    assert.equal(input.getAttribute("aria-expanded"), "false");
    const other = dom.window.document.getElementById(
      "other",
    ) as HTMLInputElement;
    await act(() => other.focus());
    await key("/", {}, other);
    assert.equal(dom.window.document.activeElement, other);
    await key("k", { metaKey: true }, other);
    assert.equal(dom.window.document.activeElement, input);
    await type("unrelated xyz");
    assert.equal(options().length, 0);
    assert(
      dom.window.document.body.textContent?.includes(
        "No existing apartment found",
      ),
    );
    assert(dom.window.document.querySelector('a[href="#add"]'));
    await key("Enter");
    assert.equal(dom.window.location.hash, "#add");
    await act(() => input.focus());
    await type("The Alpha");
    assert.equal(options().length, 1);
    await key("Enter");
    assert.equal(dom.window.location.hash, "#detail/" + alpha.id);
    await act(() => input.focus());
    await type("apartments");
    await act(() =>
      root.render(
        createElement(QuickSearch, {
          buildings: store.snapshot().buildings,
          loading: false,
          route: "settings",
        }),
      ),
    );
    assert.equal(input.getAttribute("aria-expanded"), "false");
  } finally {
    await act(() => root.unmount());
    store.db.close();
    dom.window.close();
    for (const key of globalKeys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
