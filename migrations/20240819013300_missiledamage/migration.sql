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

-- CreateTable
CREATE TABLE "FriendRequests" (
    "id" INT4 NOT NULL GENERATED BY DEFAULT AS IDENTITY (MAXVALUE 2147483647),
    "username" STRING NOT NULL DEFAULT '',
    "friend" STRING NOT NULL DEFAULT '',
    "gameplayUserId" INT4,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FriendRequests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameplayUser" (
    "id" INT4 NOT NULL GENERATED BY DEFAULT AS IDENTITY (MAXVALUE 2147483647),
    "username" STRING NOT NULL DEFAULT '',
    "level" INT4 NOT NULL DEFAULT 1,
    "exp" INT4 NOT NULL DEFAULT 0,
    "money" INT4 NOT NULL DEFAULT 2000,
    "health" INT4 NOT NULL DEFAULT 100,
    "friendsOnly" BOOL NOT NULL DEFAULT false,
    "rank" STRING NOT NULL DEFAULT 'Private',
    "rankPoints" INT4 NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isAlive" BOOL NOT NULL DEFAULT true,

    CONSTRAINT "GameplayUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" INT8 NOT NULL DEFAULT unique_rowid(),
    "name" STRING NOT NULL,
    "quantity" INT4 NOT NULL,
    "userId" INT4 NOT NULL,
    "category" STRING NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Statistics" (
    "id" INT8 NOT NULL DEFAULT unique_rowid(),
    "userId" INT4 NOT NULL,
    "badges" STRING[] DEFAULT ARRAY[]::STRING[],
    "numDeaths" INT4 NOT NULL DEFAULT 0,
    "numLootPlaced" INT4 NOT NULL DEFAULT 0,
    "numLandminesPlaced" INT4 NOT NULL DEFAULT 0,
    "numMissilesPlaced" INT4 NOT NULL DEFAULT 0,
    "numLootPickups" INT4 NOT NULL DEFAULT 0,

    CONSTRAINT "Statistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Landmine" (
    "id" INT4 NOT NULL GENERATED BY DEFAULT AS IDENTITY (MAXVALUE 2147483647),
    "placedBy" STRING NOT NULL,
    "locLat" STRING NOT NULL DEFAULT '',
    "locLong" STRING NOT NULL DEFAULT '',
    "placedtime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" STRING NOT NULL,
    "Expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Landmine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandmineType" (
    "name" STRING NOT NULL,
    "description" STRING NOT NULL,
    "price" INT4 NOT NULL,
    "damage" INT4 NOT NULL,
    "duration" INT4 NOT NULL,

    CONSTRAINT "LandmineType_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "Locations" (
    "username" STRING NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitude" STRING NOT NULL DEFAULT '',
    "longitude" STRING NOT NULL DEFAULT '',

    CONSTRAINT "Locations_pkey" PRIMARY KEY ("username")
);

-- CreateTable
CREATE TABLE "Loot" (
    "id" INT4 NOT NULL GENERATED BY DEFAULT AS IDENTITY (MAXVALUE 2147483647),
    "rarity" STRING NOT NULL,
    "Expires" TIMESTAMP(3) NOT NULL,
    "locLat" STRING NOT NULL DEFAULT '',
    "locLong" STRING NOT NULL DEFAULT '',

    CONSTRAINT "Loot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Messages" (
    "id" INT4 NOT NULL GENERATED BY DEFAULT AS IDENTITY (MAXVALUE 2147483647),
    "sender" STRING NOT NULL DEFAULT '',
    "receiver" STRING NOT NULL DEFAULT '',
    "content" STRING NOT NULL DEFAULT '',
    "createdAt" STRING NOT NULL DEFAULT '',
    "updatedAt" STRING NOT NULL DEFAULT '',
    "deletedAt" STRING NOT NULL DEFAULT '',

    CONSTRAINT "Messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Missile" (
    "id" INT4 NOT NULL GENERATED BY DEFAULT AS IDENTITY (MAXVALUE 2147483647),
    "destLat" STRING NOT NULL DEFAULT '',
    "destLong" STRING NOT NULL DEFAULT '',
    "damage" INT4 NOT NULL DEFAULT 1,
    "radius" INT4 NOT NULL,
    "type" STRING NOT NULL,
    "sentBy" STRING NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "status" STRING NOT NULL,
    "currentLat" STRING NOT NULL DEFAULT '',
    "currentLong" STRING NOT NULL DEFAULT '',
    "timeToImpact" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Missile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissileType" (
    "name" STRING NOT NULL,
    "description" STRING NOT NULL,
    "price" INT4 NOT NULL,
    "speed" INT4 NOT NULL,
    "radius" INT4 NOT NULL,
    "damage" INT4 NOT NULL,
    "fallout" INT4 NOT NULL,

    CONSTRAINT "MissileType_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "RefreshTokens" (
    "id" INT4 NOT NULL GENERATED BY DEFAULT AS IDENTITY (MAXVALUE 2147483647),
    "refreshToken" STRING NOT NULL DEFAULT '',

    CONSTRAINT "RefreshTokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sessions" (
    "lastIp" STRING NOT NULL DEFAULT '',
    "username" STRING NOT NULL DEFAULT '',
    "lastLoginTime" STRING NOT NULL DEFAULT '',
    "userAgent" STRING NOT NULL DEFAULT '',

    CONSTRAINT "Sessions_pkey" PRIMARY KEY ("username")
);

-- CreateTable
CREATE TABLE "Users" (
    "id" INT4 NOT NULL GENERATED BY DEFAULT AS IDENTITY (MAXVALUE 2147483647),
    "email" STRING NOT NULL DEFAULT '',
    "password" STRING NOT NULL DEFAULT '',
    "username" STRING NOT NULL DEFAULT '',
    "role" STRING NOT NULL DEFAULT 'user',
    "avatar" STRING NOT NULL DEFAULT '',
    "friends" STRING[] DEFAULT ARRAY[]::STRING[],
    "notificationToken" STRING NOT NULL DEFAULT '',
    "notifications" STRING[] DEFAULT ARRAY[]::STRING[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stripeCustomerId" STRING,

    CONSTRAINT "Users_pkey" PRIMARY KEY ("id")
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
ALTER TABLE "BattleSessions" ADD CONSTRAINT "BattleSessions_attackerUsername_fkey" FOREIGN KEY ("attackerUsername") REFERENCES "GameplayUser"("username") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BattleSessions" ADD CONSTRAINT "BattleSessions_defenderUsername_fkey" FOREIGN KEY ("defenderUsername") REFERENCES "GameplayUser"("username") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BattleSessions" ADD CONSTRAINT "BattleSessions_gameplayUserId_fkey" FOREIGN KEY ("gameplayUserId") REFERENCES "GameplayUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendRequests" ADD CONSTRAINT "FriendRequests_gameplayUserId_fkey" FOREIGN KEY ("gameplayUserId") REFERENCES "GameplayUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameplayUser" ADD CONSTRAINT "GameplayUser_username_fkey" FOREIGN KEY ("username") REFERENCES "Users"("username") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "GameplayUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Statistics" ADD CONSTRAINT "Statistics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "GameplayUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Locations" ADD CONSTRAINT "Locations_username_fkey" FOREIGN KEY ("username") REFERENCES "GameplayUser"("username") ON DELETE RESTRICT ON UPDATE CASCADE;
