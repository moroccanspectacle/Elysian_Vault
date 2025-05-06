const express = require('express');
const dotenv = require('dotenv');
const verifyToken = require('./routes/verifyToken'); 
const cors = require('cors');
const sequelize = require('./config/database'); // Make sure this is imported
const path = require('path'); // Import path module

dotenv.config();

// Add this near the top of the file with other constants
const PORT = process.env.PORT || 3000;

const app = express();

// --- Add Global Header Logging Middleware (VERY EARLY) ---
app.use((req, res, next) => {
  // Log only for the specific path we are debugging
  if (req.originalUrl.startsWith('/api/vault/access/')) {
    // Log headers for BOTH OPTIONS and GET requests hitting this path
    console.log(`[EARLY LOGGER] Headers for ${req.method} ${req.originalUrl}:`, JSON.stringify(req.headers, null, 2));
  }
  next(); // Pass control to the next middleware (cors, etc.)
});
// --- End Global Header Logging Middleware ---

// Update CORS configuration
app.use(cors({
  // Allow requests from both ports
  origin: ['http://localhost:3001', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'auth-token', 
    'mfa-setup-token',
    'mfasetuptoken',
    'x-mfa-setup-token',
    'x-vault-pin', // Lowercase
    'X-Vault-PIN'  // Uppercase
  ],
  exposedHeaders: ['Content-Disposition', 'X-File-Integrity', 'Content-Type']
}));  

// Route Imports later
const authRoute = require('./routes/auth'); // Import auth route
const postRoute = require('./routes/verPost'); // Import post route
const filesRoute = require('./routes/files'); // Import files route
const profileRoute = require('./routes/profile'); // Import profile route
const mfaRoute = require('./routes/mfa'); // Import mfa route
const activitiesRoute = require('./routes/activities'); // Import activities route
const sharesRoute = require('./routes/shares'); // Import shares route
const teamsRoutes = require('./routes/teams'); // Add this with your other routes
const notificationsRoutes = require('./routes/notifications'); // Add these with your other routes
const adminRoutes = require('./routes/admin'); // Add this with other imports
const vaultRoute = require('./routes/vault'); // Import vault route

// Add this code after you import all your models
const Team = require('./models/Team');
const User = require('./models/User');
const TeamMember = require('./models/TeamMember');

// Add this after importing your models but before syncing the database
const setupAssociations = require('./models/associations');
setupAssociations();

// Middleware to parse JSON bodies
app.use(express.json());

// Route Middlewares
app.use('/api/user', authRoute);
app.use('/api/auth', authRoute);
app.use('/api/posts', verifyToken, postRoute); // Apply verifyToken middleware to /api/posts
app.use('/api/files', filesRoute);
app.use('/api/profile', profileRoute); // Add the profile route middleware
app.use('/api/mfa', mfaRoute); // Add the mfa route middleware
app.use('/api/activities', activitiesRoute); // Notice no verifyToken here - it's already in the routes
app.use('/api/shares', sharesRoute); // Add the shares route middleware
app.use('/api/teams', teamsRoutes); // Then register it
app.use('/api/notifications', notificationsRoutes); // Register the route
app.use('/api/admin', adminRoutes); // Register the admin routes
app.use('/api/vault', vaultRoute); // Register the vault routes

// Add a route for accessing shared files with a token
app.use('/api/share', require('./routes/publicShare'));

// Serve static files
app.use('/profile-images', express.static(path.join(__dirname, 'uploads/profile-images')));

// Sync all models with database
sequelize.sync({ alter: true })
  .then(() => {
    console.log('Database synced');
    
    // Start server only after sync is complete
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      scheduleFileCleanup(); // Start scheduled tasks
    });
  })
  .catch(err => {
    console.error('Error syncing database:', err);
  });

// Add this at the end of your backend/index.js file, after all other routes
// Serve static files from React's build folder in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/dist'))); // Changed 'build' to 'dist'
}

// The "catch all" handler for any request that doesn't match one above
// Send back React's index.html file
app.get('*', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html')); // Changed 'build' to 'dist'
  } else {
    // Don't redirect API routes
    if (req.url.startsWith('/api/')) {
      res.status(404).json({ error: 'API endpoint not found' });
    } else {
      // Only redirect non-API routes to frontend
      res.redirect('http://localhost:3001' + req.originalUrl);
    }
  }
});

// Add near the bottom of the file
const { scheduleFileCleanup } = require('./services/fileExpirationService');


