// const { PrismaClient } = require('@prisma/client');
// const fs = require('fs');

// const prisma = new PrismaClient();

// async function main() {
//   const data = {}
//   // List all your models here
//   const models = [
//     'FriendRequests',
//     'GameplayUser',
//     'PasswordResetCodes',
//     'InventoryItem',
//     'Statistics',
//     'Landmine',
//     'LandmineType',
//     'Locations',
//     'Loot',
//     'Other',
//     'OtherType',
//     'Messages',
//     'Missile',
//     'MissileType',
//     'RefreshTokens',
//     'Sessions',
//     'Users',
//     'Notifications',
//     'NotificationPreferences',
//     'League',
//   ]

//   for (const model of models) {
//     // @ts-ignore
//     data[model] = await prisma[model.charAt(0).toLowerCase() + model.slice(1)].findMany()
//   }
//   // Custom replacer function to handle BigInt
//   const replacer = (key: string, value: any) =>
//     typeof value === 'bigint'
//       ? value.toString()
//       : value

//   fs.writeFileSync('database-export.json', JSON.stringify(data, replacer, 2))
// }

// main()
//   .catch(e => console.error(e))
//   .finally(async () => await prisma.$disconnect());
