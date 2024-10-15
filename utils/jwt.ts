import jwt from "jsonwebtoken"
import { APIError } from "./router";
import { z } from "zod";

const JwtClaimsSchema = z.object({
    username: z.string(),
})
export type JwtClaims = z.infer<typeof JwtClaimsSchema>

export const jwt_secret = process.env.JWT_SECRET ?? ""
export async function signToken(claims: JwtClaims) {
    await JwtClaimsSchema.parseAsync(claims)

    const token = jwt.sign(
        claims,
        jwt_secret,
        { algorithm: "HS256" }
    );

    return token;
}

export async function verifyToken(token: string): Promise<JwtClaims> {
    let claims: JwtClaims | string

    try {
        // decode & verify the jwt
        claims = jwt.verify(
            token,
            jwt_secret,
            { algorithms: ["HS256"] }
        ) as JwtClaims | string;
    } catch(err) {
        if (err instanceof jwt.JsonWebTokenError) {
            throw new APIError(401, "Invalid token");
        }

        throw err
    }

    // make sure claims are not invalid
    if (typeof claims === "string") {
        throw new APIError(401, "Invalid token");
    }

    try {
        // verify the jwt against the schema
        // since the signature has been verified above,
        // no token should fail this schema except if the
        // backend has signed an invalid token / this is an
        // outdated token
        claims = await JwtClaimsSchema.parseAsync(claims);
    } catch(err) {
        throw new APIError(401, "Invalid token");
    }

    return claims as JwtClaims
}