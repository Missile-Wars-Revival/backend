import express from 'express';
import bodyParser from 'body-parser';

const app = express();
app.use(bodyParser.json());

let users: { username: string; password: string; }[] = [];
let playerLocations: { username: string; latitude: number; longitude: number; }[] = [];

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(user => user.username === username && user.password === password);
    if (user) {
        res.status(200).send('logged in');
    } else {
        res.status(401).send('invalid username or password');
    }
});

app.post('/api/sendLocation', (req, res) => {
    const { username, latitude, longitude } = req.body;
    const existingLocationIndex = playerLocations.findIndex(loc => loc.username === username);

    if (existingLocationIndex !== -1) {
        // Update existing location
        playerLocations[existingLocationIndex] = { username, latitude, longitude };
    } else {
        // Add new location
        playerLocations.push({ username, latitude, longitude });
    }

    res.status(200).send('Location received');
});

app.get('/api/protected', (req, res) => {
    res.send('protected content');
});

app.listen(3000, () => {
    console.log('listening on port 3000');
});

users.push({ username: 'test', password: 'password1' });
