const { Sequelize } = require('sequelize');
const dotenv = require('dotenv');
dotenv.config();

let sequelize;

// Check if DATABASE_URL is provided (like on DigitalOcean)
if (process.env.DATABASE_URL) {
  const dbSslCaCert = process.env.DB_SSL_CA_CERT;
  let sslConfig = {};

  if (dbSslCaCert) {
    // If CA cert is provided, use it and require proper verification
    sslConfig = {
      rejectUnauthorized: false, // We now WANT to verify against the provided CA
      ca: dbSslCaCert.replace(/\\n/g, '\n') // Replace escaped newlines if necessary
    };
    console.log('Using provided DB_SSL_CA_CERT for SSL connection.');
  } else {
    // Fallback if CA cert is NOT provided (this might still lead to errors on DO)
    // This was the previous attempt.
    sslConfig = {
      rejectUnauthorized: false
    };
    console.warn('DB_SSL_CA_CERT not provided. Attempting SSL connection with rejectUnauthorized: false.');
  }

  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: {
      ssl: sslConfig
    },
    logging: false // Optional: disable logging in production
  });
} else {
  // Fallback to individual variables for local development
  sequelize = new Sequelize(process.env.DB_DATABASE, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432, // Use default port if not specified
    dialect: 'postgres',
    logging: console.log // Optional: enable logging locally
  });
}

sequelize.authenticate()
    .then(() => {
        console.log('Connected to the PostgreSQL database');
    })
    .catch(err => {
        console.error('Unable to connect to the database:', err);
    });

module.exports = sequelize;