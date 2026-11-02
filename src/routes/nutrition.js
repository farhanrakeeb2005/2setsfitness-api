// POST /nutrition: a mirror write the app still fires after logging a meal
// (NutritionSheet, fire-and-forget). Nothing on the server reads
// nutrition_logs any more; the route stays so current and recent builds get a
// 201 instead of a 404.
const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');

router.post('/', auth, async (req, res) => {
  const { meal = 'Any', protein = 0, carbs = 0, fat = 0, calories = 0 } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO nutrition_logs (user_id, meal, protein, carbs, fat, calories) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [req.user.id, meal, protein, carbs, fat, calories]
  );
  // (no points here: the app works out its own total and reports it, PUT /points)
  res.status(201).json(rows[0]);
});

module.exports = router;
