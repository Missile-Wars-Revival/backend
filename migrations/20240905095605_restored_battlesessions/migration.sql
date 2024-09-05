-- CreateTable
CREATE TABLE "BattleSessions" (
    "sessionId" STRING NOT NULL,
    "attackerUsername" STRING NOT NULL DEFAULT '',
    "defenderUsername" STRING NOT NULL DEFAULT '',
    "gameplayUserId" INT4,
    "result" STRING NOT NULL DEFAULT '',
    "status" STRING NOT NULL DEFAULT '',
    "target" STRING NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BattleSessions_pkey" PRIMARY KEY ("attackerUsername","defenderUsername")
);

-- AddForeignKey
ALTER TABLE "BattleSessions" ADD CONSTRAINT "BattleSessions_attackerUsername_fkey" FOREIGN KEY ("attackerUsername") REFERENCES "GameplayUser"("username") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BattleSessions" ADD CONSTRAINT "BattleSessions_defenderUsername_fkey" FOREIGN KEY ("defenderUsername") REFERENCES "GameplayUser"("username") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BattleSessions" ADD CONSTRAINT "BattleSessions_gameplayUserId_fkey" FOREIGN KEY ("gameplayUserId") REFERENCES "GameplayUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
