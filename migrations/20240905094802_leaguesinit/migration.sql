/*
  Warnings:

  - You are about to drop the `BattleSessions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "BattleSessions" DROP CONSTRAINT "BattleSessions_attackerUsername_fkey";

-- DropForeignKey
ALTER TABLE "BattleSessions" DROP CONSTRAINT "BattleSessions_defenderUsername_fkey";

-- DropForeignKey
ALTER TABLE "BattleSessions" DROP CONSTRAINT "BattleSessions_gameplayUserId_fkey";

-- AlterTable
ALTER TABLE "GameplayUser" ADD COLUMN     "leagueId" STRING;

-- DropTable
DROP TABLE "BattleSessions";

-- CreateTable
CREATE TABLE "League" (
    "id" STRING NOT NULL,
    "tier" STRING NOT NULL,
    "division" STRING NOT NULL,
    "number" INT4 NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "GameplayUser" ADD CONSTRAINT "GameplayUser_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE SET NULL ON UPDATE CASCADE;
