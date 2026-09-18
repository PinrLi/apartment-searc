import type { Building } from "./model";
import { normalizeAddress } from "./normalize";

const fold = (value: string) => value.toLowerCase().trim().replace(/\s+/g, " ");
const compact = (value: string) => fold(value).replace(/[^\p{L}\p{N}]/gu, "");

// One edit (including a transposition) is enough for small typing mistakes.
// Only apply this to queries of at least four characters to avoid noisy results.
function oneEditAway(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    return (
      a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] &&
        a[i + 1] === b[i] &&
        a.slice(i + 2) === b.slice(i + 2))
    );
  }
  return a.length > b.length
    ? a.slice(i + 1) === b.slice(i)
    : a.slice(i) === b.slice(i + 1);
}

type Searchable = Pick<
  Building,
  "id" | "name" | "address" | "normalized_address"
> & { aliases?: string[] };
export function createBuildingSearchIndex<T extends Searchable>(
  buildings: readonly T[],
) {
  return buildings.map((building) => ({
    building,
    name: fold(building.name),
    aliases: (building.aliases ?? []).map(fold),
    names: [building.name, ...(building.aliases ?? [])].map(compact),
    tokens: [building.name, ...(building.aliases ?? [])].flatMap((name) =>
      fold(name).split(/\s+/).map(compact),
    ),
    address: fold(building.address),
    normalizedAddress: fold(
      building.normalized_address || normalizeAddress(building.address),
    ),
  }));
}

export function searchBuildingIndex<T extends Searchable>(
  index: ReturnType<typeof createBuildingSearchIndex<T>>,
  query: string,
): T[] {
  const q = fold(query),
    squeezed = compact(query),
    address = normalizeAddress(query);
  if (!q || !squeezed) return [];
  return index
    .map((entry) => {
      const priority =
        entry.name === q
          ? 0
          : entry.aliases.includes(q)
            ? 1
            : entry.name.startsWith(q)
              ? 2
              : entry.name.includes(q) ||
                  entry.aliases.some((alias) => alias.includes(q)) ||
                  entry.names.some((name) => name.includes(squeezed))
                ? 3
                : squeezed.length >= 4 &&
                    [...entry.names, ...entry.tokens].some((name) =>
                      oneEditAway(squeezed, name),
                    )
                  ? 3
                  : entry.address.includes(q) ||
                      (address && entry.normalizedAddress.includes(address))
                    ? 4
                    : -1;
      return { ...entry, priority };
    })
    .filter((entry) => entry.priority >= 0)
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        a.name.localeCompare(b.name) ||
        a.building.id.localeCompare(b.building.id),
    )
    .map((entry) => entry.building);
}

export function searchBuildings<T extends Searchable>(
  buildings: readonly T[],
  query: string,
): T[] {
  return searchBuildingIndex(createBuildingSearchIndex(buildings), query);
}
