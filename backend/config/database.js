const { Sequelize } = require('sequelize');
const dotenv = require('dotenv');
dotenv.config();

let sequelize;

// Check if DATABASE_URL is provided (like on DigitalOcean)
if (process.env.DATABASE_URL) {
  const dbSslCaCert = process.env.DB_SSL_CA_CERT;
  let sslConfig = {};

  if (dbSslCaCert && dbSslCaCert.trim() !== '') { // Also check if the cert content is not empty
    // If CA cert is provided, use it and require proper verification
    sslConfig = {
      rejectUnauthorized: true, // <<<<------ CORRECT THIS LINE
      ca: dbSslCaCert.replace(/\\n/g, '\n')
    };
    console.log('Using provided DB_SSL_CA_CERT for SSL connection with verification.');
  } else {
    // Fallback if CA cert is NOT provided or is empty
    sslConfig = {
      rejectUnauthorized: false // This is the "trust anything" mode
    };
    console.warn('DB_SSL_CA_CERT not provided or empty. Attempting SSL connection with rejectUnauthorized: false.');
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
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: console.log
  });
}

sequelize.authenticate()
    .then(() => {
        console.log('Connected to the PostgreSQL database');
    })
    .catch(err => {
        console.error('Unable to connect to the database:', err);
        if (process.env.DATABASE_URL && err.parent && err.parent.code === 'SELF_SIGNED_CERT_IN_CHAIN') {
            console.error("SELF_SIGNED_CERT_IN_CHAIN error. Ensure DB_SSL_CA_CERT environment variable is correctly set in DigitalOcean with the CA certificate content and that it's not empty.");
        }
    });

module.exports = sequelize;