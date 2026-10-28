package flags

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tyler71/owlchirp/app/internal/assert"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// fakeRelay answers OFREP evaluations of owlchirp: true for enabledUser,
// false for anyone else. Other paths (configuration polling) get a 404.
func fakeRelay(t *testing.T, enabledUser string, status int) *httptest.Server {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ofrep/v1/evaluate/flags/"+OwlchirpKey {
			http.NotFound(w, r)
			return
		}
		if status != http.StatusOK {
			w.WriteHeader(status)
			return
		}

		var body struct {
			Context map[string]any `json:"context"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		value := body.Context["targetingKey"] == enabledUser
		variant := "disabled"
		if value {
			variant = "enabled"
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"key":     OwlchirpKey,
			"value":   value,
			"variant": variant,
			"reason":  "TARGETING_MATCH",
		})
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestOwlchirpNoEndpoint(t *testing.T) {
	c, err := New("", "", testLogger())
	assert.Nil(t, err)
	defer c.Close()

	assert.False(t, c.Owlchirp(context.Background(), "agent@example.com"))
}

func TestOwlchirpTargetsUsername(t *testing.T) {
	srv := fakeRelay(t, "agent@example.com", http.StatusOK)

	c, err := New(srv.URL, "", testLogger())
	assert.Nil(t, err)
	defer c.Close()

	assert.True(t, c.Owlchirp(context.Background(), "agent@example.com"))
	assert.False(t, c.Owlchirp(context.Background(), "someone@example.com"))
}

func TestOwlchirpFailsClosed(t *testing.T) {
	srv := fakeRelay(t, "agent@example.com", http.StatusInternalServerError)

	c, err := New(srv.URL, "", testLogger())
	assert.Nil(t, err)
	defer c.Close()

	assert.False(t, c.Owlchirp(context.Background(), "agent@example.com"))
}
