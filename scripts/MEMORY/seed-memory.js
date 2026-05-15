/**
 * seed-memory.js
 * Carica Memory.csv su Neon con tutti i campi stimati.
 *
 * Crea prima su Neon:
 *
 * CREATE TABLE IF NOT EXISTS memory (
 *   id         SERIAL PRIMARY KEY,
 *   name       TEXT NOT NULL,
 *   type       TEXT NOT NULL,
 *   capacity_gb SMALLINT NOT NULL,
 *   speed_mhz  SMALLINT,
 *   sticks     SMALLINT,
 *   cl         SMALLINT,
 *   price_eur  NUMERIC(8,2),
 *   image_url  TEXT,
 *   created_at TIMESTAMPTZ DEFAULT NOW()
 * );
 * CREATE INDEX IF NOT EXISTS idx_memory_type  ON memory (type);
 * CREATE INDEX IF NOT EXISTS idx_memory_speed ON memory (speed_mhz);
 *
 * Uso:
 *   node scripts/Memory/seed-memory.js --csv ./scripts/Memory/Memory.csv
 */

import "dotenv/config";
import { createReadStream } from "fs";
import { parse } from "csv-parse";
import pg from "pg";
import path from "path";

const { Pool } = pg;

const CSV_PATH = process.argv.includes("--csv")
  ? process.argv[process.argv.indexOf("--csv") + 1]
  : "./Memory.csv";

const DROP_FIRST = process.argv.includes("--drop");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Estrazione dal nome ───────────────────────────────────────────────────────

function extractSpeed(name) {
  const m = name.match(/DDR[345]?-(\d{3,5})/i);
  return m ? parseInt(m[1]) : null;
}

function extractSticks(name) {
  const m = name.match(/\((\d+)\s*x/i);
  return m ? parseInt(m[1]) : 1;
}

function extractCl(name) {
  const m = name.match(/\bCL(\d{1,2})\b/i);
  return m ? parseInt(m[1]) : null;
}

// ── Brand multiplier ──────────────────────────────────────────────────────────
const BRANDS = {
  "g.skill":   1.15,
  "corsair":   1.10,
  "kingston fury": 1.10,
  "kingston":  1.00,
  "crucial":   1.00,
  "teamgroup": 0.90,
  "patriot":   0.88,
  "silicon power": 0.82,
  "samsung":   1.05,
  "sk hynix":  1.05,
};

function brandMult(name) {
  const n = name.toLowerCase();
  for (const [brand, mult] of Object.entries(BRANDS)) {
    if (n.includes(brand)) return mult;
  }
  return 0.88;
}

// ── Pricing ───────────────────────────────────────────────────────────────────
// Prezzi base per tipo + capacità (EU 2024, kit completo)
// DDR3 è obsoleta → molto economica
// DDR5 premium rispetto a DDR4

const BASE_PRICE = {
  DDR3: { 4: 18, 8: 28, 16: 42, 32: 70,  64: 130, 128: 220 },
  DDR4: { 4: 22, 8: 32, 16: 55, 32: 95,  64: 170, 128: 300 },
  DDR5: { 8: 45, 16: 75, 32: 130, 64: 220, 96: 320, 128: 420, 192: 600, 256: 800 },
};

function estimatePrice(name, type, capacityGb, speedMhz) {
  const prices = BASE_PRICE[type] ?? BASE_PRICE["DDR4"];

  // Trova la capacità più vicina nella lookup
  const keys  = Object.keys(prices).map(Number).sort((a, b) => a - b);
  const closest = keys.reduce((prev, curr) =>
    Math.abs(curr - capacityGb) < Math.abs(prev - capacityGb) ? curr : prev
  );
  let base = prices[closest];

  // Speed modifier: ogni 400MHz sopra il base → +5%
  const baseSpeed = type === "DDR5" ? 4800 : type === "DDR4" ? 2133 : 1600;
  if (speedMhz && speedMhz > baseSpeed) {
    const steps = Math.floor((speedMhz - baseSpeed) / 400);
    base *= (1 + steps * 0.05);
  }

  // Serie premium dal nome
  const n = name.toLowerCase();
  if (n.includes("trident") || n.includes("dominator") || n.includes("lancer")) base *= 1.20;
  if (n.includes("rgb"))  base *= 1.10;
  if (n.includes("ecc"))  base *= 1.30; // ECC server memory

  base *= brandMult(name);
  base = Math.max(12, Math.min(900, base));
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
  INSERT INTO memory (name, type, capacity_gb, speed_mhz, sticks, cl, price_eur, image_url)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
`;

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const client = await pool.connect();
  try {
    console.log(`📂 Lettura: ${path.resolve(CSV_PATH)}`);
    const rows = await readCsv(CSV_PATH);
    console.log(`   ${rows.length} righe trovate\n`);

    if (DROP_FIRST) {
      await client.query("DROP TABLE IF EXISTS memory");
      console.log("🗑  DROP TABLE memory\n");
    }

    let ok = 0, fail = 0;
    for (const row of rows) {
      const speed = extractSpeed(row.name);
      const capacity = parseInt(row.size);
      try {
        await client.query(INSERT_SQL, [
          row.name,
          row.type,
          capacity,
          speed,
          extractSticks(row.name),
          extractCl(row.name),
          estimatePrice(row.name, row.type, capacity, speed),
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
      SELECT type, capacity_gb, speed_mhz, sticks, cl, price_eur, LEFT(name,45) AS name
      FROM memory ORDER BY RANDOM() LIMIT 6
    `);
    console.log("Campione dati:");
    sample.forEach(r =>
      console.log(
        `  [${r.type.padEnd(5)}] ${String(r.capacity_gb).padStart(3)}GB ` +
        `${String(r.speed_mhz??'-').padStart(4)}MHz ` +
        `${r.sticks}x CL${r.cl??'?'}  €${r.price_eur}  ${r.name}`
      )
    );

    // Distribuzione
    const { rows: dist } = await client.query(`
      SELECT type,
        CASE
          WHEN price_eur < 40  THEN '< €40'
          WHEN price_eur < 80  THEN '€40-80'
          WHEN price_eur < 150 THEN '€80-150'
          WHEN price_eur < 300 THEN '€150-300'
          ELSE                      '> €300'
        END AS fascia,
        COUNT(*) AS n,
        ROUND(MIN(price_eur),2) AS min,
        ROUND(MAX(price_eur),2) AS max
      FROM memory
      GROUP BY type, fascia ORDER BY type, min
    `);
    console.log("\nDistribuzione prezzi:");
    dist.forEach(r =>
      console.log(`  ${r.type.padEnd(6)} ${r.fascia.padEnd(10)} ${String(r.n).padStart(4)} kit  €${r.min}–€${r.max}`)
    );

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
