package main

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/tyler71/owlchirp/app/internal/request"
	"github.com/tyler71/owlchirp/app/internal/response"
)

func (app *application) ping(w http.ResponseWriter, r *http.Request) {
	err := response.JSON(w, http.StatusOK, map[string]string{"response": "pong"})
	if err != nil {
		app.serverError(w, r, err)
	}
}

// frontendConfig exposes instance settings that the webpack build used to
// bake into the bundle, so one frontend build works for any instance.
func (app *application) frontendConfig(w http.ResponseWriter, r *http.Request) {
	data := map[string]string{
		"connectDomain":   app.config.connect.domain,
		"connectInstance": app.config.connect.instance,
		"timeZone":        app.config.frontend.timeZone,
		"telemetryUrl":    app.config.frontend.telemetryURL,
	}

	err := response.JSON(w, http.StatusOK, data)
	if err != nil {
		app.serverError(w, r, err)
	}
}

func maxRecords(r *http.Request) (int, error) {
	v := r.URL.Query().Get("max_records")
	if v == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return 0, errors.New("max_records must be a positive integer")
	}
	return n, nil
}

func (app *application) getAgentCalls(w http.ResponseWriter, r *http.Request) {
	username := r.URL.Query().Get("username")
	if username == "" {
		app.badRequest(w, r, errors.New("username is required"))
		return
	}

	limit, err := maxRecords(r)
	if err != nil {
		app.badRequest(w, r, err)
		return
	}

	if _, err := app.db.GetOrCreateUser(r.Context(), username); err != nil {
		app.serverError(w, r, err)
		return
	}

	calls, err := app.db.GetAgentCalls(r.Context(), username, limit)
	if err != nil {
		app.serverError(w, r, err)
		return
	}

	err = response.JSON(w, http.StatusOK, calls)
	if err != nil {
		app.serverError(w, r, err)
	}
}

func (app *application) addAgentCall(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Agent       string `json:"agent"`
		PhoneNumber string `json:"phoneNumber"`
		Timestamp   int64  `json:"timestamp"`
		ContactID   string `json:"contactId"`
	}

	if err := request.DecodeJSON(w, r, &input); err != nil {
		app.badRequest(w, r, err)
		return
	}
	if input.Agent == "" || input.PhoneNumber == "" {
		app.badRequest(w, r, errors.New("agent and phoneNumber are required"))
		return
	}

	err := app.db.AddPhoneLog(r.Context(), input.Agent, input.PhoneNumber, input.Timestamp, input.ContactID)
	if err != nil {
		app.serverError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusCreated)
}

func (app *application) getNumberCalls(w http.ResponseWriter, r *http.Request) {
	phoneNumber := r.URL.Query().Get("phone_number")
	if phoneNumber == "" {
		app.badRequest(w, r, errors.New("phone_number is required"))
		return
	}

	limit, err := maxRecords(r)
	if err != nil {
		app.badRequest(w, r, err)
		return
	}

	calls, err := app.db.GetPhoneCalls(r.Context(), phoneNumber, limit)
	if err != nil {
		app.serverError(w, r, err)
		return
	}

	type numberCall struct {
		PhoneNumber string `json:"phoneNumber"`
		Timestamp   int64  `json:"timestamp"`
		Agent       string `json:"agent"`
	}
	out := make([]numberCall, len(calls))
	for i, c := range calls {
		out[i] = numberCall{PhoneNumber: c.PhoneNumber, Timestamp: c.Timestamp, Agent: c.Agent}
	}

	err = response.JSON(w, http.StatusOK, out)
	if err != nil {
		app.serverError(w, r, err)
	}
}

func (app *application) getCallDetail(w http.ResponseWriter, r *http.Request) {
	contactID := r.URL.Query().Get("contact_id")
	if contactID == "" {
		app.badRequest(w, r, errors.New("contact_id is required"))
		return
	}

	detail, err := app.connect.DescribeContact(r.Context(), contactID)
	if err != nil {
		app.logger.Error("describe contact", "contact_id", contactID, "error", err)
		app.notFound(w, r)
		return
	}

	err = response.JSON(w, http.StatusOK, detail)
	if err != nil {
		app.serverError(w, r, err)
	}
}

func (app *application) getCallerID(w http.ResponseWriter, r *http.Request) {
	phoneNumber := r.URL.Query().Get("phone_number")
	if phoneNumber == "" {
		app.badRequest(w, r, errors.New("phone_number is required"))
		return
	}

	callerID, found, err := app.db.GetCallerID(r.Context(), phoneNumber)
	if err != nil {
		app.serverError(w, r, err)
		return
	}
	if !found {
		app.notFound(w, r)
		return
	}

	err = response.JSON(w, http.StatusOK, callerID)
	if err != nil {
		app.serverError(w, r, err)
	}
}

func (app *application) putCallerID(w http.ResponseWriter, r *http.Request) {
	var input struct {
		PhoneNumber string `json:"phone_number"`
		Name        string `json:"name"`
	}

	if err := request.DecodeJSON(w, r, &input); err != nil {
		app.badRequest(w, r, err)
		return
	}
	if input.PhoneNumber == "" || input.Name == "" {
		app.badRequest(w, r, errors.New("phone_number and name are required"))
		return
	}

	if err := app.db.UpsertCallerID(r.Context(), input.PhoneNumber, input.Name); err != nil {
		app.serverError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
