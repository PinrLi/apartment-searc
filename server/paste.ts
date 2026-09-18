import { createHash } from "node:crypto";
import { z } from "zod";
import {
  buildingSchema,
  unitSchema,
  type Building,
  type Unit,
} from "../shared/model";
import { normalizeAddress, normalizeUnit } from "../shared/normalize";
import { evaluateBuilding, rankBuildings } from "../shared/engine";
import { Store, Conflict } from "./store";

const protectedFields = [
  "manual_status_override",
  "rejection_reason",
  "toured",
  "tour_date",
  "finalist",
  "signed",
] as const;
const buildingPatch = buildingSchema
  .innerType()
  .omit({
    manual_status_override: true,
    rejection_reason: true,
    toured: true,
    tour_date: true,
    finalist: true,
    signed: true,
  })
  .partial()
  .strict();
const unitPatch = unitSchema.omit({ building_id: true }).partial().strict();
const pasteSchema = z
  .object({
    building: buildingPatch.optional(),
    units: z.array(unitPatch).default([]),
  })
  .strict();
export const pasteRequest = z.object({
  text: z.string().min(1).max(2_000_000),
  building_id: z.string().optional(),
  mode: z.enum(["keep", "merge"]).default("keep"),
  token: z.string().optional(),
});
type Request = z.infer<typeof pasteRequest>;
function pathLabel(path: (string | number)[]) {
  return path.reduce<string>(
    (out, key) =>
      typeof key === "number" ? `${out}[${key}]` : out ? `${out}.${key}` : key,
    "",
  );
}
function validate<S extends z.ZodTypeAny>(
  schema: S,
  raw: unknown,
): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues
        .map((issue) => `${pathLabel(issue.path) || "JSON"}: ${issue.message}`)
        .join("\n"),
    );
  return parsed.data;
}
export function parseApartmentJSON(text: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const message = (e as Error).message;
    const position = message.match(/position (\d+)/)?.[1];
    const at = position
      ? Number(position)
      : /end of JSON/i.test(message)
        ? text.length
        : null;
    const location =
      at === null
        ? ""
        : ` (line ${text.slice(0, at).split("\n").length}, column ${at - text.lastIndexOf("\n", at - 1)})`;
    throw new Error(`Invalid JSON${location}: ${message}`);
  }
  // Workflow decisions are intentionally edited through the existing review controls.
  if (raw && typeof raw === "object" && "building" in raw) {
    const b = (raw as any).building;
    if (b && typeof b === "object")
      for (const key of protectedFields)
        if (key in b)
          throw new Error(
            `building.${key}: protected workflow field; use the building's manual review controls instead`,
          );
  }
  return validate(pasteSchema, raw);
}
function appendNotes(previous: string, next: string | undefined) {
  if (
    !next?.trim() ||
    next.trim() === previous.trim() ||
    previous.endsWith("\n\n" + next.trim())
  )
    return previous;
  return previous ? previous + "\n\n" + next.trim() : next.trim();
}
function changes(before: any, after: any, keys: string[]) {
  return keys
    .filter(
      (key) =>
        JSON.stringify(before?.[key] ?? null) !==
        JSON.stringify(after[key] ?? null),
    )
    .map((field) => ({
      field,
      before: before?.[field] ?? null,
      after: after[field] ?? null,
    }));
}
export function planPaste(store: Store, input: unknown) {
  const request = validate(pasteRequest, input) as Request;
  const parsed = parseApartmentJSON(request.text);
  const buildings = store.buildings(),
    inventory = store.units(),
    settings = store.settings();
  const context = request.building_id
    ? buildings.find((b) => b.id === request.building_id)
    : undefined;
  if (request.building_id && !context)
    throw new Error("Building context no longer exists");
  if (!context && (!parsed.building?.name || !parsed.building?.address))
    throw new Error(
      "building.name and building.address: required when pasting globally",
    );
  if (
    context &&
    parsed.building?.address &&
    normalizeAddress(parsed.building.address) !== context.normalized_address
  )
    throw new Error(
      "building.address: does not match this building. Use global Paste JSON to add a different building.",
    );
  const existing =
    context ??
    buildings.find(
      (b) =>
        b.normalized_address === normalizeAddress(parsed.building!.address!),
    );
  let facts = existing
    ? { ...existing }
    : validate(buildingSchema, parsed.building);
  if (existing && request.mode === "merge" && parsed.building) {
    facts = validate(buildingSchema, {
      ...existing,
      ...parsed.building,
      aliases: [...existing.aliases, ...(parsed.building.aliases ?? [])],
      notes: appendNotes(existing.notes, parsed.building.notes),
    });
  }
  const now = new Date().toISOString();
  const building: Building = {
    ...facts,
    id: existing?.id ?? "paste-building",
    normalized_address: normalizeAddress(facts.address),
    first_seen_date: existing?.first_seen_date ?? now,
    last_reviewed_date: existing?.last_reviewed_date ?? now,
    last_updated: existing?.last_updated ?? now,
  };
  if (!building.normalized_address)
    throw new Error("building.address: must contain letters or numbers");
  const seen = new Set<string>();
  const units = parsed.units.map((patch, index) => {
    const normalized = normalizeUnit(patch.unit_number ?? "");
    if (normalized && seen.has(normalized))
      throw new Error(
        `units[${index}].unit_number: repeated unit number in this paste`,
      );
    if (normalized) seen.add(normalized);
    const old = normalized
      ? inventory.find(
          (u) =>
            u.building_id === building.id &&
            u.normalized_unit_number === normalized,
        )
      : undefined;
    const data = validate(unitSchema, {
      ...old,
      ...patch,
      building_id: building.id,
      notes: appendNotes(old?.notes ?? "", patch.notes),
    });
    const after: Unit = {
      ...data,
      id: old?.id ?? `paste-unit-${index}`,
      normalized_unit_number: normalized,
      first_seen_date: old?.first_seen_date ?? now,
      last_seen_date: old?.last_seen_date ?? now,
      last_updated: old?.last_updated ?? now,
    };
    return {
      classification: normalized
        ? old
          ? "EXISTING UNIT"
          : "NEW UNIT"
        : "UNNUMBERED UNIT",
      existing_id: old?.id ?? null,
      after,
      changes: changes(old, after, Object.keys(patch)),
    };
  });
  const suppliedIds = new Set(units.map((u) => u.after.id));
  const evaluation = evaluateBuilding(
    building,
    [
      ...inventory.filter((u) => !suppliedIds.has(u.id)),
      ...units.map((u) => u.after),
    ],
    settings,
  );
  const rank =
    rankBuildings([
      ...buildings
        .filter((b) => b.id !== building.id)
        .map((b) => evaluateBuilding(b, inventory, settings)),
      evaluation,
    ]).findIndex((b) => b.id === building.id) + 1 || null;
  const token = createHash("sha256")
    .update(
      JSON.stringify({
        text: request.text,
        context: request.building_id ?? null,
        mode: request.mode,
        buildings,
        inventory,
        settings,
      }),
    )
    .digest("hex");
  return {
    token,
    mode: request.mode,
    existing: existing ? evaluateBuilding(existing, inventory, settings) : null,
    building,
    building_changes: changes(
      existing,
      building,
      Object.keys(parsed.building ?? {}),
    ),
    units: units.map((u) => ({
      ...u,
      evaluation: evaluation.units.find((e) => e.id === u.after.id)!,
    })),
    evaluation,
    rank,
  };
}
export type PastePlan = ReturnType<typeof planPaste>;
export function savePaste(store: Store, input: unknown) {
  const request = validate(pasteRequest, input) as Request;
  return store.transaction(() => {
    const plan = planPaste(store, request);
    if (!request.token || request.token !== plan.token)
      throw new Conflict(
        "Preview is missing or out of date. Preview again before saving.",
        null,
      );
    const building =
      !plan.existing || plan.mode === "merge"
        ? store.saveBuilding(plan.building, plan.existing?.id)
        : plan.existing;
    for (const unit of plan.units)
      store.saveUnit(
        { ...unit.after, building_id: building.id },
        unit.existing_id ?? undefined,
      );
    return { building_id: building.id, units_saved: plan.units.length };
  });
}
