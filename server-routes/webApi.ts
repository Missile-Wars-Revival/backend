import * as jwt from "jsonwebtoken";
import { prisma } from "../server";
import { NextFunction, Request, Response } from "express";
import * as argon2 from "argon2";
import { LoginSchema } from "../interfaces/api";
import { validateSchema } from "./authRoutes";

export function setupWebApi(app: any) {
    app.post('/api/Weblogin', validateSchema(LoginSchema), async (req: Request, res: Response) => {
        const { username, password } = req.body;

        const user = await prisma.users.findFirst({
            where: { username },
        });

        if (user && (await argon2.verify(user.password, password))) {
            const token = jwt.sign(
                { username: user.username },
                process.env.JWT_SECRET || ""
            );
    
            // Set the token as an HTTP-only cookie
            res.cookie('auth_token', token, {
                httpOnly: true,
                secure: true,
                // secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
            });
    
            // Also send the token in the response body
            res.status(200).json({ message: 'Login successful', token: token });
        } else {
            res.status(401).json({ message: 'Invalid username or password' });
        }
    });
    // Middleware to verify JWT token
    const verifyToken = (req: Request, res: Response, next: NextFunction) => {
        const token = req.cookies.auth_token;
        if (!token) {
            return res.status(403).json({ message: "A token is required for authentication" });
        }
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            (req as any).user = decoded;
        } catch (err) {
            return res.status(401).json({ message: "Invalid Token" });
        }
        return next();
    };

    // Logout endpoint
    app.post('/api/Weblogout', (req: Request, res: Response) => {
        res.clearCookie('auth_token');
        res.status(200).json({ message: 'Logged out successfully' });
    });

    // Example of a protected route
    app.get('/api/Webprotected', verifyToken, (req: Request, res: Response) => {
        res.status(200).json({ message: 'Access granted to protected route' });
    });


}