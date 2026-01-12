"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leagueRunner = leagueRunner;
const client_1 = require("@prisma/client");
const leagueApi_1 = require("../server-routes/leagueApi");
const prisma = new client_1.PrismaClient();
async function leagueRunner() {
    console.log('League runner started at:', new Date().toISOString());
    console.log('Starting league runner...');
    try {
        // Assign users without a league
        const usersWithoutLeague = await prisma.gameplayUser.findMany({
            where: { leagueId: null }
        });
        for (const user of usersWithoutLeague) {
            await (0, leagueApi_1.assignUserToLeague)(user.id);
        }
        // Check and promote users
        await (0, leagueApi_1.checkAndUpdateUserLeagues)();
        console.log('League runner completed successfully.');
    }
    catch (error) {
        console.error('Error in league runner:', error);
    }
}
