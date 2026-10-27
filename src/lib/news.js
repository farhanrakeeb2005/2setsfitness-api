// News & updates for the app's notifications sheet (GET /news; the app's
// InboxSheet "News" tab). Newest first. To post one: add it at the top and
// deploy. id: unique and only ever growing (the app counts the ones newer
// than the last it showed as unread); tag: 'new' (a feature), 'event',
// 'tip' or 'fix'; emoji: the card's picture. Plain text only.
const NEWS = [
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

// what the app shows: the newest 30, newest first, only known fields
function newsList(list = NEWS) {
  return list.slice(0, 30).map(({ id, date, tag, emoji, title, body }) => ({ id, date, tag, emoji, title, body }));
}

module.exports = { NEWS, newsList };
