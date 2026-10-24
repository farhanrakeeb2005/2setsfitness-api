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
  snap: {
    en: ['New proof snap', '{name} sent you a proof snap. It disappears once you see it.'],
    ar: ['صورة إثبات جديدة', 'أرسل لك {name} صورة إثبات. تختفي بعد أن تراها.'],
    ur: ['نئی پروف اسنیپ', '{name} نے آپ کو پروف اسنیپ بھیجی۔ دیکھنے کے بعد غائب ہو جائے گی۔'],
    es: ['Nueva foto de prueba', '{name} te ha enviado una foto de prueba. Desaparece cuando la ves.'],
    fr: ['Nouvelle photo preuve', '{name} vous a envoyé une photo preuve. Elle disparaît une fois vue.'],
    pt: ['Nova foto de prova', '{name} enviou-lhe uma foto de prova. Desaparece depois de a ver.'],
    tr: ['Yeni kanıt fotoğrafı', '{name} sana bir kanıt fotoğrafı gönderdi. Gördükten sonra kaybolur.'],
    de: ['Neuer Beweis-Snap', '{name} hat dir einen Beweis-Snap geschickt. Er verschwindet, sobald du ihn siehst.'],
    it: ['Nuova foto prova', '{name} ti ha mandato una foto prova. Sparisce dopo che la vedi.'],
    nl: ['Nieuwe bewijs-snap', '{name} stuurde je een bewijs-snap. Hij verdwijnt zodra je hem ziet.'],
    ru: ['Новое фото-доказательство', '{name} прислал(а) вам фото-доказательство. Оно исчезнет после просмотра.'],
    hi: ['नया प्रूफ़ स्नैप', '{name} ने आपको प्रूफ़ स्नैप भेजा। देखने के बाद गायब हो जाएगा।'],
    ja: ['新しいプルーフスナップ', '{name}さんからプルーフスナップが届きました。見ると消えます。'],
    kr: ['새 인증 스냅', '{name}님이 인증 스냅을 보냈어요. 보고 나면 사라져요.'],
    vi: ['Ảnh chứng minh mới', '{name} gửi bạn một ảnh chứng minh. Ảnh biến mất sau khi xem.'],
    th: ['รูปพิสูจน์ใหม่', '{name} ส่งรูปพิสูจน์ให้คุณ รูปจะหายไปเมื่อดูแล้ว'],
    sw: ['Picha mpya ya ushahidi', '{name} amekutumia picha ya ushahidi. Inapotea ukishaiona.'],
    'zh-CN': ['新的打卡快照', '{name} 给你发了一张打卡快照，看过就会消失。'],
    ms: ['Foto bukti baharu', '{name} menghantar foto bukti kepada anda. Ia hilang selepas dilihat.'],
    id: ['Foto bukti baru', '{name} mengirimimu foto bukti. Foto hilang setelah dilihat.'],
    tl: ['Bagong proof snap', 'Pinadalhan ka ni {name} ng proof snap. Mawawala ito pagkakita mo.'],
    pl: ['Nowy snap-dowód', '{name} wysyła ci snap-dowód. Zniknie, gdy go obejrzysz.'],
    fa: ['عکس اثبات جدید', '{name} برایتان عکس اثبات فرستاد. بعد از دیدن ناپدید می‌شود.'],
    bn: ['নতুন প্রুফ স্ন্যাপ', '{name} আপনাকে একটি প্রুফ স্ন্যাপ পাঠিয়েছে। দেখার পর মুছে যাবে।'],
    so: ['Sawir caddayn cusub', '{name} ayaa kuu soo diray sawir caddayn. Wuu baaba’aa markaad aragto.'],
  },
  screenshot: {
    en: ['Screenshot', '{name} tried to screenshot your snap.'],
    ar: ['لقطة شاشة', 'حاول {name} التقاط صورة شاشة لصورتك.'],
    ur: ['اسکرین شاٹ', '{name} نے آپ کی اسنیپ کا اسکرین شاٹ لینے کی کوشش کی۔'],
    es: ['Captura de pantalla', '{name} intentó hacer una captura de tu foto.'],
    fr: ['Capture d’écran', '{name} a tenté de faire une capture de votre photo.'],
    pt: ['Captura de ecrã', '{name} tentou fazer uma captura da sua foto.'],
    tr: ['Ekran görüntüsü', '{name} fotoğrafının ekran görüntüsünü almaya çalıştı.'],
    de: ['Screenshot', '{name} hat versucht, deinen Snap zu screenshotten.'],
    it: ['Screenshot', '{name} ha provato a fare uno screenshot della tua foto.'],
    nl: ['Screenshot', '{name} probeerde een screenshot van je snap te maken.'],
    ru: ['Скриншот', '{name} пытался(ась) сделать скриншот вашего фото.'],
    hi: ['स्क्रीनशॉट', '{name} ने आपके स्नैप का स्क्रीनशॉट लेने की कोशिश की।'],
    ja: ['スクリーンショット', '{name}さんがあなたのスナップのスクリーンショットを撮ろうとしました。'],
    kr: ['스크린샷', '{name}님이 내 스냅을 캡처하려 했어요.'],
    vi: ['Chụp màn hình', '{name} đã cố chụp màn hình ảnh của bạn.'],
    th: ['แคปหน้าจอ', '{name} พยายามแคปหน้าจอรูปของคุณ'],
    sw: ['Picha ya skrini', '{name} alijaribu kupiga picha ya skrini ya picha yako.'],
    'zh-CN': ['截屏', '{name} 试图截屏你的快照。'],
    ms: ['Tangkapan skrin', '{name} cuba menangkap skrin foto anda.'],
    id: ['Tangkapan layar', '{name} mencoba menangkap layar fotomu.'],
    tl: ['Screenshot', 'Sinubukan ni {name} na i-screenshot ang snap mo.'],
    pl: ['Zrzut ekranu', '{name} próbował(a) zrobić zrzut twojego snapa.'],
    fa: ['اسکرین‌شات', '{name} سعی کرد از عکس شما اسکرین‌شات بگیرد.'],
    bn: ['স্ক্রিনশট', '{name} আপনার স্ন্যাপের স্ক্রিনশট নেওয়ার চেষ্টা করেছে।'],
    so: ['Sawir shaashad', '{name} wuxuu isku dayay inuu sawir shaashadeed ka qaado sawirkaaga.'],
  },
};

function message(kind, lang, name) {
  const set = T[kind];
  const [title, body] = set[lang] || set.en;
  return { title, body: body.replace('{name}', name || '') };
}

// kind: 'challenged' | 'accepted' | 'snap' | 'screenshot'; data: small strings for the app (where to open)
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
