package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/tyler71/owlchirp/app/internal/connect"
	"github.com/tyler71/owlchirp/app/internal/database"
	"github.com/tyler71/owlchirp/app/internal/features"
	"github.com/tyler71/owlchirp/app/internal/realtime"
)

const (
	maxCallerIDNameLength = 30

	maxIncidentLength = 100
	maxThoughtsLength = 4000

	maxLogEntriesPerRequest = 500
	maxLogTextLength        = 2000

	maxHelpNameLength = 100
	helpCooldown      = 30 * time.Second
)

var validMoods = map[string]bool{"": true, "intense": true, "friendly": true, "spam": true}

var validOutcomes = map[string]bool{"": true, "failed": true, "missed": true}

// Theme names are daisyUI theme names or "system"; the frontend owns the list.
var validTheme = regexp.MustCompile(`^[a-z]{0,20}$`)

// clientError is a problem with the request; its message is sent to the
// client. Any other error is logged and reported generically.
type clientError string

func (e clientError) Error() string { return string(e) }

type wsHandler func(ctx context.Context, user connect.RegisteredUser, data json.RawMessage) (any, error)

func (app *application) wsHandlers() map[string]wsHandler {
	return map[string]wsHandler{
		"calls.agent":           app.wsAgentCalls,
		"calls.all":             app.wsAllCalls,
		"calls.log":             app.wsLogCall,
		"calls.number":          app.wsNumberCalls,
		"calls.detail":          app.wsCallDetail,
		"callerid.get":          app.wsGetCallerID,
		"callerid.set":          app.wsSetCallerID,
		"callerid.list":         app.wsListCallerIDs,
		"callerid.delete":       app.wsDeleteCallerID,
		"wrapups.list":          app.wsListWrapups,
		"wrapups.save":          app.wsSaveWrapup,
		"settings.get":          app.wsGetSettings,
		"settings.save":         app.wsSaveSettings,
		"syslog.append":         app.wsAppendCallLog,
		"syslog.list":           app.wsListCallLogs,
		"syslog.get":            app.wsGetCallLog,
		"flowcalls.list":        app.wsListFlowCalls,
		"flowcalls.timeline":    app.wsFlowTimeline,
		"flowcalls.number":      app.wsFlowCallsByNumber,
		"help.request":          app.wsRequestHelp,
		"users.list":            app.wsListUsers,
		"users.setFeatures":     app.wsSetFeatures,
		"users.resetFeatures":   app.wsResetFeatures,
	}
}

// requestFeature lists requests that need a feature; the rest are open to
// every user.
var requestFeature = map[string]string{
	"calls.all":        features.CallsAll,
	"flowcalls.number": features.CallerHistory,
	"callerid.list":    features.CallerIDs, "callerid.delete": features.CallerIDs,
	"users.list": features.Admin, "users.setFeatures": features.Admin, "users.resetFeatures": features.Admin,
}

// handleRequest serves req if user has the feature it needs.
func (app *application) handleRequest(ctx context.Context, user connect.RegisteredUser, req wsRequest) wsReply {
	handler, ok := app.handlers[req.Type]
	if !ok {
		return wsReply{ID: req.ID, Type: "error", Error: fmt.Sprintf("unknown request type %q", req.Type)}
	}
	if f, ok := requestFeature[req.Type]; ok && !app.perms.has(user.Username, f) {
		return wsReply{ID: req.ID, Type: "error", Error: "permission denied"}
	}

	data, err := handler(ctx, user, req.Data)
	if err != nil {
		var ce clientError
		if errors.As(err, &ce) {
			return wsReply{ID: req.ID, Type: "error", Error: ce.Error()}
		}
		app.logger.Error("websocket request", "type", req.Type, "user", user.Username, "error", err)
		return wsReply{ID: req.ID, Type: "error", Error: "internal error"}
	}
	return wsReply{ID: req.ID, Type: "result", Data: data}
}

func (app *application) broadcast(typ string, data any) {
	msg, err := realtime.Message(typ, data)
	if err != nil {
		app.logger.Error("websocket encode broadcast", "type", typ, "error", err)
		return
	}
	app.hub.Broadcast(msg)
}

func decode(data json.RawMessage, v any) error {
	if len(data) == 0 {
		data = []byte("{}")
	}
	if err := json.Unmarshal(data, v); err != nil {
		return clientError("invalid request data: " + err.Error())
	}
	return nil
}

func requireField(name, value string) error {
	if strings.TrimSpace(value) == "" {
		return clientError(name + " is required")
	}
	return nil
}

// callPage is one page of calls plus the total across all pages.
type callPage struct {
	Calls []database.RecentCall `json:"calls"`
	Total int                   `json:"total"`
}

type callPageInput struct {
	MaxRecords int `json:"maxRecords"`
	Offset     int `json:"offset"`
}

// wsAgentCalls returns one page of the requesting agent's calls.
func (app *application) wsAgentCalls(ctx context.Context, user connect.RegisteredUser, data json.RawMessage) (any, error) {
	if _, err := app.db.GetOrCreateUser(ctx, user.Username); err != nil {
		return nil, err
	}
	return app.recentCallPage(ctx, user.Username, data)
}

// wsAllCalls returns one page of calls from every agent.
func (app *application) wsAllCalls(ctx context.Context, _ connect.RegisteredUser, data json.RawMessage) (any, error) {
	return app.recentCallPage(ctx, "", data)
}

// recentCallPage serves both call lists from the shared flow_calls store,
// merged with calls only a browser logged. An empty username means all agents.
func (app *application) recentCallPage(ctx context.Context, username string, data json.RawMessage) (any, error) {
	var input callPageInput
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	calls, err := app.db.ListRecentCalls(ctx, username, input.MaxRecords, input.Offset)
	if err != nil {
		return nil, err
	}
	total, err := app.db.CountRecentCalls(ctx, username)
	if err != nil {
		return nil, err
	}
	return callPage{Calls: calls, Total: total}, nil
}

func (app *application) wsLogCall(ctx context.Context, user connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		PhoneNumber string `json:"phoneNumber"`
		Timestamp   int64  `json:"timestamp"`
		ContactID   string `json:"contactId"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if err := requireField("phoneNumber", input.PhoneNumber); err != nil {
		return nil, err
	}

	if input.Timestamp == 0 {
		input.Timestamp = time.Now().UnixMilli()
	}

	if err := app.db.AddPhoneLog(ctx, user.Username, input.PhoneNumber, input.Timestamp, input.ContactID); err != nil {
		return nil, err
	}

	call := database.Call{Agent: user.Username, PhoneNumber: input.PhoneNumber, Timestamp: input.Timestamp, ContactID: input.ContactID}
	app.broadcast("call.logged", call)
	return call, nil
}

func (app *application) wsNumberCalls(ctx context.Context, _ connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		PhoneNumber string `json:"phoneNumber"`
		MaxRecords  int    `json:"maxRecords"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if err := requireField("phoneNumber", input.PhoneNumber); err != nil {
		return nil, err
	}
	return app.db.GetPhoneCalls(ctx, input.PhoneNumber, input.MaxRecords)
}

func (app *application) wsCallDetail(ctx context.Context, _ connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		ContactID string `json:"contactId"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if err := requireField("contactId", input.ContactID); err != nil {
		return nil, err
	}

	detail, err := app.connect.DescribeContact(ctx, input.ContactID)
	if err != nil {
		app.logger.Error("describe contact", "contact_id", input.ContactID, "error", err)
		return nil, clientError("contact not found")
	}
	return detail, nil
}

// wsGetCallerID returns null when the number has no saved name.
func (app *application) wsGetCallerID(ctx context.Context, _ connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		PhoneNumber string `json:"phoneNumber"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if err := requireField("phoneNumber", input.PhoneNumber); err != nil {
		return nil, err
	}

	callerID, found, err := app.db.GetCallerID(ctx, input.PhoneNumber)
	if err != nil || !found {
		return nil, err
	}
	return callerID, nil
}

func (app *application) wsSetCallerID(ctx context.Context, _ connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input database.CallerID
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if err := requireField("phoneNumber", input.PhoneNumber); err != nil {
		return nil, err
	}
	input.Name = strings.TrimSpace(input.Name)
	if err := requireField("name", input.Name); err != nil {
		return nil, err
	}
	if utf8.RuneCountInString(input.Name) > maxCallerIDNameLength {
		return nil, clientError(fmt.Sprintf("name must be at most %d characters", maxCallerIDNameLength))
	}

	if err := app.db.UpsertCallerID(ctx, input.PhoneNumber, input.Name); err != nil {
		return nil, err
	}

	app.broadcast("callerid.updated", input)
	return input, nil
}

func (app *application) wsListCallerIDs(ctx context.Context, _ connect.RegisteredUser, _ json.RawMessage) (any, error) {
	return app.db.ListCallerIDs(ctx)
}

func (app *application) wsDeleteCallerID(ctx context.Context, _ connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		PhoneNumber string `json:"phoneNumber"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if err := requireField("phoneNumber", input.PhoneNumber); err != nil {
		return nil, err
	}

	found, err := app.db.DeleteCallerID(ctx, input.PhoneNumber)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, clientError("caller id not found")
	}

	app.broadcast("callerid.deleted", input)
	return input, nil
}

func (app *application) wsListWrapups(ctx context.Context, _ connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		PhoneNumber string `json:"phoneNumber"`
		MaxRecords  int    `json:"maxRecords"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if err := requireField("phoneNumber", input.PhoneNumber); err != nil {
		return nil, err
	}
	return app.db.GetWrapups(ctx, input.PhoneNumber, input.MaxRecords)
}

func (app *application) wsSaveWrapup(ctx context.Context, user connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input database.Wrapup
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if err := requireField("contactId", input.ContactID); err != nil {
		return nil, err
	}
	if err := requireField("phoneNumber", input.PhoneNumber); err != nil {
		return nil, err
	}

	input.Incident = strings.TrimSpace(input.Incident)
	input.Thoughts = strings.TrimSpace(input.Thoughts)
	if !validMoods[input.Mood] {
		return nil, clientError("mood must be intense, friendly or spam")
	}
	if utf8.RuneCountInString(input.Incident) > maxIncidentLength {
		return nil, clientError(fmt.Sprintf("incident must be at most %d characters", maxIncidentLength))
	}
	if utf8.RuneCountInString(input.Thoughts) > maxThoughtsLength {
		return nil, clientError(fmt.Sprintf("thoughts must be at most %d characters", maxThoughtsLength))
	}
	if input.Incident == "" && input.Mood == "" && input.Thoughts == "" {
		return nil, clientError("wrap-up is empty")
	}

	saved, err := app.db.UpsertWrapup(ctx, user.Username, input)
	if err != nil {
		return nil, err
	}

	app.broadcast("wrapup.saved", saved)
	return saved, nil
}

func (app *application) wsGetSettings(ctx context.Context, user connect.RegisteredUser, _ json.RawMessage) (any, error) {
	return app.db.GetSettings(ctx, user.Username)
}

// wsSaveSettings replaces the user's settings. Not broadcast: settings are
// private to the user.
func (app *application) wsSaveSettings(ctx context.Context, user connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input database.Settings
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if !validTheme.MatchString(input.Theme) {
		return nil, clientError("theme is invalid")
	}
	return app.db.SaveSettings(ctx, user.Username, input)
}

// truncate shortens s to at most n runes.
func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

// wsAppendCallLog adds a batch of the agent's own diagnostic entries for a
// contact. Not broadcast: logs are private to the user.
func (app *application) wsAppendCallLog(ctx context.Context, user connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input database.CallLog
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if err := requireField("contactId", input.ContactID); err != nil {
		return nil, err
	}
	if !validOutcomes[input.Outcome] {
		return nil, clientError("outcome must be failed or missed")
	}
	if len(input.Entries) > maxLogEntriesPerRequest {
		return nil, clientError(fmt.Sprintf("at most %d entries per request", maxLogEntriesPerRequest))
	}
	for i := range input.Entries {
		e := &input.Entries[i]
		e.Source = truncate(e.Source, 20)
		e.Level = truncate(e.Level, 10)
		e.Message = truncate(e.Message, maxLogTextLength)
		e.Detail = truncate(e.Detail, maxLogTextLength)
	}
	return app.db.AppendCallLog(ctx, user.Username, input)
}

func (app *application) wsListCallLogs(ctx context.Context, user connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		MaxRecords int `json:"maxRecords"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	return app.db.ListCallLogs(ctx, user.Username, input.MaxRecords)
}

func (app *application) wsGetCallLog(ctx context.Context, user connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		ContactID string `json:"contactId"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if err := requireField("contactId", input.ContactID); err != nil {
		return nil, err
	}

	log, found, err := app.db.GetCallLog(ctx, user.Username, input.ContactID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, clientError("log not found")
	}
	return log, nil
}

// wsListFlowCalls returns inbound calls from the last input.Hours (default
// 24), newest first. Updates arrive as "flowcall.updated" events.
func (app *application) wsListFlowCalls(ctx context.Context, _ connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		Hours      int `json:"hours"`
		MaxRecords int `json:"maxRecords"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if input.Hours <= 0 {
		input.Hours = 24
	}
	since := time.Now().Add(-time.Duration(input.Hours) * time.Hour).UnixMilli()
	return app.db.ListFlowCalls(ctx, since, input.MaxRecords)
}

// wsFlowTimeline returns inbound calls from the last 8 weeks grouped into
// 15-minute buckets. The result is shared by all agents and cached 30 minutes.
func (app *application) wsFlowTimeline(ctx context.Context, _ connect.RegisteredUser, _ json.RawMessage) (any, error) {
	return app.timeline.Get(ctx)
}

// wsFlowCallsByNumber returns inbound calls from input.PhoneNumber over the
// timeline window, newest first.
func (app *application) wsFlowCallsByNumber(ctx context.Context, _ connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		PhoneNumber string `json:"phoneNumber"`
		MaxRecords  int    `json:"maxRecords"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if input.PhoneNumber == "" {
		return nil, clientError("phoneNumber is required")
	}
	if input.MaxRecords <= 0 {
		input.MaxRecords = 100
	}
	since := time.Now().Add(-timelineWindow).UnixMilli()
	return app.db.ListFlowCallsByNumber(ctx, input.PhoneNumber, since, input.MaxRecords)
}

// helpLimiter remembers when each agent last asked for help so one agent
// can't flood everyone with popups. The zero value is ready to use.
type helpLimiter struct {
	mu   sync.Mutex
	last map[string]time.Time
}

// allow reports whether username may ask for help now, and if so records it.
func (l *helpLimiter) allow(username string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	if now.Sub(l.last[username]) < helpCooldown {
		return false
	}
	if l.last == nil {
		l.last = make(map[string]time.Time)
	}
	l.last[username] = now
	return true
}

type helpRequest struct {
	Agent      string `json:"agent"`
	Name       string `json:"name"`
	QueueCount int    `json:"queueCount"`
	Timestamp  int64  `json:"timestamp"`
}

// wsRequestHelp asks agents who aren't taking calls to become available.
// Every client gets the "help.requested" event; each decides from its own
// agent state whether to show it.
func (app *application) wsRequestHelp(_ context.Context, user connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		Name       string `json:"name"`
		QueueCount int    `json:"queueCount"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}

	now := time.Now()
	if !app.help.allow(user.Username, now) {
		return nil, clientError("help was already requested")
	}

	req := helpRequest{
		Agent:      user.Username,
		Name:       truncate(strings.TrimSpace(input.Name), maxHelpNameLength),
		QueueCount: input.QueueCount,
		Timestamp:  now.UnixMilli(),
	}
	if req.Name == "" {
		req.Name = user.Username
	}

	app.broadcast("help.requested", req)
	return req, nil
}
