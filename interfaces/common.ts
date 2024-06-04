import { z } from "zod";

// Declare the schemas
const SessionsSchema = z.object({
  lastIp: z.string(),
  username: z.string(),
  lastLoginTime: z.string(),
  userAgent: z.string(),
});

const UsersSchema: z.ZodSchema = z.lazy(() =>
  z.object({
    id: z.number(),
    email: z.string(),
    password: z.string(),
    username: z.string(),
    role: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string(),
    friends: z.array(z.string()),
    avatar: z.string(),
    GameplayUser: GameplayUserSchema.nullable(),
  })
);

const LocationsSchema: z.ZodSchema = z.lazy(() =>
  z.object({
    username: z.string(),
    latitude: z.string(),
    longitude: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string(),
    GameplayUser: GameplayUserSchema.nullable(),
  })
);

const FriendRequestsSchema: z.ZodSchema = z.lazy(() =>
  z.object({
    id: z.number(),
    username: z.string(),
    friend: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string(),
    GameplayUser: GameplayUserSchema.nullable(),
    gameplayUserId: z.number().nullable(),
  })
);

const BattleSessionsSchema: z.ZodSchema = z.lazy(() =>
  z.object({
    attacker: GameplayUserSchema,
    defender: GameplayUserSchema,
    attackerUsername: z.string(),
    defenderUsername: z.string(),
    sessionId: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string(),
    target: z.string(),
    status: z.string(),
    result: z.string(),
    GameplayUser: GameplayUserSchema.nullable(),
    gameplayUserId: z.number().nullable(),
  })
);

const GameplayUserSchema: z.ZodSchema = z.lazy(() =>
  z.object({
    id: z.number(),
    username: z.string(),
    location: z.array(LocationsSchema),
    level: z.number(),
    exp: z.number(),
    money: z.number(),
    health: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string(),
    friendRequests: z.array(FriendRequestsSchema),
    currentSession: z.array(BattleSessionsSchema),
    defending: z.array(BattleSessionsSchema),
    attacking: z.array(BattleSessionsSchema),
    user: UsersSchema.nullable(),
  })
);

const MessagesSchema = z.object({
  id: z.number(),
  sender: z.string(),
  receiver: z.string(),
  content: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string(),
});

const MissileSchema = z.object({
  id: z.number(),
  destLat: z.string(),
  destLong: z.string(),
  launchLat: z.string(),
  launchLong: z.string(),
  radius: z.number(),
  type: z.string(),
  sentBy: z.string(),
  status: z.string(),
});

const LandmineSchema = z.object({
  id: z.number(),
  destLat: z.string(),
  destLong: z.string(),
  launchLat: z.string(),
  launchLong: z.string(),
  placedBy: z.string(),
  Type: z.string(),
  Expires: z.string(),
});

const LootSchema = z.object({
  id: z.number(),
  longitude: z.number(),
  latitude: z.number(),
  rarity: z.string(),
  destLat: z.string(),
  destLong: z.string(),
  launchLat: z.string(),
  launchLong: z.string(),
  radius: z.number(),
  type: z.string(),
  status: z.string(),
});


// Define types from the schemas
type Sessions = z.infer<typeof SessionsSchema>;
type Users = z.infer<typeof UsersSchema>;
type Locations = z.infer<typeof LocationsSchema>;
type FriendRequests = z.infer<typeof FriendRequestsSchema>;
type BattleSessions = z.infer<typeof BattleSessionsSchema>;
type GameplayUser = z.infer<typeof GameplayUserSchema>;
type Messages = z.infer<typeof MessagesSchema>;
type Missile = z.infer<typeof MissileSchema>;
type Landmine = z.infer<typeof LandmineSchema>;
type Loot = z.infer<typeof LootSchema>;

// Export the schemas and types
export {
  SessionsSchema,
  UsersSchema,
  LocationsSchema,
  FriendRequestsSchema,
  BattleSessionsSchema,
  GameplayUserSchema,
  MessagesSchema,
  MissileSchema,
  LandmineSchema,
  LootSchema,
};

export type {
  Sessions,
  Users,
  Locations,
  FriendRequests,
  BattleSessions,
  GameplayUser,
  Messages,
  Missile,
  Landmine,
  Loot,
};
