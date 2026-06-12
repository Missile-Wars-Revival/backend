import axios from "axios";
import { prisma } from "../server";

// Shard → coordinator heartbeat (Phase 1 of DISTRIBUTED_HOSTING_PLAN.md).
//
// When COORDINATOR_URL and SHARD_API_KEY are set, this POSTs the shard's
// player count and version to the coordinator every 30s so it can list the
// shard in server discovery. When they are unset (solo/local hosting) the
// whole module is a no-op and the shard stays fully usable on its own.

const HEARTBEAT_INTERVAL = 30000; // 30 seconds in milliseconds

function readPackageVersion(): string {
  try {
    return require("../../package.json").version;
  } catch {
    try {
      return require("../package.json").version;
    } catch {
      return "unknown";
    }
  }
}

const version: string = readPackageVersion();

// Live WebSocket connection count, maintained by websocket.ts. This is the
// "player count" reported to the coordinator — connected clients, not DB rows.
let connectedPlayers = 0;

export function playerConnected() {
  connectedPlayers++;
}

export function playerDisconnected() {
  connectedPlayers = Math.max(0, connectedPlayers - 1);
}

export function getConnectedPlayerCount(): number {
  return connectedPlayers;
}

async function getTotalPlayerCount(): Promise<number> {
  return prisma.gameplayUser.count({
    where: {
      Users: {
        role: {
          not: "bot",
        },
      },
    },
  });
}

const sendHeartbeat = async (coordinatorUrl: string, shardApiKey: string) => {
  try {
    const totalPlayerCount = await getTotalPlayerCount();
    await axios.post(
      `${coordinatorUrl.replace(/\/$/, "")}/shards/heartbeat`,
      {
        playerCount: connectedPlayers,
        totalPlayerCount,
        version,
        gitSha: process.env.GIT_SHA || undefined,
      },
      {
        headers: { Authorization: `Bearer ${shardApiKey}` },
        timeout: 10000,
      }
    );
  } catch (error) {
    // Non-fatal: the coordinator marks us stale/offline if heartbeats stop,
    // but the shard itself keeps running for already-connected players.
    const message = axios.isAxiosError(error)
      ? `${error.response?.status ?? ""} ${error.message}`.trim()
      : (error as Error).message;
    console.error("[Coordinator] Heartbeat failed:", message);
  }
};

export function startCoordinatorHeartbeat() {
  const coordinatorUrl = process.env.COORDINATOR_URL;
  const shardApiKey = process.env.SHARD_API_KEY;

  if (!coordinatorUrl || !shardApiKey) {
    console.log(
      "[Coordinator] COORDINATOR_URL / SHARD_API_KEY not set — heartbeats disabled (solo/local hosting)"
    );
    return;
  }

  console.log(`[Coordinator] Heartbeats enabled → ${coordinatorUrl} (every ${HEARTBEAT_INTERVAL / 1000}s)`);
  sendHeartbeat(coordinatorUrl, shardApiKey);
  setInterval(() => sendHeartbeat(coordinatorUrl, shardApiKey), HEARTBEAT_INTERVAL);
}
