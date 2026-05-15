/**
 * seed-cases.js
 * Carica Case.csv su Neon con tutti i campi stimati dal nome.
 *
 * Crea prima su Neon:
 *
 * DROP TABLE IF EXISTS cases;
 * CREATE TABLE cases (
 *   id                   SERIAL PRIMARY KEY,
 *   name                 TEXT NOT NULL,
 *   form_factor          TEXT NOT NULL,
 *   psu_form_factor      TEXT,
 *   max_gpu_length_mm    SMALLINT,
 *   max_cooler_height_mm SMALLINT,
 *   radiator_support     TEXT,
 *   price_eur            NUMERIC(8,2),
 *   image_url            TEXT,
 *   created_at           TIMESTAMPTZ DEFAULT NOW()
 * );
 * CREATE INDEX IF NOT EXISTS idx_cases_form_factor ON cases (form_factor);
 * CREATE INDEX IF NOT EXISTS idx_cases_psu_ff      ON cases (psu_form_factor);
 *
 * Uso:
 *   node scripts/Case/seed-cases.js --csv ./scripts/Case/Case.csv
 *   node scripts/Case/seed-cases.js --csv ./scripts/Case/Case.csv --drop
 */

import "dotenv/config";
import { createReadStream } from "fs";
import { parse } from "csv-parse";
import pg from "pg";
import path from "path";

const { Pool } = pg;

const CSV_PATH = process.argv.includes("--csv")
  ? process.argv[process.argv.indexOf("--csv") + 1]
  : "./Case.csv";

const DROP_FIRST = process.argv.includes("--drop");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Tower type dal nome ───────────────────────────────────────────────────────
function towerType(name) {
  const n = name.toLowerCase();
  if (n.includes("full tower") || n.includes("full-tower") || n.includes("xl"))   return "full";
  if (n.includes("mini tower") || n.includes("mini-tower") || n.includes("mini")) return "mini";
  if (n.includes("micro")      || n.includes("slim"))                              return "micro";
  return "mid";
}

// ── PSU form factor ───────────────────────────────────────────────────────────
function inferPsuFormFactor(name, size) {
  const n = name.toLowerCase();
  if (n.includes("sfx") || n.includes("flex"))  return "SFX";
  if (size === "ITX")                            return "SFX";
  return "ATX";
}

// ── Max GPU length ────────────────────────────────────────────────────────────
// Valori tipici di mercato per tower type + form factor
function inferMaxGpuLength(name, size) {
  const tower = towerType(name);
  const n     = name.toLowerCase();

  // Alcuni case ITX famosi molto compatti
  if (n.includes("dan a4") || n.includes("ncase") || n.includes("louqe")) return 202;
  if (n.includes("velka") || n.includes("asus prime ap201"))               return 215;

  if (size === "ITX") {
    if (tower === "mini")  return 200;
    return 310;
  }
  if (size === "MicroATX") {
    if (tower === "mini" || tower === "micro") return 280;
    return 350;
  }
  // ATX
  if (tower === "full") return 420;
  if (tower === "mini") return 300;
  return 380; // mid tower standard
}

// ── Max cooler height ─────────────────────────────────────────────────────────
function inferMaxCoolerHeight(name, size) {
  const tower = towerType(name);
  const n     = name.toLowerCase();

  if (n.includes("dan a4") || n.includes("louqe ghost") || n.includes("velka")) return 52;
  if (n.includes("low profile") || n.includes("slim"))                           return 58;

  if (size === "ITX") {
    if (tower === "mini") return 58;
    return 65;
  }
  if (size === "MicroATX") {
    if (tower === "mini" || tower === "micro") return 150;
    return 162;
  }
  // ATX
  if (tower === "full") return 185;
  return 165;
}

// ── Radiator support ──────────────────────────────────────────────────────────
// Restituisce stringa "120,240,360" con i tagli supportati
function inferRadiatorSupport(name, size) {
  const tower = towerType(name);
  const n     = name.toLowerCase();

  if (n.includes("dan a4") || n.includes("velka") || n.includes("louqe ghost s1")) return "120";

  if (size === "ITX") {
    if (tower === "mini") return "120";
    return "120,240";
  }
  if (size === "MicroATX") {
    if (tower === "mini" || tower === "micro") return "120,240";
    return "120,240,280";
  }
  // ATX
  if (tower === "full") return "120,240,280,360,420";
  return "120,240,280,360";
}

// ── Brand multiplier ──────────────────────────────────────────────────────────
const BRANDS = {
  "lian li":        1.45,
  "fractal design": 1.35,
  "nzxt":           1.25,
  "corsair":        1.20,
  "be quiet":       1.20,
  "phanteks":       1.15,
  "silverstone":    1.10,
  "cooler master":  1.00,
  "thermaltake":    1.00,
  "antec":          0.90,
  "deepcool":       0.85,
  "bitfenix":       0.95,
};

function brandMult(name) {
  const n = name.toLowerCase();
  for (const [brand, mult] of Object.entries(BRANDS)) {
    if (n.includes(brand)) return mult;
  }
  return 0.88;
}

// ── Pricing ───────────────────────────────────────────────────────────────────
function estimatePrice(name, size) {
  const tower = towerType(name);
  const brand  = brandMult(name);
  const n      = name.toLowerCase();
  let base;

  if (size === "ITX") {
    base = tower === "mini" ? 55 : 90;
  } else if (size === "MicroATX") {
    base = tower === "full" ? 100 : tower === "mini" ? 45 : 65;
  } else {
    base = tower === "full" ? 160 : tower === "mini" ? 55 : 90;
  }

  if (n.includes("airflow") || n.includes("tempered") || n.includes("rgb")) base *= 1.10;

  base *= brand;
  base = Math.max(35, Math.min(320, base));
  return Math.round(base) - 0.01;
}

// ── CSV ───────────────────────────────────────────────────────────────────────
function readCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    createReadStream(filePath)
      .pipe(parse({ columns: true, trim: true, skip_empty_lines: true }))
      .on("data", (row) => rows.push(row))
      .on("end",  () => resolve(rows))
      .on("error", reject);
  });
}

const INSERT_SQL = `
  INSERT INTO cases
    (name, form_factor, psu_form_factor, max_gpu_length_mm,
     max_cooler_height_mm, radiator_support, price_eur, image_url)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
`;

async function insertRow(client, row) {
  await client.query(INSERT_SQL, [
    row.name,
    row.size,
    inferPsuFormFactor(row.name, row.size),
    inferMaxGpuLength(row.name, row.size),
    inferMaxCoolerHeight(row.name, row.size),
    inferRadiatorSupport(row.name, row.size),
    estimatePrice(row.name, row.size),
    row.image || null,
  ]);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const client = await pool.connect();
  try {
    console.log(`📂 Lettura: ${path.resolve(CSV_PATH)}`);
    const rows = await readCsv(CSV_PATH);
    console.log(`   ${rows.length} righe trovate\n`);

    await client.query("BEGIN");

    if (DROP_FIRST) {
      await client.query("DROP TABLE IF EXISTS cases");
      console.log("🗑  DROP TABLE cases\n");
    }

    let ok = 0, fail = 0;
    for (const row of rows) {
      try {
        await insertRow(client, row);
        ok++;
        process.stdout.write(`\r⬆  ${ok}/${rows.length} inseriti`);
      } catch (err) {
        fail++;
        console.error(`\n⚠️  Saltato [${row.name}]: ${err.message}`);
      }
    }

    await client.query("COMMIT");
    console.log(`\n\n✅ Fatto: ${ok} inseriti, ${fail} saltati.\n`);

    // Preview di alcuni record per verifica
    const { rows: sample } = await client.query(`
      SELECT form_factor, psu_form_factor,
             max_gpu_length_mm, max_cooler_height_mm,
             radiator_support, price_eur,
             LEFT(name, 45) AS name
      FROM cases
      ORDER BY RANDOM()
      LIMIT 6
    `);
    console.log("Campione dati inseriti:");
    sample.forEach(r =>
      console.log(`  [${r.form_factor.padEnd(9)}] GPU:${r.max_gpu_length_mm}mm  ` +
        `Cooler:${r.max_cooler_height_mm}mm  PSU:${r.psu_form_factor}  ` +
        `Rad:${r.radiator_support}  €${r.price_eur}  ${r.name}`)
    );

    // Distribuzione prezzi
    const { rows: dist } = await client.query(`
      SELECT form_factor,
        CASE
          WHEN price_eur < 60  THEN '< €60'
          WHEN price_eur < 100 THEN '€60-100'
          WHEN price_eur < 160 THEN '€100-160'
          ELSE                      '> €160'
        END AS fascia,
        COUNT(*) AS n
      FROM cases
      GROUP BY form_factor, fascia
      ORDER BY form_factor, fascia
    `);
    console.log("\nDistribuzione prezzi per form factor:");
    dist.forEach(r =>
      console.log(`  ${r.form_factor.padEnd(10)} ${r.fascia.padEnd(12)} ${r.n} case`)
    );

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Errore fatale:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();