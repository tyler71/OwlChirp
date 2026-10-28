package database

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/tyler71/owlchirp/app/assets"

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

	return &DB{DB: db}, nil
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

func (db *DB) GetAgentCalls(ctx context.Context, username string, maxRecords int) ([]Call, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	calls := []Call{}
	err := db.SelectContext(ctx, &calls,
		`SELECT u.username AS agent, COALESCE(c.phone_number, '') AS phone_number,
		        COALESCE(c.timestamp, 0) AS timestamp, COALESCE(c.contact_id, '') AS contact_id
		 FROM calls c JOIN users u ON u.id = c.agent_id
		 WHERE u.username = ?
		 ORDER BY c.created_on DESC, c.id DESC
		 LIMIT ?`, username, limit(maxRecords))
	return calls, err
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
