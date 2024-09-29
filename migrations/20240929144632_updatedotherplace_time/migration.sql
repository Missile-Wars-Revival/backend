/*
  Warnings:

  - You are about to drop the column `placedtime` on the `Landmine` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Landmine" DROP COLUMN "placedtime",
ADD COLUMN     "placedTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Other" ADD COLUMN     "placedTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
