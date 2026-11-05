package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/tyler71/owlchirp/app/assets"
	"github.com/tyler71/owlchirp/app/internal/features"

	"github.com/jmoiron/sqlx"
	_ "modernc.org/sqlite"
)

const defaultTimeout = 3 * time.Second

// SQLAlchemy stored DateTime columns in SQLite using this layout. Keep it so
// ordering by created_on works across rows written by either implementation.
const sqliteTimeLayout = "2006-01-02 15:04:05.000000"

type DB struct {
	*sqlx.DB
}

// New opens the SQLite database at dsn and ensures the schema exists.
// dsn may be a plain file path, or the Python-era DB_STRING form
// (sqlite+aiosqlite:////data/owlchirp.sqlite3).
func New(dsn string) (*DB, error) {
	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	db, err := sqlx.ConnectContext(ctx, "sqlite", normalizeDSN(dsn))
	if err != nil {
		return nil, err
	}

	// SQLite allows a single writer; one connection avoids SQLITE_BUSY churn.
	db.SetMaxOpenConns(1)

	if _, err := db.ExecContext(ctx, assets.Schema); err != nil {
		db.Close()
		return nil, err
	}
	if err := migrate(ctx, db); err != nil {
		db.Close()
		return nil, err
	}

	return &DB{DB: db}, nil
}

// migrate brings databases created by an older schema up to date. The schema
// file only creates missing tables, so added columns are applied here.
func migrate(ctx context.Context, db *sqlx.DB) error {
	if err := ensureColumn(ctx, db, "flow_calls", "agent_username", "VARCHAR(100)"); err != nil {
		return err
	}
	_, err := db.ExecContext(ctx,
		`CREATE INDEX IF NOT EXISTS ix_flow_calls_agent ON flow_calls (agent_username, connected_at)`)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx,
		`CREATE INDEX IF NOT EXISTS ix_flow_calls_phone ON flow_calls (phone_number, initiated_at)`)
	if err != nil {
		return err
	}
	if err := migrateBuildings(ctx, db); err != nil {
		return err
	}
	return migratePermissions(ctx, db)
}

// migrateBuildings moves buildings from the old fixed lots (slot) to x, y
// positions on the bigger map: lot n becomes the nth default lot.
func migrateBuildings(ctx context.Context, db *sqlx.DB) error {
	for _, col := range []string{"x", "y"} {
		if err := ensureColumn(ctx, db, "map_buildings", col, "INTEGER NOT NULL DEFAULT -1"); err != nil {
			return err
		}
	}
	if _, err := db.ExecContext(ctx, `DROP INDEX IF EXISTS ix_map_buildings_slot`); err != nil {
		return err
	}
	var rows []struct {
		ID   int64 `db:"id"`
		Slot int   `db:"slot"`
	}
	if err := db.SelectContext(ctx, &rows, `SELECT id, slot FROM map_buildings WHERE x < 0 OR y < 0 ORDER BY slot`); err != nil {
		return err
	}
	lots := DefaultLots()
	for i, r := range rows {
		lot := lots[min(max(r.Slot, 0), len(lots)-1)]
		if r.Slot >= len(lots) || r.Slot < 0 {
			lot = lots[min(i, len(lots)-1)]
		}
		_, err := db.ExecContext(ctx, `UPDATE map_buildings SET x = ?, y = ? WHERE id = ?`, lot.X, lot.Y, r.ID)
		if err != nil {
			return err
		}
	}
	return nil
}

// migratePermissions converts the old user_permissions levels (0 standard,
// 1 power, 2 admin) to user_features presets, then drops the old table.
func migratePermissions(ctx context.Context, db *sqlx.DB) error {
	var exists int
	err := db.GetContext(ctx, &exists,
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'user_permissions'`)
	if err != nil || exists == 0 {
		return err
	}

	tx, err := db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var rows []struct {
		UserID int64         `db:"user_id"`
		Level  sql.NullInt64 `db:"level"`
	}
	if err := tx.SelectContext(ctx, &rows, `SELECT user_id, level FROM user_permissions`); err != nil {
		return err
	}
	ts := now()
	for _, r := range rows {
		data, err := json.Marshal(features.FromLevel(int(r.Level.Int64)))
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO user_features (user_id, features, created_on, updated_on) VALUES (?, ?, ?, ?)`,
			r.UserID, string(data), ts, ts)
		if err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `DROP TABLE user_permissions`); err != nil {
		return err
	}
	return tx.Commit()
}

// ensureColumn adds column to table unless it already exists.
func ensureColumn(ctx context.Context, db *sqlx.DB, table, column, typ string) error {
	var cols []struct {
		Name string `db:"name"`
	}
	if err := db.SelectContext(ctx, &cols, `SELECT name FROM pragma_table_info(?)`, table); err != nil {
		return err
	}
	for _, c := range cols {
		if strings.EqualFold(c.Name, column) {
			return nil
		}
	}
	_, err := db.ExecContext(ctx, `ALTER TABLE `+table+` ADD COLUMN `+column+` `+typ)
	return err
}

func normalizeDSN(dsn string) string {
	for _, prefix := range []string{"sqlite+aiosqlite:///", "sqlite:///"} {
		if strings.HasPrefix(dsn, prefix) {
			dsn = strings.TrimPrefix(dsn, prefix)
			break
		}
	}

	if !strings.HasPrefix(dsn, "file:") {
		dsn = "file:" + dsn
	}
	if !strings.Contains(dsn, "_pragma") {
		sep := "?"
		if strings.Contains(dsn, "?") {
			sep = "&"
		}
		dsn += sep + "_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"
	}
	return dsn
}

func now() string {
	return time.Now().Format(sqliteTimeLayout)
}

type Call struct {
	Agent       string `db:"agent" json:"agent"`
	PhoneNumber string `db:"phone_number" json:"phoneNumber"`
	Timestamp   int64  `db:"timestamp" json:"timestamp"`
	ContactID   string `db:"contact_id" json:"contactId"`
}

type CallerID struct {
	Name        string `db:"name" json:"name"`
	PhoneNumber string `db:"phone_number" json:"phoneNumber"`
}

// limit converts maxRecords to a SQLite LIMIT value; -1 means no limit.
func limit(maxRecords int) int {
	if maxRecords <= 0 {
		return -1
	}
	return maxRecords
}

func (db *DB) GetOrCreateUser(ctx context.Context, username string) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var id int64
	err := db.GetContext(ctx, &id, `SELECT id FROM users WHERE username = ?`, username)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}

	ts := now()
	res, err := db.ExecContext(ctx,
		`INSERT INTO users (username, created_on, updated_on) VALUES (?, ?, ?)
		 ON CONFLICT (username) DO NOTHING`, username, ts, ts)
	if err != nil {
		return 0, err
	}
	if id, err = res.LastInsertId(); err == nil && id != 0 {
		return id, nil
	}

	err = db.GetContext(ctx, &id, `SELECT id FROM users WHERE username = ?`, username)
	return id, err
}

func (db *DB) AddPhoneLog(ctx context.Context, username, phoneNumber string, timestamp int64, contactID string) error {
	agentID, err := db.GetOrCreateUser(ctx, username)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	if timestamp == 0 {
		timestamp = time.Now().UnixMilli()
	}

	ts := now()
	_, err = db.ExecContext(ctx,
		`INSERT INTO calls (agent_id, phone_number, timestamp, contact_id, created_on, updated_on)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		agentID, phoneNumber, timestamp, contactID, ts, ts)
	return err
}

// offset clamps a negative OFFSET to zero.
func offset(n int) int {
	if n < 0 {
		return 0
	}
	return n
}

// RecentCall is a call for the Recent Calls list. Inbound calls come from
// flow_calls with their Connect details; calls only an agent's browser logged
// (outbound, or older than flow_calls retention) have zero detail fields.
type RecentCall struct {
	Call
	AgentName      string `db:"agent_name" json:"agentName"`
	QueueName      string `db:"queue_name" json:"queueName"`
	InitiatedAt    int64  `db:"initiated_at" json:"initiatedAt"`
	EnqueuedAt     int64  `db:"enqueued_at" json:"enqueuedAt"`
	ConnectedAt    int64  `db:"connected_at" json:"connectedAt"`
	DisconnectedAt int64  `db:"disconnected_at" json:"disconnectedAt"`
}

// recentCallsUnion merges answered flow calls with logged calls that aren't
// already covered by one. Each half takes the username filter twice (empty
// means every agent), so its arguments are (u, u, u, u, u, u).
const recentCallsUnion = `
	SELECT f.agent_username AS agent, COALESCE(f.phone_number, '') AS phone_number,
	       f.connected_at AS timestamp, f.contact_id,
	       COALESCE(f.agent_name, '') AS agent_name, COALESCE(f.queue_name, '') AS queue_name,
	       f.initiated_at, f.enqueued_at, f.connected_at, f.disconnected_at
	FROM flow_calls f
	WHERE f.connected_at != 0 AND COALESCE(f.agent_username, '') != ''
	  AND (? = '' OR lower(f.agent_username) = lower(?))
	UNION ALL
	SELECT u.username, COALESCE(c.phone_number, ''), COALESCE(c.timestamp, 0),
	       COALESCE(c.contact_id, ''), '', '', 0, 0, 0, 0
	FROM calls c JOIN users u ON u.id = c.agent_id
	WHERE (? = '' OR lower(u.username) = lower(?))
	  AND (COALESCE(c.contact_id, '') = '' OR c.contact_id NOT IN (
	    SELECT contact_id FROM flow_calls
	    WHERE connected_at != 0 AND COALESCE(agent_username, '') != ''
	      AND (? = '' OR lower(agent_username) = lower(?))))`

func recentCallsArgs(username string) []any {
	return []any{username, username, username, username, username, username}
}

// ListRecentCalls returns one page of recent calls, newest first: username's
// calls, or every agent's when username is empty.
func (db *DB) ListRecentCalls(ctx context.Context, username string, maxRecords, skip int) ([]RecentCall, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	calls := []RecentCall{}
	args := append(recentCallsArgs(username), limit(maxRecords), offset(skip))
	err := db.SelectContext(ctx, &calls,
		`SELECT * FROM (`+recentCallsUnion+`) ORDER BY timestamp DESC, contact_id DESC LIMIT ? OFFSET ?`,
		args...)
	return calls, err
}

// CountRecentCalls returns how many calls ListRecentCalls can page through.
func (db *DB) CountRecentCalls(ctx context.Context, username string) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var n int
	err := db.GetContext(ctx, &n, `SELECT COUNT(*) FROM (`+recentCallsUnion+`)`, recentCallsArgs(username)...)
	return n, err
}

func (db *DB) GetPhoneCalls(ctx context.Context, phoneNumber string, maxRecords int) ([]Call, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	calls := []Call{}
	err := db.SelectContext(ctx, &calls,
		`SELECT COALESCE(u.username, '') AS agent, c.phone_number,
		        COALESCE(c.timestamp, 0) AS timestamp, COALESCE(c.contact_id, '') AS contact_id
		 FROM calls c LEFT JOIN users u ON u.id = c.agent_id
		 WHERE c.phone_number = ?
		 ORDER BY c.created_on DESC, c.id DESC
		 LIMIT ?`, phoneNumber, limit(maxRecords))
	return calls, err
}

func (db *DB) GetCallerID(ctx context.Context, phoneNumber string) (CallerID, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var c CallerID
	err := db.GetContext(ctx, &c,
		`SELECT COALESCE(name, '') AS name, phone_number FROM callerid WHERE phone_number = ?`, phoneNumber)
	if errors.Is(err, sql.ErrNoRows) {
		return CallerID{}, false, nil
	}
	return c, err == nil, err
}

func (db *DB) UpsertCallerID(ctx context.Context, phoneNumber, name string) error {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	ts := now()
	_, err := db.ExecContext(ctx,
		`INSERT INTO callerid (phone_number, name, created_on, updated_on) VALUES (?, ?, ?, ?)
		 ON CONFLICT (phone_number) DO UPDATE SET name = excluded.name, updated_on = excluded.updated_on`,
		phoneNumber, name, ts, ts)
	return err
}

// ListCallerIDs returns every saved caller ID, ordered by name.
func (db *DB) ListCallerIDs(ctx context.Context) ([]CallerID, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	callerIDs := []CallerID{}
	err := db.SelectContext(ctx, &callerIDs,
		`SELECT COALESCE(name, '') AS name, phone_number FROM callerid ORDER BY name COLLATE NOCASE, phone_number`)
	return callerIDs, err
}

// DeleteCallerID removes the name saved for phoneNumber and reports whether
// there was one.
func (db *DB) DeleteCallerID(ctx context.Context, phoneNumber string) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	res, err := db.ExecContext(ctx, `DELETE FROM callerid WHERE phone_number = ?`, phoneNumber)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// ListFeatures returns the features set for each user, keyed by username.
func (db *DB) ListFeatures(ctx context.Context) (map[string][]string, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var rows []struct {
		Username string `db:"username"`
		Features string `db:"features"`
	}
	err := db.SelectContext(ctx, &rows,
		`SELECT u.username, f.features FROM user_features f JOIN users u ON u.id = f.user_id`)
	if err != nil {
		return nil, err
	}

	sets := make(map[string][]string, len(rows))
	for _, r := range rows {
		var list []string
		if err := json.Unmarshal([]byte(r.Features), &list); err != nil {
			return nil, err
		}
		sets[r.Username] = list
	}
	return sets, nil
}

// SetFeatures saves the features granted to username.
func (db *DB) SetFeatures(ctx context.Context, username string, list []string) error {
	userID, err := db.GetOrCreateUser(ctx, username)
	if err != nil {
		return err
	}
	if list == nil {
		list = []string{}
	}
	data, err := json.Marshal(list)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	ts := now()
	_, err = db.ExecContext(ctx,
		`INSERT INTO user_features (user_id, features, created_on, updated_on) VALUES (?, ?, ?, ?)
		 ON CONFLICT (user_id) DO UPDATE SET features = excluded.features, updated_on = excluded.updated_on`,
		userID, string(data), ts, ts)
	return err
}

// DeleteFeatures removes the features set for username and reports whether
// there were any.
func (db *DB) DeleteFeatures(ctx context.Context, username string) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	res, err := db.ExecContext(ctx,
		`DELETE FROM user_features WHERE user_id = (SELECT id FROM users WHERE username = ?)`, username)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

type Wrapup struct {
	ContactID   string `db:"contact_id" json:"contactId"`
	PhoneNumber string `db:"phone_number" json:"phoneNumber"`
	Agent       string `db:"agent" json:"agent"`
	Incident    string `db:"incident" json:"incident"`
	Mood        string `db:"mood" json:"mood"`
	Thoughts    string `db:"thoughts" json:"thoughts"`
	Timestamp   int64  `db:"timestamp" json:"timestamp"`
}

// UpsertWrapup stores the wrap-up for w.ContactID, replacing an earlier save
// for the same contact. The original timestamp is kept on update.
func (db *DB) UpsertWrapup(ctx context.Context, username string, w Wrapup) (Wrapup, error) {
	agentID, err := db.GetOrCreateUser(ctx, username)
	if err != nil {
		return Wrapup{}, err
	}

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	ts := now()
	_, err = db.ExecContext(ctx,
		`INSERT INTO wrapups (contact_id, phone_number, agent_id, incident, mood, thoughts, timestamp, created_on, updated_on)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (contact_id) DO UPDATE SET
		   agent_id = excluded.agent_id, incident = excluded.incident, mood = excluded.mood,
		   thoughts = excluded.thoughts, updated_on = excluded.updated_on`,
		w.ContactID, w.PhoneNumber, agentID, w.Incident, w.Mood, w.Thoughts, time.Now().UnixMilli(), ts, ts)
	if err != nil {
		return Wrapup{}, err
	}

	var saved Wrapup
	err = db.GetContext(ctx, &saved, wrapupSelect+` WHERE w.contact_id = ?`, w.ContactID)
	return saved, err
}

func (db *DB) GetWrapups(ctx context.Context, phoneNumber string, maxRecords int) ([]Wrapup, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	wrapups := []Wrapup{}
	err := db.SelectContext(ctx, &wrapups,
		wrapupSelect+` WHERE w.phone_number = ? ORDER BY w.timestamp DESC, w.id DESC LIMIT ?`,
		phoneNumber, limit(maxRecords))
	return wrapups, err
}

const wrapupSelect = `SELECT w.contact_id, w.phone_number, COALESCE(u.username, '') AS agent,
	COALESCE(w.incident, '') AS incident, COALESCE(w.mood, '') AS mood,
	COALESCE(w.thoughts, '') AS thoughts, COALESCE(w.timestamp, 0) AS timestamp
	FROM wrapups w LEFT JOIN users u ON u.id = w.agent_id`

// Settings are an agent's preferences, stored as JSON so new fields need no
// schema change.
type Settings struct {
	Theme string `json:"theme"`
	// FollowTeamMeeting switches the agent to "In a meeting" when most of the
	// team is in one.
	FollowTeamMeeting bool `json:"followTeamMeeting"`
	// HideCallerIDs opts out of showing saved caller ID names in place of
	// phone numbers.
	HideCallerIDs bool `json:"hideCallerIds"`
	// HelpQueueThreshold is the queue count at which a non-routable agent is
	// alerted to help as the queue grows. nil means the client default; 0 is off.
	HelpQueueThreshold *int `json:"helpQueueThreshold,omitempty"`
}

// GetSettings returns zero Settings when the user has saved none.
func (db *DB) GetSettings(ctx context.Context, username string) (Settings, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var data string
	err := db.GetContext(ctx, &data,
		`SELECT s.data FROM user_settings s JOIN users u ON u.id = s.user_id WHERE u.username = ?`, username)
	if errors.Is(err, sql.ErrNoRows) {
		return Settings{}, nil
	}
	if err != nil {
		return Settings{}, err
	}

	var s Settings
	err = json.Unmarshal([]byte(data), &s)
	return s, err
}

func (db *DB) SaveSettings(ctx context.Context, username string, s Settings) (Settings, error) {
	userID, err := db.GetOrCreateUser(ctx, username)
	if err != nil {
		return Settings{}, err
	}

	data, err := json.Marshal(s)
	if err != nil {
		return Settings{}, err
	}

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	ts := now()
	_, err = db.ExecContext(ctx,
		`INSERT INTO user_settings (user_id, data, created_on, updated_on) VALUES (?, ?, ?, ?)
		 ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_on = excluded.updated_on`,
		userID, string(data), ts, ts)
	return s, err
}

// Call logs are capped so a noisy call cannot grow a row without limit, and
// pruned after callLogRetention.
const (
	MaxCallLogEntries = 2000
	callLogRetention  = 30 * 24 * time.Hour
)

type LogEntry struct {
	Time    int64  `json:"time"`
	Source  string `json:"source"`
	Level   string `json:"level"`
	Message string `json:"message"`
	Detail  string `json:"detail,omitempty"`
}

// CallLog is the diagnostic log for one contact. Entries is omitted from
// listings.
type CallLog struct {
	ContactID   string     `db:"contact_id" json:"contactId"`
	Agent       string     `db:"agent" json:"agent"`
	PhoneNumber string     `db:"phone_number" json:"phoneNumber"`
	Inbound     bool       `db:"inbound" json:"inbound"`
	Outcome     string     `db:"outcome" json:"outcome"`
	StartedAt   int64      `db:"started_at" json:"startedAt"`
	EndedAt     int64      `db:"ended_at" json:"endedAt"`
	EntryCount  int        `db:"entry_count" json:"entryCount"`
	ErrorCount  int        `db:"error_count" json:"errorCount"`
	Entries     []LogEntry `db:"-" json:"entries,omitempty"`
}

const callLogSelect = `SELECT l.contact_id, COALESCE(u.username, '') AS agent,
	COALESCE(l.phone_number, '') AS phone_number, COALESCE(l.inbound, 0) AS inbound,
	COALESCE(l.outcome, '') AS outcome, COALESCE(l.started_at, 0) AS started_at,
	COALESCE(l.ended_at, 0) AS ended_at, l.entry_count, l.error_count
	FROM call_logs l LEFT JOIN users u ON u.id = l.agent_id`

// AppendCallLog adds entries to the log for c.ContactID, creating it if
// needed. Non-empty Outcome and non-zero EndedAt replace the stored values;
// once the cap is reached the oldest entries are dropped.
func (db *DB) AppendCallLog(ctx context.Context, username string, c CallLog) (CallLog, error) {
	agentID, err := db.GetOrCreateUser(ctx, username)
	if err != nil {
		return CallLog{}, err
	}

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	tx, err := db.BeginTxx(ctx, nil)
	if err != nil {
		return CallLog{}, err
	}
	defer tx.Rollback()

	var stored string
	err = tx.GetContext(ctx, &stored, `SELECT entries FROM call_logs WHERE contact_id = ?`, c.ContactID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return CallLog{}, err
	}
	entries := []LogEntry{}
	if stored != "" {
		if err := json.Unmarshal([]byte(stored), &entries); err != nil {
			return CallLog{}, err
		}
	}
	entries = append(entries, c.Entries...)
	if len(entries) > MaxCallLogEntries {
		entries = entries[len(entries)-MaxCallLogEntries:]
	}
	errorCount := 0
	for _, e := range entries {
		if e.Level == "error" {
			errorCount++
		}
	}
	data, err := json.Marshal(entries)
	if err != nil {
		return CallLog{}, err
	}

	if c.StartedAt == 0 {
		c.StartedAt = time.Now().UnixMilli()
	}
	ts := now()
	_, err = tx.ExecContext(ctx,
		`INSERT INTO call_logs (contact_id, agent_id, phone_number, inbound, outcome, started_at, ended_at,
		   entry_count, error_count, entries, created_on, updated_on)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (contact_id) DO UPDATE SET
		   phone_number = COALESCE(NULLIF(excluded.phone_number, ''), call_logs.phone_number),
		   outcome = COALESCE(NULLIF(excluded.outcome, ''), call_logs.outcome),
		   ended_at = COALESCE(NULLIF(excluded.ended_at, 0), call_logs.ended_at),
		   entry_count = excluded.entry_count, error_count = excluded.error_count,
		   entries = excluded.entries, updated_on = excluded.updated_on`,
		c.ContactID, agentID, c.PhoneNumber, c.Inbound, c.Outcome, c.StartedAt, c.EndedAt,
		len(entries), errorCount, string(data), ts, ts)
	if err != nil {
		return CallLog{}, err
	}

	cutoff := time.Now().Add(-callLogRetention).UnixMilli()
	if _, err := tx.ExecContext(ctx, `DELETE FROM call_logs WHERE started_at < ?`, cutoff); err != nil {
		return CallLog{}, err
	}

	var saved CallLog
	if err := tx.GetContext(ctx, &saved, callLogSelect+` WHERE l.contact_id = ?`, c.ContactID); err != nil {
		return CallLog{}, err
	}
	return saved, tx.Commit()
}

// ListCallLogs returns the user's call logs, newest first, without entries.
func (db *DB) ListCallLogs(ctx context.Context, username string, maxRecords int) ([]CallLog, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	logs := []CallLog{}
	err := db.SelectContext(ctx, &logs,
		callLogSelect+` WHERE u.username = ? ORDER BY l.started_at DESC, l.id DESC LIMIT ?`,
		username, limit(maxRecords))
	return logs, err
}

// GetCallLog returns the full log for contactID, if the user owns it.
func (db *DB) GetCallLog(ctx context.Context, username, contactID string) (CallLog, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var row struct {
		CallLog
		Entries string `db:"entries"`
	}
	err := db.GetContext(ctx, &row,
		strings.Replace(callLogSelect, "SELECT ", "SELECT l.entries, ", 1)+` WHERE l.contact_id = ? AND u.username = ?`,
		contactID, username)
	if errors.Is(err, sql.ErrNoRows) {
		return CallLog{}, false, nil
	}
	if err != nil {
		return CallLog{}, false, err
	}

	c := row.CallLog
	err = json.Unmarshal([]byte(row.Entries), &c.Entries)
	return c, true, err
}

// FlowCall is an inbound call as seen in the Connect contact flow. Times are
// unix ms; 0 means the call hasn't reached that stage.
type FlowCall struct {
	ContactID      string `db:"contact_id" json:"contactId"`
	PhoneNumber    string `db:"phone_number" json:"phoneNumber"`
	QueueName      string `db:"queue_name" json:"queueName"`
	AgentName      string `db:"agent_name" json:"agentName"`
	AgentUsername  string `db:"agent_username" json:"agentUsername"`
	InitiatedAt    int64  `db:"initiated_at" json:"initiatedAt"`
	EnqueuedAt     int64  `db:"enqueued_at" json:"enqueuedAt"`
	ConnectedAt    int64  `db:"connected_at" json:"connectedAt"`
	DisconnectedAt int64  `db:"disconnected_at" json:"disconnectedAt"`
}

const flowCallSelect = `SELECT contact_id, COALESCE(phone_number, '') AS phone_number,
	COALESCE(queue_name, '') AS queue_name, COALESCE(agent_name, '') AS agent_name,
	COALESCE(agent_username, '') AS agent_username, initiated_at, enqueued_at, connected_at, disconnected_at
	FROM flow_calls`

// UpsertFlowCall stores the latest state of c, keyed by contact id.
func (db *DB) UpsertFlowCall(ctx context.Context, c FlowCall) error {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	ts := now()
	_, err := db.ExecContext(ctx,
		`INSERT INTO flow_calls (contact_id, phone_number, queue_name, agent_name, agent_username,
		   initiated_at, enqueued_at, connected_at, disconnected_at, created_on, updated_on)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (contact_id) DO UPDATE SET
		   phone_number = excluded.phone_number, queue_name = excluded.queue_name,
		   agent_name = excluded.agent_name, agent_username = excluded.agent_username,
		   initiated_at = excluded.initiated_at,
		   enqueued_at = excluded.enqueued_at, connected_at = excluded.connected_at,
		   disconnected_at = excluded.disconnected_at, updated_on = excluded.updated_on`,
		c.ContactID, c.PhoneNumber, c.QueueName, c.AgentName, c.AgentUsername,
		c.InitiatedAt, c.EnqueuedAt, c.ConnectedAt, c.DisconnectedAt, ts, ts)
	return err
}

// ListFlowCalls returns calls initiated at or after since (unix ms), newest first.
func (db *DB) ListFlowCalls(ctx context.Context, since int64, maxRecords int) ([]FlowCall, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	calls := []FlowCall{}
	err := db.SelectContext(ctx, &calls,
		flowCallSelect+` WHERE initiated_at >= ? ORDER BY initiated_at DESC, id DESC LIMIT ?`,
		since, limit(maxRecords))
	return calls, err
}

// ListFlowCallsByNumber returns calls from phoneNumber initiated at or after
// since (unix ms), newest first.
func (db *DB) ListFlowCallsByNumber(ctx context.Context, phoneNumber string, since int64, maxRecords int) ([]FlowCall, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	calls := []FlowCall{}
	err := db.SelectContext(ctx, &calls,
		flowCallSelect+` WHERE phone_number = ? AND initiated_at >= ? ORDER BY initiated_at DESC, id DESC LIMIT ?`,
		phoneNumber, since, limit(maxRecords))
	return calls, err
}

// FlowCallBucket holds the calls initiated in [Start, Start+bucket). Start is
// unix ms; Calls are newest first.
type FlowCallBucket struct {
	Start     int64      `json:"start"`
	Total     int        `json:"total"`
	Answered  int        `json:"answered"`
	Abandoned int        `json:"abandoned"`
	Calls     []FlowCall `json:"calls"`
}

// FlowCallTimeline groups calls initiated at or after since (unix ms) into
// bucket-wide slots aligned to the epoch, newest first. Empty slots are omitted.
func (db *DB) FlowCallTimeline(ctx context.Context, since int64, bucket time.Duration) ([]FlowCallBucket, error) {
	calls, err := db.ListFlowCalls(ctx, since, 0)
	if err != nil {
		return nil, err
	}

	width := bucket.Milliseconds()
	buckets := []FlowCallBucket{}
	for _, c := range calls {
		start := c.InitiatedAt - c.InitiatedAt%width
		if n := len(buckets); n == 0 || buckets[n-1].Start != start {
			buckets = append(buckets, FlowCallBucket{Start: start})
		}
		b := &buckets[len(buckets)-1]
		b.Total++
		switch {
		case c.ConnectedAt != 0:
			b.Answered++
		case c.DisconnectedAt != 0:
			b.Abandoned++
		}
		b.Calls = append(b.Calls, c)
	}
	return buckets, nil
}

// PruneFlowCalls deletes calls initiated before before (unix ms).
func (db *DB) PruneFlowCalls(ctx context.Context, before int64) error {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err := db.ExecContext(ctx, `DELETE FROM flow_calls WHERE initiated_at < ?`, before)
	return err
}
