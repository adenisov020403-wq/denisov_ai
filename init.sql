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