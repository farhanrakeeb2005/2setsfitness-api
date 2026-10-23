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
    en: ['New challenge', '{name} challenged you to a 7-day points race. Accept?'],
    ar: ['تحدٍّ جديد', 'تحداك {name} في سباق نقاط لمدة 7 أيام. هل تقبل؟'],
    ur: ['نیا چیلنج', '{name} نے آپ کو 7 دن کی پوائنٹس ریس کا چیلنج دیا ہے۔ قبول کریں؟'],
    es: ['Nuevo reto', '{name} te reta a una carrera de puntos de 7 días. ¿Aceptas?'],
    fr: ['Nouveau défi', '{name} vous défie dans une course aux points de 7 jours. Vous acceptez ?'],
    pt: ['Novo desafio', '{name} desafiou-o para uma corrida de pontos de 7 dias. Aceita?'],
    tr: ['Yeni meydan okuma', '{name} seni 7 günlük puan yarışına davet etti. Kabul ediyor musun?'],
    de: ['Neue Herausforderung', '{name} fordert dich zu einem 7-Tage-Punkterennen heraus. Annehmen?'],
    it: ['Nuova sfida', '{name} ti sfida a una gara a punti di 7 giorni. Accetti?'],
    nl: ['Nieuwe uitdaging', '{name} daagt je uit voor een puntenrace van 7 dagen. Accepteren?'],
    ru: ['Новый вызов', '{name} вызывает вас на 7-дневную гонку очков. Принять?'],
    hi: ['नई चुनौती', '{name} ने आपको 7 दिन की पॉइंट्स रेस की चुनौती दी है। स्वीकार करें?'],
    ja: ['新しいチャレンジ', '{name}さんから7日間のポイントレースの挑戦状が届きました。受けますか？'],
    kr: ['새 도전', '{name}님이 7일 포인트 레이스에 도전했어요. 수락할까요?'],
    vi: ['Thử thách mới', '{name} thách đấu bạn cuộc đua điểm 7 ngày. Nhận lời?'],
    th: ['คำท้าใหม่', '{name} ท้าคุณแข่งสะสมแต้ม 7 วัน รับคำท้าไหม?'],
    sw: ['Changamoto mpya', '{name} amekupa changamoto ya mbio za pointi za siku 7. Kubali?'],
    'zh-CN': ['新挑战', '{name} 向你发起 7 天积分赛。接受吗？'],
    ms: ['Cabaran baharu', '{name} mencabar anda dalam perlumbaan mata 7 hari. Terima?'],
    id: ['Tantangan baru', '{name} menantangmu balapan poin 7 hari. Terima?'],
    tl: ['Bagong hamon', 'Hinamon ka ni {name} sa 7-araw na karera ng puntos. Tanggapin?'],
    pl: ['Nowe wyzwanie', '{name} wyzywa cię na 7-dniowy wyścig punktów. Przyjmujesz?'],
    fa: ['چالش جدید', '{name} شما را به مسابقهٔ امتیاز ۷ روزه دعوت کرد. می‌پذیرید؟'],
    bn: ['নতুন চ্যালেঞ্জ', '{name} আপনাকে ৭ দিনের পয়েন্ট রেসে চ্যালেঞ্জ দিয়েছে। গ্রহণ করবেন?'],
    so: ['Loolan cusub', '{name} ayaa kugu loolamay tartan dhibco 7 maalmood ah. Ma aqbashaa?'],
  },
  accepted: {
    en: ['Challenge accepted', '{name} accepted. The 7-day race starts now.'],
    ar: ['تم قبول التحدي', 'قبل {name}. يبدأ السباق لمدة 7 أيام الآن.'],
    ur: ['چیلنج قبول', '{name} نے قبول کر لیا۔ 7 دن کی ریس ابھی شروع۔'],
    es: ['Reto aceptado', '{name} ha aceptado. La carrera de 7 días empieza ya.'],
    fr: ['Défi accepté', '{name} a accepté. La course de 7 jours commence maintenant.'],
    pt: ['Desafio aceite', '{name} aceitou. A corrida de 7 dias começa agora.'],
    tr: ['Meydan okuma kabul edildi', '{name} kabul etti. 7 günlük yarış şimdi başlıyor.'],
    de: ['Herausforderung angenommen', '{name} hat angenommen. Das 7-Tage-Rennen beginnt jetzt.'],
    it: ['Sfida accettata', '{name} ha accettato. La gara di 7 giorni inizia ora.'],
    nl: ['Uitdaging geaccepteerd', '{name} doet mee. De race van 7 dagen begint nu.'],
    ru: ['Вызов принят', '{name} принял(а) вызов. 7-дневная гонка начинается.'],
    hi: ['चुनौती स्वीकार', '{name} ने स्वीकार किया। 7 दिन की रेस अभी शुरू।'],
    ja: ['挑戦が受けられました', '{name}さんが受けました。7日間のレース開始です。'],
    kr: ['도전 수락', '{name}님이 수락했어요. 7일 레이스가 지금 시작돼요.'],
    vi: ['Đã nhận lời', '{name} đã nhận lời. Cuộc đua 7 ngày bắt đầu ngay.'],
    th: ['รับคำท้าแล้ว', '{name} รับคำท้าแล้ว การแข่ง 7 วันเริ่มเลย'],
    sw: ['Changamoto imekubaliwa', '{name} amekubali. Mbio za siku 7 zinaanza sasa.'],
    'zh-CN': ['挑战已接受', '{name} 已接受，7 天比赛现在开始。'],
    ms: ['Cabaran diterima', '{name} menerima. Perlumbaan 7 hari bermula sekarang.'],
    id: ['Tantangan diterima', '{name} menerima. Balapan 7 hari dimulai sekarang.'],
    tl: ['Tinanggap ang hamon', 'Tinanggap ni {name}. Simula na ang 7-araw na karera.'],
    pl: ['Wyzwanie przyjęte', '{name} przyjmuje. 7-dniowy wyścig zaczyna się teraz.'],
    fa: ['چالش پذیرفته شد', '{name} پذیرفت. مسابقهٔ ۷ روزه از همین حالا شروع شد.'],
    bn: ['চ্যালেঞ্জ গৃহীত', '{name} গ্রহণ করেছে। ৭ দিনের রেস এখনই শুরু।'],
    so: ['Loolanka waa la aqbalay', '{name} ayaa aqbalay. Tartanka 7 maalmood hadda ayuu bilaabmayaa.'],
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
