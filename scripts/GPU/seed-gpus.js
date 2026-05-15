/**
 * seed-gpus.js
 * Carica GPU.csv su Neon con tutti i campi stimati.
 *
 * Crea prima su Neon:
 *
 * CREATE TABLE IF NOT EXISTS gpus (
 *   id           SERIAL PRIMARY KEY,
 *   name         TEXT NOT NULL,
 *   brand        TEXT NOT NULL,
 *   chipset      TEXT,
 *   vram_gb      SMALLINT,
 *   resolution   TEXT,
 *   tdp_w        SMALLINT,
 *   length_mm    SMALLINT,
 *   pcie_version SMALLINT,
 *   price_eur    NUMERIC(8,2),
 *   image_url    TEXT,
 *   created_at   TIMESTAMPTZ DEFAULT NOW()
 * );
 * CREATE INDEX IF NOT EXISTS idx_gpus_chipset ON gpus (chipset);
 * CREATE INDEX IF NOT EXISTS idx_gpus_length  ON gpus (length_mm);
 *
 * Uso:
 *   node scripts/GPU/seed-gpus.js --csv ./scripts/GPU/GPU.csv
 *   node scripts/GPU/seed-gpus.js --csv ./scripts/GPU/GPU.csv --drop
 */

import "dotenv/config";
import { createReadStream } from "fs";
import { parse } from "csv-parse";
import pg from "pg";
import path from "path";

const { Pool } = pg;

const CSV_PATH = process.argv.includes("--csv")
  ? process.argv[process.argv.indexOf("--csv") + 1]
  : "./GPU.csv";

const DROP_FIRST = process.argv.includes("--drop");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Chipset dal nome ──────────────────────────────────────────────────────────
function extractChipset(name) {
  const m = name.match(/\b(RTX\s?\d{4}(?:\s?Ti|(?:\s?Super))?|GTX\s?\d{4}(?:\s?Ti|(?:\s?Super))?|RX\s?\d{4}(?:\s?XT)?|Arc\s?A\d{3,4}(?:\s?M)?)/i);
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

// ── PCIe version dalla generazione chipset ────────────────────────────────────
function inferPcieVersion(name) {
  const n = name.toUpperCase();
  // RTX 30xx, 40xx, RX 6xxx, 7xxx → PCIe 4
  if (/RTX\s?[34]\d{3}/.test(n)) return 4;
  if (/RX\s?[67]\d{3}/.test(n))  return 4;
  if (/ARC\s?A\d{3}/.test(n))    return 4;
  // RTX 20xx, GTX 16xx, RX 5xxx → PCIe 3
  if (/RTX\s?2\d{3}/.test(n))    return 3;
  if (/GTX\s?1\d{3}/.test(n))    return 3;
  if (/RX\s?5\d{3}/.test(n))     return 3;
  return 3; // default safe
}

// ── Fan count dal nome ────────────────────────────────────────────────────────
function fanCount(name) {
  const n = name.toLowerCase();
  if (n.includes("trio") || n.includes("triple") || n.includes("3x") ||
      n.includes("xt3") || n.includes("tuf") || n.includes("3-fan") ||
      n.includes("gaming x trio") || n.includes("suprim x") ||
      n.includes("strix") || n.includes("gaming oc") && /rtx\s?[34]\d{3}/i.test(n)) return 3;
  if (n.includes("mini") || n.includes("itx") || n.includes("low profile") ||
      n.includes("lp") || n.includes("single") || n.includes("1-fan")) return 1;
  return 2; // dual fan default
}

// ── GPU length dal chipset tier + fan count ───────────────────────────────────
// Valori medi reali di mercato per categoria
function inferLength(name) {
  const n   = name.toUpperCase();
  const fan = fanCount(name);

  // Flagship (4090, 3090, 6900XT, 7900XTX)
  if (/RTX\s?4090|RTX\s?3090|RX\s?6900|RX\s?7900/.test(n)) {
    return fan >= 3 ? 340 : 300;
  }
  // High-end (4080, 4070Ti, 3080, 3080Ti, 6800XT, 7800XT)
  if (/RTX\s?4080|RTX\s?4070\s?Ti|RTX\s?3080|RX\s?6800|RX\s?7800/.test(n)) {
    return fan >= 3 ? 320 : 285;
  }
  // Mid-high (4070, 3070, 6700XT, 7700XT, 2080)
  if (/RTX\s?4070|RTX\s?3070|RX\s?6700|RX\s?7700|RTX\s?2080/.test(n)) {
    return fan >= 3 ? 305 : 270;
  }
  // Mid (4060Ti, 3060Ti, 6650XT, 7600XT, 2070, 1080)
  if (/RTX\s?4060\s?Ti|RTX\s?3060\s?Ti|RX\s?6650|RX\s?7600|RTX\s?2070|GTX\s?1080/.test(n)) {
    return fan >= 3 ? 285 : 255;
  }
  // Entry-mid (4060, 3060, 6600, 7600, 2060, 1070)
  if (/RTX\s?4060|RTX\s?3060|RX\s?6600|RX\s?7600|RTX\s?2060|GTX\s?1070/.test(n)) {
    return fan >= 3 ? 270 : 242;
  }
  // Budget (1060, 1660, 3050, 6500)
  if (/GTX\s?1660|GTX\s?1060|RTX\s?3050|RX\s?6500|RX\s?6400/.test(n)) {
    return fan === 1 ? 170 : 220;
  }
  // Low-end (1050, 1030, RX 550)
  if (/GTX\s?1050|GTX\s?1030|RX\s?5[56]0/.test(n)) {
    return fan === 1 ? 150 : 190;
  }

  // Fallback per fan
  if (fan === 1) return 170;
  if (fan === 3) return 290;
  return 240;
}

// ── Pricing ───────────────────────────────────────────────────────────────────
// Range reali EU 2024
const CHIPSET_PRICE = {
  // NVIDIA RTX 40xx
  "RTX 4090": 1700, "RTX 4080": 1050, "RTX 4080 Super": 1000,
  "RTX 4070 Ti": 800, "RTX 4070 Ti Super": 820,
  "RTX 4070 Super": 600, "RTX 4070": 560,
  "RTX 4060 Ti": 420, "RTX 4060": 310,
  // NVIDIA RTX 30xx
  "RTX 3090 Ti": 900, "RTX 3090": 800,
  "RTX 3080 Ti": 700, "RTX 3080": 600,
  "RTX 3070 Ti": 480, "RTX 3070": 420,
  "RTX 3060 Ti": 330, "RTX 3060": 280,
  "RTX 3050": 200,
  // NVIDIA RTX 20xx
  "RTX 2080 Ti": 700, "RTX 2080 Super": 550, "RTX 2080": 500,
  "RTX 2070 Super": 420, "RTX 2070": 380,
  "RTX 2060 Super": 320, "RTX 2060": 280,
  // NVIDIA GTX 16xx
  "GTX 1660 Ti": 200, "GTX 1660 Super": 180, "GTX 1660": 160,
  "GTX 1650 Super": 140, "GTX 1650": 120,
  // NVIDIA GTX 10xx
  "GTX 1080 Ti": 280, "GTX 1080": 220,
  "GTX 1070 Ti": 180, "GTX 1070": 155,
  "GTX 1060": 120, "GTX 1050 Ti": 90, "GTX 1050": 70,
  // AMD RX 7xxx
  "RX 7900 XTX": 950, "RX 7900 XT": 780,
  "RX 7800 XT": 480, "RX 7700 XT": 380,
  "RX 7600 XT": 290, "RX 7600": 260,
  // AMD RX 6xxx
  "RX 6950 XT": 700, "RX 6900 XT": 620,
  "RX 6800 XT": 520, "RX 6800": 460,
  "RX 6750 XT": 380, "RX 6700 XT": 340, "RX 6700": 300,
  "RX 6650 XT": 240, "RX 6600 XT": 210, "RX 6600": 190,
  "RX 6500 XT": 130, "RX 6400": 110,
  // AMD RX 5xxx
  "RX 5700 XT": 280, "RX 5700": 240,
  "RX 5600 XT": 190, "RX 5500 XT": 150,
};

function estimatePrice(name, tdp) {
  const chipset = extractChipset(name);
  const n = name.toLowerCase();

  // Cerca match esatto o parziale nella lookup
  let base = null;
  if (chipset) {
    const key = Object.keys(CHIPSET_PRICE).find(k =>
      chipset.toUpperCase().includes(k.toUpperCase()) ||
      k.toUpperCase().includes(chipset.toUpperCase())
    );
    if (key) base = CHIPSET_PRICE[key];
  }

  // Fallback su TDP se chipset non trovato
  if (!base) {
    if      (tdp >= 350) base = 900;
    else if (tdp >= 250) base = 500;
    else if (tdp >= 150) base = 280;
    else if (tdp >= 100) base = 160;
    else                 base = 90;
  }

  // Varianti premium/budget dal nome
  if (n.includes("ti super") || n.includes("xt"))   base *= 1.05;
  if (n.includes("strix") || n.includes("suprim"))  base *= 1.10;
  if (n.includes("founders") || n.includes("reference")) base *= 0.98;
  if (n.includes(" oc ") || n.includes(" oc)"))     base *= 1.03;

  base = Math.max(60, Math.min(2000, base));
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
  INSERT INTO gpus (name, brand, chipset, vram_gb, resolution, tdp_w, length_mm, pcie_version, price_eur, image_url)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
`;

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const client = await pool.connect();
  try {
    console.log(`📂 Lettura: ${path.resolve(CSV_PATH)}`);
    const rows = await readCsv(CSV_PATH);
    console.log(`   ${rows.length} righe trovate\n`);

    if (DROP_FIRST) {
      await client.query("DROP TABLE IF EXISTS gpus");
      console.log("🗑  DROP TABLE gpus\n");
    }

    let ok = 0, fail = 0;
    for (const row of rows) {
      const tdp = parseInt(row.power) || 100;
      try {
        await client.query(INSERT_SQL, [
          row.name,
          row.brand,
          extractChipset(row.name),
          parseInt(row.VRAM) || null,
          row.resolution || null,
          tdp,
          inferLength(row.name),
          inferPcieVersion(row.name),
          estimatePrice(row.name, tdp),
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

    // Campione verifica
    const { rows: sample } = await client.query(`
      SELECT brand, chipset, vram_gb, tdp_w, length_mm, pcie_version, price_eur,
             LEFT(name,40) AS name
      FROM gpus ORDER BY RANDOM() LIMIT 6
    `);
    console.log("Campione dati:");
    sample.forEach(r =>
      console.log(
        `  [${(r.brand||'').padEnd(6)}] ${(r.chipset||'?').padEnd(14)} ` +
        `${r.vram_gb}GB  ${r.tdp_w}W  ${r.length_mm}mm  PCIe${r.pcie_version}  €${r.price_eur}`
      )
    );

    // Distribuzione prezzi
    const { rows: dist } = await client.query(`
      SELECT
        CASE
          WHEN price_eur < 150  THEN '< €150  (budget)'
          WHEN price_eur < 300  THEN '€150-300 (entry)'
          WHEN price_eur < 500  THEN '€300-500 (mid)'
          WHEN price_eur < 800  THEN '€500-800 (high)'
          ELSE                       '> €800   (flagship)'
        END AS fascia,
        COUNT(*) AS n,
        ROUND(MIN(price_eur),2) AS min,
        ROUND(MAX(price_eur),2) AS max
      FROM gpus
      GROUP BY fascia ORDER BY min
    `);
    console.log("\nDistribuzione prezzi:");
    dist.forEach(r =>
      console.log(`  ${r.fascia.padEnd(24)} ${String(r.n).padStart(4)} GPU  €${r.min}–€${r.max}`)
    );

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
