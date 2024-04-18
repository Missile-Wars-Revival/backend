import express from 'express';
import bodyParser from 'body-parser';

const app = express();
app.use(bodyParser.json());

let users: { username: string; password: string; }[] = [];

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(user => user.username === username && user.password === password);
    if (user) {
        res.status(200).send('logged in');
    } else {
        res.status(401).send('invalid username or password');
    }
});

app.get('/api/protected', (req, res) => {
    res.send('protected content');
});

app.listen(3000, () => {
    console.log('listening on port 3000');
});

users.push({ username: 'test', password: 'password1' });





