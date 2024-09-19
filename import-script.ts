import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function main() {
  try {
    const data = JSON.parse(fs.readFileSync('database-export.json', 'utf-8'));

    for (const [model, records] of Object.entries(data)) {
      console.log(`Importing ${model}...`);
      const modelName = model.charAt(0).toLowerCase() + model.slice(1);
      
      if (modelName in prisma) {
        try {
          // @ts-ignore
          await prisma[modelName].createMany({
            data: records,
            skipDuplicates: true,
          });
          console.log(`Successfully imported ${length} records for ${model}`);
        } catch (error) {
          console.error(`Error importing ${model}:`, error);
        }
      } else {
        console.warn(`Model ${model} not found in Prisma client. Skipping.`);
      }
    }
  } catch (error) {
    console.error('Error reading or parsing the JSON file:', error);
  }
}

main()
  .catch(e => console.error('Unhandled error:', e))
  .finally(async () => {
    await prisma.$disconnect();
    console.log('Import process completed.');
  });