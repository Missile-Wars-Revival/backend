
# Missile Wars Backend

The offficial backend for Missile Wars 


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