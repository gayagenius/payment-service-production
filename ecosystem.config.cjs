// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'payment-api',
      script: './src/app.js',
      args: '',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'stripe-worker',
      script: './workers/stripeWorker.js',
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
