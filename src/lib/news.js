// News & updates for the app's notifications sheet (GET /news; the app's
// InboxSheet "News" tab). Newest first. To post one: add it at the top and
// deploy. id: unique and only ever growing (the app counts the ones newer
// than the last it showed as unread); tag: 'new' (a feature), 'event',
// 'tip' or 'fix'; emoji: the card's picture. Plain text only. An item is
// shown for NEWS_DAYS from its date, then drops off by itself.
const NEWS_DAYS = 7;
const NEWS = [
  {
    id: '2026-10-28e', date: '2026-10-28', tag: 'new', emoji: '🎨',
    title: 'A new colour every day',
    body: 'Today\'s card on Home changes colour each day, and yours won\'t match your friends\'. Sport days still wear that sport\'s kit.',
  },
  {
    id: '2026-10-28d', date: '2026-10-28', tag: 'new', emoji: '🗣️',
    title: 'Daily check-in with your coach',
    body: 'Tap Daily check-in on Home. Your coach runs through today out loud: your plan, food, water and sleep. Tap Talk back to ask it anything.',
  },
  {
    id: '2026-10-28c', date: '2026-10-28', tag: 'new', emoji: '🎯',
    title: 'Your full form analysis',
    body: 'In Progress, tap an exercise under Form progress to see every set: your reps, the faults the camera spotted and what your coach told you to fix.',
  },
  {
    id: '2026-10-28b', date: '2026-10-28', tag: 'new', emoji: '🎙️',
    title: 'Speak instead of typing',
    body: 'Tap the mic to tell your coach what you did. The 2SetsFitness Coach screen writes your words down as you say them.',
  },
  {
    id: '2026-10-28a', date: '2026-10-28', tag: 'new', emoji: '📋',
    title: 'Track, made simpler',
    body: 'Track now has Workouts, Plan and History. New workout lets you build your own, let the AI build it, or just start.',
  },
  {
    id: '2026-10-27c', date: '2026-10-27', tag: 'new', emoji: '🔔',
    title: 'Notifications are here',
    body: 'Friend requests and challenges now land in this bell, and on your phone even when the app is closed. Accept or decline right from the list.',
  },
  {
    id: '2026-10-27b', date: '2026-10-27', tag: 'new', emoji: '💧',
    title: 'Pick your glass size',
    body: 'Log water in the size you actually drink from: 200, 250, 330, 500 or 750 ml. Your goal and points follow the real amount.',
  },
  {
    id: '2026-10-27a', date: '2026-10-27', tag: 'new', emoji: '⚽',
    title: 'This week\'s challenge, on Home',
    body: 'The weekly challenge now sits on Home until you finish it. A new one starts every Sunday.',
  },
  {
    id: '2026-10-26b', date: '2026-10-26', tag: 'new', emoji: '🗑️',
    title: 'Delete a workout',
    body: 'Logged a test or a mistake? Open the workout and tap Delete this workout at the bottom. Its points and any record it set go with it.',
  },
  {
    id: '2026-10-26a', date: '2026-10-26', tag: 'new', emoji: '🗺️',
    title: 'Friends on your rank map',
    body: 'Your friends show as a bubble with their initial at the checkpoint they\'ve reached. Tap one to see their profile.',
  },
  {
    id: '2026-10-25b', date: '2026-10-25', tag: 'new', emoji: '⚡',
    title: 'Challenge your friends',
    body: 'Race a friend to 100 push-ups or a 10 km run, through one of your routines, or for the most points. Put points or a forfeit on it. The only person you cheat is yourself.',
  },
  {
    id: '2026-10-25a', date: '2026-10-25', tag: 'tip', emoji: '😴',
    title: 'Sleep earns points',
    body: '7 to 9 hours of sleep earns the most. Too little or too much earns less, so aim for the sweet spot.',
  },
];

// what the app shows: the last NEWS_DAYS' items (at most 30), newest first, only known fields
function newsList(list = NEWS, now = Date.now()) {
  const fresh = (n) => now - Date.parse(`${n.date}T00:00:00Z`) < (NEWS_DAYS + 1) * 864e5;
  return list.filter(fresh).slice(0, 30).map(({ id, date, tag, emoji, title, body }) => ({ id, date, tag, emoji, title, body }));
}

module.exports = { NEWS, NEWS_DAYS, newsList };
