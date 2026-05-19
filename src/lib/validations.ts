import z from "zod";
import qs from "qs";

function getRelationsFor(fullRelations: Record<string, any>, entityName: string): Record<string, any> {
    const entity = fullRelations[entityName] ?? fullRelations[`${entityName}Relations`];
    if (!entity) return {};
    return entity.relations ?? entity;
}

export function withSchema(fullRelations: Record<string, any>, entityName: string): z.ZodTypeAny {
    const rels = getRelationsFor(fullRelations, entityName);
    const relationKeys = Object.keys(rels);

    if (relationKeys.length === 0) {
        return z.record(z.never(), z.never()).optional();
    }

    const relationValueSchema = (key: string) =>
        z.union([
            z.enum(["true", "false"]).transform((val) => val === "true"),
            z.object({
                with: z.lazy(() => withSchema(fullRelations, key)),
            }).strict(),
        ]).optional();

    return z.object(
        Object.fromEntries(relationKeys.map((key) => [key, relationValueSchema(key)]))
    ).strict().optional();
}

export function querySchema<T extends z.ZodTypeAny>(schema: T): z.ZodType<z.output<T>> {
    return z.preprocess((val) => qs.parse(val as string), schema) as z.ZodType<z.output<T>>;
}
