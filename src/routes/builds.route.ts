import { Hono } from "hono";
import db from "../db/index.js";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { build, buildStorage, cpus, motherboards, gpus, memory, cases, psus, coolers, storage } from "../db/schema.js";
import { eq, inArray } from "drizzle-orm";
import z from "zod";
import { authMiddleware, type AuthContext } from "../middleware/auth.middleware.js";
import { validateBuild, type BuildConfig } from "../lib/compatibility.js";

const buildsRoute = new Hono<AuthContext>().basePath("builds");

const auth = authMiddleware();

const buildBodySchema = z.object({
    name: z.string().optional(),
    cpuId: z.number().optional(),
    motherboardId: z.number().optional(),
    gpuId: z.number().optional(),
    ramId: z.number().optional(),
    caseId: z.number().optional(),
    psuId: z.number().optional(),
    coolerId: z.number().optional(),
    storageIds: z.array(z.number()).optional(),
});

async function fetchBuildConfig(data: z.infer<typeof buildBodySchema>): Promise<BuildConfig> {
    const config: BuildConfig = {};
    if (data.cpuId)         config.cpu         = (await db.select().from(cpus).where(eq(cpus.id, data.cpuId)))[0];
    if (data.motherboardId) config.motherboard  = (await db.select().from(motherboards).where(eq(motherboards.id, data.motherboardId)))[0];
    if (data.gpuId)         config.gpu          = (await db.select().from(gpus).where(eq(gpus.id, data.gpuId)))[0];
    if (data.ramId)         config.ram          = (await db.select().from(memory).where(eq(memory.id, data.ramId)))[0];
    if (data.caseId)        config.case         = (await db.select().from(cases).where(eq(cases.id, data.caseId)))[0];
    if (data.psuId)         config.psu          = (await db.select().from(psus).where(eq(psus.id, data.psuId)))[0];
    if (data.coolerId)      config.cooler       = (await db.select().from(coolers).where(eq(coolers.id, data.coolerId)))[0];
    if (data.storageIds?.length) config.storages = await db.select().from(storage).where(inArray(storage.id, data.storageIds));
    return config;
}

buildsRoute.get("/", auth, async (c) => {
    const userId = c.get("authUser").id;
    const builds = await db.query.build.findMany({
        where: (f, { eq }) => eq(f.userId, userId),
        with: { cpu: true, motherboard: true, gpu: true, ram: true, case: true, psu: true, cooler: true, storages: { with: { storage: true } } },
    });
    return c.json(builds);
});

buildsRoute.get("/shared/:id", async (c) => {
    const id = +c.req.param("id")!;
    const found = await db.query.build.findFirst({
        where: (f, { eq }) => eq(f.id, id),
        with: { cpu: true, motherboard: true, gpu: true, ram: true, case: true, psu: true, cooler: true, storages: { with: { storage: true } } },
    });
    if (!found) throw new HTTPException(404, { message: "Build non trovata" });
    return c.json(found);
});

buildsRoute.get("/:id", auth, async (c) => {
    const id = +c.req.param("id")!;
    const found = await db.query.build.findFirst({
        where: (f, { eq }) => eq(f.id, id),
        with: { cpu: true, motherboard: true, gpu: true, ram: true, case: true, psu: true, cooler: true, storages: { with: { storage: true } } },
    });
    if (!found) throw new HTTPException(404, { message: "Build non trovata" });
    return c.json(found);
});

buildsRoute.post("/", auth, zValidator("json", buildBodySchema), async (c) => {
    const userId = c.get("authUser").id;
    const { storageIds, ...data } = c.req.valid("json");

    const [newBuild] = await db.insert(build).values({ ...data, userId }).returning();

    if (storageIds?.length) {
        await db.insert(buildStorage).values(storageIds.map(sid => ({ buildId: newBuild.id, storageId: sid })));
    }
    return c.json(newBuild, 201);
});

buildsRoute.put("/:id", auth, zValidator("json", buildBodySchema), async (c) => {
    const userId = c.get("authUser").id;
    const id = +c.req.param("id");
    const { storageIds, ...data } = c.req.valid("json");

    const [updated] = await db.update(build).set({ ...data, updatedAt: new Date() })
        .where(eq(build.id, id)).returning();
    if (!updated || updated.userId !== userId) throw new HTTPException(404, { message: "Build non trovata" });

    if (storageIds !== undefined) {
        await db.delete(buildStorage).where(eq(buildStorage.buildId, id));
        if (storageIds.length) await db.insert(buildStorage).values(storageIds.map(sid => ({ buildId: id, storageId: sid })));
    }
    return c.json(updated);
});

buildsRoute.delete("/:id", auth, async (c) => {
    const userId = c.get("authUser").id;
    const id = +c.req.param("id")!;
    const [deleted] = await db.delete(build).where(eq(build.id, id)).returning();
    if (!deleted || deleted.userId !== userId) throw new HTTPException(404, { message: "Build non trovata" });
    return c.json({ id: deleted.id });
});

buildsRoute.post("/validate", zValidator("json", buildBodySchema), async (c) => {
    const data = c.req.valid("json");
    const config = await fetchBuildConfig(data);
    const errors = validateBuild(config);
    return c.json({ valid: errors.length === 0, errors });
});

export default buildsRoute;
