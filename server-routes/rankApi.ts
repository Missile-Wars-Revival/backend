import { Request, Response } from "express";
import { prisma } from "../server";
import { verifyToken } from "../utils/jwt";

export function setupRankApi(app: any) {
  app.post("/api/getRankPoints", async (req: Request, res: Response) => {
    const { token } = req.body;
  
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
  });
  
  app.post("/api/addRankPoints", async (req: Request, res: Response) => {
    const { token, points } = req.body;
  
    try {
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
          rankPoints: user.rankPoints + points, // Correctly add points to the current rankPoints
        },
      });

      res.status(200).json({ message: "Rank points added" });
    } catch (error) {
      res.status(500).json({ message: "Error verifying token" });
    }
  });
  
  app.post("/api/removeRankPoints", async (req: Request, res: Response) => {
    const { token, points } = req.body;
  
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
        rankPoints: user.rankPoints - points,
      },
    });
    res.status(200).json({ message: "Rank points removed" });
  });
  
  app.post("/api/getRank", async (req: Request, res: Response) => {
    const { token } = req.body;
  
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
  });
  
  app.post("/api/setRank", async (req: Request, res: Response) => {
    const { token, rank } = req.body;
  
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
  });
}