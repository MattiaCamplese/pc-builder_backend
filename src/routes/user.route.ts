import { Hono } from "hono";
import db from "../db/index.js";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { createInsertSchema, createUpdateSchema } from "drizzle-zod";
import { user } from "../db/schema.js";
import { eq } from "drizzle-orm";
import z from "zod";
import * as relations from "../db/relations.js";
import { authMiddleware, type AuthContext } from "../middleware/auth.middleware.js";
import { adminOnly } from "../middleware/role.middleware.js";
import { DatabaseError } from "@neondatabase/serverless";
import { querySchema, withSchema } from "../lib/validations.js";

const userRoute = new Hono<AuthContext>().basePath('users');
userRoute.use(authMiddleware());
userRoute.use(adminOnly);

const listSchema = querySchema(
  z.object({
    page: z.string().optional().transform(val => val ? +val : undefined),
    perPage: z.string().optional().transform(val => val ? +val : undefined),
    with: withSchema(relations, "user")
  })
);

userRoute.get('/', zValidator("query", listSchema), async (c) => {
  try {
    const { page, perPage, with: withQuery } = c.req.valid("query")
    const users = await db.query.user.findMany({
      limit: perPage || (page ? 10 : undefined),
      offset: page ? (page - 1) * (perPage || 10) : undefined,
      with: withQuery as any
    });
    return c.json(users)
  } catch (error) {
    return c.json({ message: "Errore del server" }, 500)
  }
});

const findSchema = querySchema(
  z.object({
    with: withSchema(relations, "user")
  }).strict()
)
userRoute.get('/:id', zValidator("query", findSchema), async (c) => {
  try {
    const { id } = c.req.param();
    const { with: withQuery } = c.req.valid("query");
    const found = await db.query.user.findFirst({
      where: (fields, { eq }) => eq(fields.id, id),
      with: withQuery as any
    });
    if (!found) {
      throw new HTTPException(404, { message: "Utente non trovato" })
    }
    return c.json(found);
  } catch (error) {
    if (error instanceof HTTPException) {
      return c.json({ message: error.message }, error.status)
    }
    return c.json({ message: "Errore del server" }, 500)
  }
})

userRoute.post('/', zValidator("json", createInsertSchema(user).array()), async (c) => {
  try {
    const data = c.req.valid("json");
    const newUser = await db.insert(user).values(data).returning();
    return c.json(newUser[0]);
  } catch (error) {
    if (error instanceof DatabaseError) {
      return c.json({ message: error.detail }, 400)
    }
    return c.json({ message: "Errore del server" }, 500)
  }
})

userRoute.patch('/:id', zValidator('json', createUpdateSchema(user)), async (c) => {
  try {
    const { id } = c.req.param();
    const data = c.req.valid('json');
    const updated = await db.update(user).set(data).where(eq(user.id, id)).returning();
    if (!updated.length) {
      throw new HTTPException(404, { message: "Utente non trovato" })
    }
    return c.json(updated[0]);
  } catch (error) {
    if (error instanceof HTTPException) {
      return c.json({ message: error.message }, error.status);
    }
    return c.json({ message: "Errore del server" }, 500)
  }
})

userRoute.delete("/:id", async (c) => {
  try {
    const { id } = c.req.param();
    const deleted = await db.delete(user).where(eq(user.id, id)).returning({ id: user.id });
    if (!deleted.length) {
      throw new HTTPException(404, { message: "Utente non trovato" });
    }
    return c.json(deleted[0]);
  } catch (error) {
    if (error instanceof HTTPException) {
      return c.json({ message: error.message }, error.status);
    }
    return c.json({ message: "Errore del server" }, 500);
  }
});

export default userRoute;
