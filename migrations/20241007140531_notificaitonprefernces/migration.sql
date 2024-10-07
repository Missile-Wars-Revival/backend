-- CreateTable
CREATE TABLE "NotificationPreferences" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "incomingEntities" BOOLEAN NOT NULL DEFAULT true,
    "entityDamage" BOOLEAN NOT NULL DEFAULT true,
    "entitiesInAirspace" BOOLEAN NOT NULL DEFAULT true,
    "eliminationReward" BOOLEAN NOT NULL DEFAULT true,
    "lootDrops" BOOLEAN NOT NULL DEFAULT true,
    "friendRequests" BOOLEAN NOT NULL DEFAULT true,
    "leaguePromotions" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreferences_userId_key" ON "NotificationPreferences"("userId");

-- AddForeignKey
ALTER TABLE "NotificationPreferences" ADD CONSTRAINT "NotificationPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
