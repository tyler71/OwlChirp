package main

import (
	"net/http"

	"github.com/tyler71/owlchirp/app/internal/response"
)

func (app *application) ping(w http.ResponseWriter, r *http.Request) {
	err := response.JSON(w, http.StatusOK, map[string]string{"response": "pong"})
	if err != nil {
		app.serverError(w, r, err)
	}
}

// frontendConfig exposes instance settings that the webpack build used to
// bake into the bundle, so one frontend build works for any instance.
func (app *application) frontendConfig(w http.ResponseWriter, r *http.Request) {
	data := map[string]string{
		"connectDomain":   app.config.connect.domain,
		"connectInstance": app.config.connect.instance,
		"timeZone":        app.config.frontend.timeZone,
		"telemetryUrl":    app.config.frontend.telemetryURL,
	}

	err := response.JSON(w, http.StatusOK, data)
	if err != nil {
		app.serverError(w, r, err)
	}
}
