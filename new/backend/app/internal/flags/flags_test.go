package flags

import (
	"context"
	"encoding/json"
	"fmt"
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

// fakeRelay answers OFREP evaluations of owlchirp: level for user, Standard
// for anyone else. Other paths (configuration polling) get a 404.
func fakeRelay(t *testing.T, user string, level int, status int) *httptest.Server {
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

		value := Standard
		if body.Context["targetingKey"] == user {
			value = level
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"key":     OwlchirpKey,
			"value":   value,
			"variant": fmt.Sprint(value),
			"reason":  "TARGETING_MATCH",
		})
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestPermissionNoEndpoint(t *testing.T) {
	c, err := New("", "", testLogger())
	assert.Nil(t, err)
	defer c.Close()

	assert.Equal(t, c.Permission(context.Background(), "agent@example.com"), Standard)
}

func TestPermissionTargetsUsername(t *testing.T) {
	srv := fakeRelay(t, "agent", Admin, http.StatusOK)

	c, err := New(srv.URL, "", testLogger())
	assert.Nil(t, err)
	defer c.Close()

	assert.Equal(t, c.Permission(context.Background(), "agent@example.com"), Admin)
	assert.Equal(t, c.Permission(context.Background(), "someone@example.com"), Standard)
}

func TestPermissionClamps(t *testing.T) {
	srv := fakeRelay(t, "agent", 7, http.StatusOK)

	c, err := New(srv.URL, "", testLogger())
	assert.Nil(t, err)
	defer c.Close()

	assert.Equal(t, c.Permission(context.Background(), "agent@example.com"), Admin)
}

func TestPermissionFailsClosed(t *testing.T) {
	srv := fakeRelay(t, "agent", Admin, http.StatusInternalServerError)

	c, err := New(srv.URL, "", testLogger())
	assert.Nil(t, err)
	defer c.Close()

	assert.Equal(t, c.Permission(context.Background(), "agent@example.com"), Standard)
}
