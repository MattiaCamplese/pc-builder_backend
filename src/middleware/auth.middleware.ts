import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import jwt, { type JwtPayload } from "jsonwebtoken";
import db from "../db/index.js";
import { user } from "../db/schema.js";

export type AuthContext = {
    Variables: {
        authUser: typeof user.$inferSelect;
    }
}

export function authMiddleware() {
    return async (c: Context<AuthContext>, next: Next) => {
        let bearerToken = c.req.header('Authorization')
        console.log("bearerToken:", bearerToken)

        bearerToken = bearerToken?.replace('Bearer ', '');

        if (!bearerToken) {
            throw new HTTPException(401, { message: 'Token mancante o non valido' })
        }

        try {
            const payload = jwt.verify(bearerToken, process.env.JWT_SECRET!) as JwtPayload;

            const user = await db.query.user.findFirst({
                where: (fields, { eq }) => eq(fields.email, payload.email)
            })
            if (!user) {
                throw new Error();
            }

            c.set('authUser', user);
            await next();
        } catch (error) {
            throw new HTTPException(401, { message: 'Token mancante o non valido' })
        }
    }
}