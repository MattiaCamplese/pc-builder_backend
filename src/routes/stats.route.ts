import { Hono } from "hono";
import db from "../db/index.js";
import { sql } from "drizzle-orm";
import { cpus, motherboards, gpus, memory, cases, psus, coolers, storage, build } from "../db/schema.js";

const statsRoute = new Hono().basePath("stats");

const componentTables = { cpus, motherboards, gpus, memory, cases, psus, coolers, storage } as const;

statsRoute.get("/", async (c) => {
    const byType: Record<string, number> = {};
    for (const [key, table] of Object.entries(componentTables)) {
        const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(table as any);
        byType[key] = count;
    }
    const totalComponents = Object.values(byType).reduce((a, b) => a + b, 0);

    const [cpuBrands, moboBrands, gpuBrands] = await Promise.all([
        db.select({ brand: cpus.brand }).from(cpus),
        db.select({ brand: motherboards.brand }).from(motherboards),
        db.select({ brand: gpus.brand }).from(gpus),
    ]);
    const brands = new Set([...cpuBrands, ...moboBrands, ...gpuBrands].map((r) => r.brand));

    const [{ count: buildsCount }] = await db.select({ count: sql<number>`count(*)::int` }).from(build);

    return c.json({
        totalComponents,
        byType,
        brands: brands.size,
        buildsCount,
    });
});

export default statsRoute;