import { Request, Response } from "express";
import { prisma } from "../server";
import { verifyToken } from "../utils/jwt";
import { z } from "zod";
import { handleAsync } from "../utils/router";

export function setupRankApi(app: any) {
  const GetRankPointsSchema = z.object({
    token: z.string()
  })
  app.post("/api/getRankPoints", handleAsync(async (req: Request, res: Response) => {
    const { token } = await GetRankPointsSchema.parseAsync(req.body);
  
    const claims = await verifyToken(token);
  
    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: claims.username
      },
    });
  
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ rankPoints: user.rankPoints });
  }));
  
  const AddRankPointsSchema = z.object({
    token: z.string(),
    points: z.number().int().positive()
  })
  app.post("/api/addRankPoints", handleAsync(async (req: Request, res: Response) => {
    const { token, points } = await AddRankPointsSchema.parseAsync(req.body);
  
    const claims = await verifyToken(token);

    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: claims.username,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await prisma.gameplayUser.update({
      where: {
        username: claims.username,
      },
      data: {
        rankPoints: {
          increment: points
        }
      },
    });

    res.status(200).json({ message: "Rank points added" });
  }));
  
  const RemoveRankPointsSchema = z.object({
    token: z.string(),
    points: z.number().int().positive()
  })
  app.post("/api/removeRankPoints", handleAsync(async (req: Request, res: Response) => {
    const { token, points } = await RemoveRankPointsSchema.parseAsync(req.body);
  
    const claims = await verifyToken(token);
  
    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: claims.username
      },
    });
  
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await prisma.gameplayUser.update({
      where: {
        username: claims.username
      },
      data: {
        rankPoints: {
          decrement: points
        },
      },
    });

    res.status(200).json({ message: "Rank points removed" });
  }));
  
  const GetRankSchema = z.object({
    token: z.string()
  })
  app.post("/api/getRank", handleAsync(async (req: Request, res: Response) => {
    const { token } = await GetRankSchema.parseAsync(req.body);
  
    const claims = await verifyToken(token)
  
    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: claims.username,
      },
    });
  
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const rank = user.rank;

    res.status(200).json({ rank });
  }));
  
  const SetRankSchema = z.object({
    token: z.string(),
    rank: z.string()
  })
  app.post("/api/setRank", handleAsync(async (req: Request, res: Response) => {
    const { token, rank } = await SetRankSchema.parseAsync(req.body);
  
    const claims = await verifyToken(token);
  
    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: claims.username,
      },
    });
  
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    await prisma.gameplayUser.update({
      where: {
        username: claims.username
      },
      data: {
        rank,
      },
    });

    res.status(200).json({ message: "Rank set" });
  }));
}