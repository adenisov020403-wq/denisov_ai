const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const dotenv = require('dotenv');
const ExcelJS = require('exceljs');
const { sendNotification } = require('./telegramBot');



dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

// Подключение к PostgreSQL
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
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
// Маршрут для авторизации
app.post('/api/login', async (req, res) => {
    const { phone, password } = req.body;
    
    // Базовая валидация
    if (!phone || !password) {
        return res.status(400).json({ error: 'Телефон и пароль обязательны' });
    }

    try {
        // Проверяем администратора
        const admin = await pool.query('SELECT * FROM Admin WHERE phone_number = $1 AND password = $2', [phone, password]);
        if (admin.rows.length > 0) {
            return res.json({ role: 'admin', user: admin.rows[0] });
        }

        // Проверяем мастера
        const master = await pool.query('SELECT * FROM Masters WHERE phone_number = $1 AND password = $2', [phone, password]);
        if (master.rows.length > 0) {
            return res.json({ 
                role: 'master', 
                user: {
                    id: master.rows[0].id,
                    last_name: master.rows[0].last_name,
                    first_name: master.rows[0].first_name,
                    middle_name: master.rows[0].middle_name,
                    phone_number: master.rows[0].phone_number
                } 
            });
        }

        // Проверяем курсанта
        const cadet = await pool.query('SELECT * FROM Cadets WHERE phone_number = $1 AND password = $2', [phone, password]);
        if (cadet.rows.length > 0) {
            return res.json({ 
                role: 'cadet', 
                user: {
                    id: cadet.rows[0].id,
                    last_name: cadet.rows[0].last_name,
                    first_name: cadet.rows[0].first_name,
                    middle_name: cadet.rows[0].middle_name,
                    phone_number: cadet.rows[0].phone_number,
                    driving_hours: cadet.rows[0].driving_hours,
                    master_id: cadet.rows[0].master_id
                }
            });
        }

        res.status(401).json({ error: 'Неверный телефон или пароль' });
    } catch (err) {
        console.error('Ошибка авторизации:', err);
        res.status(500).json({ error: 'Ошибка сервера при авторизации' });
    }
});

// Получение данных курсанта
app.get('/api/cadet', async (req, res) => {
    try {
        const { id } = req.query;
        const result = await pool.query('SELECT * FROM Cadets WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Курсант не найден' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение доступных занятий для курсанта
// Получение доступных занятий для курсанта
app.get('/api/available-sessions', async (req, res) => {
    try {
        const { cadet_id } = req.query;
        
        if (!cadet_id) {
            return res.status(400).json({ error: 'Не указан ID курсанта' });
        }

        // Получаем master_id курсанта
        const cadetData = await pool.query(
            'SELECT master_id FROM Cadets WHERE id = $1', 
            [cadet_id]
        );
        
        if (cadetData.rows.length === 0) {
            return res.status(404).json({ error: 'Курсант не найден' });
        }

        const master_id = cadetData.rows[0].master_id;

        // Получаем доступные занятия (теперь из одной таблицы DrivingSessions)
        const now = new Date();
        const result = await pool.query(
            `SELECT 
                id,
                session_date,
                session_time,
                status,
                to_char(session_date, 'YYYY-MM-DD') as date_str,
                to_char(session_date, 'Day') as day_name
             FROM DrivingSessions
             WHERE master_id = $1
             AND (status = 'free' OR (status = 'booked' AND cadet_id = $2))
             AND (
                 session_date > CURRENT_DATE OR
                 (session_date = CURRENT_DATE AND 
                  session_time >= (CURRENT_TIME + INTERVAL '15 minutes'))
             )
             ORDER BY session_date, session_time`,
            [master_id, cadet_id]
        );
        
        // Добавляем флаг 'your_booking' для занятий курсанта
        const sessions = result.rows.map(session => ({
            ...session,
            status: session.status === 'booked' ? 'your_booking' : session.status
        }));
        
        res.json(sessions);
    } catch (err) {
        console.error('Ошибка при загрузке расписания:', err);
        res.status(500).json({ 
            error: 'Ошибка сервера при загрузке расписания',
            details: err.message
        });
    }
});

// Запись на занятие
app.post('/api/book-session', async (req, res) => {
    const { session_id, cadet_id } = req.body;
    
    try {
        // Получаем информацию о занятии
        const session = await pool.query(
            `SELECT 
                id, 
                session_date, 
                session_time, 
                status,
                master_id
             FROM DrivingSessions 
             WHERE id = $1`,
            [session_id]
        );
        
        if (session.rows.length === 0) {
            return res.status(404).json({ error: 'Занятие не найдено' });
        }

        const { 
            session_date, 
            session_time, 
            status,
            master_id
        } = session.rows[0];
        
        // Проверяем статус
        if (status !== 'free') {
            return res.status(400).json({ error: 'Занятие уже занято' });
        }

        // Проверяем, что курсант принадлежит этому мастеру
        const cadetCheck = await pool.query(
            `SELECT id FROM Cadets WHERE id = $1 AND master_id = $2`,
            [cadet_id, master_id]
        );
        
        if (cadetCheck.rows.length === 0) {
            return res.status(403).json({ 
                error: 'Нельзя записаться к другому мастеру' 
            });
        }

        // Проверяем время до начала занятия (15 минут)
        const now = new Date();
        const sessionDateTime = new Date(`${session_date}T${session_time}`);
        const bookingDeadline = new Date(sessionDateTime.getTime() - 15 * 60000);
        
        if (now > bookingDeadline) {
            return res.status(400).json({ 
                error: 'Запись закрыта',
                details: 'Записаться можно не позднее чем за 15 минут до начала занятия'
            });
        }

        // Бронирование занятие
        await pool.query(
            `UPDATE DrivingSessions 
             SET cadet_id = $1, status = 'booked' 
             WHERE id = $2`,
            [cadet_id, session_id]
        );
        
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка при бронировании:', err);
        res.status(500).json({ 
            error: 'Ошибка сервера при бронировании',
            details: err.message
        });
    }
});



// Отмена записи
// В методе отмены бронирования курсантом (/api/cancel-booking) добавьте:
// В методе отмены бронирования курсантом
app.post('/api/cancel-booking', async (req, res) => {
    const { session_id, cadet_id } = req.body;
    
    try {
        const session = await pool.query(
            `SELECT 
                ds.*,
                m.id as master_id,
                m.last_name as master_last_name,
                m.first_name as master_first_name,
                c.last_name as cadet_last_name,
                c.first_name as cadet_first_name
             FROM DrivingSessions ds
             LEFT JOIN Masters m ON ds.master_id = m.id
             LEFT JOIN Cadets c ON ds.cadet_id = c.id
             WHERE ds.id = $1 AND ds.cadet_id = $2`,
            [session_id, cadet_id]
        );
        
        if (session.rows.length === 0) {
            return res.status(400).json({ error: 'Запись не найдена или не принадлежит вам' });
        }

        const sessionData = session.rows[0];

        await pool.query(
            'UPDATE DrivingSessions SET cadet_id = NULL, status = $1 WHERE id = $2',
            ['free', session_id]
        );
        
        if (sessionData.master_id) {
            await sendNotification(
                sessionData.master_id,
                'master',
                `❌ Курсант ${sessionData.cadet_last_name} ${sessionData.cadet_first_name} отменил занятие на ${formatDate(sessionData.session_date)} в ${formatTime(sessionData.session_time)}`
            );
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка при отмене бронирования:', err);
        res.status(500).json({ 
            error: 'Ошибка сервера при отмене бронирования',
            details: err.message
        });
    }
});




// Автоматическое завершение и начисление часов для прошедших занятий
app.post('/api/auto-complete-sessions', async (req, res) => {
    try {
        // Находим все забронированные занятия, которые уже прошли
        // (учитываем, что занятие длится 1 час)
        const result = await pool.query(
            `WITH sessions_to_complete AS (
                SELECT 
                    id, 
                    cadet_id,
                    session_date,
                    session_time
                FROM DrivingSessions
                WHERE status = 'booked'
                AND (
                    -- Занятия, которые закончились (начались более 1 часа назад)
                    (session_date < CURRENT_DATE) OR
                    (session_date = CURRENT_DATE AND 
                     session_time < (CURRENT_TIME - INTERVAL '1 hour'))
            )
            UPDATE DrivingSessions ds
            SET status = 'completed'
            FROM sessions_to_complete stc
            WHERE ds.id = stc.id
            RETURNING stc.cadet_id, stc.session_date, stc.session_time`,
            []
        );

        // Начисляем часы всем курсантам
        if (result.rows.length > 0) {
            await pool.query(
                `UPDATE Cadets
                 SET driving_hours = driving_hours + 1
                 WHERE id = ANY($1::int[])`,
                [result.rows.map(row => row.cadet_id)]
            );
        }
        
        res.json({
            success: true,
            message: `Автоматически завершено ${result.rows.length} занятий`,
            completed: result.rows.length
        });
    } catch (err) {
        console.error('Ошибка при автоматическом завершении занятий:', err);
        res.status(500).json({ 
            error: 'Ошибка сервера',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});



// Маршрут для получения профиля мастера
app.get('/api/master/profile', async (req, res) => {
    try {
        const { id } = req.query;
        const result = await pool.query('SELECT * FROM Masters WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Мастер не найден' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});
app.get('/api/master/schedule', async (req, res) => {
    try {
        const { master_id, date } = req.query;
        
        if (!master_id) {
            return res.status(400).json({ error: 'Не указан ID мастера' });
        }

        // Проверяем существование мастера
        const masterExists = await pool.query('SELECT id FROM Masters WHERE id = $1', [master_id]);
        if (masterExists.rows.length === 0) {
            return res.status(404).json({ error: 'Мастер не найден' });
        }

        // Определяем диапазон дат
        const startDate = date ? new Date(date) : new Date();
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);

        const query = `
            SELECT 
                ds.id,
                to_char(ds.session_date, 'YYYY-MM-DD') as session_date,
                to_char(ds.session_time, 'HH24:MI') as session_time,  -- Явное форматирование времени
                ds.status,
                c.id as cadet_id,
                c.last_name as cadet_last_name,
                c.first_name as cadet_first_name,
                c.middle_name as cadet_middle_name,
                to_char(ds.session_date, 'Day') as day_name
            FROM DrivingSessions ds
            LEFT JOIN Cadets c ON ds.cadet_id = c.id
            WHERE ds.master_id = $1
            AND ds.session_date BETWEEN $2 AND $3
            ORDER BY ds.session_date, ds.session_time
        `;

        const result = await pool.query(query, [
            master_id,
            startDate.toISOString().split('T')[0],
            endDate.toISOString().split('T')[0]
        ]);

        res.json({
            success: true,
            data: result.rows.map(session => ({
                ...session,
                day_name: formatDayName(session.day_name.trim())
            })),
            period: {
                start: startDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0]
            }
        });
        
    } catch (err) {
        console.error('Ошибка при загрузке расписания:', err);
        res.status(500).json({ 
            success: false,
            error: 'Ошибка сервера',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Вспомогательные функции
function formatDayName(dayName) {
    const daysMap = {
        'monday': 'Понедельник',
        'tuesday': 'Вторник',
        'wednesday': 'Среда',
        'thursday': 'Четверг',
        'friday': 'Пятница',
        'saturday': 'Суббота',
        'sunday': 'Воскресенье'
    };
    return daysMap[dayName.toLowerCase()] || dayName;
}

function formatDateForSQL(date) {
    return date.toISOString().split('T')[0];
}
app.post('/api/master/reserve-session', async (req, res) => {
    try {
        const { session_id, master_id } = req.body;
        
        if (!session_id || !master_id) {
            return res.status(400).json({ 
                error: 'Не указаны обязательные параметры',
                details: 'Требуются session_id и master_id'
            });
        }

        // Проверяем, что занятие свободно и принадлежит мастеру
        const session = await pool.query(
            `SELECT id FROM DrivingSessions 
             WHERE id = $1 
             AND master_id = $2 
             AND status = 'free'`,
            [session_id, master_id]
        );
        
        if (session.rows.length === 0) {
            return res.status(400).json({ 
                error: 'Невозможно зарезервировать занятие',
                details: 'Занятие не найдено, уже забронировано или не принадлежит вам'
            });
        }

        // Резервируем занятие
        await pool.query(
            `UPDATE DrivingSessions 
             SET status = 'reserved', cadet_id = NULL 
             WHERE id = $1`,
            [session_id]
        );
        
        res.json({ 
            success: true,
            message: 'Время успешно зарезервировано'
        });
    } catch (err) {
        console.error('Ошибка при резервировании:', err);
        res.status(500).json({ 
            error: 'Ошибка сервера',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});
// Отмена резервирования времени
app.post('/api/master/cancel-reservation', async (req, res) => {
    try {
        const { session_id, master_id } = req.body;
        
        if (!session_id || !master_id) {
            return res.status(400).json({ 
                error: 'Не указаны обязательные параметры',
                details: 'Требуются session_id и master_id'
            });
        }

        // Проверяем, что занятие зарезервировано и принадлежит мастеру
        const session = await pool.query(
            `SELECT id FROM DrivingSessions 
             WHERE id = $1 
             AND master_id = $2 
             AND status = 'reserved'`,
            [session_id, master_id]
        );
        
        if (session.rows.length === 0) {
            return res.status(400).json({ 
                error: 'Невозможно отменить резервирование',
                details: 'Занятие не найдено, не зарезервировано или не принадлежит вам'
            });
        }

        // Возвращаем занятие в статус "свободно"
        await pool.query(
            `UPDATE DrivingSessions 
             SET status = 'free', cadet_id = NULL 
             WHERE id = $1`,
            [session_id]
        );
        
        res.json({ 
            success: true,
            message: 'Резервирование успешно отменено'
        });
    } catch (err) {
        console.error('Ошибка при отмене резервирования:', err);
        res.status(500).json({ 
            error: 'Ошибка сервера',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});
// Отмена записи курсанта
// В методе отмены записи мастером (/api/master/cancel-booking) добавьте:
// В методе отмены записи мастером
app.post('/api/master/cancel-booking', async (req, res) => {
    try {
        const { session_id, master_id } = req.body;
        
        const session = await pool.query(
            `SELECT 
                ds.*,
                c.id as cadet_id,
                c.last_name as cadet_last_name,
                c.first_name as cadet_first_name,
                m.last_name as master_last_name,
                m.first_name as master_first_name
             FROM DrivingSessions ds
             LEFT JOIN Cadets c ON ds.cadet_id = c.id
             LEFT JOIN Masters m ON ds.master_id = m.id
             WHERE ds.id = $1 
             AND ds.master_id = $2 
             AND ds.status = 'booked'`,
            [session_id, master_id]
        );
        
        if (session.rows.length === 0) {
            return res.status(400).json({ 
                error: 'Невозможно отменить запись',
                details: 'Занятие не найдено, не забронировано или не принадлежит вам'
            });
        }

        const sessionData = session.rows[0];

        await pool.query(
            `UPDATE DrivingSessions 
             SET status = 'free', cadet_id = NULL 
             WHERE id = $1`,
            [session_id]
        );
        
        if (sessionData.cadet_id) {
            await sendNotification(
                sessionData.cadet_id,
                'cadet',
                `❌ Мастер ${sessionData.master_last_name} ${sessionData.master_first_name} отменил занятие на ${formatDate(sessionData.session_date)} в ${formatTime(sessionData.session_time)}`
            );
        }
        
        res.json({ 
            success: true,
            message: 'Запись курсанта успешно отменена'
        });
    } catch (err) {
        console.error('Ошибка при отмене записи:', err);
        res.status(500).json({ 
            error: 'Ошибка сервера',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});
// Получение свободных занятий мастера
app.get('/api/master/available-sessions', async (req, res) => {
    try {
        const { master_id } = req.query;
        
        if (!master_id) {
            return res.status(400).json({ 
                error: 'Не указан ID мастера',
                details: 'Параметр master_id обязателен'
            });
        }

        // Получаем свободные занятия на будущие даты
        const result = await pool.query(
            `SELECT 
                id,
                session_date,
                session_time,
                to_char(session_date, 'YYYY-MM-DD') as formatted_date,
                to_char(session_date, 'Day') as day_name
             FROM DrivingSessions
             WHERE master_id = $1
             AND status = 'free'
             AND session_date >= CURRENT_DATE
             ORDER BY session_date, session_time`,
            [master_id]
        );
        
        // Форматируем время (HH:MM)
        const sessions = result.rows.map(session => ({
            ...session,
            session_time: session.session_time.slice(0, 5),
            day_name: session.day_name.trim()
        }));
        
        res.json({
            count: sessions.length,
            data: sessions
        });
    } catch (err) {
        console.error('Ошибка при получении свободных занятий:', err);
        res.status(500).json({ 
            error: 'Ошибка сервера',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});
// Получение списка курсантов мастера
app.get('/api/master/cadets', async (req, res) => {
    try {
        const { master_id } = req.query;
        
        if (!master_id) {
            return res.status(400).json({ 
                error: 'Не указан ID мастера',
                details: 'Параметр master_id обязателен'
            });
        }

        // Получаем курсантов с информацией о часах вождения (без is_active)
        const result = await pool.query(
            `SELECT 
                id,
                last_name,
                first_name,
                middle_name,
                phone_number,
                driving_hours
             FROM Cadets
             WHERE master_id = $1
             ORDER BY last_name, first_name`,
            [master_id]
        );
        
        res.json({
            success: true,
            data: result.rows
        });
    } catch (err) {
        console.error('Ошибка при получении списка курсантов:', err);
        res.status(500).json({ 
            success: false,
            error: 'Ошибка сервера',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});


app.get('/api/master/generate-report', async (req, res) => {
    try {
        const { master_id, start_date, end_date } = req.query;
        
        if (!master_id || !start_date || !end_date) {
            return res.status(400).json({ 
                error: 'Не указаны обязательные параметры',
                details: 'Требуются master_id, start_date и end_date'
            });
        }

        // Исправленный запрос - учитываем всех курсантов, даже с нулем часов
        const sessions = await pool.query(
            `SELECT 
                c.id,
                c.last_name as cadet_last_name,
                c.first_name as cadet_first_name,
                c.middle_name as cadet_middle_name,
                c.phone_number as cadet_phone,
                COUNT(ds.id) FILTER (WHERE ds.status = 'completed') as driving_hours
             FROM Cadets c
             LEFT JOIN DrivingSessions ds ON c.id = ds.cadet_id
                AND ds.session_date BETWEEN $2 AND $3
             WHERE c.master_id = $1
             GROUP BY c.id
             ORDER BY c.last_name, c.first_name`,
            [master_id, start_date, end_date]
        );

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Отчет наката часов');
        
        // Заголовки столбцов
        worksheet.columns = [
            { header: 'Фамилия', key: 'last_name', width: 20 },
            { header: 'Имя', key: 'first_name', width: 20 },
            { header: 'Отчество', key: 'middle_name', width: 20 },
            { header: 'Телефон', key: 'phone', width: 20 },
            { header: 'Часы вождения', key: 'hours', width: 15 }
        ];
        
        // Добавление данных (теперь включая курсантов с 0 часов)
        sessions.rows.forEach(session => {
            worksheet.addRow({
                last_name: session.cadet_last_name,
                first_name: session.cadet_first_name,
                middle_name: session.cadet_middle_name,
                phone: session.cadet_phone,
                hours: session.driving_hours || 0  // Явно указываем 0 для NULL
            });
        });
        
        // Подсчет общего количества часов
        const totalHours = sessions.rows.reduce((sum, row) => sum + parseInt(row.driving_hours || 0), 0);
        worksheet.addRow([]);
        worksheet.addRow(['Всего часов:', '', '', '', totalHours]);
        
        // Форматирование заголовков
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).eachCell(cell => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD9D9D9' }
            };
        });
        
        // Устанавливаем заголовки для скачивания
        const safeFilename = `Отчет_наката_часов_${start_date}_${end_date}.xlsx`;
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename)}`
        );
        
        // Отправляем файл
        await workbook.xlsx.write(res);
        res.end();
        
    } catch (err) {
        console.error('Ошибка при формировании отчета:', err);
        res.status(500).json({ 
            error: 'Ошибка сервера',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});



// Получение информации о конкретном занятии
app.get('/api/session-info', async (req, res) => {
    try {
        const { id } = req.query;
        const result = await pool.query(
            `SELECT 
                id,
                session_date,
                session_time,
                status,
                master_id,
                cadet_id
             FROM DrivingSessions 
             WHERE id = $1`,
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Занятие не найдено' });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Ошибка при получении информации о занятии:', err);
        res.status(500).json({ 
            error: 'Ошибка сервера',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});


// Маршруты администратора
app.get('/api/admin/cadets', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                c.id,
                c.last_name,
                c.first_name,
                c.middle_name,
                c.phone_number,
                c.driving_hours,
                c.group_code,
                c.master_id,
                CONCAT(m.last_name, ' ', m.first_name, ' ', COALESCE(m.middle_name, '')) as master_name
            FROM Cadets c
            LEFT JOIN Masters m ON c.master_id = m.id
            ORDER BY c.last_name, c.first_name
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера при загрузке курсантов' });
    }
});

app.get('/api/admin/cadets/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM Cadets WHERE id = $1', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Курсант не найден' });
        }
        
        // Возвращаем пароль в открытом виде (НЕ БЕЗОПАСНО!)
        const userData = result.rows[0];
        res.json({
            ...userData,
            password: userData.password // Отправляем пароль как есть
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера при загрузке курсанта' });
    }
});

app.post('/api/admin/cadets', async (req, res) => {
    try {
        const { 
            last_name, 
            first_name, 
            middle_name, 
            phone_number, 
            password,
            master_id,
            group_code,
            driving_hours
        } = req.body;
        
        // Проверка существования мастера
        const masterCheck = await pool.query('SELECT id FROM Masters WHERE id = $1', [master_id]);
        if (masterCheck.rows.length === 0) {
            return res.status(400).json({ error: 'Мастер не найден' });
        }
        
        // Проверка уникальности телефона
        const phoneCheck = await pool.query('SELECT id FROM Cadets WHERE phone_number = $1', [phone_number]);
        if (phoneCheck.rows.length > 0) {
            return res.status(400).json({ error: 'Телефон уже используется' });
        }
        
        const result = await pool.query(
            `INSERT INTO Cadets (
                last_name, 
                first_name, 
                middle_name, 
                phone_number, 
                password,
                master_id,
                group_code,
                driving_hours
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [
                last_name, 
                first_name, 
                middle_name || null, 
                phone_number, 
                password,
                master_id,
                group_code || null,
                driving_hours || 0
            ]
        );
        
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера при создании курсанта' });
    }
});

app.put('/api/admin/cadets/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            last_name, 
            first_name, 
            middle_name, 
            phone_number, 
            password, // Может быть undefined
            master_id,
            group_code,
            driving_hours
        } = req.body;
        
        // Проверка существования курсанта
        const cadetCheck = await pool.query('SELECT id, password FROM Cadets WHERE id = $1', [id]);
        if (cadetCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Курсант не найден' });
        }
        
        // Если пароль не передан, используем существующий
        const currentPassword = cadetCheck.rows[0].password;
        const newPassword = password || currentPassword;
        
        // Обновляем данные (всегда используем newPassword)
        const result = await pool.query(
            `UPDATE Cadets SET 
                last_name = $1, 
                first_name = $2, 
                middle_name = $3, 
                phone_number = $4, 
                password = $5,
                master_id = $6,
                group_code = $7,
                driving_hours = $8
             WHERE id = $9 RETURNING *`,
            [
                last_name, 
                first_name, 
                middle_name || null, 
                phone_number, 
                newPassword, // Используем новый пароль или текущий
                master_id,
                group_code || null,
                driving_hours || 0,
                id
            ]
        );
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера при обновлении курсанта' });
    }
});

app.delete('/api/admin/cadets/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(
            'DELETE FROM Cadets WHERE id = $1 RETURNING id',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Курсант не найден' });
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера при удалении курсанта' });
    }
});

// Маршруты для работы с мастерами
app.get('/api/admin/masters', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                m.id,
                m.last_name,
                m.first_name,
                m.middle_name,
                m.phone_number,
                COUNT(c.id) as cadets_count
            FROM Masters m
            LEFT JOIN Cadets c ON m.id = c.master_id
            GROUP BY m.id
            ORDER BY m.last_name, m.first_name
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера при загрузке мастеров' });
    }
});

app.get('/api/admin/masters/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM Masters WHERE id = $1', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Мастер не найден' });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера при загрузке мастера' });
    }
});

app.post('/api/admin/masters', async (req, res) => {
    try {
        const { 
            last_name, 
            first_name, 
            middle_name, 
            phone_number, 
            password
        } = req.body;
        
        // Проверка уникальности телефона
        const phoneCheck = await pool.query('SELECT id FROM Masters WHERE phone_number = $1', [phone_number]);
        if (phoneCheck.rows.length > 0) {
            return res.status(400).json({ error: 'Телефон уже используется' });
        }
        
        const result = await pool.query(
            `INSERT INTO Masters (
                last_name, 
                first_name, 
                middle_name, 
                phone_number, 
                password
            ) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [
                last_name, 
                first_name, 
                middle_name || null, 
                phone_number, 
                password
            ]
        );
        
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера при создании мастера' });
    }
});

app.put('/api/admin/masters/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            last_name, 
            first_name, 
            middle_name, 
            phone_number, 
            password
        } = req.body;
        
        // Проверка существования мастера
        const masterCheck = await pool.query('SELECT id FROM Masters WHERE id = $1', [id]);
        if (masterCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Мастер не найден' });
        }
        
        // Проверка уникальности телефона
        const phoneCheck = await pool.query(
            'SELECT id FROM Masters WHERE phone_number = $1 AND id != $2', 
            [phone_number, id]
        );
        if (phoneCheck.rows.length > 0) {
            return res.status(400).json({ error: 'Телефон уже используется' });
        }
        
        // Обновляем данные
        const query = password 
            ? `UPDATE Masters SET 
                last_name = $1, 
                first_name = $2, 
                middle_name = $3, 
                phone_number = $4, 
                password = $5
               WHERE id = $6 RETURNING *`
            : `UPDATE Masters SET 
                last_name = $1, 
                first_name = $2, 
                middle_name = $3, 
                phone_number = $4
               WHERE id = $5 RETURNING *`;
        
        const params = password 
            ? [
                last_name, 
                first_name, 
                middle_name || null, 
                phone_number, 
                password,
                id
            ]
            : [
                last_name, 
                first_name, 
                middle_name || null, 
                phone_number,
                id
            ];
        
        const result = await pool.query(query, params);
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера при обновлении мастера' });
    }
});

app.delete('/api/admin/masters/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Проверяем, есть ли у мастера курсанты
        const cadetsCheck = await pool.query(
            'SELECT id FROM Cadets WHERE master_id = $1 LIMIT 1',
            [id]
        );
        
        if (cadetsCheck.rows.length > 0) {
            return res.status(400).json({ 
                error: 'Нельзя удалить мастера, у которого есть курсанты' 
            });
        }
        
        const result = await pool.query(
            'DELETE FROM Masters WHERE id = $1 RETURNING id',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Мастер не найден' });
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера при удалении мастера' });
    }
});

// Маршруты для работы с администраторами
app.get('/api/admin/admins', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM Admin ORDER BY id');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера при загрузке администраторов' });
    }
});

app.get('/api/admin/admins/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM Admin WHERE id = $1', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Администратор не найден' });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера при загрузке администратора' });
    }
});

app.post('/api/admin/admins', async (req, res) => {
    try {
        const { phone_number, password } = req.body;
        
        // Проверка уникальности телефона
        const phoneCheck = await pool.query('SELECT id FROM Admin WHERE phone_number = $1', [phone_number]);
        if (phoneCheck.rows.length > 0) {
            return res.status(400).json({ error: 'Телефон уже используется' });
        }
        
        const result = await pool.query(
            'INSERT INTO Admin (phone_number, password) VALUES ($1, $2) RETURNING *',
            [phone_number, password]
        );
        
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера при создании администратора' });
    }
});

app.put('/api/admin/admins/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { phone_number, password } = req.body;
        
        // Проверка существования администратора
        const adminCheck = await pool.query('SELECT id FROM Admin WHERE id = $1', [id]);
        if (adminCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Администратор не найден' });
        }
        
        // Проверка уникальности телефона
        const phoneCheck = await pool.query(
            'SELECT id FROM Admin WHERE phone_number = $1 AND id != $2', 
            [phone_number, id]
        );
        if (phoneCheck.rows.length > 0) {
            return res.status(400).json({ error: 'Телефон уже используется' });
        }
        
        // Обновляем данные
        const query = password 
            ? 'UPDATE Admin SET phone_number = $1, password = $2 WHERE id = $3 RETURNING *'
            : 'UPDATE Admin SET phone_number = $1 WHERE id = $2 RETURNING *';
        
        const params = password 
            ? [phone_number, password, id]
            : [phone_number, id];
        
        const result = await pool.query(query, params);
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера при обновлении администратора' });
    }
});

app.delete('/api/admin/admins/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Проверяем, не пытаемся ли удалить последнего администратора
        const adminsCount = await pool.query('SELECT COUNT(*) FROM Admin');
        if (adminsCount.rows[0].count <= 1) {
            return res.status(400).json({ 
                error: 'Нельзя удалить последнего администратора' 
            });
        }
        
        const result = await pool.query(
            'DELETE FROM Admin WHERE id = $1 RETURNING id',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Администратор не найден' });
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера при удалении администратора' });
    }
});

// Функция для автоматического завершения занятий
async function autoCompleteSessions() {
    const client = await pool.connect();
    try {
        console.log('Запуск автоматического завершения занятий...');
        await client.query('BEGIN');

        // Получение ID завершаемых занятий и курсантов
        const getSessionsQuery = `
            SELECT 
                id, 
                cadet_id,
                session_date,
                session_time
            FROM DrivingSessions
            WHERE status = 'booked'
            AND (
                (session_date + session_time) < (NOW() - INTERVAL '1 hour')
            )
            FOR UPDATE
        `;
        
        const sessionsResult = await client.query(getSessionsQuery);
        
        if (sessionsResult.rows.length === 0) {
            console.log('Нет занятий для автоматического завершения.');
            await client.query('ROLLBACK');
            return;
        }

        const sessionIds = sessionsResult.rows.map(row => row.id);
        const cadetIds = sessionsResult.rows.map(row => row.cadet_id).filter(id => id !== null);

        // Обновление  статуса занятий
        const updateSessionsQuery = `
            UPDATE DrivingSessions
            SET status = 'completed'
            WHERE id = ANY($1)
        `;
        await client.query(updateSessionsQuery, [sessionIds]);

        // Начисление часов курсантам (только если cadet_id не NULL)
        if (cadetIds.length > 0) {
            const updateCadetsQuery = `
                UPDATE Cadets
                SET driving_hours = driving_hours + 1
                WHERE id = ANY($1)
            `;
            await client.query(updateCadetsQuery, [cadetIds]);
        }

        await client.query('COMMIT');
        console.log(`Успешно завершено ${sessionIds.length} занятий. Начислены часы для ${cadetIds.length} курсантов.`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Ошибка при автоматическом завершении занятий:', err.message);
        
        // Детальное логирование для отладки
        console.error('Детали ошибки:', {
            code: err.code,
            position: err.position,
            stack: err.stack
        });
    } finally {
        client.release();
    }
}

// Маршрут для получения списка групп курсантов
app.get('/api/admin/cadets/groups', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT DISTINCT group_code 
             FROM Cadets 
             WHERE group_code IS NOT NULL AND group_code != ''
             ORDER BY group_code`
        );
        
        res.json({
            success: true,
            groups: result.rows.map(row => row.group_code)
        });
    } catch (err) {
        console.error('Ошибка при получении списка групп:', err);
        res.status(500).json({ 
            success: false,
            error: 'Ошибка сервера'
        });
    }
});

// Отчет по курсантам
// Отчет по курсантам с возможностью выбора мастера
app.get('/api/admin/reports/cadets', async (req, res) => {
    try {
        const { start_date, end_date, master_id } = req.query;
        
        // Базовый запрос
        let query = `
            SELECT 
                c.id,
                c.last_name,
                c.first_name,
                c.middle_name,
                c.phone_number,
                c.group_code,
                COUNT(ds.id) as completed_sessions,
                m.id as master_id,
                m.last_name as master_last_name,
                m.first_name as master_first_name,
                m.middle_name as master_middle_name
            FROM Cadets c
            LEFT JOIN DrivingSessions ds ON c.id = ds.cadet_id 
                AND ds.status = 'completed'
                AND ds.session_date BETWEEN $1 AND $2
            LEFT JOIN Masters m ON c.master_id = m.id
        `;
        
        // Добавляем условие для мастера, если он указан
        const params = [start_date, end_date];
        if (master_id && master_id !== 'all') {
            query += ` WHERE c.master_id = $3 `;
            params.push(master_id);
        }
        
        query += `
            GROUP BY c.id, m.id
            ORDER BY m.last_name, m.first_name, c.last_name, c.first_name
        `;
        
        const result = await pool.query(query, params);

        // Создаем Excel файл
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Отчет по курсантам');

        // Добавляем информацию о периоде и мастере
        worksheet.addRow([`Отчет по курсантам за период: ${start_date} - ${end_date}`]);
        
        if (master_id && master_id !== 'all') {
            const master = result.rows[0]?.master_last_name 
                ? `${result.rows[0].master_last_name} ${result.rows[0].master_first_name} ${result.rows[0].master_middle_name || ''}`.trim()
                : 'Мастер не найден';
            worksheet.addRow([`Мастер: ${master}`]);
        } else {
            worksheet.addRow([`Все мастера`]);
        }
        
        worksheet.addRow([]);

        // Заголовки столбцов
        worksheet.columns = [
            { header: 'Мастер ПОВ', key: 'master', width: 30 },
            { header: 'Фамилия', key: 'last_name', width: 20 },
            { header: 'Имя', key: 'first_name', width: 20 },
            { header: 'Отчество', key: 'middle_name', width: 20 },
            { header: 'Телефон', key: 'phone', width: 20 },
            { header: 'Группа', key: 'group', width: 15 },
            { header: 'Часы вождения', key: 'hours', width: 15 }
        ];

        // Добавляем данные
        result.rows.forEach(cadet => {
            worksheet.addRow({
                master: `${cadet.master_last_name} ${cadet.master_first_name} ${cadet.master_middle_name || ''}`.trim(),
                last_name: cadet.last_name,
                first_name: cadet.first_name,
                middle_name: cadet.middle_name || '',
                phone: cadet.phone_number,
                group: cadet.group_code || 'Без группы',
                hours: cadet.completed_sessions
            });
        });

        // Подсчет общего количества часов
        const totalHours = result.rows.reduce((sum, row) => sum + (parseInt(row.completed_sessions) || 0), 0);
        worksheet.addRow([]);
        worksheet.addRow(['Всего курсантов:', '', '', '', '', '', result.rows.length]);
        worksheet.addRow(['Всего часов:', '', '', '', '', '', totalHours]);

        // Форматирование
        worksheet.getRow(4).font = { bold: true }; // Заголовки столбцов
        worksheet.getRow(4).eachCell(cell => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD9D9D9' }
            };
        });

        // Делаем первую строку (период) жирной
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(2).font = { bold: true };

        // Устанавливаем имя файла
        let filename = `Отчет_по_курсантам_${start_date}_${end_date}`;
        if (master_id && master_id !== 'all') {
            const masterName = result.rows[0]?.master_last_name 
                ? `${result.rows[0].master_last_name}_${result.rows[0].master_first_name}`
                : 'мастер';
            filename += `_${masterName}`;
        }
        filename += '.xlsx';

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);

        // Отправляем файл
        await workbook.xlsx.write(res);
        res.end();
        
    } catch (err) {
        console.error('Ошибка при формировании отчета по курсантам:', err);
        res.status(500).json({ 
            error: 'Ошибка сервера',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});
// Отчет по мастерам
app.get('/api/admin/reports/masters', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        
        // Исправленный запрос - убрали JOIN с Cadets для подсчета занятий
        const result = await pool.query(
            `SELECT 
                m.id,
                m.last_name,
                m.first_name,
                m.middle_name,
                m.phone_number,
                COUNT(ds.id) as conducted_sessions,
                (SELECT COUNT(*) FROM Cadets WHERE master_id = m.id) as cadets_count
             FROM Masters m
             LEFT JOIN DrivingSessions ds ON m.id = ds.master_id 
                AND ds.status = 'completed'
                AND ds.session_date BETWEEN $1 AND $2
             GROUP BY m.id
             ORDER BY m.last_name, m.first_name`,
            [start_date, end_date]
        );

        // Создаем Excel файл
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Отчет по мастерам');

        // Заголовки столбцов
        worksheet.columns = [
            { header: 'Фамилия', key: 'last_name', width: 20 },
            { header: 'Имя', key: 'first_name', width: 20 },
            { header: 'Отчество', key: 'middle_name', width: 20 },
            { header: 'Телефон', key: 'phone', width: 20 },
            { header: 'Проведено занятий', key: 'sessions', width: 20 },
            { header: 'Кол-во курсантов', key: 'cadets', width: 20 }
        ];

        // Добавляем данные
        result.rows.forEach(master => {
            worksheet.addRow({
                last_name: master.last_name,
                first_name: master.first_name,
                middle_name: master.middle_name || '',
                phone: master.phone_number,
                sessions: master.conducted_sessions,
                cadets: master.cadets_count
            });
        });

        // Подсчет общего количества занятий
        const totalSessions = result.rows.reduce((sum, row) => sum + (parseInt(row.conducted_sessions) || 0), 0);
        worksheet.addRow([]);
        worksheet.addRow(['Всего проведено занятий:', '', '', '', totalSessions, '']);

        // Форматирование
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).eachCell(cell => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD9D9D9' }
            };
        });

        // Устанавливаем заголовки
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`Отчет_по_мастерам_${start_date}_${end_date}.xlsx`)}`);

        // Отправляем файл
        await workbook.xlsx.write(res);
        res.end();
        
    } catch (err) {
        console.error('Ошибка при формировании отчета по мастерам:', err);
        res.status(500).json({ 
            error: 'Ошибка сервера',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

app.post('/api/generate-telegram-token', async (req, res) => {
    const { user_id, role } = req.body;
    
    if (!['master', 'cadet'].includes(role)) {
        return res.status(400).json({ 
            success: false,
            error: 'Неверная роль пользователя'
        });
    }

    try {
        const token = require('crypto').randomBytes(32).toString('hex');
        const table = role === 'master' ? 'Masters' : 'Cadets';
        
        // Проверяем существование пользователя
        const userCheck = await pool.query(
            `SELECT id, phone_number FROM ${table} WHERE id = $1`,
            [user_id]
        );
        
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Пользователь не найден'
            });
        }

        await pool.query(
            `UPDATE ${table} SET telegram_token = $1 WHERE id = $2`,
            [token, user_id]
        );
        
        res.json({ 
            success: true,
            token,
            bot_username: process.env.TELEGRAM_BOT_USERNAME,
            phone: normalizePhone(userCheck.rows[0].phone_number)
        });
    } catch (err) {
        console.error('Ошибка при генерации токена:', err);
        res.status(500).json({ 
            success: false,
            error: 'Ошибка сервера'
        });
    }
});


// Функция для нормализации номера телефона
function normalizePhone(phone) {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('8') && digits.length === 11) {
        return '+7' + digits.substring(1);
    }
    return '+' + digits;
}

// Запускаем проверку каждую минуту
setInterval(autoCompleteSessions, 60 * 1000);

// Также запустим сразу при старте сервера
autoCompleteSessions();
app.listen(port, () => {
    console.log(`Сервер запущен на порту ${port}`);
});