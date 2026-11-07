package main

import (
	"bytes"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"testing/fstest"
	"time"

	"github.com/tyler71/owlchirp/app/assets"
)

const notBuiltPage = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><title>OwlChirp</title></head>
<body><p>The frontend has not been built into this binary. Run <code>just build</code>, or use <code>just dev</code> during development.</p></body></html>`

// basePlaceholder is the Astro build's base (astro.config.mjs). It is swapped
// for BASE_PATH at startup so one build can be served from any subdirectory.
const basePlaceholder = "/__OWLCHIRP_BASE__"

// Extensions of built files that can contain the base placeholder.
var rewriteExts = map[string]bool{
	".html": true, ".js": true, ".mjs": true, ".css": true, ".json": true,
	".webmanifest": true, ".svg": true, ".txt": true, ".xml": true,
}

func init() {
	// Go's built-in table lacks the PWA manifest type.
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

// normalizeBasePath turns BASE_PATH into "" (root) or "/a/b" form.
func normalizeBasePath(p string) string {
	p = strings.Trim(strings.TrimSpace(p), "/")
	if p == "" {
		return ""
	}
	return "/" + p
}

// rebase returns a copy of fsys with basePlaceholder replaced by basePath in
// every text asset. Other files are copied unchanged.
func rebase(fsys fs.FS, basePath string) (fs.FS, error) {
	out := fstest.MapFS{}
	modTime := time.Now()
	err := fs.WalkDir(fsys, ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		f, err := fsys.Open(name)
		if err != nil {
			return err
		}
		defer f.Close()
		data, err := io.ReadAll(f)
		if err != nil {
			return err
		}
		if rewriteExts[path.Ext(name)] {
			data = bytes.ReplaceAll(data, []byte(basePlaceholder), []byte(basePath))
		}
		out[name] = &fstest.MapFile{Data: data, Mode: 0o444, ModTime: modTime}
		return nil
	})
	return out, err
}

// static serves the embedded Astro build. sw.js and manifest.webmanifest fall
// under no-cache so browsers always revalidate them and notice new deploys.
func (app *application) static() http.Handler {
	embedded, err := fs.Sub(assets.Web, "web")
	if err != nil {
		panic(err)
	}
	web, err := rebase(embedded, app.config.basePath)
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
