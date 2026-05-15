/**
 * seed-storage.js
 *
 * Crea prima su Neon:
 *
 * CREATE TABLE IF NOT EXISTS storage (
 *   id           SERIAL PRIMARY KEY,
 *   name         TEXT NOT NULL,
 *   type         TEXT NOT NULL,
 *   form_factor  TEXT NOT NULL,
 *   capacity_gb  SMALLINT NOT NULL,
 *   pcie_gen     SMALLINT,
 *   price_eur    NUMERIC(8,2),
 *   image_url    TEXT,
 *   created_at   TIMESTAMPTZ DEFAULT NOW()
 * );
 * CREATE INDEX IF NOT EXISTS idx_storage_type       ON storage (type);
 * CREATE INDEX IF NOT EXISTS idx_storage_form_factor ON storage (form_factor);
 *
 * Uso:
 *   node scripts/Storage/seed-storage.js --csv ./scripts/Storage/Storage.csv
 */

import "dotenv/config";
import { createReadStream } from "fs";
import { parse } from "csv-parse";
import pg from "pg";
import path from "path";

const { Pool } = pg;

const CSV_PATH = process.argv.includes("--csv")
  ? process.argv[process.argv.indexOf("--csv") + 1]
  : "./Storage.csv";

const DROP_FIRST = process.argv.includes("--drop");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Estrazione dal nome ───────────────────────────────────────────────────────

function extractPcieGen(name) {
  const m = name.match(/PCIe\s*(\d+)\.0/i);
  return m ? parseInt(m[1]) : null;
}

function extractFormFactor(name) {
  const n = name.toUpperCase();
  if (n.includes("M.2") || n.includes("M2-"))  return "M.2";
  if (n.includes("2.5"))                         return "2.5";
  if (n.includes("3.5"))                         return "3.5";
  return "M.2"; // fallback NVMe senza indicazione
}

// ── Brand multiplier ──────────────────────────────────────────────────────────
const BRANDS = {
  "samsung":    1.25,
  "sony":       1.10,
  "wd black":   1.20,
  "western digital": 1.10,
  "wd":         1.05,
  "seagate":    1.00,
  "crucial":    1.00,
  "kingston":   0.95,
  "sk hynix":   1.15,
  "sabrent":    0.90,
  "teamgroup":  0.85,
  "pny":        0.88,
  "corsair":    1.10,
  "silicon power": 0.80,
  "lexar":      0.90,
  "addlink":    0.82,
};

function brandMult(name) {
  const n = name.toLowerCase();
  for (const [brand, mult] of Object.entries(BRANDS)) {
    if (n.includes(brand)) return mult;
  }
  return 0.88;
}

// ── Pricing ───────────────────────────────────────────────────────────────────
// Prezzi base EU 2024 per tipo + capacità
const BASE = {
  NVME: { 250: 40, 500: 65, 1000: 100, 2000: 180 },
  SATA: { 250: 30, 500: 50, 1000: 80,  2000: 140 },
  HDD:  { 250: 25, 500: 35, 1000: 45,  2000: 65  },
};

function estimatePrice(name, type, capacityGb) {
  const prices = BASE[type] ?? BASE["SATA"];
  const keys   = Object.keys(prices).map(Number).sort((a, b) => a - b);
  const closest = keys.reduce((prev, curr) =>
    Math.abs(curr - capacityGb) < Math.abs(prev - capacityGb) ? curr : prev
  );
  let base = prices[closest];

  // PCIe 5 → +30%, PCIe 4 → standard, PCIe 3 → -10%
  const pcie = extractPcieGen(name);
  if (pcie === 5) base *= 1.30;
  if (pcie === 3) base *= 0.90;

  // Serie premium dal nome
  const n = name.toLowerCase();
  if (n.includes("980 pro") || n.includes("990 pro") || n.includes("firecuda") ||
      n.includes("wd black") || n.includes("sn850"))   base *= 1.30;
  if (n.includes("evo plus") || n.includes("sn770") ||
      n.includes("p5 plus"))                            base *= 1.15;
  if (n.includes("barracuda") || n.includes("ironwolf")) base *= 1.05;

  base *= brandMult(name);
  base = Math.max(18, Math.min(400, base));
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
  INSERT INTO storage (name, type, form_factor, capacity_gb, pcie_gen, price_eur, image_url)
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
      await client.query("DROP TABLE IF EXISTS storage");
      console.log("🗑  DROP TABLE storage\n");
    }

    let ok = 0, fail = 0;
    for (const row of rows) {
      const capacity = parseInt(row.space);
      try {
        await client.query(INSERT_SQL, [
          row.name,
          row.type,
          extractFormFactor(row.name),
          capacity,
          extractPcieGen(row.name),
          estimatePrice(row.name, row.type, capacity),
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
      SELECT type, form_factor, capacity_gb, pcie_gen, price_eur,
             LEFT(name,45) AS name
      FROM storage ORDER BY RANDOM() LIMIT 6
    `);
    console.log("Campione dati:");
    sample.forEach(r =>
      console.log(
        `  [${r.type.padEnd(5)}] ${r.form_factor.padEnd(4)} ` +
        `${String(r.capacity_gb).padStart(4)}GB ` +
        `PCIe${r.pcie_gen ?? '-'}  €${r.price_eur}  ${r.name}`
      )
    );

    // Distribuzione
    const { rows: dist } = await client.query(`
      SELECT type,
        CASE
          WHEN price_eur < 40  THEN '< €40'
          WHEN price_eur < 80  THEN '€40-80'
          WHEN price_eur < 130 THEN '€80-130'
          ELSE                      '> €130'
        END AS fascia,
        COUNT(*) AS n,
        ROUND(MIN(price_eur),2) AS min,
        ROUND(MAX(price_eur),2) AS max
      FROM storage
      GROUP BY type, fascia ORDER BY type, min
    `);
    console.log("\nDistribuzione prezzi:");
    dist.forEach(r =>
      console.log(`  ${r.type.padEnd(6)} ${r.fascia.padEnd(10)} ${String(r.n).padStart(4)} drive  €${r.min}–€${r.max}`)
    );

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
