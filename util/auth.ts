import * as jwt from "jsonwebtoken";

// Tokens are valid for 30 days. Passing the same value as maxAge to verify
// also retroactively bounds legacy tokens that were signed without an exp
// claim (their age is measured from iat).
export const TOKEN_TTL = "30d";

let cachedSecret: string | undefined;

export function getJwtSecret(): string {
    if (!cachedSecret) {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            throw new Error(
                "JWT_SECRET is not set. Refusing to sign or verify tokens with an empty secret — set JWT_SECRET in the environment (.env locally, eb setenv on Elastic Beanstalk)."
            );
        }
        cachedSecret = secret;
    }
    return cachedSecret;
}

export interface TokenPayload extends jwt.JwtPayload {
    username: string;
}

export function signToken(username: string): string {
    return jwt.sign({ username }, getJwtSecret(), { expiresIn: TOKEN_TTL });
}

// Throws (JsonWebTokenError / TokenExpiredError) on bad, expired, or
// malformed tokens — callers keep the existing verify-inside-try/catch shape.
export function verifyToken(token: string): TokenPayload {
    const decoded = jwt.verify(token, getJwtSecret(), { maxAge: TOKEN_TTL });
    if (typeof decoded === "string" || !decoded.username) {
        throw new jwt.JsonWebTokenError("Token payload missing username");
    }
    return decoded as TokenPayload;
}
