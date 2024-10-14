import jwt from "jsonwebtoken"
import { APIError } from "./router";
import { z } from "zod";

const JwtClaimsSchema = z.object({
    username: z.string(),
})
export type JwtClaims = z.infer<typeof JwtClaimsSchema>

export const jwt_secret = process.env.JWT_SECRET ?? ""
export function signToken(claims: JwtClaims) {
    const token = jwt.sign(
        claims,
        jwt_secret,
        { algorithm: "HS256" }
    );

    return token;
}

export async function verifyToken(token: string): Promise<JwtClaims> {
    let claims = jwt.verify(
        token,
        jwt_secret,
        { algorithms: ["HS256"] }
    ) as JwtClaims | string;

    if (typeof claims === "string") {
        throw new APIError(401, "Invalid token");
    }

    try {
        // verify the jwt against the schema
        // since the signature has been verified above,
        // no token should fail this schema except if the
        // backend has signed an invalid token
        claims = await JwtClaimsSchema.parseAsync(claims);
    } catch(err) {
        throw new APIError(401, "Invalid token");
    }

    return claims as JwtClaims
}