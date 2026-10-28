package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tyler71/owlchirp/app/internal/connect"
	"github.com/tyler71/owlchirp/app/internal/database"
	"github.com/tyler71/owlchirp/app/internal/realtime"
)

const (
	maxIncidentLength = 100
	maxThoughtsLength = 4000
)

var validMoods = map[string]bool{"": true, "intense": true, "friendly": true, "spam": true}

// clientError is a problem with the request; its message is sent to the
// client. Any other error is logged and reported generically.
type clientError string

func (e clientError) Error() string { return string(e) }

type wsHandler func(ctx context.Context, user connect.RegisteredUser, data json.RawMessage) (any, error)

func (app *application) wsHandlers() map[string]wsHandler {
	return map[string]wsHandler{
		"calls.agent":  app.wsAgentCalls,
		"calls.log":    app.wsLogCall,
		"calls.number": app.wsNumberCalls,
		"calls.detail": app.wsCallDetail,
		"callerid.get": app.wsGetCallerID,
		"callerid.set": app.wsSetCallerID,
		"wrapups.list": app.wsListWrapups,
		"wrapups.save": app.wsSaveWrapup,
	}
}

func (app *application) handleRequest(ctx context.Context, user connect.RegisteredUser, enabled bool, req wsRequest) wsReply {
	if !enabled {
		return wsReply{ID: req.ID, Type: "error", Error: "owlchirp is not enabled for this user"}
	}

	handler, ok := app.handlers[req.Type]
	if !ok {
		return wsReply{ID: req.ID, Type: "error", Error: fmt.Sprintf("unknown request type %q", req.Type)}
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

func (app *application) wsAgentCalls(ctx context.Context, user connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		MaxRecords int `json:"maxRecords"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}

	if _, err := app.db.GetOrCreateUser(ctx, user.Username); err != nil {
		return nil, err
	}
	return app.db.GetAgentCalls(ctx, user.Username, input.MaxRecords)
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
	if err := requireField("name", input.Name); err != nil {
		return nil, err
	}

	if err := app.db.UpsertCallerID(ctx, input.PhoneNumber, input.Name); err != nil {
		return nil, err
	}

	app.broadcast("callerid.updated", input)
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
