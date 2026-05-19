import { user } from '../db/schema.js';

type User = typeof user.$inferSelect;

export function userOmits(u: User) {
    const { password, emailVerificationCode, passwordRecoveryCode, ...rest } = u;
    return rest;
}
