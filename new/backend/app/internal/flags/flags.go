// Package flags evaluates feature flags against a GO Feature Flag relay proxy
// through OpenFeature. Every evaluation fails closed: errors yield false.
package flags

import (
	"context"
	"log/slog"
	"time"

	gofeatureflag "github.com/open-feature/go-sdk-contrib/providers/go-feature-flag/pkg"
	"github.com/open-feature/go-sdk/openfeature"
)

// OwlchirpKey is the flag that enables the Owlchirp features for a user.
const OwlchirpKey = "owlchirp"

const initTimeout = 10 * time.Second

type Client struct {
	of     *openfeature.Client
	logger *slog.Logger
}

// New returns a Client backed by the relay proxy at endpoint, authenticating
// with apiKey when the relay requires one. With an empty endpoint no provider
// is set, so OpenFeature's no-op provider answers every evaluation with the
// default (false).
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

// Owlchirp reports whether the owlchirp flag is on for username. Errors are
// logged and treated as false.
func (c *Client) Owlchirp(ctx context.Context, username string) bool {
	details, err := c.of.BooleanValueDetails(ctx, OwlchirpKey, false, openfeature.NewEvaluationContext(username, nil))
	if err != nil {
		c.logger.Warn("evaluate flag", "flag", OwlchirpKey, "username", username, "error", err)
		return false
	}
	return details.Value
}

func (c *Client) Close() {
	openfeature.Shutdown()
}
