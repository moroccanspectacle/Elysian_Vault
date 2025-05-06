const { Sequelize } = require('sequelize');
const dotenv = require('dotenv');
dotenv.config();

let sequelize;

// Check if DATABASE_URL is provided (like on DigitalOcean)
if (process.env.DATABASE_URL) {
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    protocol: 'postgres',
    dialectOptions: {
      ssl: {
        require: true, // Required for secure connections on many platforms
        rejectUnauthorized: false // Adjust as needed based on DO's SSL setup
      }
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