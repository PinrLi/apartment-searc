import express from "express";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store, Conflict } from "./store";
import { importPlan } from "./import";
import { buildingSchema, unitSchema } from "../shared/model";
import { evaluateBuilding, rankBuildings } from "../shared/engine";
import { normalizeAddress } from "../shared/normalize";
export function createApp(store: Store) {
  const app = express();
  app.use("/api", (req, res, next) => {
    const host = req.headers.host?.split(":")[0];
    if (!["localhost", "127.0.0.1", "["].includes(host ?? ""))
      return res.status(403).json({ error: "Local access only" });
    if (
      req.headers.origin &&
      req.headers.origin !== `http://${req.headers.host}`
    )
      return res
        .status(403)
        .json({ error: "Cross-origin requests are not allowed" });
    next();
  });
  app.use(express.json({ limit: "25mb" }));
  app.get("/api/state", (_q, r) => r.json(store.snapshot()));
  app.get("/api/duplicate", (q, r) =>
    r.json(
      store
        .snapshot()
        .buildings.find(
          (b) =>
            b.normalized_address ===
            normalizeAddress(String(q.query.address ?? "")),
        ) ?? null,
    ),
  );
  app.post("/api/apartment", (q, r) =>
    r.json(
      store.transaction(() => {
        let b = q.body.building_id
          ? store.buildings().find((b) => b.id === q.body.building_id)
          : null;
        if (q.body.building_id && !b) throw new Error("Building not found");
        if (!b || q.body.update_building)
          b = store.saveBuilding(q.body.building, b?.id);
        const unit = q.body.unit
          ? store.saveUnit(
              { ...q.body.unit, building_id: b.id },
              q.body.unit_id,
            )
          : null;
        return { building_id: b.id, unit };
      }),
    ),
  );
  app.put("/api/buildings/:id", (q, r) =>
    r.json(
      store.transaction(() => store.saveBuilding(q.body, String(q.params.id))),
    ),
  );
  app.delete("/api/buildings/:id", (q, r) =>
    r.json(
      store.transaction(() => {
        store.deleteBuilding(String(q.params.id));
        return { ok: true };
      }),
    ),
  );
  app.put("/api/units/:id", (q, r) =>
    r.json(
      store.transaction(() => store.saveUnit(q.body, String(q.params.id))),
    ),
  );
  app.delete("/api/units/:id", (q, r) =>
    r.json(
      store.transaction(() => {
        store.deleteUnit(String(q.params.id));
        return { ok: true };
      }),
    ),
  );
  app.put("/api/settings", (q, r) =>
    r.json(store.transaction(() => store.saveSettings(q.body))),
  );
  app.post("/api/preview", (q, r) => {
    const existing = q.body.building_id
      ? store.buildings().find((b) => b.id === q.body.building_id)
      : null;
    const b = {
      ...existing,
      ...buildingSchema.parse(q.body.building),
      id: existing?.id ?? "preview",
      normalized_address: "",
      first_seen_date: existing?.first_seen_date ?? "",
      last_reviewed_date: existing?.last_reviewed_date ?? "",
      last_updated: "",
    };
    const units = store.units().filter((u) => u.id !== q.body.unit_id);
    if (q.body.unit)
      units.push({
        ...unitSchema.parse(q.body.unit),
        id: q.body.unit_id ?? "preview-unit",
        building_id: b.id,
        normalized_unit_number: "",
        first_seen_date: "",
        last_seen_date: "",
        last_updated: "",
      });
    const evaluation = evaluateBuilding(b, units, store.settings());
    const ranked = rankBuildings([
      ...store.snapshot().buildings.filter((x) => x.id !== b.id),
      evaluation,
    ]);
    r.json({
      evaluation,
      rank: ranked.findIndex((x) => x.id === b.id) + 1 || null,
    });
  });
  app.get("/api/export/json", (_q, r) =>
    r.attachment("apartment-ledger.json").json(store.export()),
  );
  app.get("/api/export/csv", (_q, r) => {
    const rows: Record<string, unknown>[] = [];
    for (const b of store.snapshot().buildings)
      for (const u of b.units.length ? b.units : [null])
        rows.push({
          building_id: b.id,
          name: b.name,
          address: b.address,
          neighborhood: b.neighborhood,
          status: b.final_status,
          auto_status: b.auto_status,
          manual_override: b.manual_status_override,
          building_score: b.building_score,
          opportunity_score: b.opportunity_score,
          rejection_reason: b.rejection_reason,
          building_failures: b.failures.join("; "),
          building_notes: b.notes,
          first_seen: b.first_seen_date,
          last_reviewed: b.last_reviewed_date,
          unit_id: u?.id,
          unit: u?.unit_number,
          sqft: u?.sqft,
          base_rent: u?.base_rent,
          parking: u?.parking_cost,
          fees: u?.mandatory_monthly_fees,
          base_plus_parking: u?.base_plus_parking,
          total_mandatory_cost: u?.total_mandatory_monthly_cost,
          available: u?.available_date,
          lease_months: u?.lease_length_months,
          active: u?.active,
          unit_score: u?.unit_score,
          unit_failures: u?.hard_fail_reasons.join("; "),
          unit_notes: u?.notes,
        });
    const keys = Object.keys(
      rows[0] ?? { building_id: "", name: "", address: "", status: "" },
    );
    const cell = (v: unknown) => {
      let s = String(v ?? "");
      if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    r.attachment("apartment-ledger.csv")
      .type("text/csv")
      .send(
        [
          keys.map(cell).join(","),
          ...rows.map((row) => keys.map((k) => cell(row[k])).join(",")),
        ].join("\r\n"),
      );
  });
  app.post("/api/import/preview", (q, r) =>
    r.json(importPlan(store, q.body.data)),
  );
  app.post("/api/import", (q, r) =>
    r.json(
      store.transaction(() =>
        importPlan(store, q.body.data, true, q.body.include_settings === true),
      ),
    ),
  );
  app.use("/api", (_q, r) =>
    r.status(404).json({ error: "Endpoint not found" }),
  );
  app.use(
    (
      e: any,
      _q: express.Request,
      r: express.Response,
      _n: express.NextFunction,
    ) =>
      r
        .status(e instanceof Conflict ? 409 : 400)
        .json({
          error:
            e.issues
              ?.map((i: any) => `${i.path.join(".")}: ${i.message}`)
              .join("; ") ?? e.message,
          existing: e.existing,
        }),
  );
  return app;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const store = new Store(
    process.env.DB_PATH ?? resolve("data/apartments.sqlite"),
  );
  const app = createApp(store);
  if (process.argv.includes("--production")) {
    app.use(express.static(resolve("dist")));
    app.get("/{*path}", (_q, r) => r.sendFile(resolve("dist/index.html")));
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }
  const server = app.listen(Number(process.env.PORT ?? 4317), "127.0.0.1", () =>
    console.log(
      "Apartment Ledger: http://127.0.0.1:" + String(process.env.PORT ?? 4317),
    ),
  );
  const close = () =>
    server.close(() => {
      store.db.close();
      process.exit(0);
    });
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
