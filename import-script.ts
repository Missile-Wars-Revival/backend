const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient();

async function main() {
  try {
    const data = JSON.parse(fs.readFileSync('database-export.json', 'utf-8'));

    // Define the order of imports
    const importOrder = [
      'Users',
      'League',
      'GameplayUser',
      'InventoryItem',
      'Statistics',
      'Landmine',
      'LandmineType',
      'Locations',
      'Loot',
      'Other',
      'Messages',
      'Missile',
      'MissileType',
      'RefreshTokens',
      'Sessions',
      'Notifications',
      'BattleSessions',
      'FriendRequests'
    ];

    for (const model of importOrder) {
      if (model in data) {
        console.log(`Importing ${model}...`);
        const modelName = model.charAt(0).toLowerCase() + model.slice(1);
        
        if (modelName in prisma) {
          try {
            const records = data[model];
            // @ts-ignore
            await prisma[modelName].createMany({
              data: records,
              skipDuplicates: true,
            });
            console.log(`Successfully imported ${records.length} records for ${model}`);
          } catch (error) {
            console.error(`Error importing ${model}:`, error);
          }
        } else {
          console.warn(`Model ${model} not found in Prisma client. Skipping.`);
        }
      } else {
        console.warn(`No data found for model ${model}. Skipping.`);
      }
    }
  } catch (error) {
    console.error('Error reading or parsing the JSON file:', error);
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());