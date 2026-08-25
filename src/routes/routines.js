const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');

// GET /routines
router.get('/', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM routines WHERE user_id = $1 ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json(rows);
});

// POST /routines
router.post('/', auth, async (req, res) => {
  const { name, icon = 'star', exercises = [] } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { rows } = await pool.query(
    'INSERT INTO routines (user_id, name, icon, exercises) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.user.id, name, icon, JSON.stringify(exercises)]
  );
  res.status(201).json(rows[0]);
});

// PUT /routines/:id
router.put('/:id', auth, async (req, res) => {
  const { name, icon, exercises } = req.body;
  const { rows } = await pool.query(
    `UPDATE routines SET
      name      = COALESCE($1, name),
      icon      = COALESCE($2, icon),
      exercises = COALESCE($3, exercises)
     WHERE id=$4 AND user_id=$5 RETURNING *`,
    [name ?? null, icon ?? null, exercises ? JSON.stringify(exercises) : null, req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// DELETE /routines/:id
router.delete('/:id', auth, async (req, res) => {
  await pool.query(
    'DELETE FROM routines WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  );
  res.json({ ok: true });
});

module.exports = router;
