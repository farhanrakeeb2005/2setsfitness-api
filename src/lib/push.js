// Push notifications to a player's phones (Firebase Cloud Messaging), for
// challenges: "X challenged you", "X accepted", the result (with any
// forfeit owed), and the forfeit paid or asked for. The app registers each
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
  won: {
    en: ["You won!", "You beat {name} in your challenge."],
    ar: ["لقد فزت!", "تغلبت على {name} في التحدي."],
    ur: ["آپ جیت گئے!", "آپ نے چیلنج میں {name} کو ہرا دیا۔"],
    es: ["¡Has ganado!", "Has vencido a {name} en el reto."],
    fr: ["Vous avez gagné !", "Vous avez battu {name} dans le défi."],
    pt: ["Ganhou!", "Venceu {name} no desafio."],
    tr: ["Kazandın!", "Meydan okumada {name} kişisini yendin."],
    de: ["Gewonnen!", "Du hast {name} in der Herausforderung geschlagen."],
    it: ["Hai vinto!", "Hai battuto {name} nella sfida."],
    nl: ["Gewonnen!", "Je hebt {name} verslagen in de uitdaging."],
    ru: ["Победа!", "Вы обошли {name} в вызове."],
    hi: ["आप जीत गए!", "आपने चुनौती में {name} को हरा दिया।"],
    ja: ["勝利！", "チャレンジで{name}さんに勝ちました。"],
    kr: ["승리!", "도전에서 {name}님을 이겼어요."],
    vi: ["Bạn đã thắng!", "Bạn đã thắng {name} trong thử thách."],
    th: ["คุณชนะ!", "คุณชนะ {name} ในคำท้า"],
    sw: ["Umeshinda!", "Umemshinda {name} kwenye changamoto."],
    "zh-CN": ["你赢了！", "你在挑战中赢了 {name}。"],
    ms: ["Anda menang!", "Anda mengalahkan {name} dalam cabaran."],
    id: ["Kamu menang!", "Kamu mengalahkan {name} dalam tantangan."],
    tl: ["Panalo ka!", "Tinalo mo si {name} sa hamon."],
    pl: ["Wygrana!", "Pokonujesz {name} w wyzwaniu."],
    fa: ["برنده شدی!", "در چالش {name} را شکست دادی."],
    bn: ["আপনি জিতেছেন!", "চ্যালেঞ্জে আপনি {name}-কে হারিয়েছেন।"],
    so: ["Waad guulaysatay!", "Waxaad ka adkaatay {name} loolanka."],
  },
  lost: {
    en: ["Challenge over", "{name} won this one."],
    ar: ["انتهى التحدي", "فاز {name} هذه المرة."],
    ur: ["چیلنج ختم", "اس بار {name} جیت گئے۔"],
    es: ["Reto terminado", "{name} ha ganado esta vez."],
    fr: ["Défi terminé", "{name} a gagné cette fois."],
    pt: ["Desafio terminado", "{name} ganhou desta vez."],
    tr: ["Meydan okuma bitti", "Bu sefer {name} kazandı."],
    de: ["Herausforderung vorbei", "Diesmal hat {name} gewonnen."],
    it: ["Sfida finita", "Questa volta ha vinto {name}."],
    nl: ["Uitdaging voorbij", "Deze keer won {name}."],
    ru: ["Вызов окончен", "На этот раз победил(а) {name}."],
    hi: ["चुनौती खत्म", "इस बार {name} जीते।"],
    ja: ["チャレンジ終了", "今回は{name}さんの勝ちです。"],
    kr: ["도전 종료", "이번에는 {name}님이 이겼어요."],
    vi: ["Thử thách kết thúc", "Lần này {name} thắng."],
    th: ["คำท้าจบแล้ว", "รอบนี้ {name} ชนะ"],
    sw: ["Changamoto imeisha", "Safari hii {name} ameshinda."],
    "zh-CN": ["挑战结束", "这次 {name} 赢了。"],
    ms: ["Cabaran tamat", "Kali ini {name} menang."],
    id: ["Tantangan selesai", "Kali ini {name} menang."],
    tl: ["Tapos na ang hamon", "Si {name} ang nanalo ngayon."],
    pl: ["Koniec wyzwania", "Tym razem wygrywa {name}."],
    fa: ["چالش تمام شد", "این بار {name} برنده شد."],
    bn: ["চ্যালেঞ্জ শেষ", "এবার {name} জিতেছে।"],
    so: ["Loolanku waa dhammaaday", "Markan {name} ayaa guulaystay."],
  },
  draw: {
    en: ["It's a draw", "You and {name} finished level."],
    ar: ["تعادل", "أنهيت أنت و{name} بالتساوي."],
    ur: ["برابر", "آپ اور {name} برابر رہے۔"],
    es: ["Empate", "Tú y {name} habéis terminado igualados."],
    fr: ["Égalité", "{name} et vous finissez à égalité."],
    pt: ["Empate", "Você e {name} terminaram empatados."],
    tr: ["Berabere", "{name} ile berabere bitirdiniz."],
    de: ["Unentschieden", "Du und {name} seid gleichauf."],
    it: ["Pareggio", "Tu e {name} avete chiuso in parità."],
    nl: ["Gelijkspel", "Jij en {name} eindigen gelijk."],
    ru: ["Ничья", "Вы и {name} закончили вровень."],
    hi: ["बराबरी", "आप और {name} बराबर रहे।"],
    ja: ["引き分け", "{name}さんと引き分けでした。"],
    kr: ["무승부", "{name}님과 동점으로 끝났어요."],
    vi: ["Hòa", "Bạn và {name} hòa nhau."],
    th: ["เสมอ", "คุณกับ {name} จบเสมอกัน"],
    sw: ["Sare", "Wewe na {name} mmetoka sare."],
    "zh-CN": ["平局", "你和 {name} 打成平手。"],
    ms: ["Seri", "Anda dan {name} seri."],
    id: ["Seri", "Kamu dan {name} imbang."],
    tl: ["Tabla", "Tabla kayo ni {name}."],
    pl: ["Remis", "Ty i {name} kończycie na remis."],
    fa: ["مساوی", "تو و {name} مساوی شدید."],
    bn: ["ড্র", "আপনি ও {name} সমান শেষ করেছেন।"],
    so: ["Barbaro", "Adiga iyo {name} waad isku dhammaateen."],
  },
  forfeitDone: {
    en: ["Forfeit paid", "{name} has done the forfeit: {f}"],
    ar: ["تم تنفيذ العقوبة", "نفّذ {name} العقوبة: {f}"],
    ur: ["سزا پوری", "{name} نے سزا پوری کر دی: {f}"],
    es: ["Prenda cumplida", "{name} ha cumplido la prenda: {f}"],
    fr: ["Gage payé", "{name} a fait son gage : {f}"],
    pt: ["Castigo cumprido", "{name} cumpriu o castigo: {f}"],
    tr: ["Ceza ödendi", "{name} cezasını yerine getirdi: {f}"],
    de: ["Wetteinsatz erledigt", "{name} hat den Einsatz eingelöst: {f}"],
    it: ["Penitenza fatta", "{name} ha fatto la penitenza: {f}"],
    nl: ["Straf betaald", "{name} heeft de straf gedaan: {f}"],
    ru: ["Фант выполнен", "{name} выполнил(а) фант: {f}"],
    hi: ["सज़ा पूरी", "{name} ने सज़ा पूरी कर दी: {f}"],
    ja: ["罰ゲーム完了", "{name}さんが罰ゲームを済ませました：{f}"],
    kr: ["벌칙 완료", "{name}님이 벌칙을 했어요: {f}"],
    vi: ["Đã chịu phạt", "{name} đã thực hiện hình phạt: {f}"],
    th: ["ทำบทลงโทษแล้ว", "{name} ทำบทลงโทษแล้ว: {f}"],
    sw: ["Adhabu imelipwa", "{name} amefanya adhabu: {f}"],
    "zh-CN": ["惩罚已完成", "{name} 已完成惩罚：{f}"],
    ms: ["Denda dibayar", "{name} telah menunaikan denda: {f}"],
    id: ["Hukuman dibayar", "{name} sudah menjalankan hukuman: {f}"],
    tl: ["Bayad na ang parusa", "Ginawa na ni {name} ang parusa: {f}"],
    pl: ["Fant spłacony", "{name} wykonuje fant: {f}"],
    fa: ["جریمه انجام شد", "{name} جریمه را انجام داد: {f}"],
    bn: ["শাস্তি পূরণ", "{name} শাস্তি পূরণ করেছে: {f}"],
    so: ["Ganaaxa waa la bixiyay", "{name} ayaa sameeyay ganaaxa: {f}"],
  },
  forfeitNudge: {
    en: ["Forfeit reminder", "{name} is waiting for your forfeit: {f}"],
    ar: ["تذكير بالعقوبة", "{name} ينتظر عقوبتك: {f}"],
    ur: ["سزا کی یاد دہانی", "{name} آپ کی سزا کا انتظار کر رہے ہیں: {f}"],
    es: ["Recordatorio de prenda", "{name} espera tu prenda: {f}"],
    fr: ["Rappel de gage", "{name} attend ton gage : {f}"],
    pt: ["Lembrete de castigo", "{name} está à espera do teu castigo: {f}"],
    tr: ["Ceza hatırlatması", "{name} cezanı bekliyor: {f}"],
    de: ["Erinnerung an den Einsatz", "{name} wartet auf deinen Einsatz: {f}"],
    it: ["Promemoria penitenza", "{name} aspetta la tua penitenza: {f}"],
    nl: ["Herinnering straf", "{name} wacht op je straf: {f}"],
    ru: ["Напоминание о фанте", "{name} ждёт ваш фант: {f}"],
    hi: ["सज़ा की याद", "{name} आपकी सज़ा का इंतज़ार कर रहे हैं: {f}"],
    ja: ["罰ゲームのお知らせ", "{name}さんが罰ゲームを待っています：{f}"],
    kr: ["벌칙 알림", "{name}님이 벌칙을 기다리고 있어요: {f}"],
    vi: ["Nhắc hình phạt", "{name} đang chờ bạn chịu phạt: {f}"],
    th: ["เตือนบทลงโทษ", "{name} รอบทลงโทษของคุณอยู่: {f}"],
    sw: ["Kumbusho la adhabu", "{name} anasubiri adhabu yako: {f}"],
    "zh-CN": ["惩罚提醒", "{name} 在等你完成惩罚：{f}"],
    ms: ["Peringatan denda", "{name} menunggu denda anda: {f}"],
    id: ["Pengingat hukuman", "{name} menunggu hukumanmu: {f}"],
    tl: ["Paalala sa parusa", "Hinihintay ni {name} ang parusa mo: {f}"],
    pl: ["Przypomnienie o fancie", "{name} czeka na twój fant: {f}"],
    fa: ["یادآوری جریمه", "{name} منتظر جریمه‌ات است: {f}"],
    bn: ["শাস্তির কথা মনে করিয়ে দেওয়া", "{name} আপনার শাস্তির অপেক্ষায়: {f}"],
    so: ["Xusuusin ganaax", "{name} ayaa sugaya ganaaxaaga: {f}"],
  },
};

// what a challenge's loser owes, after the result ({f}: the forfeit)
const OWE = {
  theyOwe: { en: "They owe you: {f}", ar: "عليه لك: {f}", ur: "ان پر آپ کا حق: {f}", es: "Te deben: {f}", fr: "On vous doit : {f}", pt: "Devem-lhe: {f}", tr: "Sana borçlu: {f}", de: "Dir geschuldet: {f}", it: "Ti devono: {f}", nl: "Ze zijn je verschuldigd: {f}", ru: "Вам должны: {f}", hi: "आपका बकाया: {f}", ja: "相手の罰ゲーム：{f}", kr: "상대 벌칙: {f}", vi: "Họ nợ bạn: {f}", th: "อีกฝ่ายติดคุณ: {f}", sw: "Wanakudai: {f}", "zh-CN": "对方欠你：{f}", ms: "Mereka berhutang: {f}", id: "Mereka berutang: {f}", tl: "Utang nila sa iyo: {f}", pl: "Należy ci się: {f}", fa: "بدهکار توست: {f}", bn: "আপনার পাওনা: {f}", so: "Waxaa kuu deyn ah: {f}" },
  youOwe: { en: "You owe: {f}", ar: "عليك: {f}", ur: "آپ پر واجب: {f}", es: "Debes: {f}", fr: "Vous devez : {f}", pt: "Deve: {f}", tr: "Borcun: {f}", de: "Du schuldest: {f}", it: "Devi: {f}", nl: "Je bent verschuldigd: {f}", ru: "Вы должны: {f}", hi: "आप पर बकाया: {f}", ja: "あなたの罰ゲーム：{f}", kr: "내 벌칙: {f}", vi: "Bạn nợ: {f}", th: "คุณติด: {f}", sw: "Unadaiwa: {f}", "zh-CN": "你欠：{f}", ms: "Anda berhutang: {f}", id: "Kamu berutang: {f}", tl: "Utang mo: {f}", pl: "Jesteś winien: {f}", fa: "بدهکاری: {f}", bn: "আপনার দেনা: {f}", so: "Waxaa lagugu leeyahay: {f}" },
};

// f: the forfeit (the result names what's owed; a forfeit message quotes it)
function message(kind, lang, name, f) {
  const set = T[kind];
  const [title, body] = set[lang] || set.en;
  let text = body.replace('{name}', name || '').replace('{f}', f || '');
  if (f && (kind === 'won' || kind === 'lost')) {
    const owe = OWE[kind === 'won' ? 'theyOwe' : 'youOwe'];
    text += ' ' + (owe[lang] || owe.en).replace('{f}', f);
  }
  return { title, body: text };
}

// kind: 'challenged' | 'accepted' | 'won' | 'lost' | 'draw' | 'forfeitDone' | 'forfeitNudge';
// data: small strings for the app (where to open)
async function notifyUser(userId, kind, { name, forfeit, data = {} } = {}) {
  try {
    const { rows } = await pool.query('SELECT token, lang FROM push_tokens WHERE user_id = $1', [userId]);
    if (!rows.length) return;
    const { getMessaging } = require('firebase-admin/messaging');
    const messaging = getMessaging();
    await Promise.all(rows.map(async ({ token, lang }) => {
      const { title, body } = message(kind, lang, name, forfeit);
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
