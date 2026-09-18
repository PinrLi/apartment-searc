import {
  defaults,
  type Building,
  type Unit,
  type Settings,
  type Status,
} from "./model";
const clamp = (v: number) => Math.max(0, Math.min(100, v));
export function priceScore(cost: number, s: Settings = defaults): number {
  const p = s.price_points;
  if (cost <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++)
    if (cost <= p[i][0])
      return (
        p[i - 1][1] +
        ((p[i][1] - p[i - 1][1]) * (cost - p[i - 1][0])) /
          (p[i][0] - p[i - 1][0])
      );
  return p[p.length - 1][1];
}
export function leaseScore(months: number | null, s: Settings = defaults) {
  return s.lease_scores[
    months === null
      ? "unknown"
      : months <= 12
        ? "up_to_12"
        : months <= 15
          ? "up_to_15"
          : months <= 18
            ? "up_to_18"
            : "over_18"
  ];
}
export function buildingFilters(b: Building, s: Settings) {
  const failures: string[] = [],
    unresolved: string[] = [];
  if (b.has_in_unit_washer_dryer === "no")
    failures.push("No in-unit washer/dryer");
  if (b.has_in_unit_washer_dryer === "unknown")
    unresolved.push("In-unit washer/dryer is unknown");
  if (["none", "street_only"].includes(b.parking_type))
    failures.push("No acceptable parking");
  if (b.parking_type === "unknown") unresolved.push("Parking type is unknown");
  for (const [label, value, min] of [
    ["Safety", b.safety_score, s.min_safety],
    ["Quiet", b.quiet_score, s.min_quiet],
  ] as const) {
    if (value === null) unresolved.push(`${label} score is unknown`);
    else if (value < min)
      failures.push(`${label} ${value} is below minimum ${min}`);
  }
  if (b.max_floorplan_sqft !== null && b.max_floorplan_sqft < s.min_sqft)
    failures.push(
      `All floorplans below ${s.min_sqft} sqft (confirmed maximum ${b.max_floorplan_sqft})`,
    );
  return { failures, unresolved };
}
function baseComponents(b: Building, s: Settings) {
  const quality = [b.building_quality_score, b.management_score].filter(
    (n): n is number => n !== null,
  );
  return {
    quiet: (b.quiet_score ?? 5) * 10,
    safety: (b.safety_score ?? 5) * 10,
    commute: (b.commute_score ?? 5) * 10,
    parking: s.parking_scores[b.parking_type],
    building: quality.length
      ? (quality.reduce((a, v) => a + v, 0) / quality.length) * 10
      : 50,
  };
}
export function buildingScore(b: Building, s: Settings) {
  const c = baseComponents(b, s);
  const keys = Object.keys(c) as (keyof typeof c)[];
  const total = keys.reduce((a, k) => a + s.weights[k], 0);
  return total ? keys.reduce((a, k) => a + c[k] * s.weights[k], 0) / total : 0;
}
export function evaluateUnit(b: Building, u: Unit, s: Settings = defaults) {
  const bf = buildingFilters(b, s),
    hard_fail_reasons = [...bf.failures],
    unresolved = [...bf.unresolved],
    warnings: string[] = [];
  const base_plus_parking =
    u.base_rent === null || u.parking_cost === null
      ? null
      : u.base_rent + u.parking_cost;
  const total_mandatory_monthly_cost =
    base_plus_parking === null || u.mandatory_monthly_fees === null
      ? null
      : base_plus_parking + u.mandatory_monthly_fees;
  if (u.sqft === null) unresolved.push("Square footage is unknown");
  else if (u.sqft < s.min_sqft)
    hard_fail_reasons.push(`Unit ${u.sqft} sqft is below ${s.min_sqft} sqft`);
  if (base_plus_parking === null)
    unresolved.push("Base rent or parking cost is unknown");
  else if (base_plus_parking >= s.budget)
    hard_fail_reasons.push(
      `Base + parking $${base_plus_parking} must be under $${s.budget}`,
    );
  if (!u.available_date) unresolved.push("Availability is unknown");
  else if (u.available_date < s.earliest || u.available_date > s.latest)
    hard_fail_reasons.push(
      `Availability ${u.available_date} is outside ${s.earliest} – ${s.latest}`,
    );
  if (!u.active) hard_fail_reasons.push("Unit is inactive");
  if (u.lease_length_months === null)
    warnings.push("Lease length unknown; neutral lease score");
  if (u.mandatory_monthly_fees === null)
    warnings.push("Mandatory fees unknown; total cost is incomplete");
  if (!u.unit_number)
    warnings.push(
      "Unit number missing; duplicates cannot be reliably detected",
    );
  if (b.commute_score === null || b.building_quality_score === null)
    warnings.push("Some qualitative scores unknown; neutral values used");
  const size =
    u.sqft === null
      ? 50
      : clamp(
          s.size_min_score +
            ((u.sqft - s.min_sqft) / (s.size_cap - s.min_sqft)) *
              (100 - s.size_min_score),
        );
  const components = {
    ...baseComponents(b, s),
    price: base_plus_parking === null ? 50 : priceScore(base_plus_parking, s),
    unit:
      u.unit_quality_score === null
        ? size
        : size * (1 - s.layout_share) +
          u.unit_quality_score * 10 * s.layout_share,
    lease: leaseScore(u.lease_length_months, s),
  };
  const unit_score = Object.entries(components).reduce(
    (a, [k, v]) => a + (v * s.weights[k as keyof typeof components]) / 100,
    0,
  );
  const passes_hard_filters =
    hard_fail_reasons.length === 0 && unresolved.length === 0;
  const auto_status: Status = hard_fail_reasons.length
    ? "REJECTED"
    : unresolved.length
      ? "UNREVIEWED"
      : "SHORTLIST";
  return {
    ...u,
    base_plus_parking,
    total_mandatory_monthly_cost,
    budget_margin:
      base_plus_parking === null ? null : s.budget - base_plus_parking,
    passes_hard_filters,
    hard_fail_reasons,
    unresolved,
    warnings,
    unit_score,
    components,
    auto_status,
  };
}
export function evaluateBuilding(
  b: Building,
  units: Unit[],
  s: Settings = defaults,
) {
  const evaluated = units
    .filter((u) => u.building_id === b.id)
    .map((u) => evaluateUnit(b, u, s));
  const best =
    evaluated
      .filter((u) => u.passes_hard_filters)
      .sort(
        (a, b) => b.unit_score - a.unit_score || a.id.localeCompare(b.id),
      )[0] ?? null;
  const { failures, unresolved } = buildingFilters(b, s);
  const auto_status: Status = failures.length
    ? "REJECTED"
    : unresolved.length
      ? "UNREVIEWED"
      : best
        ? "SHORTLIST"
        : "WATCH";
  return {
    ...b,
    building_score: buildingScore(b, s),
    auto_status,
    final_status: b.manual_status_override ?? auto_status,
    best_unit: best,
    opportunity_score: best?.unit_score ?? null,
    units: evaluated,
    failures,
    unresolved,
  };
}
export type EvaluatedBuilding = ReturnType<typeof evaluateBuilding>;
export type EvaluatedUnit = ReturnType<typeof evaluateUnit>;
export function rankBuildings(
  buildings: EvaluatedBuilding[],
  pureScore = false,
) {
  const priority: Record<string, number> = {
    FINALIST: 0,
    TOUR: 1,
    SHORTLIST: 2,
    WATCH: 3,
    UNREVIEWED: 4,
  };
  return buildings
    .filter((b) => b.final_status !== "REJECTED" && b.final_status !== "SIGNED")
    .sort(
      (a, b) =>
        (pureScore ? 0 : priority[a.final_status] - priority[b.final_status]) ||
        (b.opportunity_score ?? b.building_score) -
          (a.opportunity_score ?? a.building_score) ||
        a.name.localeCompare(b.name),
    );
}
