/**
 * seed-prices.js
 * Calcola e aggiunge price_eur indicativo a tutte le CPU nel DB.
 *
 * Uso:
 *   node scripts/seed-prices.js
 */

import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Logica di pricing ─────────────────────────────────────────────────────────

function estimatePrice(cpu) {
  const name = cpu.name.toLowerCase();
  const cores = cpu.core_count  || 4;
  const tdp   = cpu.tdp_w       || 65;
  const ghz   = parseFloat(cpu.speed_ghz) || 3.0;
  let base = 100;

  // ── 1. TIER BASE ──────────────────────────────────────────────────────────

  if (name.includes("threadripper")) {
    base = 600;
  } else if (name.includes("intel") || name.includes("lga")) {

    if      (name.includes("i9")) base = 500;
    else if (name.includes("i7")) base = 300;
    else if (name.includes("i5")) base = 180;
    else if (name.includes("i3")) base = 80;
    else if (name.includes("xeon")) base = 350;
    else base = 60; // Pentium, Celeron ecc.

    // ── 2a. GENERAZIONE Intel (dal numero modello) ────────────────────────
    const genMatch = name.match(/i[3579]-(\d{4,5})/);
    if (genMatch) {
      const model = parseInt(genMatch[1]);
      const gen   = model >= 10000 ? Math.floor(model / 1000) : Math.floor(model / 1000);
      if      (gen <= 7)  base *= 0.40;
      else if (gen <= 9)  base *= 0.55;
      else if (gen <= 10) base *= 0.68;
      else if (gen <= 11) base *= 0.78;
      else if (gen <= 12) base *= 0.88;
      else if (gen <= 13) base *= 0.95;
      else                base *= 1.00;
    }

  } else if (name.includes("ryzen") || name.includes("amd") || name.includes("athlon")) {

    if      (name.includes("ryzen 9")) base = 420;
    else if (name.includes("ryzen 7")) base = 280;
    else if (name.includes("ryzen 5")) base = 150;
    else if (name.includes("ryzen 3")) base = 70;
    else if (name.includes("athlon"))  base = 45;
    else base = 55; // FX series ecc.

    // ── 2b. SERIE AMD (3000 / 5000 / 7000 / 9000) ────────────────────────
    const seriesMatch = name.match(/ryzen\s+\d\s+(\d)(\d{3})/);
    if (seriesMatch) {
      const series = parseInt(seriesMatch[1]);
      if      (series <= 3) base *= 0.60;
      else if (series <= 5) base *= 0.80;
      else if (series <= 7) base *= 1.00;
      else                  base *= 1.15; // 9000 series
    }
  }

  // ── 3. MODIFICATORI SPECIFICHE ────────────────────────────────────────────

  // Core count
  if      (cores >= 16) base *= 1.25;
  else if (cores >= 12) base *= 1.10;
  else if (cores >= 8)  base *= 1.05;
  else if (cores <= 2)  base *= 0.85;

  // TDP (proxy di performance/variante)
  if      (tdp >= 150) base *= 1.10;
  else if (tdp <= 35)  base *= 0.85;

  // GHz: piccolo modificatore ±2%
  base *= (0.96 + (ghz - 2.0) * 0.02);

  // ── 4. CAP ────────────────────────────────────────────────────────────────
  base = Math.max(35, Math.min(750, base));

  // Arrotonda al .99 (look & feel da prezzo reale)
  return (Math.round(base) - 0.01);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const client = await pool.connect();
  try {
    // Aggiungi la colonna se non esiste
    await client.query(`
      ALTER TABLE cpus
      ADD COLUMN IF NOT EXISTS price_eur NUMERIC(8,2)
    `);

    const { rows: cpus } = await client.query(
      "SELECT id, name, core_count, tdp_w, speed_ghz FROM cpus"
    );
    console.log(`📋 ${cpus.length} CPU trovate\n`);

    let updated = 0;
    for (const cpu of cpus) {
      const price = estimatePrice(cpu);
      await client.query(
        "UPDATE cpus SET price_eur = $1 WHERE id = $2",
        [price, cpu.id]
      );
      updated++;
      process.stdout.write(`\r💶 ${updated}/${cpus.length} aggiornati`);
    }

    console.log("\n\n✅ Fatto.\n");

    // Preview distribuzione prezzi
    const { rows: dist } = await client.query(`
      SELECT
        CASE
          WHEN price_eur < 100  THEN '< €100 (budget)'
          WHEN price_eur < 200  THEN '€100-200 (entry)'
          WHEN price_eur < 350  THEN '€200-350 (mid)'
          WHEN price_eur < 500  THEN '€350-500 (high)'
          ELSE                       '> €500 (enthusiast)'
        END AS fascia,
        COUNT(*) AS n,
        ROUND(MIN(price_eur),2) AS min,
        ROUND(MAX(price_eur),2) AS max
      FROM cpus
      GROUP BY fascia
      ORDER BY min
    `);

    console.log("Distribuzione prezzi:");
    dist.forEach(r =>
      console.log(`  ${r.fascia.padEnd(26)} ${String(r.n).padStart(3)} CPU   €${r.min} – €${r.max}`)
    );

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
