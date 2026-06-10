# MinjiBot

MinjiBot V2 adalah WhatsApp bot berbasis tenant. Bot memakai Baileys, Prisma PostgreSQL, TypeScript, dan command prefix dari environment.

## Development

1. Install dependency.

```bash
npm install
```

2. Salin `.env.example` menjadi `.env`, lalu isi `DATABASE_URL` dan `SUPER_OWNER_JIDS`.

3. Generate Prisma client dan jalankan migrasi.

```bash
npm run prisma:generate
npm run prisma:migrate
```

4. Jalankan bot mode development.

```bash
npm run dev
```

## Production

1. Siapkan `.env` production.

2. Jalankan migrasi dan build.

```bash
npm run prisma:deploy
npm run build
```

3. Jalankan dengan Node.

```bash
npm start
```

## PM2

Development dengan restart otomatis:

```bash
pm2 start "npm run dev" --name minjibot-dev
```

Production:

```bash
npm run prisma:deploy
npm run build
pm2 start dist/index.js --name minjibot
pm2 save
```

Command operasional:

```bash
pm2 logs minjibot
pm2 restart minjibot
pm2 stop minjibot
```

## Verification

```bash
npm run build
npm run lint
npm run format:check
npm test
```
