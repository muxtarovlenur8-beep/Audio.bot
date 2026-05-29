const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(token, { polling: true });

const userLinks = {};

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
        `👋 Salom!\n\nYouTube link tashlang.`);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    if (text.includes('youtube.com') || text.includes('youtu.be')) {
        userLinks[chatId] = text;

        bot.sendMessage(chatId,
            '🎬 Formatni tanlang:',
            {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🎵 Audio', callback_data: 'audio' }
                        ],
                        [
                            { text: '📹 480p', callback_data: '480' },
                            { text: '📹 720p', callback_data: '720' }
                        ]
                    ]
                }
            }
        );
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    const url = userLinks[chatId];

    if (!url) {
        return bot.sendMessage(chatId, '❌ Link topilmadi');
    }

    try {
        bot.sendMessage(chatId, '⏳ Yuklanmoqda...');

        if (data === 'audio') {

            const api = `https://api.vevioz.com/api/button/mp3?url=${encodeURIComponent(url)}`;

            bot.sendMessage(chatId,
                `🎵 Audio yuklash:\n${api}`
            );

        } else {

            const api = `https://api.vevioz.com/api/button/videos?url=${encodeURIComponent(url)}`;

            bot.sendMessage(chatId,
                `🎬 ${data} video yuklash:\n${api}`
            );

        }

    } catch (error) {
        console.log(error);
        bot.sendMessage(chatId, '❌ Xatolik yuz berdi');
    }
});

console.log('Bot ishga tushdi...');