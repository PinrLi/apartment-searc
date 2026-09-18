import { z } from "zod";

export const statuses = [
  "UNREVIEWED",
  "REJECTED",
  "WATCH",
  "SHORTLIST",
  "TOUR",
  "FINALIST",
  "SIGNED",
] as const;
export const parkingTypes = [
  "garage",
  "covered",
  "community_lot",
  "street_only",
  "none",
  "unknown",
] as const;
const score = z.number().int().min(1).max(10).nullable().default(null);
const nonnegative = z.number().finite().min(0).nullable().default(null);
const date = z
  .string()
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      !isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Use a valid YYYY-MM-DD date",
  );
const optionalDate = date.nullable().default(null);
export const buildingSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    address: z.string().trim().min(3).max(500),
    neighborhood: z.string().max(200).default(""),
    safety_score: score,
    quiet_score: score,
    commute_score: score,
    building_quality_score: score,
    management_score: score,
    smoking_policy: z.string().default("unknown"),
    parking_type: z.enum(parkingTypes).default("unknown"),
    has_in_unit_washer_dryer: z
      .enum(["yes", "no", "unknown"])
      .default("unknown"),
    max_floorplan_sqft: nonnegative,
    notes: z.string().default(""),
    manual_status_override: z.enum(statuses).nullable().default(null),
    rejection_reason: z.string().nullable().default(null),
    toured: z.boolean().default(false),
    tour_date: optionalDate,
    finalist: z.boolean().default(false),
    signed: z.boolean().default(false),
  })
  .superRefine((b, c) => {
    if (b.manual_status_override === "REJECTED" && !b.rejection_reason?.trim())
      c.addIssue({
        code: "custom",
        path: ["rejection_reason"],
        message: "Enter a rejection reason",
      });
  });
export const unitSchema = z.object({
  building_id: z.string().default(""),
  unit_number: z.string().trim().max(100).default(""),
  floorplan_name: z.string().default(""),
  sqft: nonnegative,
  base_rent: nonnegative,
  parking_cost: nonnegative,
  mandatory_monthly_fees: nonnegative,
  available_date: optionalDate,
  lease_length_months: z
    .number()
    .int()
    .min(1)
    .max(120)
    .nullable()
    .default(null),
  floor: z.number().int().nullable().default(null),
  orientation_or_view: z.string().default(""),
  concession_text: z.string().default(""),
  notes: z.string().default(""),
  unit_quality_score: score,
  active: z.boolean().default(true),
});
export const weightKeys = [
  "quiet",
  "safety",
  "price",
  "commute",
  "unit",
  "parking",
  "building",
  "lease",
] as const;
const points = z.number().finite().min(0).max(100);
export const settingsSchema = z
  .object({
    min_sqft: z.number().positive(),
    budget: z.number().positive(),
    earliest: date,
    latest: date,
    min_safety: z.number().int().min(1).max(10),
    min_quiet: z.number().int().min(1).max(10),
    weights: z.object({
      quiet: points,
      safety: points,
      price: points,
      commute: points,
      unit: points,
      parking: points,
      building: points,
      lease: points,
    }),
    price_points: z.array(z.tuple([z.number().min(0), points])).min(2),
    parking_scores: z.object({
      garage: points,
      covered: points,
      community_lot: points,
      street_only: points,
      none: points,
      unknown: points,
    }),
    lease_scores: z.object({
      up_to_12: points,
      up_to_15: points,
      up_to_18: points,
      over_18: points,
      unknown: points,
    }),
    size_cap: z.number().positive(),
    size_min_score: points,
    layout_share: z.number().min(0).max(1),
  })
  .superRefine((s, c) => {
    if (
      Math.abs(Object.values(s.weights).reduce((a, b) => a + b, 0) - 100) >
      0.001
    )
      c.addIssue({
        code: "custom",
        message: "Scoring weights must total 100%",
      });
    if (s.earliest > s.latest)
      c.addIssue({
        code: "custom",
        message: "Earliest move-in must be before latest",
      });
    if (s.size_cap <= s.min_sqft)
      c.addIssue({
        code: "custom",
        message: "Size cap must exceed minimum sqft",
      });
    if (
      s.price_points.some(
        (p, i, a) => i > 0 && (p[0] <= a[i - 1][0] || p[1] > a[i - 1][1]),
      )
    )
      c.addIssue({
        code: "custom",
        message: "Price thresholds must increase and scores must not increase",
      });
  });
export type BuildingInput = z.infer<typeof buildingSchema>;
export type UnitInput = z.infer<typeof unitSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type Status = (typeof statuses)[number];
export type Building = BuildingInput & {
  id: string;
  normalized_address: string;
  first_seen_date: string;
  last_reviewed_date: string;
  last_updated: string;
};
export type Unit = UnitInput & {
  id: string;
  normalized_unit_number: string;
  first_seen_date: string;
  last_seen_date: string;
  last_updated: string;
};
export type History = {
  id: string;
  building_id: string;
  unit_id: string | null;
  at: string;
  action: string;
  before: any;
  after: any;
};
export const defaults: Settings = {
  min_sqft: 550,
  budget: 2400,
  earliest: "2026-10-20",
  latest: "2026-11-07",
  min_safety: 6,
  min_quiet: 6,
  weights: {
    quiet: 20,
    safety: 15,
    price: 20,
    commute: 15,
    unit: 15,
    parking: 5,
    building: 5,
    lease: 5,
  },
  price_points: [
    [2000, 100],
    [2100, 85],
    [2200, 65],
    [2300, 35],
    [2400, 0],
  ],
  parking_scores: {
    garage: 100,
    covered: 90,
    community_lot: 70,
    street_only: 0,
    none: 0,
    unknown: 50,
  },
  lease_scores: {
    up_to_12: 100,
    up_to_15: 85,
    up_to_18: 60,
    over_18: 30,
    unknown: 50,
  },
  size_cap: 700,
  size_min_score: 50,
  layout_share: 0.5,
};
