import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";
import db from "../db/index.js";
import { HTTPException } from "hono/http-exception";
import bcrypt from "bcrypt";
import { generateJwt, generateRandomCode, generateToken } from "../lib/utils.js";
import { createInsertSchema } from "drizzle-zod";
import { user } from "../db/schema.js";
import { userOmits } from "../lib/omits.js";
import { eq } from "drizzle-orm";
import { emailSend } from "../lib/email.js";
import { authMiddleware, type AuthContext } from "../middleware/auth.middleware.js";


const authRoute = new Hono<AuthContext>().basePath("auth");

const loginSchema = z.object({
    email: z.email(),
    password: z.string().min(1),
});

authRoute.post("/login", zValidator("json", loginSchema), async (c) => {
    const { email, password } = c.req.valid("json");

    const user = await db.query.user.findFirst({
        where: (fields, { eq }) => eq(fields.email, email),
        // columns: {password: false}
    });
    if (!user) {
        throw new HTTPException(401, { message: "email o password non validi" });
    }

    if (!user.emailVerifiedAt) {
        throw new HTTPException(401, {
            message: "email non verificata",
            cause: "EMAIL_NOT_VERIFIED",
        });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
        throw new HTTPException(401, { message: "email o password non validi" });
    }

    const token = generateJwt(user.email);

    const { password: psw, ...userNoPsw } = user;
    return c.json({
        token,
        user: userOmits(user),
    });
});

authRoute.get("/me", authMiddleware(), async (c) => {
    const user = c.get("authUser");
    return c.json(userOmits(user));
})

const registerSchema = createInsertSchema(user, {
    email: z.email().transform((v) => v.toLowerCase()),
    password: z
        .string()
        .min(8)
        .regex(/[a-z]/g, { error: "Devi inserire almeno una minuscola" })
        .regex(/[A-Z]/g, { error: "Devi inserire almeno una maiuscola" })
        .regex(/[0-9]/g, { error: "Devi inserire almeno un numero" })
        .regex(/[!$&=?]/g, { error: "Devi inserire almeno un simbolo tra ! $ & = ?" }),
})
    .extend({
        passwordConfirmation: z.string().min(1),
    })
    .refine((data) => data.password === data.passwordConfirmation, {
        message: "Password diverse!",
        path: ["passwordConfirmation"],
    })
    .transform(({ passwordConfirmation, password, ...rest }) => ({
        ...rest,
        password: bcrypt.hashSync(password, 10),
    }));
authRoute.post("/register", zValidator("json", registerSchema), async (c) => {
    const data = c.req.valid("json");

    const code = generateRandomCode();

    emailSend({
        email: data.email,
        subject: "Completa la Registazione",
        text: `Inserisci il codice di verifica ${code}`,
    });
    console.log(code);

    const queryResult = await db
        .insert(user)
        .values({
            ...data,
            emailVerificationCode: bcrypt.hashSync(code, 10),
            emailCodeAt: new Date(),
        })
        .returning();

    return c.json({
        message: "Utente Registrato",
        user: userOmits(queryResult[0]),
    });
});

const emailVerifySchema = z.object({
    email: z.email(),
    code: z.string().min(1),
});

authRoute.post("/email-verify", zValidator("json", emailVerifySchema), async (c) => {
    const { email, code } = c.req.valid("json");

    const userDb = await db.query.user.findFirst({
        where: (fields, { eq }) => eq(fields.email, email),
    });
    if (
        !userDb ||
        (userDb.emailVerificationCode &&
            !bcrypt.compareSync(code, userDb.emailVerificationCode))
    ) {
        throw new HTTPException(400, {
            message: "Verifica della mail non valida",
        });
    }

    if (userDb.emailVerifiedAt) {
        throw new HTTPException(400, { message: "Email già verificata" });
    }

    if (!userDb.emailCodeAt) {
        throw new HTTPException(400, { message: "Codice Scaduto" });
    }
    const createdAt = userDb.emailCodeAt.valueOf();
    const now = new Date().valueOf();
    const diff = Math.floor((now - createdAt) / 1000 / 60);
    if (diff > 10) {
        throw new HTTPException(400, { message: "Codice Scaduto" });
    }

    const queryResult = await db
        .update(user)
        .set({
            emailVerifiedAt: new Date(),
            emailVerificationCode: null,
            emailCodeAt: null,
        })
        .where(eq(user.id, userDb.id));

    const token = generateJwt(userDb.email);

    return c.json({
        message: "email verificata",
        token,
        user: userOmits(userDb),
    });
},
);

const resendEmailVerifySchema = z.object({
    email: z.email(),
});

authRoute.post( "/resend-email-verify", zValidator("json", resendEmailVerifySchema), async (c) => {
        const { email } = c.req.valid("json");

        const userDb = await db.query.user.findFirst({
            where: (fields, { eq }) => eq(fields.email, email),
        });

        if (!userDb) {
            throw new HTTPException(400, { message: "Dati non Validi" });
        }

        if (userDb.emailVerifiedAt) {
            throw new HTTPException(400, { message: "Dati non Validi" });
        }

        const code = generateRandomCode();
        emailSend({
            email: userDb.email,
            subject: "Completa la Registazione",
            text: `Inserisci il codice di verifica ${code}`,
        });
        console.log(code);

        await db
            .update(user)
            .set({
                emailVerificationCode: bcrypt.hashSync(code, 10),
                emailCodeAt: new Date(),
            })
            .where(eq(user.id, userDb.id));

        return c.json({ message: "Codice Verifica inviato" });
    },
);

const resendPasswordRecoverySchema = z.object({
    email: z.email(),
});

authRoute.post("/send-password-recovery", zValidator("json", resendPasswordRecoverySchema), async (c) => {
    const { email } = c.req.valid("json");

    const userDb = await db.query.user.findFirst({
        where: (fields, { eq }) => eq(fields.email, email),
    });

    if (!userDb || !userDb.emailVerifiedAt) {
        throw new HTTPException(400, { message: "Dati non validi" });
    }

    const token = generateToken(); // token in chiaro da mandare nel link
    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
    const resetLink = `${frontendUrl}/password-recovery?token=${token}&email=${encodeURIComponent(email)}`;

    await emailSend({
        email,
        subject: "Recupero Password",
        text: `Clicca qui per reimpostare la password: ${resetLink}`,
    });

    await db
        .update(user)
        .set({
            passwordRecoveryCode: bcrypt.hashSync(token, 10),
            passwordRecoveryAt: new Date(),
        })
        .where(eq(user.id, userDb.id));

    return c.json({ message: "Email recupero Password mandato" });
},
);

const passwordRecoverySchema = z
    .object({
        email: z.email(),
        token: z.string().min(1),
        password: z
            .string()
            .min(8)
            .regex(/[a-z]/g, { error: "Devi inserire almeno una minuscola" })
            .regex(/[A-Z]/g, { error: "Devi inserire almeno una maiuscola" })
            .regex(/[0-9]/g, { error: "Devi inserire almeno un numero" })
            .regex(/[!$&=?]/g, { error: "Devi inserire almeno un simbolo tra ! $ & = ?" }),
        passwordConfirmation: z.string().min(1),
    })
    .refine((data) => data.password === data.passwordConfirmation, {
        message: "Password diverse!",
        path: ["passwordConfirmation"],
    })
    .transform(({ passwordConfirmation, password, ...rest }) => ({
        ...rest,
        password: bcrypt.hashSync(password, 10),
    }));

authRoute.post( "password-recovery", zValidator("json", passwordRecoverySchema), async (c) => {
        const { email, token, password } = c.req.valid("json");

        const userDb = await db.query.user.findFirst({
            where: (fields, { eq }) => eq(fields.email, email),
        });

        if (
            !userDb ||
            !userDb.passwordRecoveryCode ||
            !bcrypt.compareSync(token, userDb.passwordRecoveryCode)
        ) {
            throw new HTTPException(400, { message: "Link non Valido" });
        }

        if (!userDb.passwordRecoveryAt) {
            throw new HTTPException(400, {
                message: "Link Scaduto",
            });
        }

        const createdAt = userDb.passwordRecoveryAt.valueOf();
        const now = new Date().valueOf();
        const diff = Math.floor((now - createdAt) / (1000 * 60));

        if (diff > 10) {
            throw new HTTPException(400, {
                message: "Link Scaduto",
            });
        }

        await db.update(user).set({password,
                passwordRecoveryCode: null,
                passwordRecoveryAt: null,
            })
            .where(eq(user.id, userDb.id));

        return c.json({ message: "Password modificata" });
    },
);

const updateProfileSchema = z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
});

authRoute.put("/profile", authMiddleware(), zValidator("json", updateProfileSchema), async (c) => {
    const authUser = c.get("authUser");
    const { firstName, lastName } = c.req.valid("json");

    const queryResult = await db
        .update(user)
        .set({ firstName, lastName })
        .where(eq(user.id, authUser.id))
        .returning();

    return c.json({
        message: "Profilo aggiornato",
        user: userOmits(queryResult[0]),
    });
});

const changePasswordSchema = z
    .object({
        currentPassword: z.string().min(1),
        password: z
            .string()
            .min(8)
            .regex(/[a-z]/g, { error: "Devi inserire almeno una minuscola" })
            .regex(/[A-Z]/g, { error: "Devi inserire almeno una maiuscola" })
            .regex(/[0-9]/g, { error: "Devi inserire almeno un numero" })
            .regex(/[!$&=?]/g, { error: "Devi inserire almeno un simbolo tra ! $ & = ?" }),
        passwordConfirmation: z.string().min(1),
    })
    .refine((data) => data.password === data.passwordConfirmation, {
        message: "Password diverse!",
        path: ["passwordConfirmation"],
    });

authRoute.put("/change-password", authMiddleware(), zValidator("json", changePasswordSchema), async (c) => {
    const authUser = c.get("authUser");
    const { currentPassword, password } = c.req.valid("json");

    const validPassword = await bcrypt.compare(currentPassword, authUser.password);
    if (!validPassword) {
        throw new HTTPException(401, { message: "Password attuale non valida" });
    }

    await db
        .update(user)
        .set({ password: bcrypt.hashSync(password, 10) })
        .where(eq(user.id, authUser.id));

    return c.json({ message: "Password modificata" });
});

const deleteAccountSchema = z.object({
    password: z.string().min(1),
});

authRoute.delete("/account", authMiddleware(), zValidator("json", deleteAccountSchema), async (c) => {
    const authUser = c.get("authUser");
    const { password } = c.req.valid("json");

    const validPassword = await bcrypt.compare(password, authUser.password);
    if (!validPassword) {
        throw new HTTPException(401, { message: "Password non valida" });
    }

    await db.delete(user).where(eq(user.id, authUser.id));

    return c.json({ message: "Account eliminato" });
});

export default authRoute;
