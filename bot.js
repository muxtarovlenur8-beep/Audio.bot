require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
const ytdl = require('@distube/ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// ─── DATABASE SETUP ───────────────────────────────────────────
async function setupDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      downloads INTEGER DEFAULT 0,
      joined_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS downloads (
      id SERIAL PRIMARY KEY,
      user_id BIGINT,
      video_title TEXT,
      video_url TEXT,
      format TEXT DEFAULT 'mp3',
      downloaded_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ Database tayyor');
}
setupDB().catch(console.error);

// ─── HELPERS ──────────────────────────────────────────────────
function isYouTubeURL(url) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w\-]+/.test(url);
}

async function saveUser(msg) {
  try {
    await pool.query(
      `INSERT INTO users (telegram_id, username, first_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (telegram_id) DO UPDATE
       SET username = EXCLUDED.username, first_name = EXCLUDED.first_name`,
      [msg.from.id, msg.from.username || '', msg.from.first_name || '']
    );
  } catch (e) {}
}

async function incrementDownload(userId, title, url) {
  try {
    await pool.query(`UPDATE users SET downloads = downloads + 1 WHERE telegram_id = $1`, [userId]);
    await pool.query(
      `INSERT INTO downloads (user_id, video_title, video_url) VALUES ($1, $2, $3)`,
      [userId, title, url]
    );
  } catch (e) {}
}

// ─── /start ──────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  await saveUser(msg);
  const name = msg.from.first_name || 'Do\'st';
  
  const welcome = 
`🎵 *Xush kelibsiz, ${name}!*

Men YouTube videolarni tez va sifatli audio faylga aylantirib beraman.

━━━━━━━━━━━━━━━━━
📌 *Qanday ishlatish:*
1️⃣ YouTube havolasini yuboring
2️⃣ Format tanlang (MP3 yoki M4A)
3️⃣ Audio tayyor! 🎧
━━━━━━━━━━━━━━━━━

⚡ *Tez* • 🎯 *Sifatli* • 🔒 *Xavfsiz*`;

  await bot.sendMessage(msg.chat.id, welcome, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📖 Yordam', callback_data: 'help' },
          { text: '📊 Statistika', callback_data: 'stats' }
        ],
        [
          { text: '⭐ Kanal', url: 'https://t.me/' }
        ]
      ]
    }
  });
});

// ─── /help ────────────────────────────────────────────────────
bot.onText(/\/help/, async (msg) => {
  const helpText =
`📖 *Yordam*

*Qo'llab-quvvatlanadigan havolalar:*
• youtube.com/watch?v=...
• youtu.be/...
• youtube.com/shorts/...

*Formatlar:*
🎵 *MP3* — Keng qo'llab-quvvatlanadigan format
🎼 *M4A* — Yuqori sifatli format

*Buyruqlar:*
/start — Boshlanish
/help — Yordam
/stats — Statistika
/profile — Profilingiz

❓ Muammo bo'lsa: Havolani to'g'ri ko'chirganingizni tekshiring`;

  await bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
});

// ─── /stats ───────────────────────────────────────────────────
bot.onText(/\/stats/, async (msg) => {
  try {
    const total = await pool.query(`SELECT COUNT(*) FROM users`);
    const totalDl = await pool.query(`SELECT COUNT(*) FROM downloads`);
    const todayDl = await pool.query(
      `SELECT COUNT(*) FROM downloads WHERE downloaded_at > NOW() - INTERVAL '24 hours'`
    );

    const statsText =
`📊 *Bot Statistikasi*

👥 Jami foydalanuvchilar: *${total.rows[0].count}*
🎵 Jami yuklab olishlar: *${totalDl.rows[0].count}*
⚡ Bugungi yuklab olishlar: *${todayDl.rows[0].count}*

🤖 Bot ishlayapti ✅`;

    await bot.sendMessage(msg.chat.id, statsText, { parse_mode: 'Markdown' });
  } catch (e) {
    await bot.sendMessage(msg.chat.id, '📊 Statistika yuklanmadi');
  }
});

// ─── /profile ─────────────────────────────────────────────────
bot.onText(/\/profile/, async (msg) => {
  await saveUser(msg);
  try {
    const user = await pool.query(
      `SELECT * FROM users WHERE telegram_id = $1`, [msg.from.id]
    );
    if (user.rows.length === 0) return;
    const u = user.rows[0];
    const profileText =
`👤 *Profilingiz*

🆔 ID: \`${u.telegram_id}\`
👋 Ism: ${u.first_name || '—'}
📛 Username: ${u.username ? '@' + u.username : '—'}
🎵 Yuklab olishlar: *${u.downloads}*
📅 Qo'shilgan: ${new Date(u.joined_at).toLocaleDateString('uz-UZ')}`;

    await bot.sendMessage(msg.chat.id, profileText, { parse_mode: 'Markdown' });
  } catch (e) {
    await bot.sendMessage(msg.chat.id, '❌ Profil yuklanmadi');
  }
});

// ─── CALLBACK BUTTONS ─────────────────────────────────────────
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data === 'help') {
    bot.emit('text', { ...query.message, text: '/help', from: query.from });
  }
  if (data === 'stats') {
    bot.emit('text', { ...query.message, text: '/stats', from: query.from });
  }

  // Format tanlash
  if (data.startsWith('format_')) {
    const parts = data.split('_');
    const format = parts[1]; // mp3 yoki m4a
    const url = parts.slice(2).join('_');

    await bot.answerCallbackQuery(query.id, { text: `${format.toUpperCase()} yuklanmoqda...` });
    await bot.editMessageText(
      `⏳ *Yuklanmoqda...*\n\nFormat: *${format.toUpperCase()}*\nIltimos kuting...`,
      { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
    );

    await downloadAudio(chatId, url, format, query.message.message_id);
  }

  if (data === 'cancel') {
    await bot.editMessageText('❌ Bekor qilindi.', {
      chat_id: chatId,
      message_id: query.message.message_id
    });
  }
});

// ─── YOUTUBE URL HANDLER ──────────────────────────────────────
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  await saveUser(msg);

  const url = msg.text.trim();
  if (!isYouTubeURL(url)) {
    return bot.sendMessage(msg.chat.id,
      '❌ *Noto\'g\'ri havola!*\n\nYouTube havolasini yuboring.\n\nMisol: `https://youtu.be/xxxxx`',
      { parse_mode: 'Markdown' }
    );
  }

  const loadMsg = await bot.sendMessage(msg.chat.id, '🔍 *Video ma\'lumotlari yuklanmoqda...*', {
    parse_mode: 'Markdown'
  });

  try {
    const info = await ytdl.getInfo(url);
    const title = info.videoDetails.title;
    const duration = parseInt(info.videoDetails.lengthSeconds);
    const author = info.videoDetails.author.name;
    const thumb = info.videoDetails.thumbnails.slice(-1)[0]?.url;

    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    const durationStr = `${mins}:${secs.toString().padStart(2, '0')}`;

    const caption =
`🎬 *${title}*

👤 ${author}
⏱ Davomiyligi: ${durationStr}

🎵 *Format tanlang:*`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🎵 MP3 (Tavsiya)', callback_data: `format_mp3_${url}` },
          { text: '🎼 M4A (Sifatli)', callback_data: `format_m4a_${url}` }
        ],
        [
          { text: '❌ Bekor qilish', callback_data: 'cancel' }
        ]
      ]
    };

    await bot.deleteMessage(msg.chat.id, loadMsg.message_id);

    if (thumb) {
      await bot.sendPhoto(msg.chat.id, thumb, {
        caption,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } else {
      await bot.sendMessage(msg.chat.id, caption, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    }
  } catch (e) {
    console.error('Info error:', e.message);
    await bot.editMessageText(
      '❌ *Video topilmadi!*\n\nHavola noto\'g\'ri yoki video mavjud emas.',
      { chat_id: msg.chat.id, message_id: loadMsg.message_id, parse_mode: 'Markdown' }
    );
  }
});

// ─── DOWNLOAD & SEND AUDIO ────────────────────────────────────
async function downloadAudio(chatId, url, format, editMsgId) {
  const tmpFile = path.join('/tmp', `audio_${Date.now()}`);
  const outFile = `${tmpFile}.${format}`;

  try {
    const info = await ytdl.getInfo(url);
    const title = info.videoDetails.title.replace(/[^\w\s]/gi, '').trim().substring(0, 60);
    const author = info.videoDetails.author.name;

    await new Promise((resolve, reject) => {
      const stream = ytdl(url, { quality: 'highestaudio', filter: 'audioonly' });

      const cmd = ffmpeg(stream)
        .audioBitrate(320)
        .toFormat(format === 'mp3' ? 'mp3' : 'ipod')
        .audioCodec(format === 'mp3' ? 'libmp3lame' : 'aac')
        .on('end', resolve)
        .on('error', reject)
        .save(outFile);
    });

    const stats = fs.statSync(outFile);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);

    if (editMsgId) {
      await bot.editMessageText(
        `📤 *Yuborilmoqda...*\n\n📁 Hajm: ${sizeMB} MB`,
        { chat_id: chatId, message_id: editMsgId, parse_mode: 'Markdown' }
      );
    }

    await bot.sendAudio(chatId, outFile, {
      title: title,
      performer: author,
      caption: `🎵 *${title}*\n👤 ${author}\n\n✅ Sifat: 320kbps ${format.toUpperCase()}`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🔄 Boshqa video', callback_data: 'new' },
          { text: '📊 Statistika', callback_data: 'stats' }
        ]]
      }
    });

    await incrementDownload(chatId, title, url);

    if (editMsgId) {
      await bot.deleteMessage(chatId, editMsgId).catch(() => {});
    }

  } catch (e) {
    console.error('Download error:', e.message);
    const errMsg = e.message.includes('age') ? 
      '🔞 Bu video yosh cheklovi bor.' :
      e.message.includes('private') ?
      '🔒 Bu video yopiq.' :
      '❌ Yuklab olishda xato. Boshqa video sinab ko\'ring.';

    if (editMsgId) {
      await bot.editMessageText(errMsg, { chat_id: chatId, message_id: editMsgId });
    } else {
      await bot.sendMessage(chatId, errMsg);
    }
  } finally {
    if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

console.log('🤖 Audio Bot ishga tushdi...');
