
# Missile Wars Backend

The offficial backend for Missile Wars 

# Setup

Create an .env file:
```
HELLO="development"
JWT_SECRET="58e2083b9cc6e23872d27b3cc6a34dffa5209b35c59202e6e3fdeb71431ec913"
VERBOSE_MODE="ON"
DISABLE_AUTH="OFF"
PORT=3000

DATABASE_URL=""

# Mail:
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=""
EMAIL_PASS=""
EMAIL_FROM=""
```
Enter your firebase.json credentials and rename it `firebasecred.json` place this at the root of your project. This is used to send notificaitons when messages are sent / recived and more!


# Running the backend


Make sure to install all dependencies before proceeding:

```sh
$ npm i
```

To run the server in development mode:

```sh
$ npm run dev
```

To build and run in production mode:

```sh
$ npm start
```

## Prisma commands:
Pulls current schema
```
npx prisma db pull 
```
```
npx prisma generate
```

Edit items stored in database
```
npx prisma studio
```

Adding to Schema:
```
npx prisma migrate dev --create-only
```
Enter name of migration. Then Migrate:
```
npx prisma migrate dev
```


## Data Migration 

Save data from current database:
```
npx ts-node export-script.ts
```
Update .env and schema.
```
npx ts-node import-script.ts
```
