module.exports = {
  apps: [
    {
      name: 'cfs-quick-listing',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 4100,
      },
      max_memory_restart: '256M',
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      time: true,
    },
  ],
};
