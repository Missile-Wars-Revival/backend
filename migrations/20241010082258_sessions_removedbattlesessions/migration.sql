/*
  Warnings:

  - The primary key for the `Sessions` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `userAgent` on the `Sessions` table. All the data in the column will be lost.
  - You are about to drop the column `username` on the `Sessions` table. All the data in the column will be lost.
  - The `lastLoginTime` column on the `Sessions` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `BattleSessions` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `userId` to the `Sessions` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "BattleSessions" DROP CONSTRAINT "BattleSessions_attackerUsername_fkey";

-- DropForeignKey
ALTER TABLE "BattleSessions" DROP CONSTRAINT "BattleSessions_defenderUsername_fkey";

-- DropForeignKey
ALTER TABLE "BattleSessions" DROP CONSTRAINT "BattleSessions_gameplayUserId_fkey";

-- AlterTable
ALTER TABLE "Sessions" DROP CONSTRAINT "Sessions_pkey",
DROP COLUMN "userAgent",
DROP COLUMN "username",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD COLUMN     "userId" INTEGER NOT NULL,
DROP COLUMN "lastLoginTime",
ADD COLUMN     "lastLoginTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD CONSTRAINT "Sessions_pkey" PRIMARY KEY ("id");

-- DropTable
DROP TABLE "BattleSessions";

-- AddForeignKey
ALTER TABLE "Sessions" ADD CONSTRAINT "Sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
