-- Matches the tables created by the original SQLAlchemy models so existing
-- owlchirp.sqlite3 files can be used as-is.
CREATE TABLE IF NOT EXISTS users (
	id INTEGER NOT NULL PRIMARY KEY,
	username VARCHAR(50),
	name VARCHAR(50),
	created_on DATETIME,
	updated_on DATETIME
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username);

CREATE TABLE IF NOT EXISTS calls (
	id INTEGER NOT NULL PRIMARY KEY,
	agent_id INTEGER REFERENCES users (id),
	phone_number VARCHAR(20),
	timestamp INTEGER,
	contact_id VARCHAR(36),
	created_on DATETIME,
	updated_on DATETIME
);
CREATE INDEX IF NOT EXISTS ix_calls_phone_number ON calls (phone_number);

CREATE TABLE IF NOT EXISTS callerid (
	id INTEGER NOT NULL PRIMARY KEY,
	phone_number VARCHAR(20),
	name VARCHAR(30),
	created_on DATETIME,
	updated_on DATETIME
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_callerid_phone_number ON callerid (phone_number);
CREATE INDEX IF NOT EXISTS ix_callerid_name ON callerid (name);

-- Post-call wrap-up an agent fills in after each contact; one row per contact.
CREATE TABLE IF NOT EXISTS wrapups (
	id INTEGER NOT NULL PRIMARY KEY,
	contact_id VARCHAR(36) NOT NULL,
	phone_number VARCHAR(20) NOT NULL,
	agent_id INTEGER REFERENCES users (id),
	incident VARCHAR(100),
	mood VARCHAR(10),
	thoughts TEXT,
	timestamp INTEGER,
	created_on DATETIME,
	updated_on DATETIME
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_wrapups_contact_id ON wrapups (contact_id);
CREATE INDEX IF NOT EXISTS ix_wrapups_phone_number ON wrapups (phone_number, timestamp);

-- Per-user preferences as a JSON object; one row per user.
CREATE TABLE IF NOT EXISTS user_settings (
	user_id INTEGER NOT NULL PRIMARY KEY REFERENCES users (id),
	data TEXT NOT NULL,
	created_on DATETIME,
	updated_on DATETIME
);
