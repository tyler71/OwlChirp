package connect

import (
	"testing"
	"time"

	"github.com/tyler71/owlchirp/app/internal/assert"
)

func TestHandledIncomingWindow(t *testing.T) {
	start, end := handledIncomingWindow(time.Date(2026, 10, 26, 18, 47, 30, 0, time.UTC))
	assert.Equal(t, end, time.Date(2026, 10, 26, 18, 45, 0, 0, time.UTC))
	assert.Equal(t, start, time.Date(2026, 10, 26, 5, 45, 0, 0, time.UTC))

	// Before 05:00 UTC the window starts the previous day.
	start, end = handledIncomingWindow(time.Date(2026, 10, 26, 2, 12, 0, 0, time.UTC))
	assert.Equal(t, end, time.Date(2026, 10, 26, 2, 10, 0, 0, time.UTC))
	assert.Equal(t, start, time.Date(2026, 10, 25, 5, 10, 0, 0, time.UTC))
	assert.True(t, end.Sub(start) <= 24*time.Hour)
}
