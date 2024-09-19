-- CreateTable
CREATE TABLE "FriendRequests" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL DEFAULT '',
    "friend" TEXT NOT NULL DEFAULT '',
    "gameplayUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FriendRequests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameplayUser" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL DEFAULT '',
    "level" INTEGER NOT NULL DEFAULT 1,
    "exp" INTEGER NOT NULL DEFAULT 0,
    "money" INTEGER NOT NULL DEFAULT 2000,
    "health" INTEGER NOT NULL DEFAULT 100,
    "friendsOnly" BOOLEAN NOT NULL DEFAULT false,
    "rank" TEXT NOT NULL DEFAULT 'Private',
    "rankPoints" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isAlive" BOOLEAN NOT NULL DEFAULT true,
    "leagueId" TEXT,
    "locActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "GameplayUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Statistics" (
    "id" BIGSERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "badges" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "numDeaths" INTEGER NOT NULL DEFAULT 0,
    "numLootPlaced" INTEGER NOT NULL DEFAULT 0,
    "numLandminesPlaced" INTEGER NOT NULL DEFAULT 0,
    "numMissilesPlaced" INTEGER NOT NULL DEFAULT 0,
    "numLootPickups" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Statistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Landmine" (
    "id" SERIAL NOT NULL,
    "placedBy" TEXT NOT NULL,
    "locLat" TEXT NOT NULL DEFAULT '',
    "locLong" TEXT NOT NULL DEFAULT '',
    "placedtime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "Expires" TIMESTAMP(3) NOT NULL,
    "damage" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Landmine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandmineType" (
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "damage" INTEGER NOT NULL,
    "duration" INTEGER NOT NULL,

    CONSTRAINT "LandmineType_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "Locations" (
    "username" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitude" TEXT NOT NULL DEFAULT '',
    "longitude" TEXT NOT NULL DEFAULT '',
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousLat" TEXT NOT NULL DEFAULT '',
    "previousLong" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Locations_pkey" PRIMARY KEY ("username")
);

-- CreateTable
CREATE TABLE "Loot" (
    "id" SERIAL NOT NULL,
    "rarity" TEXT NOT NULL,
    "Expires" TIMESTAMP(3) NOT NULL,
    "locLat" TEXT NOT NULL DEFAULT '',
    "locLong" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Loot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Other" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "radius" INTEGER NOT NULL,
    "Expires" TIMESTAMP(3) NOT NULL,
    "locLat" TEXT NOT NULL DEFAULT '',
    "locLong" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Other_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Messages" (
    "id" SERIAL NOT NULL,
    "sender" TEXT NOT NULL DEFAULT '',
    "receiver" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "createdAt" TEXT NOT NULL DEFAULT '',
    "updatedAt" TEXT NOT NULL DEFAULT '',
    "deletedAt" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Missile" (
    "id" SERIAL NOT NULL,
    "destLat" TEXT NOT NULL DEFAULT '',
    "destLong" TEXT NOT NULL DEFAULT '',
    "damage" INTEGER NOT NULL DEFAULT 1,
    "radius" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "sentBy" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "currentLat" TEXT NOT NULL DEFAULT '',
    "currentLong" TEXT NOT NULL DEFAULT '',
    "timeToImpact" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Missile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissileType" (
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "speed" INTEGER NOT NULL,
    "radius" INTEGER NOT NULL,
    "damage" INTEGER NOT NULL,
    "fallout" INTEGER NOT NULL,

    CONSTRAINT "MissileType_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "RefreshTokens" (
    "id" SERIAL NOT NULL,
    "refreshToken" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "RefreshTokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sessions" (
    "lastIp" TEXT NOT NULL DEFAULT '',
    "username" TEXT NOT NULL DEFAULT '',
    "lastLoginTime" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Sessions_pkey" PRIMARY KEY ("username")
);

-- CreateTable
CREATE TABLE "Users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "password" TEXT NOT NULL DEFAULT '',
    "username" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'user',
    "avatar" TEXT NOT NULL DEFAULT '',
    "friends" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notificationToken" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stripeCustomerId" TEXT,

    CONSTRAINT "Users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "sentby" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "League" (
    "id" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BattleSessions" (
    "sessionId" TEXT NOT NULL,
    "attackerUsername" TEXT NOT NULL DEFAULT '',
    "defenderUsername" TEXT NOT NULL DEFAULT '',
    "gameplayUserId" INTEGER,
    "result" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "target" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BattleSessions_pkey" PRIMARY KEY ("attackerUsername","defenderUsername")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameplayUser_username_key" ON "GameplayUser"("username");

-- CreateIndex
CREATE UNIQUE INDEX "LandmineType_name_key" ON "LandmineType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Locations_username_key" ON "Locations"("username");

-- CreateIndex
CREATE UNIQUE INDEX "MissileType_name_key" ON "MissileType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Users_username_key" ON "Users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Users_stripeCustomerId_key" ON "Users"("stripeCustomerId");

-- AddForeignKey
ALTER TABLE "FriendRequests" ADD CONSTRAINT "FriendRequests_gameplayUserId_fkey" FOREIGN KEY ("gameplayUserId") REFERENCES "GameplayUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameplayUser" ADD CONSTRAINT "GameplayUser_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameplayUser" ADD CONSTRAINT "GameplayUser_username_fkey" FOREIGN KEY ("username") REFERENCES "Users"("username") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "GameplayUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Statistics" ADD CONSTRAINT "Statistics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "GameplayUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Locations" ADD CONSTRAINT "Locations_username_fkey" FOREIGN KEY ("username") REFERENCES "GameplayUser"("username") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notifications" ADD CONSTRAINT "Notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("username") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BattleSessions" ADD CONSTRAINT "BattleSessions_attackerUsername_fkey" FOREIGN KEY ("attackerUsername") REFERENCES "GameplayUser"("username") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BattleSessions" ADD CONSTRAINT "BattleSessions_defenderUsername_fkey" FOREIGN KEY ("defenderUsername") REFERENCES "GameplayUser"("username") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BattleSessions" ADD CONSTRAINT "BattleSessions_gameplayUserId_fkey" FOREIGN KEY ("gameplayUserId") REFERENCES "GameplayUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
