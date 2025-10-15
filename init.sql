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

-- Функция для создания расписания
CREATE OR REPLACE FUNCTION generate_master_schedule(
    start_date DATE DEFAULT '2025-10-17',
    end_date DATE DEFAULT '2026-12-31'
)
RETURNS void AS $$
DECLARE
    current_date DATE;
    master_record RECORD;
    holidays TEXT[] := ARRAY[
        '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', 
        '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', 
        '2026-01-10', '2026-01-11', '2026-02-23', '2026-03-09', '2026-05-01', 
        '2026-05-11', '2026-06-12', '2026-11-04'
    ];
    is_holiday BOOLEAN;
    is_weekend BOOLEAN;
BEGIN
    -- Для каждого инструктора
    FOR master_record IN SELECT id FROM masters LOOP
        current_date := start_date;
        
        -- Для каждой даты в диапазоне
        WHILE current_date <= end_date LOOP
            -- Проверяем выходные (суббота, воскресенье)
            is_weekend := EXTRACT(DOW FROM current_date) IN (0, 6);
            
            -- Проверяем праздники
            is_holiday := current_date::TEXT = ANY(holidays);
            
            -- Если рабочий день (пн-пт и не праздник)
            IF NOT is_weekend AND NOT is_holiday THEN
                -- Утренняя сессия 9:00-13:00 (4 часа по 1 часу)
                INSERT INTO drivingsessions (session_date, session_time, master_id, status)
                VALUES 
                    (current_date, '09:00', master_record.id, 'free'),
                    (current_date, '10:00', master_record.id, 'free'),
                    (current_date, '11:00', master_record.id, 'free'),
                    (current_date, '12:00', master_record.id, 'free');
                
                -- Дневная сессия 14:00-18:00 (4 часа по 1 часу)
                INSERT INTO drivingsessions (session_date, session_time, master_id, status)
                VALUES 
                    (current_date, '14:00', master_record.id, 'free'),
                    (current_date, '15:00', master_record.id, 'free'),
                    (current_date, '16:00', master_record.id, 'free'),
                    (current_date, '17:00', master_record.id, 'free');
            END IF;
            
            current_date := current_date + 1;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Триггерная функция для автоматического создания расписания при добавлении нового инструктора
CREATE OR REPLACE FUNCTION create_schedule_for_new_master()
RETURNS TRIGGER AS $$
BEGIN
    -- Создаем расписание для нового инструктора на оставшийся период
    PERFORM generate_master_schedule(
        start_date := CURRENT_DATE,
        end_date := '2026-12-31',
        master_id := NEW.id
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер для автоматического создания расписания при добавлении инструктора
CREATE TRIGGER auto_create_schedule
    AFTER INSERT ON masters
    FOR EACH ROW
    EXECUTE FUNCTION create_schedule_for_new_master();

-- Создаем начальное расписание для существующих инструкторов
SELECT generate_master_schedule();

