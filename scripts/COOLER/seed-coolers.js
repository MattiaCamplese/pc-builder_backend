import "dotenv/config";
import { createReadStream } from "fs";
import { parse } from "csv-parse";
import pg from "pg";
import path from "path";

const { Pool } = pg;

const CSV_PATH = process.argv.includes("--csv")
  ? process.argv[process.argv.indexOf("--csv") + 1]
  : "./Cooler.csv";

const DROP_FIRST = process.argv.includes("--drop");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function extractRadiatorMm(name) {
  const match = name.match(/\b(120|140|240|280|360|420)\b/);
  return match ? parseInt(match[1]) : null;
}

function inferMaxTdp(name, type) {
  const n = name.toLowerCase();
  if (type === "liquid") {
    const rad = extractRadiatorMm(name);
    if (!rad || rad <= 120) return 150;
    if (rad <= 240)         return 200;
    if (rad <= 280)         return 220;
    if (rad <= 360)         return 300;
    return 350;
  }
  if (n.includes("low profile") || n.includes("low-profile") || n.includes("slim")) return 65;
  if (n.includes("nh-d15") || n.includes("dark rock pro") || n.includes("assassin") || n.includes("pa120")) return 250;
  if (n.includes("nh-u12") || n.includes("nh-u14") || n.includes("dark rock") || n.includes("hyper 212")) return 180;
  return 150;
}

const MODERN  = "LGA1151,LGA1200,LGA1700,AM4,AM5";
const BROAD   = "LGA1150,LGA1151,LGA1200,LGA1700,AM3+,AM4,AM5";
const LEGACY  = "LGA1150,LGA1151,AM3+,AM4";

function inferSocketSupport(name) {
  const n = name.toLowerCase();
  if (n.includes("lga 775") || n.includes("lga775") || n.includes("lga 1366")) return "LGA775,LGA1366,LGA1156";
  if (n.includes("am3") || n.includes("fm2") || n.includes("fm1")) return LEGACY;
  if (n.includes("am5") || n.includes("lga1700") || n.includes("lga 1700")) return BROAD;
  const broadBrands = ["noctua","be quiet","arctic","thermalright","deepcool","scythe"];
  for (const b of broadBrands) if (n.includes(b)) return BROAD;
  return MODERN;
}

const BRANDS = {
  "noctua":1.55,"be quiet":1.30,"nzxt":1.25,"corsair":1.20,
  "ek water":1.35,"ekwb":1.35,"lian li":1.20,"phanteks":1.10,
  "thermaltake":1.00,"cooler master":1.00,"deepcool":0.90,
  "thermalright":0.90,"arctic":0.75,"scythe":1.05,"fractal":1.15,
};

function brandMult(name) {
  const n = name.toLowerCase();
  for (const [b, m] of Object.entries(BRANDS)) if (n.includes(b)) return m;
  return 0.85;
}

function estimatePrice(name, type) {
  const brand = brandMult(name);
  const n = name.toLowerCase();
  let base;
  if (type === "liquid") {
    const rad = extractRadiatorMm(name);
    if      (!rad || rad <= 120) base = 65;
    else if (rad <= 240)         base = 95;
    else if (rad <= 280)         base = 120;
    else if (rad <= 360)         base = 155;
    else                         base = 200;
    if (n.includes("rgb") || n.includes("elite") || n.includes("lcd")) base *= 1.12;
  } else {
    if (n.includes("low profile") || n.includes("low-profile")) base = 30;
    else if (n.includes("nh-d15") || n.includes("dark rock pro") || n.includes("assassin")) base = 90;
    else base = 45;
    if (n.includes("chromax") || n.includes("premium")) base *= 1.15;
  }
  base *= brand;
  base = Math.max(15, Math.min(270, base));
  return Math.round(base) - 0.01;
}

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
  INSERT INTO coolers (name, type, radiator_mm, socket_support, max_tdp_w, price_eur, image_url)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
`;

async function main() {
  const client = await pool.connect();
  try {
    console.log(`📂 Lettura: ${path.resolve(CSV_PATH)}`);
    const rows = await readCsv(CSV_PATH);
    console.log(`   ${rows.length} righe trovate\n`);

    if (DROP_FIRST) {
      await client.query("DROP TABLE IF EXISTS coolers");
      console.log("🗑  DROP TABLE coolers\n");
    }

    // Nessun BEGIN/COMMIT globale — ogni insert è indipendente
    let ok = 0, fail = 0;
    for (const row of rows) {
      try {
        await client.query(INSERT_SQL, [
          row.name,
          row.type,
          row.type === "liquid" ? extractRadiatorMm(row.name) : null,
          inferSocketSupport(row.name),
          inferMaxTdp(row.name, row.type),
          estimatePrice(row.name, row.type),
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

    const { rows: sample } = await client.query(`
      SELECT type, radiator_mm, max_tdp_w, price_eur, LEFT(name,45) AS name
      FROM coolers ORDER BY RANDOM() LIMIT 5
    `);
    console.log("Campione:");
    sample.forEach(r =>
      console.log(`  [${r.type.padEnd(7)}] rad:${String(r.radiator_mm??'-').padEnd(4)} tdp:${r.max_tdp_w}W €${r.price_eur}  ${r.name}`)
    );

    const { rows: dist } = await client.query(`
      SELECT type,
        CASE WHEN price_eur < 40 THEN '< €40'
             WHEN price_eur < 80 THEN '€40-80'
             WHEN price_eur < 140 THEN '€80-140'
             ELSE '> €140' END AS fascia,
        COUNT(*) AS n,
        ROUND(MIN(price_eur),2) AS min, ROUND(MAX(price_eur),2) AS max
      FROM coolers GROUP BY type, fascia ORDER BY type, min
    `);
    console.log("\nDistribuzione prezzi:");
    dist.forEach(r =>
      console.log(`  ${r.type.padEnd(8)} ${r.fascia.padEnd(10)} ${String(r.n).padStart(4)} cooler  €${r.min}–€${r.max}`)
    );

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });