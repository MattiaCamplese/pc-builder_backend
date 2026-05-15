/**
 * seed-psus.js
 *
 * Crea prima su Neon:
 *
 * CREATE TABLE IF NOT EXISTS psus (
 *   id           SERIAL PRIMARY KEY,
 *   name         TEXT NOT NULL,
 *   wattage_w    SMALLINT NOT NULL,
 *   form_factor  TEXT NOT NULL,
 *   efficiency   TEXT,
 *   modular      TEXT,
 *   price_eur    NUMERIC(8,2),
 *   image_url    TEXT,
 *   created_at   TIMESTAMPTZ DEFAULT NOW()
 * );
 * CREATE INDEX IF NOT EXISTS idx_psus_wattage    ON psus (wattage_w);
 * CREATE INDEX IF NOT EXISTS idx_psus_form_factor ON psus (form_factor);
 *
 * Uso:
 *   node scripts/PSU/seed-psus.js --csv ./scripts/PSU/PSU.csv
 */

import "dotenv/config";
import { createReadStream } from "fs";
import { parse } from "csv-parse";
import pg from "pg";
import path from "path";

const { Pool } = pg;

const CSV_PATH = process.argv.includes("--csv")
  ? process.argv[process.argv.indexOf("--csv") + 1]
  : "./PSU.csv";

const DROP_FIRST = process.argv.includes("--drop");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Estrazione dal nome ───────────────────────────────────────────────────────

function extractEfficiency(name) {
  const m = name.match(/80\+\s*(Bronze|Silver|Gold|Platinum|Titanium)/i);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : null;
}

function extractModular(name) {
  const n = name.toLowerCase();
  if (n.includes("fully modular"))               return "Full";
  if (n.includes("semi-modular") || n.includes("semi modular")) return "Semi";
  return "Non";
}

// ── Brand multiplier ──────────────────────────────────────────────────────────
const BRANDS = {
  "seasonic":       1.30,
  "be quiet":       1.25,
  "corsair":        1.15,
  "fractal":        1.15,
  "nzxt":           1.10,
  "super flower":   1.20,
  "asus":           1.15,
  "silverstone":    1.10,
  "evga":           1.10,
  "antec":          1.00,
  "thermaltake":    1.00,
  "cooler master":  0.95,
  "msi":            1.05,
  "gigabyte":       0.95,
  "deepcool":       0.90,
  "xpg":            1.00,
  "chieftec":       0.80,
};

function brandMult(name) {
  const n = name.toLowerCase();
  for (const [brand, mult] of Object.entries(BRANDS)) {
    if (n.includes(brand)) return mult;
  }
  return 0.85;
}

// ── Pricing ───────────────────────────────────────────────────────────────────
// Base per wattaggio (EU 2024, ATX standard)
function wattBase(watt) {
  if (watt <= 450)  return 55;
  if (watt <= 550)  return 70;
  if (watt <= 650)  return 85;
  if (watt <= 750)  return 100;
  if (watt <= 850)  return 120;
  if (watt <= 1000) return 155;
  if (watt <= 1200) return 200;
  if (watt <= 1600) return 280;
  return 380; // 1800W+
}

// Efficienza → moltiplicatore
const EFF_MULT = {
  Bronze:   1.00,
  Silver:   1.08,
  Gold:     1.18,
  Platinum: 1.35,
  Titanium: 1.55,
};

// Modular → aggiunta fissa
const MOD_ADD = { Full: 18, Semi: 8, Non: 0 };

function estimatePrice(name, watt, size) {
  let base = wattBase(watt);

  const eff     = extractEfficiency(name);
  const modular = extractModular(name);

  base *= (EFF_MULT[eff] ?? 1.05); // default ~80+ senza grado
  base += MOD_ADD[modular] ?? 0;
  base *= brandMult(name);

  // SFX costa ~25% in più per stessa potenza
  if (size === "SFX") base *= 1.25;

  base = Math.max(35, Math.min(600, base));
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
  INSERT INTO psus (name, wattage_w, form_factor, efficiency, modular, price_eur, image_url)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
`;

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const client = await pool.connect();
  try {
    console.log(`📂 Lettura: ${path.resolve(CSV_PATH)}`);
    const rows = await readCsv(CSV_PATH);
    console.log(`   ${rows.length} righe trovate\n`);

    if (DROP_FIRST) {
      await client.query("DROP TABLE IF EXISTS psus");
      console.log("🗑  DROP TABLE psus\n");
    }

    let ok = 0, fail = 0;
    for (const row of rows) {
      const watt = parseInt(row.power);
      try {
        await client.query(INSERT_SQL, [
          row.name,
          watt,
          row.size,
          extractEfficiency(row.name),
          extractModular(row.name),
          estimatePrice(row.name, watt, row.size),
          row.image || null,
        ]);
        ok++;
        process.stdout.write(`\r⬆  ${ok}/${rows.length} inseriti`);
      } catch (err) {
        fail++;
        console.error(`\n⚠️  Saltato [${row.name}]: ${err.message}`);
      }
    }

    console.log(`\n\n✅ Fatto: ${ok} inseriti, ${fail} saltati.\n`);

    // Campione
    const { rows: sample } = await client.query(`
      SELECT wattage_w, form_factor, efficiency, modular, price_eur,
             LEFT(name,45) AS name
      FROM psus ORDER BY RANDOM() LIMIT 6
    `);
    console.log("Campione dati:");
    sample.forEach(r =>
      console.log(
        `  ${String(r.wattage_w).padStart(4)}W ${r.form_factor.padEnd(4)} ` +
        `${(r.efficiency??'?').padEnd(9)} ${r.modular.padEnd(5)} €${r.price_eur}  ${r.name}`
      )
    );

    // Distribuzione
    const { rows: dist } = await client.query(`
      SELECT form_factor, efficiency,
        COUNT(*) AS n,
        ROUND(MIN(price_eur),2) AS min,
        ROUND(MAX(price_eur),2) AS max
      FROM psus
      GROUP BY form_factor, efficiency
      ORDER BY form_factor, min
    `);
    console.log("\nDistribuzione per form factor + efficienza:");
    dist.forEach(r =>
      console.log(`  ${r.form_factor.padEnd(4)} ${(r.efficiency??'?').padEnd(9)} ${String(r.n).padStart(4)} PSU  €${r.min}–€${r.max}`)
    );

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
