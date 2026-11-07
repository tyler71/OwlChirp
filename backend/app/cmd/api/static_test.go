package main

import (
	"io/fs"
	"testing"
	"testing/fstest"
)

func TestNormalizeBasePath(t *testing.T) {
	tests := map[string]string{
		"":             "",
		"/":            "",
		"  ":           "",
		"owlchirp":     "/owlchirp",
		"/owlchirp":    "/owlchirp",
		"/owlchirp/":   "/owlchirp",
		" /a/b/ ":      "/a/b",
		"//owlchirp//": "/owlchirp",
	}
	for in, want := range tests {
		if got := normalizeBasePath(in); got != want {
			t.Errorf("normalizeBasePath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRebase(t *testing.T) {
	png := []byte("\x89PNG/__OWLCHIRP_BASE__/x")
	src := fstest.MapFS{
		"ccp.html":             {Data: []byte(`<script src="/__OWLCHIRP_BASE__/_astro/a.js"></script>`)},
		"_astro/a.js":          {Data: []byte(`fetch("/__OWLCHIRP_BASE__/api/config")`)},
		"manifest.webmanifest": {Data: []byte(`{"scope":"/__OWLCHIRP_BASE__/"}`)},
		"icon.png":             {Data: png},
	}

	tests := []struct {
		base, html, js, manifest string
	}{
		{"", `<script src="/_astro/a.js"></script>`, `fetch("/api/config")`, `{"scope":"/"}`},
		{"/owlchirp", `<script src="/owlchirp/_astro/a.js"></script>`, `fetch("/owlchirp/api/config")`, `{"scope":"/owlchirp/"}`},
	}
	for _, tt := range tests {
		out, err := rebase(src, tt.base)
		if err != nil {
			t.Fatal(err)
		}
		for name, want := range map[string]string{
			"ccp.html":             tt.html,
			"_astro/a.js":          tt.js,
			"manifest.webmanifest": tt.manifest,
			"icon.png":             string(png),
		} {
			got, err := fs.ReadFile(out, name)
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != want {
				t.Errorf("base %q, %s = %q, want %q", tt.base, name, got, want)
			}
		}
	}
}
