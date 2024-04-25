import express from 'express';
import bodyParser from 'body-parser';
import { PrismaClient } from '@prisma/client';
import * as argon2 from "argon2";
import swaggerUi from 'swagger-ui-express';
import swaggerJSDoc from 'swagger-jsdoc';

const prisma = new PrismaClient();

const app = express();
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

// Serve Swagger docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

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
    const { username, latitude, longitude } = req.body; // Destructuring timestamp from req.body

    const lastLocation = await prisma.locations.findFirst({
        where: {
            username: username
        },
        orderBy: {
            createdAt: 'desc'
        }
    });


    if (lastLocation) {
        await prisma.gameplayUser.update({
            where: {
                username: username
            },
            data: {
                location: {
                    create: {
                        latitude: latitude,
                        longitude: longitude,
                        updatedAt: new Date().toDateString()
                    }
                }
            }
        })
    } else {
        await prisma.locations.create({
            data: {
                username: username,
                latitude: latitude,
                longitude: longitude,
                createdAt: new Date().toDateString(),
            }
        })
    }

    res.status(200).json({ message: 'Location updated' });

});



app.get('/api/nearby', async (req, res) => {
    const { username, latitude, longitude } = req.body; // Destructuring timestamp from req.body

    const nearbyUsers = await prisma.gameplayUser.findMany({
        where: {
            username: {
                not: username
            },
            location: {
                some: {
                    latitude: {
                        gte: String(latitude - 0.01),
                        lte: String(latitude + 0.01)
                    },
                    longitude: {
                        gte: String(longitude - 0.01),
                        lte: String(longitude + 0.01)
                    }
                }
            }
        }
    })

    if (nearbyUsers) {
        res.status(200).json({ message: 'Nearby users found', nearbyUsers });
    } else {
        res.status(404).json({ message: 'No nearby users found' });
    }
});




app.listen(3000, () => {
    console.log('listening on port 3000');
});

