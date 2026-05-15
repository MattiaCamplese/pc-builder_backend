import jwt from "jsonwebtoken";
import crypto from "crypto";

export function omit<T extends object, K extends keyof T>(obj: T, ...keys: K[]): Omit<T, K> {
    const omitSet = new Set(keys);
    return Object.fromEntries(
        Object.entries(obj).filter(([key]) => !omitSet.has(key as K))
    ) as Omit<T, K>
}

export function generateRandomCode() {
    const random = Math.floor((Math.random()+ 1) * 100000) ;
    return random.toString();
}

export function generateJwt(email: string) {
    const token = jwt.sign(
        { email },
        process.env.JWT_SECRET || '',
        { expiresIn: "1d" }
    );
    return token;
}

export function generateToken() {
    return crypto.randomBytes(32).toString("hex"); // 64 char hex, sicuro e url-safe
}