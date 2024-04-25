import express from 'express';
import bodyParser from 'body-parser';
import { PrismaClient } from '@prisma/client';
import * as argon2 from "argon2";

const prisma = new PrismaClient();


const app = express();
app.use(bodyParser.json());

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
        res.status(401).json({ message: 'Login failed' });
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
                        gte: String(latitude - 0.135),
                        lte: String(latitude + 0.135)
                    },
                    longitude: {
                        gte: String(longitude - 0.176),
                        lte: String(longitude + 0.176)
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
// add friend logic...
app.post('/api/addFriend', async (req, res) => {
    const { username, friendUsername } = req.body;

    // Check if friend exists
    const friend = await prisma.users.findFirst({
        where: {
            username: friendUsername
        }
    });

    if (!friend) {
        return res.status(404).json({ message: 'Friend not found' });
    }

    // Logic to add friend to user's friend list (assuming you have a friends table or field in users table)
    // Update this part based on your database schema

    res.status(200).json({ message: 'Friend added' });
});

app.delete('/api/removeFriend', async (req, res) => {
    const { username, friendUsername } = req.body;

    // Logic to remove friend from user's friend list (assuming you have a friends table or field in users table)
    // Update this part based on your database schema

    res.status(200).json({ message: 'Friend removed' });
});


//readded player locations to allow frontend to conintue working 
let playerLocations: { username: string; latitude: number; longitude: number; }[] = [];

app.post('/api/sendLocation', (req, res) => {
    const { username, latitude, longitude, timestamp } = req.body; // Destructuring timestamp from req.body
    const existingLocationIndex = playerLocations.findIndex(loc => loc.username === username);

    const locationData = {
        username,
        latitude,
        longitude,
        timestamp, // Include timestamp in the location data
    };

    if (existingLocationIndex !== -1) {
        // Update existing location
        playerLocations[existingLocationIndex] = locationData;
    } else {
        // Add new location
        playerLocations.push(locationData);
    }

    // Send the updated playerLocations as a response
    res.status(200).json(playerLocations);
    console.log('playerlocation received:', locationData); // Logging the received location data
});

app.get('/api/getOtherPlayersData', (req, res) => {
    res.status(200).json(playerLocations);
    console.log('playerlocation sent');
});


app.listen(3000, () => {
    console.log('listening on port 3000');
});

