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

-- Features an admin granted to a user, as a JSON array of feature keys
-- (see internal/features). Users without a row get no features.
CREATE TABLE IF NOT EXISTS user_features (
	user_id INTEGER NOT NULL PRIMARY KEY REFERENCES users (id),
	features TEXT NOT NULL,
	created_on DATETIME,
	updated_on DATETIME
);

-- Diagnostic log the browser captures for each contact (app events, console
-- errors and Amazon Connect Streams entries); one row per contact.
CREATE TABLE IF NOT EXISTS call_logs (
	id INTEGER NOT NULL PRIMARY KEY,
	contact_id VARCHAR(36) NOT NULL,
	agent_id INTEGER REFERENCES users (id),
	phone_number VARCHAR(20),
	inbound BOOLEAN,
	outcome VARCHAR(10),
	started_at INTEGER,
	ended_at INTEGER,
	entry_count INTEGER NOT NULL DEFAULT 0,
	error_count INTEGER NOT NULL DEFAULT 0,
	entries TEXT NOT NULL,
	created_on DATETIME,
	updated_on DATETIME
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_call_logs_contact_id ON call_logs (contact_id);
CREATE INDEX IF NOT EXISTS ix_call_logs_agent ON call_logs (agent_id, started_at);

-- Inbound calls seen in the Connect contact flow, polled from SearchContacts
-- so agents can see calls before they are routed; one row per contact.
-- Timestamps are unix ms, 0 when the call hasn't reached that stage.
CREATE TABLE IF NOT EXISTS flow_calls (
	id INTEGER NOT NULL PRIMARY KEY,
	contact_id VARCHAR(36) NOT NULL,
	phone_number VARCHAR(20),
	queue_name VARCHAR(100),
	agent_name VARCHAR(100),
	agent_username VARCHAR(100),
	initiated_at INTEGER NOT NULL DEFAULT 0,
	enqueued_at INTEGER NOT NULL DEFAULT 0,
	connected_at INTEGER NOT NULL DEFAULT 0,
	disconnected_at INTEGER NOT NULL DEFAULT 0,
	created_on DATETIME,
	updated_on DATETIME
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_flow_calls_contact_id ON flow_calls (contact_id);
CREATE INDEX IF NOT EXISTS ix_flow_calls_initiated_at ON flow_calls (initiated_at);

-- Map buildings: where incoming calls come from. patterns is a JSON array of
-- normalized digit patterns ("1206256*" prefix or "12062561234" exact). x, y
-- is the top-left tile of the building. slot is unused (the old fixed lot,
-- converted to x, y by the migration).
CREATE TABLE IF NOT EXISTS map_buildings (
	id INTEGER NOT NULL PRIMARY KEY,
	name VARCHAR(30) NOT NULL,
	patterns TEXT NOT NULL DEFAULT '[]',
	slot INTEGER NOT NULL DEFAULT 0,
	x INTEGER NOT NULL DEFAULT -1,
	y INTEGER NOT NULL DEFAULT -1,
	style INTEGER NOT NULL DEFAULT 0,
	created_on DATETIME,
	updated_on DATETIME
);

-- Map ground painted over each scene's default layout ("town" or "office"),
-- one row per tile.
CREATE TABLE IF NOT EXISTS map_tiles (
	scene VARCHAR(10) NOT NULL DEFAULT 'town',
	x INTEGER NOT NULL,
	y INTEGER NOT NULL,
	tile VARCHAR(20) NOT NULL,
	PRIMARY KEY (scene, x, y)
);

-- Map decorations, at most one per tile of a scene. The (scene, x, y) index
-- is made in migrate, after older databases gain the scene column.
CREATE TABLE IF NOT EXISTS map_props (
	id INTEGER NOT NULL PRIMARY KEY,
	scene VARCHAR(10) NOT NULL DEFAULT 'town',
	kind VARCHAR(20) NOT NULL,
	x INTEGER NOT NULL,
	y INTEGER NOT NULL
);

-- Scenes whose starting decorations have been placed, so they're placed once.
CREATE TABLE IF NOT EXISTS map_seeds (
	scene VARCHAR(10) NOT NULL PRIMARY KEY
);

-- How each user looks on the map: their pet, ride, and (when they've
-- designed one) a JSON MapLook. Users without a row get the defaults.
CREATE TABLE IF NOT EXISTS map_looks (
	username VARCHAR(100) NOT NULL PRIMARY KEY,
	pet VARCHAR(10) NOT NULL DEFAULT '',
	ride VARCHAR(10) NOT NULL DEFAULT 'walk',
	look TEXT,
	updated_on DATETIME
);
