/**
 * seed-cpu.js
 * Carica CPU.csv su Neon (PostgreSQL).
 *
 * Setup:
 *   npm install pg csv-parse dotenv
 *
 * .env:
 *   DATABASE_URL=postgresql://user:pass@host.neon.tech/dbname?sslmode=require
 *
 * Uso:
 *   node scripts/seed-cpu.js --csv ./scripts/CPU.csv
 *   node scripts/seed-cpu.js --csv ./scripts/CPU.csv --drop
 */

import "dotenv/config";
import { createReadStream } from "fs";
import { parse } from "csv-parse";
import pg from "pg";
import path from "path";

const { Pool } = pg;

const CSV_PATH = process.argv.includes("--csv")
  ? process.argv[process.argv.indexOf("--csv") + 1]
  : "./CPU.csv";

const DROP_FIRST = process.argv.includes("--drop");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const RAM_BY_SOCKET = {
  "AM5":      "DDR5",
  "AM4":      "DDR4",
  "AM3+":     "DDR3",
  "AM3":      "DDR3",
  "LGA 1200": "DDR4",
  "LGA 1151": "DDR4",
  "LGA 1150": "DDR3",
  "X399":     "DDR4",
  "TRX40":    "DDR4",
};

function inferRamType(socket) {
  return RAM_BY_SOCKET[socket?.trim()] ?? null;
}

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS cpus (
    id            SERIAL PRIMARY KEY,
    name          TEXT        NOT NULL,
    brand         TEXT        NOT NULL,
    socket        TEXT        NOT NULL,
    speed_ghz     NUMERIC(4,1),
    core_count    SMALLINT,
    thread_count  SMALLINT,
    tdp_w         SMALLINT,
    ram_type      TEXT,
    image_url     TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_cpus_socket   ON cpus (socket);
  CREATE INDEX IF NOT EXISTS idx_cpus_ram_type ON cpus (ram_type);
`;

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
  INSERT INTO cpus (name, brand, socket, speed_ghz, core_count, thread_count, tdp_w, ram_type, image_url)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
`;

async function insertRow(client, row) {
  await client.query(INSERT_SQL, [
    row.name,
    row.brand,
    row.socket,
    row.speed       ? parseFloat(row.speed)    : null,
    row.coreCount   ? parseInt(row.coreCount)   : null,
    row.threadCount ? parseInt(row.threadCount) : null,
    row.power       ? parseInt(row.power)       : null,
    inferRamType(row.socket),
    row.image || null,
  ]);
}

async function main() {
  const client = await pool.connect();

  try {
    console.log(`📂 Lettura: ${path.resolve(CSV_PATH)}`);
    const rows = await readCsv(CSV_PATH);
    console.log(`   ${rows.length} righe trovate\n`);

    await client.query("BEGIN");

    if (DROP_FIRST) {
      console.log("🗑  DROP + ricreazione tabella...");
      await client.query("DROP TABLE IF EXISTS cpus");
    }

    await client.query(CREATE_SQL);

    let ok = 0, fail = 0;

    for (const row of rows) {
      try {
        await insertRow(client, row);
        ok++;
        process.stdout.write(`\r⬆  ${ok}/${rows.length} inseriti`);
      } catch (err) {
        fail++;
        console.error(`\n⚠️  Riga saltata [${row.name}]: ${err.message}`);
      }
    }

    await client.query("COMMIT");
    console.log(`\n\n✅ Fatto: ${ok} inseriti, ${fail} saltati.`);

    const { rows: nulls } = await client.query(`
      SELECT socket, COUNT(*) AS n
      FROM cpus WHERE ram_type IS NULL
      GROUP BY socket ORDER BY n DESC
    `);
    if (nulls.length > 0) {
      console.log("\n⚠️  CPU con ram_type NULL (da completare a mano):");
      nulls.forEach(r => console.log(`   ${r.socket}: ${r.n} righe`));
    }

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
