package main

import (
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/tyler71/owlchirp/app/assets"
)

const notBuiltPage = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><title>OwlChirp</title></head>
<body><p>The frontend has not been built into this binary. Run <code>just build</code>, or use <code>just dev</code> during development.</p></body></html>`

// static serves the embedded Astro build.
func (app *application) static() http.Handler {
	web, err := fs.Sub(assets.Web, "web")
	if err != nil {
		panic(err)
	}

	_, err = fs.Stat(web, "index.html")
	built := err == nil

	fileServer := http.FileServerFS(web)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !built {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte(notBuiltPage))
			return
		}

		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" {
			name = "index.html"
		}

		if !isFile(web, name) {
			if isFile(web, name+".html") {
				name += ".html"
			} else if isFile(web, path.Join(name, "index.html")) {
				name = path.Join(name, "index.html")
			} else {
				app.notFound(w, r)
				return
			}
		}

		if strings.HasPrefix(name, "_astro/") {
			// Hashed filenames; safe to cache forever.
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}

		// Serve by exact name so FileServer doesn't redirect index.html → ./
		if strings.HasSuffix(name, ".html") {
			http.ServeFileFS(w, r, web, name)
			return
		}

		r2 := r.Clone(r.Context())
		r2.URL.Path = "/" + name
		fileServer.ServeHTTP(w, r2)
	})
}

func isFile(fsys fs.FS, name string) bool {
	info, err := fs.Stat(fsys, name)
	return err == nil && !info.IsDir()
}
