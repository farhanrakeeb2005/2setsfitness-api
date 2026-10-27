// GET /news: the app's News & updates (src/lib/news.js). Public: guests see
// it too, and it holds nothing about anyone.
const router = require('express').Router();
const { newsList } = require('../lib/news');

router.get('/', (req, res) => res.json({ news: newsList() }));

module.exports = router;
