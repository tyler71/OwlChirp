package auth

import (
	"context"
	"testing"
	"time"

	"github.com/tyler71/owlchirp/app/internal/assert"
	"github.com/tyler71/owlchirp/app/internal/connect"
)

type fakeUsers []connect.RegisteredUser

func (f fakeUsers) RegisteredUsers(context.Context) ([]connect.RegisteredUser, error) {
	return f, nil
}

func TestTokenMatchesPythonFormula(t *testing.T) {
	// hashlib.sha256(b"1700000000abc-123agent@example.com").hexdigest()
	assert.Equal(t, Token(1700000000, "abc-123", "agent@example.com"),
		"b036cecb5bb51ff34142ecc266b47b9ba263789536f80f8528648b1228bec129")
}

func TestVerify(t *testing.T) {
	users := fakeUsers{{ID: "abc-123", Username: "agent@example.com"}}
	v := NewVerifier(users)

	now := time.Date(2026, 10, 26, 14, 37, 12, 0, time.UTC)
	v.now = func() time.Time { return now }

	hour := time.Date(2026, 10, 26, 14, 0, 0, 0, time.UTC).Unix()

	ok, err := v.Verify(context.Background(), Token(hour, "abc-123", "agent@example.com"))
	assert.Nil(t, err)
	assert.True(t, ok)

	ok, _ = v.Verify(context.Background(), Token(hour-3600, "abc-123", "agent@example.com"))
	assert.True(t, ok)

	ok, _ = v.Verify(context.Background(), Token(hour-7200, "abc-123", "agent@example.com"))
	assert.False(t, ok)

	ok, _ = v.Verify(context.Background(), Token(hour, "abc-123", "someone@example.com"))
	assert.False(t, ok)

	ok, _ = v.Verify(context.Background(), "")
	assert.False(t, ok)

	// Rolls over at midnight (the Python version did not).
	now = time.Date(2026, 10, 27, 0, 5, 0, 0, time.UTC)
	ok, _ = v.Verify(context.Background(), Token(now.Truncate(time.Hour).Unix(), "abc-123", "agent@example.com"))
	assert.True(t, ok)
}
