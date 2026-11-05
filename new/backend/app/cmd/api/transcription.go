package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/tyler71/owlchirp/app/internal/connect"
	"github.com/tyler71/owlchirp/app/internal/transcribe"
)

// A connection runs at most one transcription, under this job name.
const transcriptJob = "transcript"

type transcriptRequest struct {
	ContactID string `json:"contactId"`
}

type transcriptEnded struct {
	ContactID string `json:"contactId"`
	Reason    string `json:"reason"` // stopped, ended, contactChanged, error
	Error     string `json:"error,omitempty"`
}

// wsStartTranscript starts live transcription of the agent's current
// contact. Audio is read from the contact's Kinesis Video Stream and text
// is pushed to this connection only as "transcript.segment" events,
// followed by one "transcript.ended". Nothing is stored.
func (app *application) wsStartTranscript(ctx context.Context, user connect.RegisteredUser, data json.RawMessage) (any, error) {
	var req transcriptRequest
	if err := decode(data, &req); err != nil {
		return nil, err
	}
	req.ContactID = strings.TrimSpace(req.ContactID)
	if req.ContactID == "" {
		return nil, clientError("contactId is required")
	}
	session := sessionFrom(ctx)
	if session == nil {
		return nil, errors.New("transcription needs a websocket session")
	}

	arn, err := app.connect.ContactStream(ctx, req.ContactID, user.ID, app.config.transcription.streamAttribute)
	switch {
	case errors.Is(err, connect.ErrNotAgentContact):
		return nil, clientError("this call isn't connected to you yet")
	case errors.Is(err, connect.ErrNoMediaStream):
		return nil, clientError("media streaming isn't enabled for this call")
	case err != nil:
		return nil, err
	}

	contactID := req.ContactID
	logger := app.logger.With("user", user.Username, "contact", contactID)
	logger.Info("transcription started")

	session.start(transcriptJob, func(ctx context.Context) error {
		return app.transcriber.Run(ctx, contactID, arn, func(seg transcribe.Segment) {
			// Partials are superseded quickly, so they may be dropped when
			// the client is slow; final text is not.
			session.send("transcript.segment", seg, seg.Partial)
		})
	}, func(err error, cancelled bool) {
		ended := transcriptEnded{ContactID: contactID, Reason: "ended"}
		switch {
		case cancelled:
			ended.Reason = "stopped"
		case errors.Is(err, transcribe.ErrContactChanged):
			ended.Reason = "contactChanged"
		case err != nil:
			logger.Error("transcription", "error", err)
			ended.Reason, ended.Error = "error", "transcription failed"
		}
		logger.Info("transcription ended", "reason", ended.Reason)
		session.send("transcript.ended", ended, false)
	})

	return map[string]string{"contactId": contactID}, nil
}

func (app *application) wsStopTranscript(ctx context.Context, user connect.RegisteredUser, data json.RawMessage) (any, error) {
	session := sessionFrom(ctx)
	if session == nil {
		return nil, errors.New("transcription needs a websocket session")
	}
	return map[string]bool{"stopped": session.stopJob(transcriptJob)}, nil
}
