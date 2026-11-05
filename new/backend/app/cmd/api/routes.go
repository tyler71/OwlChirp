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

		// Metrics and all call handling. Authenticates with its first
		// message instead of a header; see socket.
		r.Get("/ws", app.socket)
		// Map proximity voice relay; authenticates like /ws. See voiceSocket.
		r.Get("/voice", app.voiceSocket)

		r.NotFound(app.notFound)
	})

	if app.config.devMode {
		r.Mount("/debug", middleware.Profiler())
	}

	r.Handle("/*", app.static())

	return r
}
