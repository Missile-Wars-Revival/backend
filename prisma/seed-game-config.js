require("dotenv/config");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const missileTypes = [
  {
    name: "Amplifier",
    description: "A powerful cost effective missile with small radius high damage effect.",
    price: 250,
    speed: 40,
    radius: 15,
    damage: 20,
    fallout: 1,
  },
  {
    name: "Ballista",
    description: "A powerful missile with a wide blast radius.",
    price: 500,
    speed: 90,
    radius: 25,
    damage: 40,
    fallout: 1,
  },
  {
    name: "Buzzard",
    description: "A fast paced low damage missile",
    price: 750,
    speed: 400,
    radius: 20,
    damage: 30,
    fallout: 2,
  },
  {
    name: "ClusterBomb",
    description: "Fires a cluster of missiles down.",
    price: 1000,
    speed: 120,
    radius: 100,
    damage: 20,
    fallout: 3,
  },
  {
    name: "CorporateRaider",
    description: "A fast missile like the Buzzard but deals higher damage.",
    price: 1400,
    speed: 1000,
    radius: 40,
    damage: 60,
    fallout: 1,
  },
  {
    name: "GutShot",
    description: "A fast missile with a long fallout. ",
    price: 1600,
    speed: 130,
    radius: 30,
    damage: 30,
    fallout: 4,
  },
  {
    name: "ShieldBreaker",
    description: "A shield destroyer capable of destroying shields.",
    price: 3000,
    speed: 1000,
    radius: 20,
    damage: 2,
    fallout: 2,
  },
  {
    name: "TheNuke",
    description: "The most powerful missile in the game",
    price: 10000,
    speed: 1000,
    radius: 1000,
    damage: 100,
    fallout: 20,
  },
  {
    name: "Zippy",
    description: "The fastest missile in the game.",
    price: 2500,
    speed: 2000,
    radius: 20,
    damage: 40,
    fallout: 1,
  },
];

const landmineTypes = [
  {
    name: "BigBertha",
    description: "Large warhead Landmine that does the largest damage. Careful though as it is unstable and has the shortest duration. ",
    price: 500,
    damage: 40,
    duration: 1,
  },
  {
    name: "Bombabom",
    description: "A mid-duration landmine that does the lowest damage. Valued for its cheap production the Bombabom is a good landmine to have for those finishing kills.",
    price: 400,
    damage: 20,
    duration: 2,
  },
  {
    name: "BunkerBlocker",
    description: "Blocks Bunkers. This Landmine will last 24 hours which outlasts any shield dealing a unexpected blow when they wake up!",
    price: 2000,
    damage: 70,
    duration: 24,
  },
];

const otherTypes = [
  {
    name: "LandmineSweep",
    description: "This can be used to show all landmines for 2 minutes. Use wisely!",
    price: 600,
    radius: 0,
    duration: 2,
  },
  {
    name: "LootDrop",
    description: "A Loot Drop. This will give you items, coins, rank points and health when you collect it! Reward is based on its rarity.",
    price: 400,
    radius: 20,
    duration: 1440,
  },
  {
    name: "Shield",
    description: "A standard Shield that will protect you from incoming missiles and landmines.",
    price: 2000,
    radius: 10,
    duration: 60,
  },
  {
    name: "UltraShield",
    description: "The powerful shield that will protect you from all incoming attacks for a longer duration than the standard shield.",
    price: 5000,
    radius: 20,
    duration: 720,
  },
];

async function upsertRows(model, rows) {
  for (const row of rows) {
    await model.upsert({
      where: { name: row.name },
      update: row,
      create: row,
    });
  }
}

async function main() {
  await upsertRows(prisma.missileType, missileTypes);
  await upsertRows(prisma.landmineType, landmineTypes);
  await upsertRows(prisma.otherType, otherTypes);

  console.log(
    `Seeded game config: ${missileTypes.length} missile types, ${landmineTypes.length} landmine types, ${otherTypes.length} other types.`
  );
}

main()
  .catch((error) => {
    console.error("Failed to seed game config:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
