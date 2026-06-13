import axios from "axios";
import { spawn } from "child_process";
import { existsSync, readFileSync, rmSync, statSync } from "fs";
import { join } from "path";
import { prisma } from "../server";

// Shard → coordinator heartbeat (Phase 1 of DISTRIBUTED_HOSTING_PLAN.md) and
// Phase 12 self-update agent.
//
// When COORDINATOR_URL and SHARD_API_KEY are set, this POSTs the shard's
// player count and version to the coordinator every 30s. The heartbeat RESPONSE
// carries the coordinator's per-shard update decision (current /
// update_available / update_required) plus the latest release metadata and an
// admin "update requested" flag. When an update is indicated — and the host has
// not opted out (AUTO_UPDATE=false) and it's a quiet moment (no players, or a
// critical release) — the agent runs the platform updater script, serialized by
// a lock file so repeated heartbeats can't start overlapping updates.
//
// Solo/local hosting (no COORDINATOR_URL/SHARD_API_KEY) makes the whole module
// a no-op.

const HEARTBEAT_INTERVAL = 30000; // 30 seconds in milliseconds

// Hosts opt out of self-update with AUTO_UPDATE=false. Default is on.
const AUTO_UPDATE = process.env.AUTO_UPDATE !== "false";

// docker/ lives at the backend package root. __dirname is runners/ under
// ts-node but dist/runners after build, so probe the likely locations.
function resolveDockerDir(): string {
  const fallback = join(__dirname, "..", "docker"); // ts-node: runners/../docker
  const candidates = [
    fallback,
    join(__dirname, "..", "..", "docker"), // built: dist/runners/../../docker
    join(process.cwd(), "docker"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return fallback;
}

const DOCKER_DIR = resolveDockerDir();
const LOCK_FILE = join(DOCKER_DIR, ".update.lock");
// The updater writes this on FAILURE (it doesn't restart on failure, so this
// process survives to report it). Success restarts the container and the fresh
// process simply heartbeats the new version.
const RESULT_FILE = join(DOCKER_DIR, ".update-result.json");
// A lock older than this is treated as stale (a crashed/killed update) and
// ignored, so a botched attempt can't block updates forever.
const LOCK_STALE_MS = 30 * 60 * 1000;

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

// ------------------------------------------------------------ update agent

// Same-process guard; the lock file guards across processes/restarts.
let updateInProgress = false;

interface BackendRelease {
  version: string;
  gitSha?: string;
  imageDigest?: string;
  critical?: boolean;
}

interface UpdateFailure {
  fromVersion?: string;
  toVersion?: string;
  reason?: string;
  at?: number;
}

function lockHeld(): boolean {
  if (!existsSync(LOCK_FILE)) return false;
  try {
    const age = Date.now() - statSync(LOCK_FILE).mtimeMs;
    if (age > LOCK_STALE_MS) {
      rmSync(LOCK_FILE, { force: true });
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Reads (and consumes) a failure record written by a previous failed update so
// it can be reported once in the heartbeat. Reading clears the same-process
// in-progress flag — the attempt is over.
function takeUpdateFailure(): UpdateFailure | null {
  if (!existsSync(RESULT_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(RESULT_FILE, "utf8"));
    rmSync(RESULT_FILE, { force: true });
    updateInProgress = false;
    if (parsed && parsed.ok === false) {
      return {
        fromVersion: parsed.fromVersion ?? version,
        toVersion: parsed.toVersion,
        reason: parsed.reason,
        at: parsed.at,
      };
    }
  } catch {
    rmSync(RESULT_FILE, { force: true });
  }
  return null;
}

function maybeRunUpdate(
  decision: { updateStatus?: string; updateRequested?: boolean; release?: BackendRelease | null }
): void {
  const wantsUpdate =
    decision.updateStatus === "update_available" ||
    decision.updateStatus === "update_required" ||
    decision.updateRequested === true;
  if (!wantsUpdate) return;

  if (!AUTO_UPDATE) {
    console.log("[Coordinator] Update available but AUTO_UPDATE=false — not self-updating. Update manually with docker/update.sh.");
    return;
  }
  if (updateInProgress || lockHeld()) return;

  // Don't disrupt a live game unless the release is explicitly critical.
  const critical = decision.release?.critical === true;
  if (connectedPlayers > 0 && !critical) {
    console.log(`[Coordinator] Update available but ${connectedPlayers} player(s) connected — deferring until quiet (or a critical release).`);
    return;
  }

  runUpdater(decision.release ?? null);
}

function runUpdater(release: BackendRelease | null): void {
  updateInProgress = true;
  const isWindows = process.platform === "win32";
  const script = join(DOCKER_DIR, isWindows ? "update.ps1" : "update.sh");
  if (!existsSync(script)) {
    console.error(`[Coordinator] Updater script not found at ${script}; cannot self-update.`);
    updateInProgress = false;
    return;
  }

  const childEnv = {
    ...process.env,
    RELEASE_VERSION: release?.version ?? "",
    RELEASE_GIT_SHA: release?.gitSha ?? "",
    RELEASE_IMAGE_DIGEST: release?.imageDigest ?? "",
    UPDATE_FROM_VERSION: version,
  };

  console.log(`[Coordinator] Starting self-update → v${release?.version ?? "?"} via ${script}`);
  try {
    const child = isWindows
      ? spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {
          detached: true,
          stdio: "ignore",
          env: childEnv,
          cwd: DOCKER_DIR,
        })
      : spawn("bash", [script], { detached: true, stdio: "ignore", env: childEnv, cwd: DOCKER_DIR });
    child.on("error", (err) => {
      console.error("[Coordinator] Failed to launch updater:", err.message);
      updateInProgress = false;
    });
    // Detach so a container/process restart by the script doesn't kill the
    // update mid-flight; the script owns the lifecycle from here.
    child.unref();
  } catch (error) {
    console.error("[Coordinator] Failed to spawn updater:", (error as Error).message);
    updateInProgress = false;
  }
}

// ---------------------------------------------------------------- heartbeat

const sendHeartbeat = async (coordinatorUrl: string, shardApiKey: string) => {
  try {
    const totalPlayerCount = await getTotalPlayerCount();
    const failure = takeUpdateFailure();
    const { data } = await axios.post(
      `${coordinatorUrl.replace(/\/$/, "")}/shards/heartbeat`,
      {
        playerCount: connectedPlayers,
        totalPlayerCount,
        version,
        gitSha: process.env.GIT_SHA || undefined,
        autoUpdate: AUTO_UPDATE,
        ...(failure
          ? {
              updateFailed: {
                fromVersion: failure.fromVersion,
                toVersion: failure.toVersion,
                reason: failure.reason,
              },
              lastUpdateAttemptAt: failure.at,
            }
          : {}),
      },
      {
        headers: { Authorization: `Bearer ${shardApiKey}` },
        timeout: 10000,
      }
    );

    // Phase 12: act on the coordinator's update decision.
    const decision = data?.data;
    if (decision) {
      maybeRunUpdate({
        updateStatus: decision.updateStatus,
        updateRequested: decision.updateRequested,
        release: decision.release ?? null,
      });
    }
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

  console.log(
    `[Coordinator] Heartbeats enabled → ${coordinatorUrl} (every ${HEARTBEAT_INTERVAL / 1000}s, auto-update ${AUTO_UPDATE ? "on" : "off"})`
  );
  sendHeartbeat(coordinatorUrl, shardApiKey);
  setInterval(() => sendHeartbeat(coordinatorUrl, shardApiKey), HEARTBEAT_INTERVAL);
}
