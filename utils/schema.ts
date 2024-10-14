import { NextFunction, Request, Response } from "express";
import { z, ZodError, ZodSchema } from "zod";

export function validateSchema(schema: ZodSchema) {
    return async function(req: Request, res: Response, next: NextFunction) {
        try {
            req.body = await schema.parseAsync(req.body);
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                return res.status(400).json(error.errors);
            }

            next(error); // Pass the error to the next error handler
        }
    }
}

export const emailSchema = z.string().email()