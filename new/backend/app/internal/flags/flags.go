// Package flags evaluates feature flags against a GO Feature Flag relay proxy
// through OpenFeature. Every evaluation fails closed: errors yield Standard.
package flags

import (
	"context"
	"log/slog"
	"strings"
	"time"

	gofeatureflag "github.com/open-feature/go-sdk-contrib/providers/go-feature-flag/pkg"
	"github.com/open-feature/go-sdk/openfeature"
)

// OwlchirpKey is the integer flag holding a user's Owlchirp permission level.
const OwlchirpKey = "owlchirp"

// Permission levels. Each level includes everything below it, so compare
// with >=.
const (
	Standard = 0
	Power    = 1
	Admin    = 2
)

const initTimeout = 10 * time.Second

type Client struct {
	of     *openfeature.Client
	logger *slog.Logger
}

// New returns a Client backed by the relay proxy at endpoint, authenticating
// with apiKey when the relay requires one. With an empty endpoint no provider
// is set, so OpenFeature's no-op provider answers every evaluation with the
// default (Standard).
func New(endpoint, apiKey string, logger *slog.Logger) (*Client, error) {
	if endpoint != "" {
		provider, err := gofeatureflag.NewProvider(gofeatureflag.ProviderOptions{
			Endpoint:              endpoint,
			APIKey:                apiKey,
			EvaluationType:        gofeatureflag.EvaluationTypeRemote,
			DataCollectorDisabled: true,
			Logger:                logger,
		})
		if err != nil {
			return nil, err
		}

		ctx, cancel := context.WithTimeout(context.Background(), initTimeout)
		defer cancel()

		err = openfeature.SetProviderWithContextAndWait(ctx, provider)
		if err != nil {
			return nil, err
		}
	}

	return &Client{of: openfeature.NewClient("owlchirp"), logger: logger}, nil
}

// Permission returns username's permission level from the owlchirp flag,
// clamped to Standard..Admin. The targeting key is the part of username before
// any "@". Errors are logged and treated as Standard.
func (c *Client) Permission(ctx context.Context, username string) int {
	key, _, _ := strings.Cut(username, "@")
	details, err := c.of.IntValueDetails(ctx, OwlchirpKey, Standard, openfeature.NewEvaluationContext(key, nil))
	if err != nil {
		c.logger.Warn("evaluate flag", "flag", OwlchirpKey, "username", username, "error", err)
		return Standard
	}
	return int(min(max(details.Value, Standard), Admin))
}

func (c *Client) Close() {
	openfeature.Shutdown()
}
