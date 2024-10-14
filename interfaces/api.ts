import { z } from "zod";

const AuthWithLocationSchema = z.object({
  token: z.string(),
  latitude: z.string(),
  longitude: z.string(),
});

const AuthForFriendSchema = z.object({
  token: z.string(),
  friend: z.string(),
});

type AuthWithLocation = z.infer<typeof AuthWithLocationSchema>;
type AuthForFriend = z.infer<typeof AuthForFriendSchema>;

export {
  AuthWithLocationSchema,
  AuthForFriendSchema,
};

export type { AuthWithLocation, AuthForFriend };
