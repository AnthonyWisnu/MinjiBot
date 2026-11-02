module.exports = {
  apps: [
    {
      name: "minjibot",
      script: "dist/index.js",
      instances: 1, // WAJIB 1: sesi tunggal Baileys tidak boleh dijalankan mode cluster
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "750M",
      kill_timeout: 10000, // Beri waktu 10 detik bagi flush ActivityBuffer, Prisma & Baileys saat SIGINT
      listen_timeout: 10000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
