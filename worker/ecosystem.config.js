module.exports = {
  apps: [
    {
      name: "querypie-worker",
      script: "server.js",
      cwd: __dirname,
      interpreter: "/opt/homebrew/bin/node",
      restart_delay: 5000,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
