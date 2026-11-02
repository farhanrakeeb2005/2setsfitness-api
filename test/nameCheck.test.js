// Players' names (src/lib/nameCheck.js, a copy of the app's lib/nameCheck.js):
// every name saved must be there, be a name and not be offensive, and a
// stored name that fails shows as 'Athlete' + the start of the public id
// (src/lib/names.js). `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkName, cleanName, okName } = require('../src/lib/nameCheck');
const { nameUpdate, shownName } = require('../src/lib/names');

const reason = (n) => checkName(n).reason;

test('real names pass, in every script the app speaks', () => {
  for (const n of [
    'Mohammed Salih', 'Mohammed', "O'Brien", 'Anne-Marie', 'Dr. Jane Smith', 'J. R. R. Tolkien', 'Al', 'Bo', 'Li',
    'José Álvarez', 'François', 'Zoë', 'Björk', 'Łukasz Żółć', 'Şükrü Öztürk', 'İbrahim', 'Nguyễn Văn An',
    'محمد صالح', 'عبد الله', 'فاطمة', 'محمد علی', 'عائشہ', 'زهرا‌سادات',
    '李明', '王小红', '山田太郎', 'さくら', '김민준', 'Иван Петров', 'Ольга', 'राहुल शर्मा', 'प्रिया',
    'রহিম', 'สมชาย ใจดี', 'Porntip', 'Siriporn', 'Juma Mwangi', 'Cabdi Xasan', 'Maria dela Cruz',
    'Andrzej', 'Daan de Vries', 'Giulia', 'Mike 2', 'Player 7', 'Ana·Maria', 'Ali',
  ]) assert.deepEqual(checkName(n), { ok: true, name: cleanName(n), reason: null }, n);
});

test('names that are also slang somewhere, or contain a swear word inside, still pass', () => {
  for (const n of [
    'Dick Van Dyke', 'Dick', 'Scunthorpe', 'Cummings', 'Hancock', 'Sexton', 'Shital', 'Shitake', 'Anal Patel',
    'Kuma', 'Fukuda', 'Wai Fuk', 'Randi', 'Lund', 'Niki Lauda', 'Huy', 'Suka', 'Nazi', 'Amina', 'Kapil Sibal',
    'Concha', 'Marica', 'Verga', 'Foda', 'Fick', 'Kut', 'Magi', 'Kir', 'Cono', 'Kike García', 'Lon', 'Du', 'Lan',
    'Joe Root', 'Arsenal', 'Assad', 'Glasgow', 'Pussycat Doll', 'Massachusetts', 'Cassandra', 'Badminton Ben',
    'Peacock', 'Babcock', 'Penistone', 'Titus', 'Moderna', 'Mo D.', 'Pat D.', 'A. M. Khan', 'Isis',
  ]) assert.equal(reason(n), null, n);
});

test('tidied: spaces trimmed and collapsed, invisible characters dropped', () => {
  assert.equal(checkName('  Mohammed   Salih \n').name, 'Mohammed Salih');
  assert.equal(checkName('Mo​hammed').name, 'Mohammed');
  assert.equal(okName('  Anne-Marie '), 'Anne-Marie');
  assert.equal(okName('fuck'), '');
});

test('empty: nothing, only spaces, only symbols or emoji', () => {
  for (const n of ['', '   ', '\n\t', '!!!', '😀😀', '💪🔥', '...', "'-'", null, undefined, 42]) assert.equal(reason(n), 'empty', String(n));
});

test('short and long', () => {
  assert.equal(reason('J'), 'short');
  assert.equal(reason('李'), 'short');
  assert.equal(reason('Mohammed Abdulrahman Salih'), null);
  assert.equal(reason('A'.repeat(41)), 'long');
  assert.equal(reason('A'.repeat(40)), null);
});

test('symbols: emoji in a name, other punctuation, no letter at all', () => {
  for (const n of ['Mike 💪', 'Sam#1', 'Ann!e', 'Jo_Jo', '<b>Bo</b>', '1234', '12 34', 'Bob & Al']) assert.equal(reason(n), 'symbols', n);
});

test('contact: links, handles, emails, phone numbers', () => {
  for (const n of ['@mike', 'mike@gmail.com', 'www.mysite', 'http://x', 'mysite.com', 'follow me.io', 'Sam 07700900123', 'Ali 555 123 4567', 'shop.store']) {
    assert.equal(reason(n), 'contact', n);
  }
});

test('offensive: English, disguised every usual way', () => {
  for (const n of [
    'fuck', 'Fuck You', 'FUCK', 'fuuuuck', 'f.u.c.k', 'f_u_c_k', 'f u c k', 'f-u-c-k', 'fu ck', 'Fück', 'phat fucker',
    'motherfucker99', 'sh1t', 'shiiit', '$hit', 'b1tch', 'Bitchy Bob', 'c u n t', 'cunt', 'n1gger', 'n i g g a',
    'niggaz', 'faggot', 'f4g', 'a$$hole', 'ass hole', 'wanker', 'Dickhead', 'c0ck', 'pu$$y', 'p3nis', 's3x', 'sexy sam',
    'slut', 'wh0re', 'rapist', 'retard', 'Hitler', 'H1tl3r', 'kkk', 'Big Cock', 'tranny', 'milf hunter', 'jizz',
    'fuсk', // a Cyrillic с
    'f​uck', 'Mr Fuck', 'xXfuckXx',
  ]) assert.equal(reason(n), 'offensive', n);
});

test('offensive: the main ones in the app\'s other languages', () => {
  for (const n of [
    'puta', 'Hijo de Puta', 'pendejo', 'gilipollas', 'cabrón', 'coño', // es
    'caralho', 'filho da puta', 'buceta', // pt
    'putain', 'salope', 'connard', 'enculé', // fr
    'cazzo', 'vaffanculo', 'stronzo', // it
    'Scheiße', 'arschloch', 'hurensohn', 'fotze', // de
    'klootzak', 'kankerlijer', 'godverdomme', // nl
    'orospu çocuğu', 'siktir', 'amına koyim', // tr
    'хуй', 'пиздец', 'блядь', 'сука', 'blyat', // ru
    'kurwa', 'skurwysyn', 'chuj', // pl
    'شرموطة', 'كس', 'ابن الكلب', 'sharmouta', // ar
    'بہنچود', 'مادرچود', 'bhenchod', 'madarchod', 'chutiya', // ur
    'चूतिया', 'मादरचोद', 'बहनचोद', // hi
    'খানকি', 'চুতমারানি', // bn
    'جنده', 'کسکش', 'مادرجنده', // fa
    '傻逼', '操你妈', '他妈的', '婊子', // zh
    'まんこ', 'ちんこ', '死ね', // ja
    '씨발', '개새끼', '병신', // kr
    'địt mẹ', 'lồn', 'cặc', // vi
    'ควย', 'เย็ดแม่', // th
    'msenge', 'kumamako', // sw
    'kontol', 'ngentot', 'pukimak', 'bangsat', // ms / id
    'putangina', 'tangina mo', 'pokpok', // tl
    'wasmo', 'dhillo', // so
  ]) assert.equal(reason(n), 'offensive', n);
});

test('reserved: names that look official', () => {
  for (const n of [
    'Admin', 'admin', 'ADMIN 2', 'Adm1n', 'a d m i n', 'Moderator', 'Official', 'The Official Bob', '2SetsFitness',
    '2 Sets Fitness', '2sets', 'TwoSets', '2SetsFitness Team', 'Support', 'Athlete', 'Athlete 3F2A', 'Staff',
  ]) assert.equal(reason(n), 'reserved', n);
  assert.equal(reason('Athlete Mike'), null);
});

test('PUT /profile names: none given keeps the stored one, a bad one is refused with its reason', () => {
  assert.equal(nameUpdate(undefined), undefined);
  assert.equal(nameUpdate('   '), undefined);
  assert.equal(nameUpdate('Athlete'), undefined);
  assert.equal(nameUpdate(42), undefined);
  assert.deepEqual(nameUpdate('  Anne-Marie  '), { name: 'Anne-Marie' });
  assert.equal(nameUpdate('f.u.c.k').reason, 'offensive');
  assert.equal(nameUpdate('Admin').reason, 'reserved');
  assert.equal(nameUpdate('me@x.com').reason, 'contact');
  assert.equal(nameUpdate('😀😀').reason, 'empty');
});

test('a stored name that fails is shown as Athlete + the start of the public id', () => {
  const id = '3f2a9c0000000000000000000000abcd';
  assert.equal(shownName('Mohammed Salih', id), 'Mohammed Salih');
  assert.equal(shownName('  محمد   صالح ', id), 'محمد صالح');
  assert.equal(shownName('fuck you', id), 'Athlete 3F2A');
  assert.equal(shownName('Athlete', id), 'Athlete 3F2A');
  assert.equal(shownName('', id), 'Athlete 3F2A');
  assert.equal(shownName(null, null), 'Athlete');
  // (the fallback itself is reserved: nobody can take it as a name)
  assert.equal(reason('Athlete 3F2A'), 'reserved');
});
