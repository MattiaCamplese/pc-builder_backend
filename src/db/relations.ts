import { relations } from "drizzle-orm";
import { user, build, buildStorage, storage, cpus, motherboards, gpus, memory, cases, psus, coolers } from './schema.js';

export const userRelations = relations(user, ({ many }) => ({
    builds: many(build),
}));

export const buildRelations = relations(build, ({ one, many }) => ({
    user: one(user, { fields: [build.userId], references: [user.id] }),
    cpu: one(cpus, { fields: [build.cpuId], references: [cpus.id] }),
    motherboard: one(motherboards, { fields: [build.motherboardId], references: [motherboards.id] }),
    gpu: one(gpus, { fields: [build.gpuId], references: [gpus.id] }),
    ram: one(memory, { fields: [build.ramId], references: [memory.id] }),
    case: one(cases, { fields: [build.caseId], references: [cases.id] }),
    psu: one(psus, { fields: [build.psuId], references: [psus.id] }),
    cooler: one(coolers, { fields: [build.coolerId], references: [coolers.id] }),
    storages: many(buildStorage),
}));

export const buildStorageRelations = relations(buildStorage, ({ one }) => ({
    build: one(build, { fields: [buildStorage.buildId], references: [build.id] }),
    storage: one(storage, { fields: [buildStorage.storageId], references: [storage.id] }),
}));

export const cpuRelations = relations(cpus, ({ many }) => ({ builds: many(build) }));
export const motherboardRelations = relations(motherboards, ({ many }) => ({ builds: many(build) }));
export const gpuRelations = relations(gpus, ({ many }) => ({ builds: many(build) }));
export const memoryRelations = relations(memory, ({ many }) => ({ builds: many(build) }));
export const caseRelations = relations(cases, ({ many }) => ({ builds: many(build) }));
export const psuRelations = relations(psus, ({ many }) => ({ builds: many(build) }));
export const coolerRelations = relations(coolers, ({ many }) => ({ builds: many(build) }));
export const storageRelations = relations(storage, ({ many }) => ({ builds: many(buildStorage) }));
