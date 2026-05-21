import { Hono } from "hono";
import db from "../db/index.js";
import { HTTPException } from "hono/http-exception";
import { createInsertSchema, createUpdateSchema } from "drizzle-zod";
import { cpus, motherboards, gpus, memory, cases, psus, coolers, storage } from "../db/schema.js";
import { eq, gte, lte, and, ilike } from "drizzle-orm";
import { authMiddleware, type AuthContext } from "../middleware/auth.middleware.js";
import { adminOnly } from "../middleware/role.middleware.js";
import { deriveConstraints, type BuildConfig } from "../lib/compatibility.js";

const componentMap = { cpus, motherboards, gpus, memory, cases, psus, coolers, storage } as const;
type ComponentType = keyof typeof componentMap;

function snakeToCamel(s: string) {
    return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function buildConditions(table: any, query: Record<string, string>) {
    return Object.entries(query).map(([key, value]) => {
        if (key.endsWith("_gte")) {
            const col = snakeToCamel(key.slice(0, -4));
            return col in table ? gte(table[col], Number(value)) : null;
        }
        if (key.endsWith("_lte")) {
            const col = snakeToCamel(key.slice(0, -4));
            return col in table ? lte(table[col], Number(value)) : null;
        }
        const col = snakeToCamel(key);
        if (!(col in table)) return null;
        // CSV fields (e.g. socketSupport) need contains check
        if (col === "socketSupport") return ilike(table[col], `%${value}%`);
        return eq(table[col], value);
    }).filter(Boolean) as ReturnType<typeof eq>[];
}

const componentsRoute = new Hono<AuthContext>().basePath("components");

componentsRoute.get("/:type", async (c) => {
    const table = componentMap[c.req.param("type") as ComponentType];
    if (!table) throw new HTTPException(404, { message: "Tipo componente non trovato" });

    const conditions = buildConditions(table, c.req.query());
    const result = await db.select().from(table as any).where(conditions.length ? and(...conditions) : undefined);
    return c.json(result);
});

// GET /api/components/:type/compatible?cpuId=1&caseId=2&...
componentsRoute.get("/:type/compatible", async (c) => {
    const type = c.req.param("type") as ComponentType;
    const table = componentMap[type];
    if (!table) throw new HTTPException(404, { message: "Tipo componente non trovato" });

    const q = c.req.query();
    const config: BuildConfig = {};
    if (q.cpuId)         config.cpu         = (await db.select().from(cpus).where(eq(cpus.id, +q.cpuId)))[0];
    if (q.motherboardId) config.motherboard  = (await db.select().from(motherboards).where(eq(motherboards.id, +q.motherboardId)))[0];
    if (q.gpuId)         config.gpu          = (await db.select().from(gpus).where(eq(gpus.id, +q.gpuId)))[0];
    if (q.caseId)        config.case         = (await db.select().from(cases).where(eq(cases.id, +q.caseId)))[0];

    const constraints = deriveConstraints(config);
    const typeKey = type === 'cpus' ? 'cpu' : type === 'motherboards' ? 'motherboard' : type === 'gpus' ? 'gpu'
        : type === 'memory' ? 'memory' : type === 'cases' ? 'case' : type === 'psus' ? 'psu'
        : type === 'coolers' ? 'cooler' : 'storage';
    const typeConstraints = (constraints as any)[typeKey] ?? {};

    const conditions = buildConditions(table, Object.fromEntries(
        Object.entries(typeConstraints).map(([k, v]) => [k, String(v)])
    ));
    const result = await db.select().from(table as any).where(conditions.length ? and(...conditions) : undefined);
    return c.json(result);
});

componentsRoute.get("/:type/:id", async (c) => {
    const table = componentMap[c.req.param("type") as ComponentType];
    if (!table) throw new HTTPException(404, { message: "Tipo componente non trovato" });

    const result = await db.select().from(table as any).where(eq((table as any).id, Number(c.req.param("id"))));
    if (!result.length) throw new HTTPException(404, { message: "Componente non trovato" });
    return c.json(result[0]);
});

componentsRoute.use(authMiddleware());
componentsRoute.use(adminOnly);

componentsRoute.post("/:type", async (c) => {
    const table = componentMap[c.req.param("type") as ComponentType];
    if (!table) throw new HTTPException(404, { message: "Tipo componente non trovato" });

    const parsed = createInsertSchema(table as any).safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const result = await db.insert(table as any).values(parsed.data).returning();
    return c.json(result[0], 201);
});

componentsRoute.put("/:type/:id", async (c) => {
    const table = componentMap[c.req.param("type") as ComponentType];
    if (!table) throw new HTTPException(404, { message: "Tipo componente non trovato" });

    const parsed = createUpdateSchema(table as any).safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const result = await db.update(table as any).set(parsed.data).where(eq((table as any).id, Number(c.req.param("id")))).returning();
    if (!result.length) throw new HTTPException(404, { message: "Componente non trovato" });
    return c.json(result[0]);
});

componentsRoute.delete("/:type/:id", async (c) => {
    const table = componentMap[c.req.param("type") as ComponentType];
    if (!table) throw new HTTPException(404, { message: "Tipo componente non trovato" });

    const result = await db.delete(table as any).where(eq((table as any).id, Number(c.req.param("id")))).returning({ id: (table as any).id });
    if (!result.length) throw new HTTPException(404, { message: "Componente non trovato" });
    return c.json(result[0]);
});

export default componentsRoute;