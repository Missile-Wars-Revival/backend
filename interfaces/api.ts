import { z } from "zod";

// notificationToken is no longer part of these bodies (Phase 6: clients
// register push tokens in Firebase central). Old clients may still send it;
// zod ignores unknown keys, so it is silently dropped.
const LoginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

const RegisterSchema = z.object({
  username: z.string(),
  email: z.string(),
  password: z.string(),
});

const AuthWithLocationSchema = z.object({
  token: z.string(),
  latitude: z.string(),
  longitude: z.string(),
});

const AuthForFriendSchema = z.object({
  token: z.string(),
  friend: z.string(),
});

type Login = z.infer<typeof LoginSchema>;
type Register = z.infer<typeof RegisterSchema>;
type AuthWithLocation = z.infer<typeof AuthWithLocationSchema>;
type AuthForFriend = z.infer<typeof AuthForFriendSchema>;

export {
  LoginSchema,
  RegisterSchema,
  AuthWithLocationSchema,
  AuthForFriendSchema,
};

export type { Login, Register, AuthWithLocation, AuthForFriend };
