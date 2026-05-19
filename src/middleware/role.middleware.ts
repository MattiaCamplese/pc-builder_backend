import type { user } from "../db/schema.js";
import { createMiddleware } from "hono/factory";
import type { AuthContext } from "./auth.middleware.js";
import { HTTPException } from "hono/http-exception";


export function roleMiddleware(role: typeof user.$inferSelect['role']) {
    return createMiddleware<AuthContext>(async (c, next) => {
        const authUser = c.get("authUser");
        if (!authUser) {
            throw new HTTPException(401, { message: "accesso non autorizzato" });
        }
        if (authUser.role !== role) {
            throw new HTTPException(403, { message: "accesso non autorizzato" });
        }
        await next();
    })
}

export const adminOnly = roleMiddleware('admin');