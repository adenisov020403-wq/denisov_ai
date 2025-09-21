const { Bot } = require('grammy');
const { Pool } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

// Подключение к базе данных
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
const userChats = new Map();

// Функция для нормализации номера телефона
function normalizePhone(phone) {
    if (!phone) return null;
    // Удаляем все нецифровые символы
    const digits = phone.replace(/\D/g, '');
    // Если номер начинается с 8, заменяем на +7
    if (digits.startsWith('8') && digits.length === 11) {
        return '+7' + digits.substring(1);
    }
    return '+' + digits;
}
// Функция для форматирования времени (добавьте эту новую функцию)
function formatTime(timeString) {
    if (!timeString) return '';
    return timeString.split(':').slice(0, 2).join(':');
}

function formatDate(dateString) {
    const months = [
        'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
        'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
    ];
    
    const date = new Date(dateString);
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    
    return `${day} ${month} ${year}`;
}

// Команда для старта бота
bot.command('start', async (ctx) => {
    const token = ctx.match;
    if (!token) {
        return ctx.reply('Пожалуйста, используйте ссылку из личного кабинета для привязки Telegram аккаунта.');
    }

    try {
        // Проверяем токен в базе данных
        const result = await pool.query(
            `SELECT 
                u.id, 
                u.role,
                u.phone_number,
                CASE 
                    WHEN u.role = 'master' THEN m.telegram_chat_id
                    WHEN u.role = 'cadet' THEN c.telegram_chat_id
                END as telegram_chat_id
             FROM (
                 SELECT id, 'master' as role, phone_number FROM Masters WHERE telegram_token = $1
                 UNION
                 SELECT id, 'cadet' as role, phone_number FROM Cadets WHERE telegram_token = $1
             ) u
             LEFT JOIN Masters m ON u.role = 'master' AND u.id = m.id
             LEFT JOIN Cadets c ON u.role = 'cadet' AND u.id = c.id
             WHERE (
                 (u.role = 'master' AND m.telegram_chat_id IS NULL) OR
                 (u.role = 'cadet' AND c.telegram_chat_id IS NULL)
             )`,
            [token]
        );

        if (result.rows.length === 0) {
            return ctx.reply('Неверный или устаревший токен. Пожалуйста, получите новый токен в личном кабинете.');
        }

        const user = result.rows[0];
        const chatId = ctx.chat.id;

        // Сохраняем chat_id в базу данных
        const updateQuery = user.role === 'master' 
            ? 'UPDATE Masters SET telegram_chat_id = $1, telegram_token = NULL WHERE id = $2'
            : 'UPDATE Cadets SET telegram_chat_id = $1, telegram_token = NULL WHERE id = $2';
        
        await pool.query(updateQuery, [chatId, user.id]);

        // Сохраняем в памяти
        userChats.set(user.id, chatId);

        ctx.reply(`Ваш Telegram аккаунт успешно привязан к номеру ${normalizePhone(user.phone_number)}! Вы будете получать уведомления о занятиях.`);
    } catch (err) {
        console.error('Ошибка при привязке Telegram:', err);
        ctx.reply('Произошла ошибка при привязке аккаунта. Пожалуйста, попробуйте позже.');
    }
});

// Функция для отправки уведомления пользователю
async function sendNotification(userId, role, message) {
    try {
        let chatId = userChats.get(userId);
        
        if (!chatId) {
            const query = role === 'master' 
                ? 'SELECT telegram_chat_id FROM Masters WHERE id = $1 AND telegram_chat_id IS NOT NULL'
                : 'SELECT telegram_chat_id FROM Cadets WHERE id = $1 AND telegram_chat_id IS NOT NULL';
            
            const result = await pool.query(query, [userId]);
            
            if (result.rows.length > 0) {
                chatId = result.rows[0].telegram_chat_id;
                userChats.set(userId, chatId);
            }
        }
        
        if (chatId) {
            await bot.api.sendMessage(chatId, message);
            return true;
        }
        
        return false;
    } catch (err) {
        console.error('Ошибка при отправке уведомления:', err);
        return false;
    }
}

// Проверка предстоящих занятий
async function checkUpcomingSessions() {
    try {
        const now = new Date();
        const oneHourLater = new Date(now.getTime() + 60 * 60000);
        
        const result = await pool.query(
            `SELECT 
                ds.id,
                ds.session_date,
                ds.session_time,
                c.id as cadet_id,
                c.last_name as cadet_last_name,
                c.first_name as cadet_first_name,
                m.id as master_id,
                m.last_name as master_last_name,
                m.first_name as master_first_name
             FROM DrivingSessions ds
             LEFT JOIN Cadets c ON ds.cadet_id = c.id
             LEFT JOIN Masters m ON ds.master_id = m.id
             WHERE ds.status = 'booked'
             AND ds.session_date = $1
             AND ds.session_time BETWEEN $2 AND $3`,
            [
                now.toISOString().split('T')[0],
                now.toTimeString().substr(0, 8),
                oneHourLater.toTimeString().substr(0, 8)
            ]
        );
        
        for (const session of result.rows) {
            if (session.cadet_id) {
                await sendNotification(
                    session.cadet_id,
                    'cadet',
                    `🔔 Напоминание: занятие с ${session.master_last_name} ${session.master_first_name} начнётся через час (${session.session_time})`
                );
            }
            
            if (session.master_id) {
                await sendNotification(
                    session.master_id,
                    'master',
                    `🔔 Напоминание: занятие с ${session.cadet_last_name} ${session.cadet_first_name} начнётся через час (${session.session_time})`
                );
            }
        }
    } catch (err) {
        console.error('Ошибка при проверке предстоящих занятий:', err);
    }
}

setInterval(checkUpcomingSessions, 5 * 60 * 1000);
bot.start();
console.log('Telegram бот запущен');

module.exports = {
    sendNotification,
    bot
};