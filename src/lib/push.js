// Push notifications to a player's phones (Firebase Cloud Messaging), for
// challenges: "X challenged you", "X accepted". The app registers each
// phone's FCM token with its language (PUT /profile/push-token); tokens the
// phone no longer has are dropped when FCM says so. Sending never fails the
// request that caused it: a notification is a nicety, the challenge itself
// is already saved.
const pool = require('../db');

// the two messages, in the app's 25 languages ({name}: the other player)
const T = {
  challenged: {
    en: ['New challenge', '{name} challenged you. Open it to see the challenge and accept.'],
    ar: ['تحدٍّ جديد', 'تحداك {name}. افتحه لترى التحدي وتقبله.'],
    ur: ['نیا چیلنج', '{name} نے آپ کو چیلنج دیا ہے۔ کھول کر دیکھیں اور قبول کریں۔'],
    es: ['Nuevo reto', '{name} te ha retado. Ábrelo para ver el reto y aceptarlo.'],
    fr: ['Nouveau défi', '{name} vous a lancé un défi. Ouvrez-le pour le voir et l’accepter.'],
    pt: ['Novo desafio', '{name} desafiou-o. Abra para ver o desafio e aceitar.'],
    tr: ['Yeni meydan okuma', '{name} sana meydan okudu. Görmek ve kabul etmek için aç.'],
    de: ['Neue Herausforderung', '{name} fordert dich heraus. Öffne sie, um sie zu sehen und anzunehmen.'],
    it: ['Nuova sfida', '{name} ti ha sfidato. Aprila per vederla e accettarla.'],
    nl: ['Nieuwe uitdaging', '{name} daagt je uit. Open hem om te kijken en te accepteren.'],
    ru: ['Новый вызов', '{name} бросает вам вызов. Откройте, чтобы посмотреть и принять.'],
    hi: ['नई चुनौती', '{name} ने आपको चुनौती दी है। देखने और स्वीकार करने के लिए खोलें।'],
    ja: ['新しいチャレンジ', '{name}さんから挑戦状が届きました。開いて内容を確認しましょう。'],
    kr: ['새 도전', '{name}님이 도전했어요. 열어서 확인하고 수락하세요.'],
    vi: ['Thử thách mới', '{name} đã thách đấu bạn. Mở ra để xem và nhận lời.'],
    th: ['คำท้าใหม่', '{name} ท้าคุณ เปิดดูคำท้าแล้วรับได้เลย'],
    sw: ['Changamoto mpya', '{name} amekupa changamoto. Fungua uione na ukubali.'],
    'zh-CN': ['新挑战', '{name} 向你发起挑战。打开查看并接受。'],
    ms: ['Cabaran baharu', '{name} mencabar anda. Buka untuk melihat dan menerimanya.'],
    id: ['Tantangan baru', '{name} menantangmu. Buka untuk melihat dan menerimanya.'],
    tl: ['Bagong hamon', 'Hinamon ka ni {name}. Buksan para makita at tanggapin.'],
    pl: ['Nowe wyzwanie', '{name} rzuca ci wyzwanie. Otwórz, by je zobaczyć i przyjąć.'],
    fa: ['چالش جدید', '{name} شما را به چالش دعوت کرد. باز کنید تا ببینید و بپذیرید.'],
    bn: ['নতুন চ্যালেঞ্জ', '{name} আপনাকে চ্যালেঞ্জ দিয়েছে। দেখতে ও গ্রহণ করতে খুলুন।'],
    so: ['Loolan cusub', '{name} ayaa kugu loolamay. Fur si aad u aragto oo u aqbasho.'],
  },
  accepted: {
    en: ['Challenge accepted', '{name} accepted. The challenge starts now.'],
    ar: ['تم قبول التحدي', 'قبل {name}. يبدأ التحدي الآن.'],
    ur: ['چیلنج قبول', '{name} نے قبول کر لیا۔ چیلنج ابھی شروع۔'],
    es: ['Reto aceptado', '{name} ha aceptado. El reto empieza ya.'],
    fr: ['Défi accepté', '{name} a accepté. Le défi commence maintenant.'],
    pt: ['Desafio aceite', '{name} aceitou. O desafio começa agora.'],
    tr: ['Meydan okuma kabul edildi', '{name} kabul etti. Meydan okuma şimdi başlıyor.'],
    de: ['Herausforderung angenommen', '{name} hat angenommen. Die Herausforderung beginnt jetzt.'],
    it: ['Sfida accettata', '{name} ha accettato. La sfida inizia ora.'],
    nl: ['Uitdaging geaccepteerd', '{name} doet mee. De uitdaging begint nu.'],
    ru: ['Вызов принят', '{name} принял(а) вызов. Начинаем.'],
    hi: ['चुनौती स्वीकार', '{name} ने स्वीकार किया। चुनौती अभी शुरू।'],
    ja: ['挑戦が受けられました', '{name}さんが受けました。チャレンジ開始です。'],
    kr: ['도전 수락', '{name}님이 수락했어요. 도전이 지금 시작돼요.'],
    vi: ['Đã nhận lời', '{name} đã nhận lời. Thử thách bắt đầu ngay.'],
    th: ['รับคำท้าแล้ว', '{name} รับคำท้าแล้ว เริ่มกันเลย'],
    sw: ['Changamoto imekubaliwa', '{name} amekubali. Changamoto inaanza sasa.'],
    'zh-CN': ['挑战已接受', '{name} 已接受，挑战现在开始。'],
    ms: ['Cabaran diterima', '{name} menerima. Cabaran bermula sekarang.'],
    id: ['Tantangan diterima', '{name} menerima. Tantangan dimulai sekarang.'],
    tl: ['Tinanggap ang hamon', 'Tinanggap ni {name}. Simula na ang hamon.'],
    pl: ['Wyzwanie przyjęte', '{name} przyjmuje. Wyzwanie zaczyna się teraz.'],
    fa: ['چالش پذیرفته شد', '{name} پذیرفت. چالش از همین حالا شروع شد.'],
    bn: ['চ্যালেঞ্জ গৃহীত', '{name} গ্রহণ করেছে। চ্যালেঞ্জ এখনই শুরু।'],
    so: ['Loolanka waa la aqbalay', '{name} ayaa aqbalay. Loolanku hadda ayuu bilaabmayaa.'],
  },
};

function message(kind, lang, name) {
  const set = T[kind];
  const [title, body] = set[lang] || set.en;
  return { title, body: body.replace('{name}', name || '') };
}

// kind: 'challenged' | 'accepted'; data: small strings for the app (where to open)
async function notifyUser(userId, kind, { name, data = {} } = {}) {
  try {
    const { rows } = await pool.query('SELECT token, lang FROM push_tokens WHERE user_id = $1', [userId]);
    if (!rows.length) return;
    const { getMessaging } = require('firebase-admin/messaging');
    const messaging = getMessaging();
    await Promise.all(rows.map(async ({ token, lang }) => {
      const { title, body } = message(kind, lang, name);
      try {
        await messaging.send({
          token,
          notification: { title, body },
          data: { type: kind, ...data },
          android: { priority: 'high', notification: { channelId: 'challenges', color: '#E31E24' } },
        });
      } catch (e) {
        // the phone no longer has that token (app removed, data cleared)
        if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(e?.code || '')) {
          await pool.query('DELETE FROM push_tokens WHERE token = $1', [token]).catch(() => {});
        } else {
          console.warn('push failed:', e?.code || e?.message);
        }
      }
    }));
  } catch (e) {
    console.warn('push skipped:', e?.message);
  }
}

module.exports = { notifyUser, message };
