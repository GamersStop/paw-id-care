require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// Import Modular Routers
const authRoutes = require('./routes/auth');
const reportRoutes = require('./routes/report');
const ownerRoutes = require('./routes/owner');
const rescuerRoutes = require('./routes/rescuer');
const vetRoutes = require('./routes/vet');

const app = express();

// Global Middleware
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Mount API Routers
app.use('/api', authRoutes);
app.use('/api', reportRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/rescuer', rescuerRoutes);
app.use('/api/vet', vetRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`PawID & Care server running on port ${PORT}`);
});

module.exports = app;