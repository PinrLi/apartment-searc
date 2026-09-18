import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const source = resolve(process.env.DB_PATH ?? "data/apartments.sqlite");
if (!existsSync(source))
  throw new Error("Database does not exist yet. Start the app first.");
mkdirSync("backups", { recursive: true });
const destination = resolve(
  "backups",
  `apartments-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
);
const db = new DatabaseSync(source);
try {
  db.exec("PRAGMA busy_timeout=5000");
  db.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
  console.log(`Consistent SQLite backup saved to ${destination}`);
} finally {
  db.close();
}
