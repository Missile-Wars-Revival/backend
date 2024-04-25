//tried to seed users into schema

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
    // Add first temporary user
    await prisma.gameplayUser.create({
        data: {
            username: 'test',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }
    });

    // Add second temporary user
    await prisma.gameplayUser.create({
        data: {
            username: 'test2',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }
    });

    console.log('Temporary users created');
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
