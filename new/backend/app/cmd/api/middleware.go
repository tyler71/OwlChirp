package main

import (
	"fmt"
	"log/slog"
	"net/http"

	"github.com/tyler71/owlchirp/app/internal/response"
)

func (app *application) recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			pv := recover()
			if pv != nil {
				app.serverError(w, r, fmt.Errorf("%s", pv))
			}
		}()

		next.ServeHTTP(w, r)
	})
}

func (app *application) logRequest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mw := response.NewMetricsResponseWriter(w)
		next.ServeHTTP(mw, r)

		var (
			ip     = r.RemoteAddr
			method = r.Method
			url    = r.URL.String()
			proto  = r.Proto
		)

		userAttrs := slog.Group("user", "ip", ip)
		requestAttrs := slog.Group("request", "method", method, "url", url, "proto", proto)
		responseAttrs := slog.Group("response", "status", mw.StatusCode, "size", mw.BytesCount)

		app.logger.Debug("access", userAttrs, requestAttrs, responseAttrs)
	})
}

// requireAPIKey rejects requests without a valid X-Api-Key header.
func (app *application) requireAPIKey(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ok, err := app.auth.Verify(r.Context(), r.Header.Get("X-Api-Key"))
		if err != nil {
			app.serverError(w, r, err)
			return
		}
		if !ok {
			app.unauthorized(w, r)
			return
		}

		next.ServeHTTP(w, r)
	})
}
