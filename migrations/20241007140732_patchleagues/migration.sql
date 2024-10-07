/*
  Warnings:

  - You are about to drop the column `leaguePromotions` on the `NotificationPreferences` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "NotificationPreferences" DROP COLUMN "leaguePromotions",
ADD COLUMN     "leagues" BOOLEAN NOT NULL DEFAULT true;
