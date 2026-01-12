"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupWebApi = setupWebApi;
const jwt = __importStar(require("jsonwebtoken"));
const server_1 = require("../server");
const argon2 = __importStar(require("argon2"));
const api_1 = require("../interfaces/api");
const authRoutes_1 = require("./authRoutes");
function setupWebApi(app) {
    app.post('/api/Weblogin', (0, authRoutes_1.validateSchema)(api_1.LoginSchema), async (req, res) => {
        const { username, password } = req.body;
        const user = await server_1.prisma.users.findFirst({
            where: { username },
        });
        if (user && (await argon2.verify(user.password, password))) {
            const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET || "");
            // Set the token as an HTTP-only cookie
            res.cookie('auth_token', token, {
                httpOnly: true,
                secure: true,
                // secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
            });
            // Also send the token in the response body
            res.status(200).json({ message: 'Login successful', token: token });
        }
        else {
            res.status(401).json({ message: 'Invalid username or password' });
        }
    });
    // Middleware to verify JWT token
    const verifyToken = (req, res, next) => {
        const token = req.cookies.auth_token;
        if (!token) {
            return res.status(403).json({ message: "A token is required for authentication" });
        }
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            req.user = decoded;
        }
        catch (err) {
            return res.status(401).json({ message: "Invalid Token" });
        }
        return next();
    };
    // Logout endpoint
    app.post('/api/Weblogout', (req, res) => {
        res.clearCookie('auth_token');
        res.status(200).json({ message: 'Logged out successfully' });
    });
    // Example of a protected route
    app.get('/api/Webprotected', verifyToken, (req, res) => {
        res.status(200).json({ message: 'Access granted to protected route' });
    });
}
