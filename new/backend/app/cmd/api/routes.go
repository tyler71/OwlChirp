package main

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func (app *application) routes() http.Handler {
	r := chi.NewRouter()

	r.NotFound(app.notFound)
	r.MethodNotAllowed(app.methodNotAllowed)

	r.Use(app.logRequest)
	r.Use(app.recoverPanic)

	r.Get("/ping", app.ping)

	r.Route("/api", func(r chi.Router) {
		r.Get("/config", app.frontendConfig)

		// Authenticates with its first message instead of a header.
		r.Get("/ws", app.metricsSocket)

		r.Group(func(r chi.Router) {
			r.Use(app.requireAPIKey)

			r.Get("/calls/agent", app.getAgentCalls)
			r.Post("/calls/agent", app.addAgentCall)
			r.Get("/calls/number", app.getNumberCalls)
			r.Get("/calls/detail", app.getCallDetail)
			r.Get("/calls/callerid", app.getCallerID)
			r.Put("/calls/callerid", app.putCallerID)
		})

		r.NotFound(app.notFound)
	})

	if app.config.devMode {
		r.Mount("/debug", middleware.Profiler())
	}

	r.Handle("/*", app.static())

	return r
}
