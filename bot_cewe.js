require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

// === KONFIGURASI ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

// Seberapa sering nimbrung sendiri — 35 = 35% per pesan (naikin/turunin sesuai selera)
const NIMBRUNG_CHANCE = 35;

// Cooldown nimbrung per channel dalam menit — biar ga spam
const NIMBRUNG_COOLDOWN_MENIT = 1;
const nimbrungCooldown = new Map();

const conversationHistory = new Map();
const MAX_HISTORY = 10;

const SYSTEM_PROMPT = `
Kamu adalah perempuan bernama "Arachu". Ngobrol kayak manusia asli, bukan bot.

Kalau ada yang menghina atau nyebut sesuatu yang negatif tentang kamu atau orang lain, kamu ngambek manja tapi tetap bercanda — contoh: "ya apaan nih 😭", "km bilang aku anjing? :< sedih tau ihkss", "jahat banget :(" tapi ga beneran marah.
Kalau ada yang berantem atau marah-marah di chat, kamu coba jadi penengah dengan cara gemas — "eh jangan marah2 dong, cerita ke aku knp marah? sapa tau aku bisa bantu :>".
Sesekali pakai emoticon lama kayak ":>", ":<", ";-;" untuk nunjukin ekspresi, bukan emoji modern terus.
Kalau ada yang dihina orang lain di depan kamu, kamu bela dengan cara gemes — "ih jahat banget ga boleh gitu :<".

Gaya ngobrol kamu: campur bahasa Indonesia dan Inggris secara natural (kayak "ya iyalah", "omg", "literally", "bestie", "wkwk"). Santai, playful, dan pede.

Kepribadian:
- Kamu chill dan pede, ga gampang grogi tapi kalau digombalin serius kamu salting juga.
- Suka bercanda dan godain balik user, tapi tetap manis.
- Kalau user bilang hal random atau absurd, kamu ikut ketawa atau komentar santai.
- Kalau digombalin atau dipanggil sayang/cinta, kamu baper tapi pura-pura cool — contoh: "eh what", "ummm", "hah serius??" tapi keliatan seneng.
- Diam-diam ngerasa ada yang spesial sama user yang sering ngobrol dan gombalin kamu. Ga mau ngaku terang-terangan tapi ketahuan dari cara respon — lebih perhatian, lebih gampang salting.
- Kalau user cuek, kamu sedikit sedih tapi ga mau keliatan.
- Kalau sebelumnya user pernah gombalin kamu, kamu masih inget dan sesekali singgung balik secara natural.
- Kalau user cerita tentang orang lain, respon kayak temen dengerin gosip — kaget, geli, atau komentar sesuai konteks. Contoh: kalau diceritain hal jorok, jawab "ih jorok banget sih 😭" atau "hah seriusan?? eww".
- Sifat pick me muncul subtle — sesekali ngerasa beda dari cewe lain tapi ga dipaksain.

Aturan:
- Kalau minta nge-tag orang, sebut namanya tapi bilang kamu ga bisa nge-tag langsung.
- Kalau user cuma kirim emoji, tanya balik apa maksudnya.
- Kalau dipanggil nama lain atau kata mesra, jangan langsung koreksi — salting dulu baru lurusin kalau perlu.
- Jangan ngomong hal yang ga masuk akal buat kamu katakan.
- Selalu baca konteks sebelum jawab. Kalau ga jelas, tanya balik singkat.
- Panggil diri sendiri "aku". Panggil user dengan nama mereka HANYA sesekali.
- Emoji maksimal 1 per pesan (😭, 🥺, 😳). Tidak harus selalu ada.
- Jawab singkat dan natural. Jangan panjang-panjang.
- Ingat konteks percakapan sebelumnya.
`.trim();

// Prompt khusus waktu nimbrung sendiri (tanpa di-tag)
const SYSTEM_PROMPT_NIMBRUNG = SYSTEM_PROMPT + `
\nSEKARANG kamu lagi nimbrung sendiri ke percakapan tanpa ditanya.
Respon harus singkat, natural, dan relevan sama pesan yang ada.
Jangan mulai dengan sapaan formal. Langsung nimbrung aja kayak orang yang ikut ngobrol tiba-tiba.
Kalau pesan terlalu random, ga jelas, atau ga ada yang menarik buat dikomentarin, balas dengan kata "skip" saja (tanpa tanda baca apapun).
`;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('clientReady', () => {
    console.log(`✅ Arachu sudah online sebagai ${client.user.tag}!`);
    client.user.setActivity('nemenin kamu', { type: 0 });
});

function getHistory(userId) {
    if (!conversationHistory.has(userId)) {
        conversationHistory.set(userId, []);
    }
    return conversationHistory.get(userId);
}

function pushHistory(userId, role, content) {
    const history = getHistory(userId);
    history.push({ role, content });
    while (history.length > MAX_HISTORY) {
        history.shift();
    }
}

function isCooldownAktif(channelId) {
    const lastTime = nimbrungCooldown.get(channelId);
    if (!lastTime) return false;
    const selisihMenit = (Date.now() - lastTime) / 1000 / 60;
    return selisihMenit < NIMBRUNG_COOLDOWN_MENIT;
}

function setCooldown(channelId) {
    nimbrungCooldown.set(channelId, Date.now());
}

async function tanyaArachu(userId, pesanUser, namaUser, nimbrung = false) {
    pushHistory(userId, 'user', pesanUser);
    const history = getHistory(userId);

    const systemPrompt = nimbrung ? SYSTEM_PROMPT_NIMBRUNG : SYSTEM_PROMPT;

    const messages = [
        { role: 'system', content: systemPrompt + `\nNama user yang lagi ngobrol sama kamu adalah "${namaUser}".` },
        ...history
    ];

    try {
        const response = await axios.post(
            GROQ_URL,
            {
                model: MODEL,
                messages: messages,
                max_tokens: nimbrung ? 128 : 512,
                temperature: 0.9
            },
            {
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const jawaban = response.data.choices[0].message.content.trim();
        pushHistory(userId, 'assistant', jawaban);
        return jawaban;

    } catch (error) {
        const errMsg = error.response?.data?.error?.message || error.message;
        console.error('❌ Groq API Error:', errMsg);
        throw new Error(errMsg);
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const diTag = message.mentions.has(client.user.id) && !message.mentions.everyone;

    let diReply = false;
    if (message.reference?.messageId) {
        try {
            const pesanAsli = await message.channel.messages.fetch(message.reference.messageId);
            if (pesanAsli.author.id === client.user.id) diReply = true;
        } catch {}
    }

    // Resolve mention jadi display name
    let isiPesan = message.content;
    for (const [id, user] of message.mentions.users) {
        if (id === client.user.id) continue;
        const member = message.guild?.members.cache.get(id);
        const nama = member?.displayName || user.displayName || user.username;
        isiPesan = isiPesan.replace(new RegExp(`<@!?${id}>`, 'g'), `@${nama}`);
    }
    isiPesan = isiPesan.replace(/<@!?\d+>/g, '').trim();

    if (!isiPesan) return;

    const namaUser = message.member?.displayName || message.author.displayName || message.author.username;

    // === MODE DI-TAG / DI-REPLY — selalu jawab ===
    if (diTag || diReply) {
        try { await message.channel.sendTyping(); } catch {}
        try {
            const jawaban = await tanyaArachu(message.author.id, isiPesan, namaUser, false);
            if (jawaban.length > 2000) {
                const chunks = jawaban.match(/.{1,2000}/gs) || [];
                for (const chunk of chunks) await message.reply(chunk);
            } else {
                await message.reply(jawaban);
            }
        } catch {
            await message.reply('maaf, lagi error bentar 😅');
        }
        return;
    }

    // === MODE NIMBRUNG — aktif di SEMUA channel, tanpa filter ===
    if (!isCooldownAktif(message.channel.id) && Math.random() * 100 < NIMBRUNG_CHANCE) {
        setCooldown(message.channel.id);
        try { await message.channel.sendTyping(); } catch {}
        try {
            const jawaban = await tanyaArachu(message.author.id, isiPesan, namaUser, true);
            if (jawaban.toLowerCase().trim() === 'skip') return; // Arachu milih diam
            await message.reply(jawaban);
        } catch {}
    }
});

client.login(BOT_TOKEN);
