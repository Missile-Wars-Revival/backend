import * as jwt from "jsonwebtoken";
import { prisma } from "../server";
import * as argon2 from "argon2";
import * as crypto from 'crypto';
import nodemailer from 'nodemailer';
import { deleteResetToken, getResetTokenInfo, storeResetToken } from "../runners/usermanagment";
import { Login, LoginSchema, Register, RegisterSchema } from "../interfaces/api";
import { NextFunction, Request, Response } from "express";
import { z, ZodError } from "zod";

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

export const validateSchema =
  (schema: z.ZodSchema) =>
    (req: Request, res: Response, next: NextFunction) => {
      try {
        schema.parse(req.body);
        next();
      } catch (error) {
        if (error instanceof ZodError) {
          return res.status(400).json(error.errors);
        }
        next(error); // Pass the error to the next error handler
      }
    };

export function setupAuthRoutes(app: any) {
    app.post("/api/login", validateSchema(LoginSchema), async (req: Request, res: Response) => {
        const login: Login = req.body;

        const user = await prisma.users.findFirst({
            where: {
                username: login.username,
            },
        });

        if (user && (await argon2.verify(user.password, login.password))) {
            const token = jwt.sign(
                { username: user.username, password: user.password },
                process.env.JWT_SECRET || ""
            );

            await prisma.users.update({
                where: {
                    username: login.username,
                },
                data: {
                    notificationToken: login.notificationToken,
                },
            });

            res.status(200).json({ message: "Login successful", token });
        } else {
            res.status(401).json({ message: "Invalid username or password" });
        }
    });

    app.post("/api/register", validateSchema(RegisterSchema), async (req: Request, res: Response) => {
        const register: Register = req.body;

        const existingUser = await prisma.users.findFirst({
            where: {
                username: register.username,
            },
        });

        if (existingUser) {
            return res.status(409).json({ message: "User already exists" });
        }

        if (register.password.length < 8) {
            return res
                .status(400)
                .json({ message: "Password must be at least 8 characters long" });
        }

        if (register.username.length < 3) {
            return res
                .status(400)
                .json({ message: "Username must be at least 3 characters long" });
        }

        if (!register.username.match(/^[a-zA-Z0-9]+$/)) {
            return res
                .status(400)
                .json({ message: "Username must only contain letters and numbers" });
        }

        if (
            !register.password.match(
                /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/
            )
        ) {
            return res.status(400).json({
                message:
                    "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
            });
        }

        if (!register.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
            return res.status(400).json({ message: "Invalid email address" });
        }

        if (
            (existingUser as unknown as { email: string })?.email === register.email
        ) {
            return res.status(400).json({ message: "Email already exists" });
        }

        const hashedPassword = await argon2.hash(register.password);

        await prisma.users.create({
            data: {
                username: register.username,
                password: hashedPassword,
                email: register.email,
            },
        });

        await prisma.gameplayUser.create({
            data: {
                username: register.username,
                createdAt: new Date().toISOString(),
            },
        });

        const token = jwt.sign(
            { username: register.username, password: register.password },
            process.env.JWT_SECRET || ""
        );

        res.status(200).json({ message: "User created", token });
    });

    app.post("/api/requestPasswordReset", async (req: Request, res: Response) => {
        const { email } = req.body;

        try {
            const user = await prisma.users.findFirst({ where: { email } });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            const resetToken = crypto.randomBytes(32).toString('hex');
            const resetTokenExpiry = new Date(Date.now() + 3600000); // Token valid for 1 hour

            await storeResetToken(user.id, resetToken, resetTokenExpiry);

            const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

            await transporter.sendMail({
                from: process.env.EMAIL_FROM,
                to: user.email,
                subject: "Password Reset Request",
                text: `Please use the following link to reset your password: ${resetUrl}`,
                html: `<p>Please use the following link to reset your password:</p><a href="${resetUrl}">${resetUrl}</a>`,
            });

            res.status(200).json({ message: "Password reset email sent" });
        } catch (error) {
            console.error("Password reset request failed:", error);
            res.status(500).json({ message: "Failed to process password reset request" });
        }
    });
    app.post("/api/resetPassword", async (req: Request, res: Response) => {
        const { token, newPassword } = req.body;

        try {
            const resetInfo = await getResetTokenInfo(token);
            if (!resetInfo || resetInfo.expiry < new Date()) {
                return res.status(400).json({ message: "Invalid or expired reset token" });
            }

            const hashedPassword = await argon2.hash(newPassword);

            await prisma.users.update({
                where: { id: resetInfo.userId },
                data: { password: hashedPassword },
            });

            await deleteResetToken(token);

            res.status(200).json({ message: "Password reset successful" });
        } catch (error) {
            console.error("Password reset failed:", error);
            res.status(500).json({ message: "Failed to reset password" });
        }
    });

    app.post("/api/requestUsernameReminder", async (req: Request, res: Response) => {
        const { email } = req.body;

        try {
            const user = await prisma.users.findFirst({ where: { email } });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            await transporter.sendMail({
                from: process.env.EMAIL_FROM,
                to: user.email,
                subject: "Username Reminder",
                text: `Your username is: ${user.username}`,
                html: `<p>Your username is: <strong>${user.username}</strong></p>`,
            });

            res.status(200).json({ message: "Username reminder email sent" });
        } catch (error) {
            console.error("Username reminder request failed:", error);
            res.status(500).json({ message: "Failed to process username reminder request" });
        }
    });
}