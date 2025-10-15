-- Таблица администраторов
CREATE TABLE admin (
  id SERIAL PRIMARY KEY,
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  password VARCHAR(100) NOT NULL
);

-- Таблица инструкторов
CREATE TABLE masters (
  id SERIAL PRIMARY KEY,
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  password VARCHAR(100) NOT NULL,
  last_name VARCHAR(50) NOT NULL,
  first_name VARCHAR(50) NOT NULL,
  middle_name VARCHAR(50),
  telegram_chat_id BIGINT,
  telegram_token VARCHAR(100)
);

-- Таблица курсантов
CREATE TABLE cadets (
  id SERIAL PRIMARY KEY,
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  password VARCHAR(100) NOT NULL,
  last_name VARCHAR(50) NOT NULL,
  first_name VARCHAR(50) NOT NULL,
  middle_name VARCHAR(50),
  group_code VARCHAR(20),
  master_id INTEGER REFERENCES masters(id) ON DELETE SET NULL,
  driving_hours INTEGER DEFAULT 0,
  telegram_chat_id BIGINT,
  telegram_token VARCHAR(100)
);

-- Таблица занятий по вождению
CREATE TABLE drivingsessions (
  id SERIAL PRIMARY KEY,
  session_date DATE NOT NULL,
  session_time TIME WITHOUT TIME ZONE NOT NULL,
  master_id INTEGER REFERENCES masters(id) ON DELETE CASCADE,
  cadet_id INTEGER REFERENCES cadets(id) ON DELETE SET NULL,
  status VARCHAR(20) DEFAULT 'free' NOT NULL
); 
-- Вставка начальных данных
INSERT INTO admin (phone_number, password) VALUES 
('89123456789', 'admin123');

INSERT INTO masters (phone_number, password, last_name, first_name, middle_name) VALUES 
('89123456780', 'master1', 'Иванов', 'Петр', 'Сергеевич'),
('89123456781', 'master2', 'Петрова', 'Ольга', 'Ивановна');

INSERT INTO cadets (phone_number, password, last_name, first_name, middle_name, group_code, master_id) VALUES 
('89123456790', 'cadet1', 'Смирнов', 'Алексей', 'Петрович', 'ГРП-21-01', 1),
('879123456791', 'cadet2', 'Кузнецова', 'Екатерина', 'Александровна', 'ГРП-21-01', 1),
('89123456792', 'cadet3', 'Попов', 'Дмитрий', 'Владимирович', 'ГРП-21-02', 2);



-- ПРОСТОЕ создание расписания на 6 месяцев С выходными днями
INSERT INTO drivingsessions (session_date, session_time, master_id, status)
SELECT 
    date_seq::date,
    time_seq::time,
    m.id,
    'free'
FROM 
    generate_series(
        CURRENT_DATE, 
        CURRENT_DATE + 180,  -- 6 месяцев = ~180 дней
        '1 day'::interval
    ) as date_seq,
    (VALUES 
        ('09:00'), ('10:00'), ('11:00'), ('12:00'),
        ('14:00'), ('15:00'), ('16:00'), ('17:00')
    ) as time_seq,
    masters m
WHERE 
    -- Рабочие дни: понедельник-пятница
    EXTRACT(DOW FROM date_seq) IN (1, 2, 3, 4, 5)
    -- Исключаем праздничные дни
    AND date_seq::text NOT IN (
        '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', 
        '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', 
        '2026-01-10', '2026-01-11', '2026-02-23', '2026-03-09', '2026-05-01', 
        '2026-05-11', '2026-06-12', '2026-11-04'
    )
    AND NOT EXISTS (
        SELECT 1 FROM drivingsessions ds 
        WHERE ds.session_date = date_seq::date 
        AND ds.session_time = time_seq::time::time
        AND ds.master_id = m.id
    );

