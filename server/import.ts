import { z } from "zod";
import { buildingSchema, unitSchema, settingsSchema } from "../shared/model";
import { normalizeAddress, normalizeUnit } from "../shared/normalize";
import { Store } from "./store";
const stamp = z.string().datetime().optional();
const fileSchema = z.object({
  version: z.literal(1),
  buildings: z.array(
    z
      .object({
        id: z.string().min(1),
        first_seen_date: stamp,
        last_reviewed_date: stamp,
        last_updated: stamp,
      })
      .passthrough(),
  ),
  units: z.array(
    z
      .object({
        id: z.string().min(1),
        building_id: z.string(),
        first_seen_date: stamp,
        last_seen_date: stamp,
        last_updated: stamp,
      })
      .passthrough(),
  ),
  settings: settingsSchema.optional(),
  history: z
    .array(
      z.object({
        id: z.string(),
        building_id: z.string(),
        unit_id: z.string().nullable(),
        at: z.string().datetime(),
        action: z.string(),
        before: z.any(),
        after: z.any(),
      }),
    )
    .default([]),
});
export function importPlan(
  store: Store,
  raw: unknown,
  apply = false,
  includeSettings = false,
) {
  const file = fileSchema.parse(raw);
  const buildings = file.buildings.map((b) => ({
    ...b,
    ...buildingSchema.parse(b),
  }));
  const units = file.units.map((u) => ({ ...u, ...unitSchema.parse(u) }));
  if (
    new Set(buildings.map((b) => b.id)).size !== buildings.length ||
    new Set(units.map((u) => u.id)).size !== units.length
  )
    throw new Error("Import contains repeated record IDs");
  const known = new Map(
    store.buildings().map((b) => [b.normalized_address, b.id]),
  );
  const mapping = new Map<string, string>();
  const unitMapping = new Map<string, string>();
  const importedBuildings = new Set<string>();
  const seenUnits = new Set(
    store
      .units()
      .map(
        (u) => u.building_id + "|" + (u.normalized_unit_number || "id:" + u.id),
      ),
  );
  const report = {
    new_buildings: 0,
    existing_buildings: 0,
    new_units: 0,
    existing_units: 0,
    unnumbered_units: 0,
    history_records: 0,
  };
  for (const b of buildings) {
    const address = normalizeAddress(b.address);
    let id = known.get(address);
    if (id) report.existing_buildings++;
    else {
      report.new_buildings++;
      id = apply ? store.saveBuilding(b, undefined, b).id : "new:" + b.id;
      known.set(address, id);
      importedBuildings.add(b.id);
    }
    mapping.set(b.id, id);
  }
  for (const u of units) {
    const building_id = mapping.get(u.building_id);
    if (!building_id)
      throw new Error("Import unit refers to a building absent from the file");
    const normalized = normalizeUnit(u.unit_number);
    if (!normalized) report.unnumbered_units++;
    const key = building_id + "|" + (normalized || "id:" + u.id);
    // Export IDs allow safe re-import of unnumbered units. Independently entered unknown units stay separate.
    const prior = store
      .units()
      .find(
        (x) =>
          x.building_id === building_id &&
          (normalized
            ? x.normalized_unit_number === normalized
            : x.id === u.id),
      );
    if (seenUnits.has(key) || prior) {
      report.existing_units++;
      if (prior) unitMapping.set(u.id, prior.id);
      continue;
    }
    report.new_units++;
    seenUnits.add(key);
    if (apply) {
      const saved = store.saveUnit({ ...u, building_id }, undefined, u);
      unitMapping.set(u.id, saved.id);
      // Retain source ID when it is globally unused so repeated JSON imports are idempotent.
      if (!store.units().some((x) => x.id === u.id)) {
        const retained = { ...saved, id: u.id };
        store.db
          .prepare("UPDATE units SET id=?,data=? WHERE id=?")
          .run(u.id, JSON.stringify(retained), saved.id);
        store.db
          .prepare("UPDATE history SET unit_id=? WHERE unit_id=?")
          .run(u.id, saved.id);
        unitMapping.set(u.id, u.id);
      }
    }
  }
  for (const h of file.history)
    if (importedBuildings.has(h.building_id)) {
      report.history_records++;
      if (apply)
        store.db
          .prepare("INSERT OR IGNORE INTO history VALUES(?,?,?,?,?,?,?)")
          .run(
            h.id,
            mapping.get(h.building_id)!,
            h.unit_id ? (unitMapping.get(h.unit_id) ?? h.unit_id) : null,
            h.at,
            h.action,
            JSON.stringify(h.before ?? null),
            JSON.stringify(h.after ?? null),
          );
    }
  // Adding imported units must not turn an old review into a review made today.
  if (apply)
    for (const source of buildings)
      if (importedBuildings.has(source.id)) {
        const id = mapping.get(source.id)!;
        const saved = store.buildings().find((b) => b.id === id)!;
        const restored = {
          ...saved,
          first_seen_date: source.first_seen_date ?? saved.first_seen_date,
          last_reviewed_date:
            source.last_reviewed_date ?? saved.last_reviewed_date,
          last_updated: source.last_updated ?? saved.last_updated,
        };
        store.db
          .prepare("UPDATE buildings SET data=? WHERE id=?")
          .run(JSON.stringify(restored), id);
      }
  if (apply && includeSettings && file.settings)
    store.saveSettings(file.settings);
  return report;
}
