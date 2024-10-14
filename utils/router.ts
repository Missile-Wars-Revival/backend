import { NextFunction, Request, Response } from "express";

export function handleAsync(handler: (req:Request, res:Response, next:NextFunction) => Promise<any>){
    return async (req:Request, res:Response, next:NextFunction) => {
        try{
            await handler(req, res, next)
        }catch(err){
            next(err)
        }
    }
}

export class APIError extends Error {
    name = "APIError"
    status: number
    constructor(status: number, message: string) {
        super(message)
        this.status = status
    }
}