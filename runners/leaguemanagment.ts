import { PrismaClient } from '@prisma/client';
import { assignUserToLeague, checkAndUpdateUserLeagues } from '../server-routes/leagueApi';

const prisma = new PrismaClient();

export async function leagueRunner() {
  console.log('League runner started at:', new Date().toISOString());
  console.log('Starting league runner...');

  try {
    // Assign users without a league
    const usersWithoutLeague = await prisma.gameplayUser.findMany({
      where: { leagueId: null }
    });
    for (const user of usersWithoutLeague) {
      await assignUserToLeague(user.id);
    }

    // Check and promote users
    await checkAndUpdateUserLeagues();

    console.log('League runner completed successfully.');
  } catch (error) {
    console.error('Error in league runner:', error);
  }
}
