"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nothingProbability = exports.rarityProbability = exports.notSoGoodLootItems = exports.goodLootItems = void 0;
exports.getRandomLoot = getRandomLoot;
exports.goodLootItems = [
    { name: "ClusterBomb", category: "Missiles" },
    { name: "CorporateRaider", category: "Missiles" },
    { name: "GutShot", category: "Missiles" },
    { name: "Yokozuna", category: "Missiles" },
    { name: "Zippy", category: "Missiles" },
    { name: "BunkerBlocker", category: "Landmines" },
    { name: "Buzzard", category: "Missiles" }
];
exports.notSoGoodLootItems = [
    { name: "Bombabom", category: "Landmines" },
    { name: "BigBertha", category: "Landmines" },
    { name: "Ballista", category: "Missiles" },
    { name: "Amplifier", category: "Missiles" },
    { name: "LootDrop", category: "Loot Drops" },
    { name: "Coins", category: "Currency" }
];
exports.rarityProbability = {
    Common: 20, // 20% chance for good loot
    Uncommon: 30, // 30% chance for good loot
    Rare: 50 // 50% chance for good loot
};
exports.nothingProbability = {
    Common: 10, // 10% chance to get nothing
    Uncommon: 5, // 5% chance to get nothing
    Rare: 2 // 2% chance to get nothing
};
function getRandomLoot(rarity) {
    const chance = Math.random() * 100;
    // Check if the player gets nothing
    if (chance < exports.nothingProbability[rarity]) {
        return null; // or return a specific value representing nothing
    }
    // Check if the player gets good loot
    if (chance < exports.rarityProbability[rarity] + exports.nothingProbability[rarity]) {
        const lootIndex = Math.floor(Math.random() * exports.goodLootItems.length);
        return exports.goodLootItems[lootIndex];
    }
    else {
        const notSoGoodIndex = Math.floor(Math.random() * exports.notSoGoodLootItems.length);
        return exports.notSoGoodLootItems[notSoGoodIndex];
    }
}
//Missile types
//   Amplifier:
//   Ballista:
//   BigBertha:
//   Bombabom:
//   BunkerBlocker:
//   Buzzard:
//   ClusterBomb:
//   CorporateRaider:
//   GutShot:
//   TheNuke:
//   Yokozuna:
//   Zippy:
