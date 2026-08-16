const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
require('dotenv').config();

const authRoutes        = require('./routes/auth');
const profileRoutes     = require('./routes/profile');
const routinesRoutes    = require('./routes/routines');
const historyRoutes     = require('./routes/history');
const leaderboardRoutes = require('./routes/leaderboard');
const aiRoutes          = require('./routes/ai');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use('/auth',        authRoutes);
app.use('/profile',     profileRoutes);
app.use('/routines',    routinesRoutes);
app.use('/history',     historyRoutes);
app.use('/leaderboard', leaderboardRoutes);
app.use('/ai',          aiRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

module.exports = app;
