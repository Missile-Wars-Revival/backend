"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAndCollectLoot = exports.checkPlayerProximity = exports.addRandomLoot = exports.deleteExpiredOther = exports.deleteExpiredLoot = exports.deleteExpiredLandmines = exports.deleteExpiredMissiles = exports.updateMissilePositions = exports.getRandomCoordinates = exports.haversine = void 0;
const server_1 = require("../server");
const geolib = __importStar(require("geolib"));
const friendsApi_1 = require("../server-routes/friendsApi");
const notificationhelper_1 = require("./notificationhelper");
const turf = __importStar(require("@turf/turf"));
const lootconfig_1 = require("./lootconfig");
// Add this at the top of your file or in an appropriate scope
const notifiedEntities = new Set();
const notifiedLootItems = new Set();
const haversine = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // meters
    const φ1 = parseFloat(lat1) * Math.PI / 180;
    const φ2 = parseFloat(lat2) * Math.PI / 180;
    const Δφ = (parseFloat(lat2) - parseFloat(lat1)) * Math.PI / 180;
    const Δλ = (parseFloat(lon2) - parseFloat(lon1)) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c); // in meters, rounded to the nearest integer
};
exports.haversine = haversine;
function getRandomCoordinates(latitude, longitude, radiusInMeters) {
    // Generate a random point within the given radius
    const randomPoint = geolib.computeDestinationPoint({ latitude, longitude }, Math.random() * radiusInMeters, Math.random() * 360);
    return randomPoint;
}
exports.getRandomCoordinates = getRandomCoordinates;
const HOLDING_PATTERN_DISTANCE = 1; // km from target to start holding pattern
const HOLDING_PATTERN_RADIUS = 0.5; // km radius of the holding pattern circle
const updateMissilePositions = async () => {
    try {
        const currentTime = new Date();
        const missiles = await server_1.prisma.missile.findMany({
            where: { status: 'Incoming' },
        });
        for (const missile of missiles) {
            const timeToImpact = new Date(missile.timeToImpact);
            const remainingTime = timeToImpact.getTime() - currentTime.getTime();
            if (remainingTime <= 0) {
                await server_1.prisma.missile.update({
                    where: { id: missile.id },
                    data: {
                        currentLat: missile.destLat,
                        currentLong: missile.destLong,
                        status: 'Hit'
                    }
                });
            }
            else {
                // Calculate new position
                const newPosition = calculateNewPosition({
                    ...missile,
                    timeToImpact: missile.timeToImpact.toISOString(),
                    sentAt: missile.sentAt.toISOString()
                }, currentTime);
                await server_1.prisma.missile.update({
                    where: { id: missile.id },
                    data: {
                        currentLat: newPosition.lat,
                        currentLong: newPosition.long,
                        status: 'Incoming'
                    }
                });
            }
        }
        console.log(`Updated ${missiles.length} missiles`);
    }
    catch (error) {
        console.error('Failed to update missile positions:', error);
    }
};
exports.updateMissilePositions = updateMissilePositions;
// Helper function to calculate new position (implement this based on your logic)
function calculateNewPosition(missile, currentTime) {
    const startLong = parseFloat(missile.currentLong);
    const startLat = parseFloat(missile.currentLat);
    const endLong = parseFloat(missile.destLong);
    const endLat = parseFloat(missile.destLat);
    const start = turf.point([startLong, startLat]);
    const end = turf.point([endLong, endLat]);
    const totalDistance = turf.distance(start, end, { units: 'kilometers' });
    const timeToImpact = new Date(missile.timeToImpact);
    const totalTravelTime = timeToImpact.getTime() - new Date(missile.sentAt).getTime();
    const elapsedTime = currentTime.getTime() - new Date(missile.sentAt).getTime();
    const fractionCompleted = Math.min(elapsedTime / totalTravelTime, 1);
    let newPosition;
    if (fractionCompleted >= 1) {
        newPosition = end;
    }
    else {
        const line = turf.lineString([start.geometry.coordinates, end.geometry.coordinates]);
        const distanceToTravel = totalDistance * fractionCompleted;
        newPosition = turf.along(line, distanceToTravel, { units: 'kilometers' });
        const distanceToTarget = turf.distance(newPosition, end, { units: 'kilometers' });
        if (distanceToTarget <= HOLDING_PATTERN_DISTANCE && (timeToImpact.getTime() - currentTime.getTime()) > 0) {
            const holdingCenter = turf.destination(end, HOLDING_PATTERN_DISTANCE, 0, { units: 'kilometers' });
            const angleInPattern = (currentTime.getTime() % 10000) / 10000 * 360;
            newPosition = turf.destination(holdingCenter, HOLDING_PATTERN_RADIUS, angleInPattern, { units: 'kilometers' });
        }
    }
    return {
        lat: newPosition.geometry.coordinates[1].toString(),
        long: newPosition.geometry.coordinates[0].toString()
    };
}
// Delete items:
const deleteExpiredMissiles = async () => {
    try {
        // Current time
        const now = new Date();
        // Fetch all missile types with their fallout times
        const missileTypes = await server_1.prisma.missileType.findMany({
            select: { name: true, fallout: true }
        });
        // Create a map for quick lookup
        const falloutTimeMap = new Map(missileTypes.map((mt) => [mt.name, mt.fallout]));
        // Find and delete expired missiles
        const expiredMissiles = await server_1.prisma.missile.findMany({
            where: { status: 'Hit' },
            select: { id: true, type: true, timeToImpact: true }
        });
        const deletedMissiles = await Promise.all(expiredMissiles.map(async (missile) => {
            const falloutTimeMinutes = Number(falloutTimeMap.get(missile.type)) || 30; // Default to 30 minutes if not found
            const expirationTime = new Date(missile.timeToImpact.getTime() + falloutTimeMinutes * 60 * 1000); // Convert minutes to milliseconds
            if (expirationTime < now) {
                return server_1.prisma.missile.delete({ where: { id: missile.id } });
            }
            return null;
        }));
        const deletedCount = deletedMissiles.filter(Boolean).length;
        console.log(`${deletedCount} missiles deleted.`);
    }
    catch (error) {
        console.error('Failed to delete expired missiles:', error);
    }
};
exports.deleteExpiredMissiles = deleteExpiredMissiles;
const deleteExpiredLandmines = async () => {
    try {
        // Current time
        const now = new Date();
        // Find and delete missiles where status is 'Hit' and fallout time has elapsed
        const result = await server_1.prisma.landmine.deleteMany({
            where: {
                Expires: {
                    lt: new Date(now.getTime()) // Landmines that impacted more than 5 seconds ago
                }
            }
        });
        console.log(`${result.count} landmines deleted.`);
    }
    catch (error) {
        console.error('Failed to delete expired landmines:', error);
    }
};
exports.deleteExpiredLandmines = deleteExpiredLandmines;
const deleteExpiredLoot = async () => {
    try {
        // Current time
        const now = new Date();
        // Find and delete missiles where status is 'Hit' and fallout time has elapsed
        const result = await server_1.prisma.loot.deleteMany({
            where: {
                Expires: {
                    lt: new Date(now.getTime()) // Loot that expired 
                }
            }
        });
        console.log(`${result.count} loot deleted.`);
    }
    catch (error) {
        console.error('Failed to delete expired loot:', error);
    }
};
exports.deleteExpiredLoot = deleteExpiredLoot;
const deleteExpiredOther = async () => {
    try {
        // Current time
        const now = new Date();
        // Find and delete other
        const result = await server_1.prisma.other.deleteMany({
            where: {
                Expires: {
                    lt: new Date(now.getTime()) // other that expired
                }
            }
        });
        console.log(`${result.count} other deleted.`);
    }
    catch (error) {
        console.error('Failed to delete expired other:', error);
    }
};
exports.deleteExpiredOther = deleteExpiredOther;
const haversineDistance = (coords1, coords2, isMiles = false) => {
    function toRad(x) {
        return x * Math.PI / 180;
    }
    var lon1 = coords1.longitude;
    var lat1 = coords1.latitude;
    var lon2 = coords2.longitude;
    var lat2 = coords2.latitude;
    var R = 6371; // km
    if (isMiles)
        R = 3959; // miles
    var x1 = lat2 - lat1;
    var dLat = toRad(x1);
    var x2 = lon2 - lon1;
    var dLon = toRad(x2);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var d = R * c;
    return d;
};
const addRandomLoot = async () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const userLocations = await server_1.prisma.locations.findMany({
        where: {
            updatedAt: { gte: twoDaysAgo },
            // username: {
            //   notIn: (await prisma.users.findMany({
            //     where: { role: "bot" }, // filter for bots
            //     select: { username: true }
            //   })).map(user => user.username)
            // }
        }
    });
    if (userLocations.length === 0) {
        console.log('No active user locations available to place loot.');
        return;
    }
    const randomUserLocation = userLocations[Math.floor(Math.random() * userLocations.length)];
    const baseCoords = { latitude: parseFloat(randomUserLocation.latitude), longitude: parseFloat(randomUserLocation.longitude) };
    const nearbyLoot = await server_1.prisma.loot.findMany();
    const lootThreshold = 0.5; // distance in kilometers below which loot is considered "nearby"
    const isLootNearby = nearbyLoot.some((loot) => {
        const lootCoords = { latitude: parseFloat(loot.locLat), longitude: parseFloat(loot.locLong) };
        return haversineDistance(baseCoords, lootCoords) < lootThreshold;
    });
    if (isLootNearby) {
        console.log('Loot not added, as there is already loot nearby.');
        return;
    }
    const randomCoordinates = getRandomCoordinates(baseCoords.latitude, baseCoords.longitude, 100);
    const locLat = randomCoordinates.latitude.toFixed(6);
    const locLong = randomCoordinates.longitude.toFixed(6);
    const rarities = ['Common', 'Uncommon', 'Rare'];
    const rarity = rarities[Math.floor(Math.random() * rarities.length)];
    try {
        await server_1.prisma.loot.create({
            data: {
                locLat,
                locLong,
                rarity,
                Expires: new Date(Date.now() + 86400000) // Expires in 24 hours
            }
        });
        console.log(`Loot added.`);
    }
    catch (error) {
        console.error('Failed to add loot:', error);
    }
};
exports.addRandomLoot = addRandomLoot;
// Constants for distance thresholds in kilometers
const MISSILE_ALERT_DISTANCE = 0.5; // 0.5 km = 500 meters
const LANDMINE_ALERT_DISTANCE = 0.05; // 0.05 km = 50 meters
const getLeagueAirspace = (league) => {
    switch (league.toLowerCase()) {
        case 'bronze': return 60;
        case 'silver': return 80;
        case 'gold': return 120;
        case 'diamond': return 140;
        case 'legend': return 200;
        default: return 40;
    }
};
const checkPlayerProximity = async () => {
    var _a;
    try {
        const allUsers = await server_1.prisma.gameplayUser.findMany({
            where: {
                isAlive: true,
                locActive: true
            },
            include: { Users: true, Locations: true, league: true }
        });
        for (const user of allUsers) {
            if (!user.Locations)
                continue;
            const userCoords = { latitude: parseFloat(user.Locations.latitude), longitude: parseFloat(user.Locations.longitude) };
            const userAirspace = getLeagueAirspace(((_a = user.league) === null || _a === void 0 ? void 0 : _a.tier) || 'Bronze');
            // Fetch relevant entities based on friendsOnly setting
            let missiles, landmines;
            if (user.friendsOnly) {
                const mutualFriends = await (0, friendsApi_1.getMutualFriends)(user.Users);
                missiles = await server_1.prisma.missile.findMany({ where: { sentBy: { in: mutualFriends } } });
                landmines = await server_1.prisma.landmine.findMany({ where: { placedBy: { in: mutualFriends } } });
            }
            else {
                const nonFriendsOnlyUsers = await server_1.prisma.gameplayUser.findMany({
                    where: { OR: [{ friendsOnly: false }, { username: { in: await (0, friendsApi_1.getMutualFriends)(user.Users) } }] },
                    select: { username: true }
                });
                const relevantUsernames = nonFriendsOnlyUsers.map((u) => u.username);
                missiles = await server_1.prisma.missile.findMany({ where: { sentBy: { in: relevantUsernames } } });
                landmines = await server_1.prisma.landmine.findMany({ where: { placedBy: { in: relevantUsernames } } });
            }
            // Check proximity to missiles
            for (const missile of missiles) {
                const missileDestCoords = { latitude: parseFloat(missile.destLat), longitude: parseFloat(missile.destLong) };
                const missileCurrentCoords = { latitude: parseFloat(missile.currentLat), longitude: parseFloat(missile.currentLong) };
                const distanceToDest = haversineDistance(userCoords, missileDestCoords); // Already in km
                const distanceToCurrent = haversineDistance(userCoords, missileCurrentCoords); // Already in km
                const entityId = `missile-${missile.id}-${user.id}`; // Unique identifier for this missile-user pair
                const airspaceEntityId = `airspace-${missile.id}-${user.id}`; // Unique identifier for airspace alert
                if (!notifiedEntities.has(entityId)) {
                    if (missile.status !== 'Hit') {
                        if (distanceToDest <= missile.radius / 1000 + MISSILE_ALERT_DISTANCE) {
                            // Calculate ETA
                            const currentTime = new Date();
                            const timeToImpact = new Date(missile.timeToImpact);
                            const etaSeconds = Math.max(0, Math.round((timeToImpact.getTime() - currentTime.getTime()) / 1000));
                            const etaHours = Math.floor(etaSeconds / 3600);
                            const etaMinutes = Math.floor((etaSeconds % 3600) / 60);
                            const remainingSeconds = etaSeconds % 60;
                            let etaString = '';
                            if (etaHours > 0) {
                                etaString = `${etaHours} hour${etaHours > 1 ? 's' : ''}`;
                            }
                            else if (etaMinutes > 0) {
                                etaString = `${etaMinutes} minute${etaMinutes > 1 ? 's' : ''}`;
                            }
                            else {
                                etaString = `${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`;
                            }
                            const message = distanceToDest <= missile.radius / 1000
                                ? `A ${missile.type} missile is approaching your location! ETA: ${etaString}. Take cover!`
                                : `A ${missile.type} missile is approaching nearby! ETA: ${etaString}. Be prepared to take cover.`;
                            await (0, notificationhelper_1.sendNotification)(user.username, "Missile Alert!", message, "Server");
                            notifiedEntities.add(entityId);
                        }
                        // New airspace alert logic
                        if (distanceToCurrent <= userAirspace / 1000 && !notifiedEntities.has(airspaceEntityId) && missile.sentBy !== user.username) {
                            const airspaceMessage = `A ${missile.type} missile has entered your airspace!`;
                            await (0, notificationhelper_1.sendNotification)(user.username, "Airspace Alert!", airspaceMessage, "Server");
                            notifiedEntities.add(airspaceEntityId);
                        }
                    }
                    else { // missile.status === 'Hit'
                        if (distanceToDest <= missile.radius / 1000 + MISSILE_ALERT_DISTANCE) {
                            const message = "A missile has impacted nearby! Proceed with caution.";
                            await (0, notificationhelper_1.sendNotification)(user.username, "Missile Impact Alert!", message, "Server");
                            notifiedEntities.add(entityId);
                        }
                    }
                }
            }
            // Check proximity to landmines
            for (const landmine of landmines) {
                const landmineCoords = { latitude: parseFloat(landmine.locLat), longitude: parseFloat(landmine.locLong) };
                const distance = haversineDistance(userCoords, landmineCoords); // Already in km
                const entityId = `landmine-${landmine.id}-${user.id}`;
                if (!notifiedEntities.has(entityId) && distance <= LANDMINE_ALERT_DISTANCE) {
                    await (0, notificationhelper_1.sendNotification)(user.username, "Landmine Nearby!", `Caution: You're within 50 meters of a ${landmine.type} landmine!`, "Server");
                    notifiedEntities.add(entityId);
                }
            }
        }
    }
    catch (error) {
        console.error('Error in checkPlayerProximity:', error);
    }
};
exports.checkPlayerProximity = checkPlayerProximity;
// Add this function to clear notifications when appropriate (e.g., when a missile is removed)
function clearNotification(entityType, entityId) {
    notifiedEntities.forEach((notifiedEntityId) => {
        if (notifiedEntityId.startsWith(`${entityType}-${entityId}-`)) {
            notifiedEntities.delete(notifiedEntityId);
        }
    });
}
const checkAndCollectLoot = async () => {
    try {
        const allUsers = await server_1.prisma.gameplayUser.findMany({
            where: {
                isAlive: true,
                locActive: true
            },
            include: { Users: true, Locations: true }
        });
        for (const user of allUsers) {
            if (!user.Locations)
                continue;
            const userCoords = { latitude: parseFloat(user.Locations.latitude), longitude: parseFloat(user.Locations.longitude) };
            const loot = await server_1.prisma.loot.findMany();
            const LOOT_RADIUS = 0.05; // 50 meters = 0.05 km
            const LOOT_NEARBY_DISTANCE = 0.5; // 0.5 km = 500 meters
            let nearbyLootCount = 0;
            let collectedLoot = [];
            let totalCoinsGained = 0;
            let totalRankPointsGained = 0;
            let totalHealthGained = 0;
            let lootDropCollected = false;
            for (const item of loot) {
                const lootCoords = { latitude: parseFloat(item.locLat), longitude: parseFloat(item.locLong) };
                const distance = haversineDistance(userCoords, lootCoords);
                const lootNotificationId = `${item.id}-${user.id}`;
                if (distance <= LOOT_RADIUS) {
                    const randomLoot = (0, lootconfig_1.getRandomLoot)(item.rarity);
                    if (randomLoot) {
                        if (randomLoot.category === 'Currency' && randomLoot.name === 'Coins') {
                            totalCoinsGained += 1000;
                        }
                        else {
                            collectedLoot.push(randomLoot);
                            lootDropCollected = true;
                            // Check if the item already exists in the user's inventory
                            const existingItem = await server_1.prisma.inventoryItem.findFirst({
                                where: {
                                    userId: user.id,
                                    name: randomLoot.name,
                                    category: randomLoot.category
                                }
                            });
                            if (existingItem) {
                                // If the item exists, update its quantity
                                await server_1.prisma.inventoryItem.update({
                                    where: { id: existingItem.id },
                                    data: { quantity: existingItem.quantity + 1 }
                                });
                            }
                            else {
                                // If the item doesn't exist, create a new entry
                                await server_1.prisma.inventoryItem.create({
                                    data: {
                                        userId: user.id,
                                        name: randomLoot.name,
                                        category: randomLoot.category,
                                        quantity: 1
                                    }
                                });
                            }
                        }
                        totalRankPointsGained += 50;
                        totalHealthGained += 40;
                        totalCoinsGained += 3000;
                        try {
                            await server_1.prisma.loot.delete({ where: { id: item.id } });
                            console.log(`Loot item ${item.id} deleted successfully`);
                            notifiedLootItems.delete(lootNotificationId);
                        }
                        catch (error) {
                            console.error(`Failed to delete loot item ${item.id}:`, error);
                        }
                    }
                }
                else if (distance <= LOOT_NEARBY_DISTANCE && !notifiedLootItems.has(lootNotificationId)) {
                    nearbyLootCount++;
                    notifiedLootItems.add(lootNotificationId);
                }
            }
            // Fetch current user health and update stats
            const currentUser = await server_1.prisma.gameplayUser.findUnique({
                where: { id: user.id },
                select: { health: true }
            });
            if (currentUser && (totalRankPointsGained > 0 || totalCoinsGained > 0 || totalHealthGained > 0)) {
                const newHealth = Math.min(currentUser.health + totalHealthGained, 100);
                const actualHealthGained = newHealth - currentUser.health;
                await server_1.prisma.gameplayUser.update({
                    where: { id: user.id },
                    data: {
                        rankPoints: { increment: totalRankPointsGained },
                        money: { increment: totalCoinsGained },
                        health: newHealth
                    }
                });
                // Prepare a single notification for all collected loot
                let lootMessage = [];
                if (lootDropCollected) {
                    lootMessage.push("A Loot Drop");
                }
                if (totalCoinsGained > 0) {
                    lootMessage.push(`${totalCoinsGained} coins`);
                }
                const healthMessage = actualHealthGained > 0
                    ? `and ${actualHealthGained} health`
                    : '(health already at maximum)';
                if (lootMessage.length > 0) {
                    await (0, notificationhelper_1.sendNotification)(user.username, "Loot Collected!", `You've collected: A Loot drop! You gained ${totalRankPointsGained} rank points, ${totalCoinsGained} coins, ${healthMessage}!`, "Server");
                }
            }
            // Send a notification for nearby loot
            if (nearbyLootCount > 0) {
                await (0, notificationhelper_1.sendNotification)(user.username, "Loot Nearby!", `There ${nearbyLootCount === 1 ? 'is' : 'are'} ${nearbyLootCount} loot item${nearbyLootCount === 1 ? '' : 's'} within 500 meters of you!`, "Server");
            }
        }
        // Clean up old notifications
        const currentTime = Date.now();
        notifiedLootItems.forEach(async (id) => {
            const [lootId, userId] = id.split('-');
            const loot = await server_1.prisma.loot.findUnique({ where: { id: parseInt(lootId) } });
            if (!loot) {
                notifiedLootItems.delete(id);
            }
        });
    }
    catch (error) {
        console.error('Failed to check and collect loot:', error);
    }
};
exports.checkAndCollectLoot = checkAndCollectLoot;
