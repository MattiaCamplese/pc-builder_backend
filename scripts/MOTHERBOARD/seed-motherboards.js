/**
 * seed-motherboards.js
 *
 * Crea prima su Neon:
 *
 * CREATE TABLE IF NOT EXISTS motherboards (
 *   id           SERIAL PRIMARY KEY,
 *   name         TEXT NOT NULL,
 *   brand        TEXT NOT NULL,
 *   socket       TEXT NOT NULL,
 *   chipset      TEXT,
 *   form_factor  TEXT NOT NULL,
 *   ram_type     TEXT,
 *   ram_slots    SMALLINT,
 *   max_ram_gb   SMALLINT,
 *   m2_slots     SMALLINT,
 *   sata_ports   SMALLINT,
 *   pcie_version SMALLINT,
 *   price_eur    NUMERIC(8,2),
 *   image_url    TEXT,
 *   created_at   TIMESTAMPTZ DEFAULT NOW()
 * );
 * CREATE INDEX IF NOT EXISTS idx_mb_socket      ON motherboards (socket);
 * CREATE INDEX IF NOT EXISTS idx_mb_form_factor ON motherboards (form_factor);
 * CREATE INDEX IF NOT EXISTS idx_mb_ram_type    ON motherboards (ram_type);
 *
 * Uso:
 *   node scripts/Motherboard/seed-motherboards.js --csv ./scripts/Motherboard/Motherboard.csv
 */

import "dotenv/config";
import { createReadStream } from "fs";
import { parse } from "csv-parse";
import pg from "pg";
import path from "path";

const { Pool } = pg;

const CSV_PATH = process.argv.includes("--csv")
  ? process.argv[process.argv.indexOf("--csv") + 1]
  : "./Motherboard.csv";

const DROP_FIRST = process.argv.includes("--drop");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Form factor dal nome (più affidabile del campo size) ──────────────────────
function inferFormFactor(name) {
  const n = name.toLowerCase();
  if (n.includes("mini-itx") || n.includes("mini itx") || n.includes("itx")) return "ITX";
  if (n.includes("micro-atx") || n.includes("micro atx") || n.includes("matx") || n.includes("m-atx")) return "MicroATX";
  // Modelli che finiscono in M tipicamente sono MicroATX
  if (/\b[bzhx]\d{3}m\b/i.test(name)) return "MicroATX";
  return "ATX";
}

// ── Chipset dal nome ──────────────────────────────────────────────────────────
function extractChipset(name) {
  const m = name.match(/\b([BXHZ]\d{2,3}[A-Z]?(?:[-\s]?Plus|[-\s]?WIFI)?)\b/i);
  return m ? m[0].toUpperCase().trim() : null;
}

// ── RAM type da socket + nome ─────────────────────────────────────────────────
function inferRamType(name, socket) {
  const n = name.toUpperCase();

  // Esplicito nel nome
  if (n.includes("DDR5")) return "DDR5";
  if (n.includes("DDR4")) return "DDR4";
  if (n.includes("DDR3")) return "DDR3";

  // Da socket
  if (socket === "AM5")       return "DDR5";
  if (socket === "AM4")       return "DDR4";
  if (socket === "AM3" || socket === "AM3+") return "DDR3";
  if (socket === "LGA 1200")  return "DDR4";
  if (socket === "LGA 1151")  return "DDR4";
  if (socket === "LGA 1150")  return "DDR3";
  if (socket === "X399" || socket === "TRX40") return "DDR4";

  // LGA 1700: Z690/Z790/B760 con DDR5 sono comuni ma non la maggioranza
  // Default DDR4 — è la scelta più conservativa e più comune
  if (socket === "LGA 1700") return "DDR4";

  return "DDR4";
}

// ── RAM slots da form factor ──────────────────────────────────────────────────
function inferRamSlots(formFactor) {
  if (formFactor === "ITX")      return 2;
  if (formFactor === "MicroATX") return 4;
  return 4; // ATX
}

// ── Max RAM da form factor + chipset tier ─────────────────────────────────────
function inferMaxRam(name, formFactor) {
  const n = name.toUpperCase();
  if (formFactor === "ITX") return 64;
  // Chipset Z/X top → 128GB
  if (/\b[ZX]\d{3}/.test(n)) return 128;
  return 64;
}

// ── M.2 slots da chipset tier ─────────────────────────────────────────────────
function inferM2Slots(name, formFactor) {
  const n = name.toUpperCase();
  if (formFactor === "ITX") return 1;
  if (/\b[ZX]\d{3}/.test(n)) return 3; // Z/X series premium
  if (/\bB\d{3}/.test(n))   return 2; // B series mid
  return 1; // H series budget
}

// ── SATA ports da chipset tier ────────────────────────────────────────────────
function inferSataPorts(name, formFactor) {
  const n = name.toUpperCase();
  if (formFactor === "ITX") return 4;
  if (/\b[ZX]\d{3}/.test(n)) return 6;
  return 4;
}

// ── PCIe version da generazione chipset ───────────────────────────────────────
function inferPcieVersion(name, socket) {
  const n = name.toUpperCase();
  // AM5 → PCIe 5, ma 4 è il supporto pratico per GPU
  if (socket === "AM5") return 5;
  // Z790, B760, H770 (LGA1700 13th gen) → PCIe 5
  if (/\b[BHZX]7\d{2}/.test(n)) return 5;
  // Z690, B660 (LGA1700 12th gen), X570, B550, Z490 → PCIe 4
  if (/\b[BHZX]6\d{2}/.test(n)) return 4;
  if (/\b(X570|B550)\b/.test(n)) return 4;
  // Tutto il resto → PCIe 3
  return 3;
}

// ── Brand multiplier ──────────────────────────────────────────────────────────
const BRANDS = {
  "asus rog":   1.40,
  "asus tuf":   1.25,
  "asus":       1.15,
  "gigabyte aorus": 1.35,
  "gigabyte":   1.10,
  "msi meg":    1.40,
  "msi maq":    1.35,
  "msi":        1.10,
  "asrock taichi": 1.30,
  "asrock":     0.95,
  "biostar":    0.80,
};

function brandMult(name) {
  const n = name.toLowerCase();
  for (const [brand, mult] of Object.entries(BRANDS)) {
    if (n.includes(brand)) return mult;
  }
  return 0.95;
}

// ── Pricing ───────────────────────────────────────────────────────────────────
// Range reali EU 2024 per chipset tier
const CHIPSET_BASE = {
  // Intel 13th/12th gen
  Z790: 280, Z690: 220, H770: 180, B760: 130, H670: 160, B660: 120, H610: 90,
  // Intel 11th/10th gen
  Z590: 160, Z490: 140, H570: 130, B560: 100, H510: 75,
  // Intel 9th/8th gen
  Z390: 120, Z370: 100, H370: 90, B365: 80, B360: 70, H310: 55,
  // AMD AM5
  X670: 300, X670E: 380, B650: 180, B650E: 220, A620: 120,
  // AMD AM4
  X570: 180, B550: 120, A520: 80, X470: 120, B450: 90, A320: 65,
  // AMD AM3/older
  X399: 300, TRX40: 400, X370: 110, B350: 75,
};

function estimatePrice(name, socket, formFactor) {
  const chipset = extractChipset(name);
  const n = name.toUpperCase();
  let base = 100;

  if (chipset) {
    const key = Object.keys(CHIPSET_BASE).find(k => n.includes(k));
    if (key) base = CHIPSET_BASE[key];
  }

  // Form factor modifier
  if (formFactor === "ITX") base *= 1.20; // ITX è sempre più costoso
  if (formFactor === "MicroATX") base *= 0.92;

  base *= brandMult(name);

  // WiFi nel nome → +20€ circa
  if (name.toUpperCase().includes("WIFI") || name.toUpperCase().includes("WI-FI")) base += 20;

  base = Math.max(50, Math.min(650, base));
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
  INSERT INTO motherboards
    (name, brand, socket, chipset, form_factor, ram_type, ram_slots,
     max_ram_gb, m2_slots, sata_ports, pcie_version, price_eur, image_url)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
`;

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const client = await pool.connect();
  try {
    console.log(`📂 Lettura: ${path.resolve(CSV_PATH)}`);
    const rows = await readCsv(CSV_PATH);
    console.log(`   ${rows.length} righe trovate\n`);

    if (DROP_FIRST) {
      await client.query("DROP TABLE IF EXISTS motherboards");
      console.log("🗑  DROP TABLE motherboards\n");
    }

    let ok = 0, fail = 0;
    for (const row of rows) {
      const ff = inferFormFactor(row.name);
      try {
        await client.query(INSERT_SQL, [
          row.name,
          row.brand,
          row.socket,
          extractChipset(row.name),
          ff,
          inferRamType(row.name, row.socket),
          inferRamSlots(ff),
          inferMaxRam(row.name, ff),
          inferM2Slots(row.name, ff),
          inferSataPorts(row.name, ff),
          inferPcieVersion(row.name, row.socket),
          estimatePrice(row.name, row.socket, ff),
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
      SELECT socket, form_factor, ram_type, ram_slots, max_ram_gb,
             m2_slots, sata_ports, pcie_version, price_eur,
             LEFT(name,45) AS name
      FROM motherboards ORDER BY RANDOM() LIMIT 6
    `);
    console.log("Campione dati:");
    sample.forEach(r =>
      console.log(
        `  [${r.socket.padEnd(9)}] ${r.form_factor.padEnd(9)} ${r.ram_type} ` +
        `${r.ram_slots}slot max${r.max_ram_gb}GB M2:${r.m2_slots} SATA:${r.sata_ports} ` +
        `PCIe${r.pcie_version} €${r.price_eur}`
      )
    );

    // Distribuzione prezzi per socket
    const { rows: dist } = await client.query(`
      SELECT socket,
        CASE
          WHEN price_eur < 100 THEN '< €100'
          WHEN price_eur < 180 THEN '€100-180'
          WHEN price_eur < 300 THEN '€180-300'
          ELSE                      '> €300'
        END AS fascia,
        COUNT(*) AS n,
        ROUND(MIN(price_eur),2) AS min,
        ROUND(MAX(price_eur),2) AS max
      FROM motherboards
      GROUP BY socket, fascia ORDER BY socket, min
    `);
    console.log("\nDistribuzione prezzi per socket:");
    dist.forEach(r =>
      console.log(`  ${r.socket.padEnd(10)} ${r.fascia.padEnd(12)} ${String(r.n).padStart(4)} board  €${r.min}–€${r.max}`)
    );

    // Verifica ram_type
    const { rows: ramDist } = await client.query(`
      SELECT socket, ram_type, COUNT(*) AS n
      FROM motherboards
      GROUP BY socket, ram_type ORDER BY socket
    `);
    console.log("\nRam type per socket:");
    ramDist.forEach(r =>
      console.log(`  ${r.socket.padEnd(10)} ${r.ram_type.padEnd(6)} ${r.n}`)
    );

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
