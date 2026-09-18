import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Store } from "../server/store";
import { planPaste, savePaste } from "../server/paste";

test("JSON paste requires preview, shows diffs, invalidates edits, copies a template and saves to building detail", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "http://localhost/#paste",
  });
  const keys = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Node",
    "IS_REACT_ACT_ENVIRONMENT",
    "fetch",
  ];
  const previous = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const key of keys)
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value:
        key === "IS_REACT_ACT_ENVIRONMENT" ? true : (dom.window as any)[key],
    });
  const { createElement, act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { JsonPaste } = await import("../src/JsonPaste");
  const store = new Store(":memory:");
  const building = store.saveBuilding({
    name: "Windsor Ballard",
    address: "5555 14th Ave NW Seattle WA 98107",
    notes: "Original review",
    manual_status_override: "REJECTED",
    rejection_reason: "Tour noise",
  });
  const unit = store.saveUnit({
    building_id: building.id,
    unit_number: "247",
    base_rent: 2174,
  });
  let copied = "";
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        copied = text;
      },
    },
  });
  (globalThis as any).fetch = async (path: string, options: any) => {
    try {
      const body = JSON.parse(options.body);
      const result = path.endsWith("/preview")
        ? planPaste(store, body)
        : savePaste(store, body);
      return { ok: true, json: async () => result };
    } catch (e) {
      return { ok: false, json: async () => ({ error: (e as Error).message }) };
    }
  };
  const root = createRoot(dom.window.document.getElementById("root")!);
  let refreshed = 0;
  const buttons = (text: string) =>
    [...dom.window.document.querySelectorAll("button")].filter(
      (button) => button.textContent === text,
    );
  const click = (text: string) =>
    act(async () => {
      buttons(text)[0].click();
    });
  const paste = (value: string) =>
    act(() => {
      const element = dom.window.document.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(
        dom.window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(element, value);
      element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  const text = () => dom.window.document.body.textContent ?? "";
  try {
    await act(() =>
      root.render(
        createElement(JsonPaste, {
          building: store.snapshot().buildings[0],
          buildingId: building.id,
          refresh: async () => {
            refreshed++;
          },
        }),
      ),
    );
    assert(buttons("Save")[0].disabled);
    await click("Copy JSON Template");
    assert.equal(JSON.parse(copied).building, undefined);
    assert(Array.isArray(JSON.parse(copied).units));
    await paste("{broken");
    await click("Validate");
    assert(text().includes("Invalid JSON"));
    assert.equal(store.units()[0].base_rent, 2174);
    const input = {
      building: { notes: "New note" },
      units: [{ unit_number: "247", base_rent: 2099 }],
    };
    await paste(JSON.stringify(input));
    await click("Validate");
    assert(text().includes("Valid JSON"));
    assert(text().includes("EXISTING BUILDING FOUND"));
    assert(text().includes("Tour noise"));
    assert(buttons("Save")[0].disabled);
    await click("Preview");
    assert(!buttons("Save")[0].disabled);
    assert(text().includes("EXISTING UNIT"));
    assert(text().includes("$2,174.00"));
    assert(text().includes("$2,099.00"));
    assert.equal(store.units()[0].base_rent, 2174);
    const select = dom.window.document.querySelector("select")!;
    assert.equal(select.value, "keep");
    await act(() => {
      select.value = "merge";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    assert(buttons("Save")[0].disabled);
    await click("Preview");
    assert(!buttons("Save")[0].disabled);
    await paste(
      JSON.stringify({
        ...input,
        units: [{ unit_number: "247", base_rent: 2050 }],
      }),
    );
    assert(buttons("Save")[0].disabled);
    await click("Preview");
    await click("Save");
    assert.equal(refreshed, 1);
    assert.equal(dom.window.location.hash, "#detail/" + building.id);
    assert.equal(store.units()[0].id, unit.id);
    assert.equal(store.units()[0].base_rent, 2050);
    assert.equal(store.buildings()[0].notes, "Original review\n\nNew note");
    assert.equal(store.buildings()[0].manual_status_override, "REJECTED");
    await act(() =>
      root.render(
        createElement(JsonPaste, { key: "global", refresh: async () => {} }),
      ),
    );
    await click("Copy JSON Template");
    assert(JSON.parse(copied).building.name);
    assert(JSON.parse(copied).building.address);
    assert(dom.window.document.querySelector('a[href="#buildings"]'));
  } finally {
    await act(() => root.unmount());
    store.db.close();
    dom.window.close();
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
