import { relations } from "drizzle-orm";
import { user, build, buildStorage, storage } from './schema.js';

export const userRelations = relations(user, ({ many }) => ({
    builds: many(build),
}));

export const buildRelations = relations(build, ({ one, many }) => ({
    user: one(user, {
        fields: [build.userId],
        references: [user.id],
    }),
    storages: many(buildStorage),
}));

export const buildStorageRelations = relations(buildStorage, ({ one }) => ({
    build: one(build, {
        fields: [buildStorage.buildId],
        references: [build.id],
    }),
    storage: one(storage, {
        fields: [buildStorage.storageId],
        references: [storage.id],
    }),
}));
