import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Store } from "../server/store";

test("direct building/unit forms, duplicate warnings, inventory actions and inactive visibility", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "http://localhost/#buildings",
  });
  const keys = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Node",
    "IS_REACT_ACT_ENVIRONMENT",
    "fetch",
    "confirm",
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
  const { ExistingEditor, Detail } = await import("../src/App");
  const store = new Store(":memory:");
  const b = store.saveBuilding({
    name: "Windsor Ballard",
    address: "100 Test Street",
    quiet_score: 8,
    safety_score: 8,
    parking_type: "garage",
    has_in_unit_washer_dryer: "yes",
  });
  const first = store.saveUnit({
    building_id: b.id,
    unit_number: "247",
    sqft: 650,
    base_rent: 2100,
    parking_cost: 0,
    mandatory_monthly_fees: 0,
    available_date: "2026-10-28",
  });
  const second = store.saveUnit({
    ...first,
    unit_number: "322",
    base_rent: 1800,
  });
  store.saveUnit({ ...first, unit_number: "518", active: false });
  const requests: { path: string; body: any; method: string }[] = [];
  let allowDelete = false,
    confirmations = 0;
  (globalThis as any).confirm = () => {
    confirmations++;
    return allowDelete;
  };
  (globalThis as any).fetch = async (path: string, options: any) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ path, body, method: options.method });
    let result: any = {};
    if (path === "/api/apartment")
      result = {
        building_id: body.building_id,
        unit: store.saveUnit({ ...body.unit, building_id: body.building_id }),
      };
    else if (path.startsWith("/api/units/"))
      result =
        options.method === "DELETE"
          ? store.deleteUnit(path.split("/").at(-1)!)
          : store.saveUnit(body, path.split("/").at(-1)!);
    else if (path.startsWith("/api/buildings/"))
      result = store.saveBuilding(body, path.split("/").at(-1)!);
    else throw new Error("Unexpected UI request " + path);
    return { ok: true, json: async () => result };
  };
  const root = createRoot(dom.window.document.getElementById("root")!);
  let revision = 0;
  const text = () => dom.window.document.body.textContent ?? "";
  const field = (label: string) =>
    [...dom.window.document.querySelectorAll("label")]
      .find((l) => l.querySelector("span")?.textContent === label)
      ?.querySelector("input,textarea") as HTMLInputElement;
  const edit = async (label: string, value: string) =>
    act(() => {
      const element = field(label);
      assert(element, label);
      Object.getOwnPropertyDescriptor(
        element.tagName === "TEXTAREA"
          ? dom.window.HTMLTextAreaElement.prototype
          : dom.window.HTMLInputElement.prototype,
        "value",
      )!.set!.call(element, value);
      element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  const submit = () =>
    act(async () => {
      dom.window.document
        .querySelector("form")!
        .dispatchEvent(
          new dom.window.Event("submit", { bubbles: true, cancelable: true }),
        );
    });
  const showEditor = (unitId?: string) =>
    act(() =>
      root.render(
        createElement(ExistingEditor, {
          key: ++revision,
          state: store.snapshot(),
          id: b.id,
          unitId,
          refresh: async () => {},
        }),
      ),
    );
  const renderDetail = () =>
    root.render(
      createElement(Detail, {
        state: store.snapshot(),
        id: b.id,
        refresh: async () => {
          renderDetail();
        },
      }),
    );
  try {
    await showEditor();
    assert(text().includes("Add Unit — Windsor Ballard"));
    assert(!field("Building name"));
    assert(!text().includes("Identify building"));
    assert(text().includes("reliable unit deduplication is not possible"));
    await edit("Unit number", "247");
    assert(text().includes("Existing unit found"));
    assert(
      dom.window.document.querySelector<HTMLButtonElement>(
        "button[type=submit]",
      )!.disabled,
    );
    await edit("Unit number", "600");
    await submit();
    assert.equal(store.buildings().length, 1);
    assert.equal(store.units().length, 4);
    assert.equal(requests.at(-1)?.body.building, undefined);
    assert.equal(dom.window.location.hash, "#detail/" + b.id);
    await showEditor(first.id);
    assert(text().includes("Edit Unit — Windsor Ballard"));
    assert(!field("Building name"));
    const sibling = store.units().find((u) => u.id === second.id);
    await edit("Base rent ($/month)", "2050");
    await submit();
    assert.equal(requests.at(-1)?.path, "/api/units/" + first.id);
    assert.deepEqual(
      store.units().find((u) => u.id === second.id),
      sibling,
    );
    await showEditor("building");
    assert(text().includes("Edit Building — Windsor Ballard"));
    assert(!field("Unit number"));
    assert(!text().includes("Continue to unit"));
    const units = store.units();
    await edit("Building notes", "Shared facts");
    await submit();
    assert.equal(requests.at(-1)?.path, "/api/buildings/" + b.id);
    assert.deepEqual(store.units(), units);
    await act(() => renderDetail());
    let inventory = dom.window.document.querySelector(".unit-inventory")!;
    assert.equal(inventory.querySelectorAll("th").length, 14);
    assert(!inventory.textContent?.includes("#518"));
    assert(
      inventory.querySelector(".inventory-best")?.textContent?.includes("#322"),
    );
    const inactive = inventory.querySelector<HTMLInputElement>(
      "input[type=checkbox]",
    )!;
    await act(() => inactive.click());
    assert(inventory.textContent?.includes("#518"));
    const bestRow = inventory.querySelector(".inventory-best")!;
    await act(async () => {
      [...bestRow.querySelectorAll("button")]
        .find((btn) => btn.textContent === "Mark inactive")!
        .click();
    });
    assert.equal(store.units().find((u) => u.id === second.id)?.active, false);
    assert(
      inventory.querySelector(".inventory-best")?.textContent?.includes("#247"),
    );
    const deleteButton = inventory.querySelector<HTMLButtonElement>(
      '[aria-label="Delete unit 322"]',
    )!;
    const count = store.units().length;
    await act(async () => deleteButton.click());
    assert.equal(confirmations, 1);
    assert.equal(store.units().length, count);
    allowDelete = true;
    await act(async () => deleteButton.click());
    assert.equal(store.units().length, count - 1);
    assert(
      store
        .history()
        .some((h) => h.unit_id === second.id && h.action === "Unit deleted"),
    );
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
