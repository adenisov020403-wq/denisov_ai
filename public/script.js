// Общие функции
document.getElementById('logoutButton')?.addEventListener('click', () => {
    localStorage.removeItem('user');
    window.location.href = '/';
});
// Авторизация
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = document.getElementById('phone').value;
    const password = document.getElementById('password').value;
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка авторизации');
        }

        const data = await response.json();
        localStorage.setItem('user', JSON.stringify(data.user));
        
        // Перенаправление в зависимости от роли
        switch(data.role) {
            case 'master':
                window.location.href = `master.html?master_id=${data.user.id}`;
                break;
            case 'cadet':
                window.location.href = `cadet.html?cadet_id=${data.user.id}`;
                break;
            case 'admin':
                window.location.href = 'admin.html';
                break;
            default:
                throw new Error('Неизвестная роль пользователя');
        }
    } catch (err) {
        console.error('Ошибка при авторизации:', err);
        alert(err.message || 'Произошла ошибка при подключении к серверу');
    }
});

// Загрузка расписания мастера
if (window.location.pathname.includes('master.html')) {
    document.addEventListener('DOMContentLoaded', async () => {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const masterId = urlParams.get('master_id');
            
            if (!masterId) throw new Error('Не указан ID мастера');
            
            const response = await fetch(`/api/master/schedule?master_id=${masterId}`);
            if (!response.ok) throw new Error('Ошибка загрузки расписания');
            
            const schedule = await response.json();
            const scheduleDiv = document.getElementById('schedule');
            
            scheduleDiv.innerHTML = schedule.map(session => `
                <div class="session ${session.status || 'free'}">
                    <p>Дата: ${session.session_date}</p>
                    <p>Время: ${session.session_time}</p>
                    <p>Статус: ${session.status || 'free'}</p>
                </div>
            `).join('');
        } catch (err) {
            console.error('Ошибка:', err);
            alert(err.message || 'Не удалось загрузить расписание');
            window.location.href = '/';
        }
    });
}
// Загрузка страницы курсанта
if (window.location.pathname.includes('cadet.html')) {
    document.addEventListener('DOMContentLoaded', async () => {
        try {
            const user = JSON.parse(localStorage.getItem('user'));
            if (!user || !user.id) {
                throw new Error('Необходимо авторизоваться');
            }

            // Загрузка данных курсанта
            const [userResponse, scheduleResponse] = await Promise.all([
                fetch(`/api/cadet?id=${user.id}`),
                fetch(`/api/available-sessions?cadet_id=${user.id}`)
            ]);

            if (!userResponse.ok) throw new Error('Ошибка загрузки данных');
            if (!scheduleResponse.ok) throw new Error('Ошибка загрузки расписания');

            const [userData, schedule] = await Promise.all([
                userResponse.json(),
                scheduleResponse.json()
            ]);

            // Отображение данных
            document.getElementById('cadetName').textContent = 
                `${userData.last_name} ${userData.first_name}`;
            document.getElementById('totalHours').textContent = 
                `Часы вождения: ${userData.driving_hours}`;
            
            // Отображение расписания с кнопками
            const scheduleDiv = document.getElementById('schedule');
            scheduleDiv.innerHTML = schedule.map(session => `
                <div class="session ${session.status}">
                    <p>Дата: ${new Date(session.session_date).toLocaleDateString()}</p>
                    <p>Время: ${session.session_time}</p>
                    <p>Статус: ${getStatusText(session.status)}</p>
                    ${session.status === 'free' ? 
                        `<button class="book-btn" data-session-id="${session.id}">Записаться</button>` : 
                        session.status === 'your_booking' ?
                        `<button class="cancel-btn" data-session-id="${session.id}">Отменить</button>` :
                        ''}
                </div>
            `).join('');

            // Добавляем обработчики кнопок
            document.querySelectorAll('.book-btn').forEach(btn => {
                btn.addEventListener('click', () => bookSession(btn.dataset.sessionId, user.id));
            });
            
            document.querySelectorAll('.cancel-btn').forEach(btn => {
                btn.addEventListener('click', () => cancelBooking(btn.dataset.sessionId, user.id));
            });

        } catch (err) {
            console.error('Ошибка:', err);
            alert(err.message);
            window.location.href = '/';
        }
    });

    // Функция для текстового описания статуса
    function getStatusText(status) {
        const statusMap = {
            'free': 'Свободно',
            'booked': 'Занято',
            'your_booking': 'Ваша запись'
        };
        return statusMap[status] || status;
    }

    // Запись на занятие
    async function bookSession(sessionId, cadetId) {
        try {
            const response = await fetch('/api/book-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    session_id: sessionId, 
                    cadet_id: cadetId 
                }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error);
            }

            alert('Вы успешно записаны на занятие!');
            location.reload();
        } catch (err) {
            alert(err.message);
        }
    }

    // Отмена записи
    async function cancelBooking(sessionId, cadetId) {
        if (!confirm('Вы уверены, что хотите отменить запись?')) return;
        
        try {
            const response = await fetch('/api/cancel-booking', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    session_id: sessionId, 
                    cadet_id: cadetId 
                }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error);
            }

            alert('Запись отменена');
            location.reload();
        } catch (err) {
            alert(err.message);
        }
    }
}
// Загрузка данных курсанта
if (window.location.pathname.includes('cadet.html')) {
    document.addEventListener('DOMContentLoaded', async () => {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const cadetId = urlParams.get('cadet_id');
            
            if (!cadetId) throw new Error('Не указан ID курсанта');
            
            // Загрузка данных курсанта
            const userResponse = await fetch(`/api/cadet?id=${cadetId}`);
            if (!userResponse.ok) throw new Error('Ошибка загрузки данных');
            const user = await userResponse.json();
            
            // Загрузка расписания
            const scheduleResponse = await fetch(`/api/cadet/schedule?cadet_id=${cadetId}`);
            if (!scheduleResponse.ok) throw new Error('Ошибка загрузки расписания');
            const schedule = await scheduleResponse.json();
            
            // Отображение данных
            document.getElementById('cadetName').textContent = `${user.last_name} ${user.first_name}`;
            document.getElementById('totalHours').textContent = `Часы вождения: ${user.driving_hours}`;
            
            const scheduleDiv = document.getElementById('schedule');
            scheduleDiv.innerHTML = schedule.map(session => `
                <div class="session ${session.status || 'free'}">
                    <p>Дата: ${session.session_date}</p>
                    <p>Время: ${session.session_time}</p>
                    <p>Статус: ${session.status || 'free'}</p>
                </div>
            `).join('');
        } catch (err) {
            console.error('Ошибка:', err);
            alert(err.message || 'Не удалось загрузить данные');
            window.location.href = '/';
        }
    });
}
// Маршрут для отмены записи
app.post('/api/cancel-booking', async (req, res) => {
    const { session_id, cadet_id } = req.body;
    
    try {
        // Проверяем, что запись принадлежит этому курсанту
        const check = await pool.query(
            'SELECT * FROM BookingStatus WHERE session_id = $1 AND cadet_id = $2',
            [session_id, cadet_id]
        );
        
        if (check.rows.length === 0) {
            return res.status(400).json({ error: 'Запись не найдена' });
        }

        // Удаляем запись
        await pool.query(
            'DELETE FROM BookingStatus WHERE session_id = $1 AND cadet_id = $2',
            [session_id, cadet_id]
        );
        
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});
