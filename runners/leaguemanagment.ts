import { PrismaClient } from '@prisma/client';
import { assignUserToLeague, checkAndPromoteUsers } from '../server-routes/leagueApi';

const prisma = new PrismaClient();

async function leagueRunner() {
  console.log('Starting league runner...');

  // Assign users without a league
  const usersWithoutLeague = await prisma.gameplayUser.findMany({
    where: { leagueId: null }
  });

  for (const user of usersWithoutLeague) {
    await assignUserToLeague(user.id);
  }

  // Check and promote users
  await checkAndPromoteUsers();

  console.log('League runner completed.');
}

// Run the league runner every hour
setInterval(leagueRunner, 60 * 60 * 1000);

// Initial run
leagueRunner();
