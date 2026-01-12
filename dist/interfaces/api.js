"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthForFriendSchema = exports.AuthWithLocationSchema = exports.RegisterSchema = exports.LoginSchema = void 0;
const zod_1 = require("zod");
const LoginSchema = zod_1.z.object({
    username: zod_1.z.string(),
    password: zod_1.z.string(),
    notificationToken: zod_1.z.string().optional(),
});
exports.LoginSchema = LoginSchema;
const RegisterSchema = zod_1.z.object({
    username: zod_1.z.string(),
    email: zod_1.z.string(),
    password: zod_1.z.string(),
    notificationToken: zod_1.z.string(),
});
exports.RegisterSchema = RegisterSchema;
const AuthWithLocationSchema = zod_1.z.object({
    token: zod_1.z.string(),
    latitude: zod_1.z.string(),
    longitude: zod_1.z.string(),
});
exports.AuthWithLocationSchema = AuthWithLocationSchema;
const AuthForFriendSchema = zod_1.z.object({
    token: zod_1.z.string(),
    friend: zod_1.z.string(),
});
exports.AuthForFriendSchema = AuthForFriendSchema;
