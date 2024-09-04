import { Request, Response } from "express";
import * as jwt from "jsonwebtoken";
import { prisma } from "../server";
import { JwtPayload } from "jsonwebtoken";

export function setupRankApi(app: any) {
  app.post("/api/getRankPoints", async (req: Request, res: Response) => {
    const { token } = req.body;
  
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
  
    if (!decoded) {
      return res.status(401).json({ message: "Invalid token" });
    }
  
    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: (decoded as JwtPayload).username as string,
      },
    });
  
    if (user) {
      res.status(200).json({ rankPoints: user.rankPoints });
    } else {
      res.status(404).json({ message: "User not found" });
    }
  });
  
  app.post("/api/addRankPoints", async (req: Request, res: Response) => {
    const { token, points } = req.body;
  
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
  
      // Check if decoded is of type JwtPayload and has a username property
      if (typeof decoded === 'object' && 'username' in decoded) {
        const username = decoded.username;
  
        const user = await prisma.gameplayUser.findFirst({
          where: {
            username: username,
          },
        });
  
        if (user) {
          await prisma.gameplayUser.update({
            where: {
              username: username,
            },
            data: {
              rankPoints: user.rankPoints + points, // Correctly add points to the current rankPoints
            },
          });
  
          res.status(200).json({ message: "Rank points added" });
        } else {
          res.status(404).json({ message: "User not found" });
        }
      } else {
        // If decoded does not have a username property
        res.status(401).json({ message: "Invalid token" });
      }
    } catch (error) {
      res.status(500).json({ message: "Error verifying token" });
    }
  });
  
  app.post("/api/removeRankPoints", async (req: Request, res: Response) => {
    const { token, points } = req.body;
  
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
  
    if (!decoded) {
      return res.status(401).json({ message: "Invalid token" });
    }
  
    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: (decoded as JwtPayload).username as string,
      },
    });
  
    if (user) {
      await prisma.gameplayUser.update({
        where: {
          username: (decoded as JwtPayload).username as string,
        },
        data: {
          rankPoints: user.rankPoints - points,
        },
      });
  
      res.status(200).json({ message: "Rank points removed" });
    } else {
      res.status(404).json({ message: "User not found" });
    }
  });
  
  app.post("/api/getRank", async (req: Request, res: Response) => {
    const { token } = req.body;
  
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
  
    if (!decoded) {
      return res.status(401).json({ message: "Invalid token" });
    }
  
    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: (decoded as JwtPayload).username as string,
      },
    });
  
    if (user) {
      const rank = user.rank;
  
      res.status(200).json({ rank });
    } else {
      res.status(404).json({ message: "User not found" });
    }
  });
  
  app.post("/api/setRank", async (req: Request, res: Response) => {
    const { token, rank } = req.body;
  
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
  
    if (!decoded) {
      return res.status(401).json({ message: "Invalid token" });
    }
  
    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: (decoded as JwtPayload).username as string,
      },
    });
  
    if (user) {
      await prisma.gameplayUser.update({
        where: {
          username: (decoded as JwtPayload).username as string,
        },
        data: {
          rank,
        },
      });
  
      res.status(200).json({ message: "Rank set" });
    } else {
      res.status(404).json({ message: "User not found" });
    }
  });
}