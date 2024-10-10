-- DropForeignKey
ALTER TABLE "PasswordResetCodes" DROP CONSTRAINT "PasswordResetCodes_userId_fkey";

-- DropForeignKey
ALTER TABLE "Sessions" DROP CONSTRAINT "Sessions_userId_fkey";

-- AddForeignKey
ALTER TABLE "PasswordResetCodes" ADD CONSTRAINT "PasswordResetCodes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sessions" ADD CONSTRAINT "Sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
