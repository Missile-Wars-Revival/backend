import { PrismaClient } from '@prisma/client'
import fs from 'fs'

const prisma = new PrismaClient()

async function main() {
  const data = JSON.parse(fs.readFileSync('database-export.json', 'utf-8'))

  for (const [model, records] of Object.entries(data)) {
    console.log(`Importing ${model}...`)
    // @ts-ignore
    await prisma[model.charAt(0).toLowerCase() + model.slice(1)].createMany({
      data: records,
      skipDuplicates: true,
    })
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect())
