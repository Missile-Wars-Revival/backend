import express from 'express';
import bodyParser from 'body-parser';
import { PrismaClient } from '@prisma/client';
import * as argon2 from "argon2";
import swaggerUi from 'swagger-ui-express';
import swaggerJSDoc from 'swagger-jsdoc';
import expressWs from 'express-ws';
import { ParamsDictionary } from 'express-serve-static-core';
import { ParsedQs } from 'qs';

const prisma = new PrismaClient();



const wsServer = expressWs(express());
const app = wsServer.app;


app.use(bodyParser.json());

// Swagger definition
const swaggerDefinition = {
    info: {
        title: 'Missile Wars Backend',
        version: '0.0.1',
        description: 'Endpoints to interact with the Missile Wars game backend',
    },
    host: 'localhost:3000', // Your host
    basePath: '/', // Base path for your API
};

// Options for the swagger docs
const options = {
    swaggerDefinition,
    apis: ['./routes/*.ts'], // Path to the API routes folder
};

// Initialize swagger-jsdoc
const swaggerSpec = swaggerJSDoc(options);

// check if env is dev and serve swagger
if (process.env.NODE_ENV === 'development') {
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

function authenticate(ws: import("ws"), req: express.Request<ParamsDictionary, any, any, ParsedQs, Record<string, any>>) {
    const authToken = req.headers['authorization']

    if (!authToken || authToken !== 'missilewars') {
        ws.send(JSON.stringify({ error: 'Authentication failed. Disconnecting.' }));

        ws.close();
        return false;
    }

    return true;
}


app.ws('/', (ws, req) => {
    // Perform authentication when a new connection is established
    if (!authenticate(ws, req)) {
        return; 
    }

   
    ws.on('message', (message: string) => {
        console.log('Received message from client:', message);
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });

});


app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    const user = await prisma.users.findFirst({
        where: {
            username: username
        }
    });


    if (user && await argon2.verify(user.password, password)) {
        res.status(200).json({ message: 'Login successful' });
    } else {
        res.status(401).json({ message: 'Invalid username or password' });
    }
});

app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;

    const existingUser = await prisma.users.findFirst({
        where: {
            username: username
        }
    })

    if (existingUser) {
        return res.status(409).json({ message: 'User already exists' });
    }

    if (password.length < 8) {
        return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }

    if (username.length < 3) {
        return res.status(400).json({ message: 'Username must be at least 3 characters long' });
    }

    if (!username.match(/^[a-zA-Z0-9]+$/)) {
        return res.status(400).json({ message: 'Username must only contain letters and numbers' });
    }

    if (!password.match(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)) {
        return res.status(400).json({ message: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character' });
    }

    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
        return res.status(400).json({ message: 'Invalid email address' });
    }

    if ((existingUser as unknown as { email: string })?.email === email) {
        return res.status(400).json({ message: 'Email already exists' });
    }


    const hashedPassword = await argon2.hash(password);

    await prisma.users.create({
        data: {
            username: username,
            password: hashedPassword,
            email: email
        }
    });

    await prisma.gameplayUser.create({
        data: {
            username: username,
            createdAt: new Date().toDateString(),
        }
    })

    res.status(200).json({ message: 'User created' });
});

app.post('/api/dispatch', async (req, res) => {
    const { username, latitude, longitude } = req.body;

    // Check if the user exists
    const user = await prisma.gameplayUser.findFirst({
        where: {
            username: username
        }
    });

    if (user) {
        const lastLocation = await prisma.locations.findFirst({
            where: {
                username: username
            },
            orderBy: {
                updatedAt: 'desc'
            }
        });

        if (lastLocation) {
            // User already has a location, update it
            await prisma.locations.update({
                where: {
                    username: lastLocation.username
                },
                data: {
                    latitude: latitude,
                    longitude: longitude,
                    updatedAt: new Date().toISOString() // Convert Date object to string
                }
            });
        } else {
            // User does not have a location, create a new one
            await prisma.locations.create({
                data: {
                    username: username,
                    latitude: latitude,
                    longitude: longitude,
                    updatedAt: new Date().toISOString() // Convert Date object to string
                }
            });
        }

        res.status(200).json({ message: 'Location dispatched' });
    } else {
        res.status(404).json({ message: 'User not found' });
    }
});

app.get('/api/playerlocations', async (req, res) => {
    try {
        const allLocations = await prisma.locations.findMany({
            select: {
                username: true,
                latitude: true,
                longitude: true,
                updatedAt: true
            }
        });
        res.status(200).json(allLocations);
    } catch (error) {
        console.error("Error fetching locations:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});



app.get('/api/nearby', async (req, res) => {
    const { username, latitude, longitude } = req.body;

    // Approximate conversion factor from kilometers to degrees
    const kmToDegrees = 1 / 111.12; // Approximately 1 degree is 111.12 kilometers

    // Convert 15km radius to degrees
    const radiusInDegrees = 15 * kmToDegrees;

    const nearbyUsers = await prisma.gameplayUser.findMany({
        where: {
            username: {
                not: username
            },
            location: {
                some: {
                    latitude: {
                        gte: String(latitude - radiusInDegrees),
                        lte: String(latitude + radiusInDegrees)
                    },
                    longitude: {
                        gte: String(longitude - radiusInDegrees),
                        lte: String(longitude + radiusInDegrees)
                    }
                }
            }
        }
    });

    if (nearbyUsers.length > 0) {
        res.status(200).json({ message: 'Nearby users found', nearbyUsers });
    } else {
        res.status(404).json({ message: 'No nearby users found' });
    }

});

app.post('/api/friends', async (req, res) => {
    const { username } = req.body; // Only taking username from req.body

    const user = await prisma.users.findFirst({
        where: {
            username: username
        }
    })

    if (user) {
        const friends = await prisma.users.findMany({
            where: {
                username: {
                    in: user.friends
                }
            }
        })

        if (friends.length > 0) {
            res.status(200).json({ message: 'Friends found', friends });
        } else {
            res.status(404).json({ message: 'No friends found' });
        }
    } else {
        res.status(404).json({ message: 'User not found' });
    }
});

app.post('/api/addFriend', async (req, res) => {
    const { username, friend } = req.body; // Destructuring username and friend from req.body

    const user = await prisma.users.findFirst({
        where: {
            username: username
        }
    })

    const friendUser = await prisma.users.findFirst({
        where: {
            username: friend
        }
    })

    if (!friendUser) {
        return res.status(404).json({ message: 'Friend not found' });
    }

    if (user) {
        await prisma.users.update({
            where: {
                username: username
            },
            data: {
                friends: {
                    push: friend
                }
            }
        })

        res.status(200).json({ message: 'Friend added' });
    } else {
        res.status(404).json({ message: 'User not found' });
    }
});


app.delete('/api/removeFriend', async (req, res) => {
    const { username, friend } = req.body; // Destructuring username and friend from req.body

    const user = await prisma.users.findFirst({
        where: {
            username: username
        }
    })

    const friendUser = await prisma.users.findFirst({
        where: {
            username: friend
        }
    })

    if (!friendUser) {
        return res.status(404).json({ message: 'Friend not found' });
    }

    if (user) {
        await prisma.users.update({
            where: {
                username: username
            },
            data: {
                friends: {
                    set: user.friends.filter((f) => f !== friend)
                }
            }
        })

        res.status(204).end();
    } else {
        res.status(404).json({ message: 'User not found' });
    }
});


app.get('/api/testusers', async (req, res) => {

    const users = await prisma.users.findMany({
        where: {
            username: {
                contains: 'test'
            }
        }
    })

    res.status(200).json({ users });
})

app.get('/api/getuser', async (req, res) => {

    const { username } = req.query;

    const user = await prisma.users.findFirst({
        where: {
            username: username?.toString()
        }
    })


    const fmtUser = { "username": user?.username, "id": user?.id, "role": user?.role, "avatar": user?.avatar }

    if (user) {
        res.status(200).json({ ...fmtUser });
    } else {
        res.status(404).json({ message: 'User not found' });
    }
})



app.listen(3000, () => {
    console.log('listening on port 3000');
});

