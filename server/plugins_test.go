package server

import (
	"encoding/json"
	"github.com/Autumn-27/shrike/pluginhost"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func pluginServerTest(t *testing.T) *Server {
	t.Helper()
	t.Setenv("ARTEX_PLUGIN_DIR", t.TempDir())
	return &Server{dataDir: t.TempDir()}
}
func TestPluginAPILifecycleAndScopedRPC(t *testing.T) {
	s := pluginServerTest(t)
	p := pluginhost.Package{Manifest: pluginhost.Manifest{ID: "example.api", Name: "API fixture", Version: "1.0.0", APIVersion: 1, Permissions: []string{"host.version"}, Contributions: []pluginhost.Contribution{{Point: "panel", ID: "api", Label: "API", Renderer: "ui/index.html"}}}, Files: map[string]string{"ui/index.html": "<!doctype html><p>API</p>"}}
	b, _ := json.Marshal(p)
	w := httptest.NewRecorder()
	s.pluginsInstall(w, httptest.NewRequest("POST", "/api/plugins/install", strings.NewReader(string(b))))
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	request := httptest.NewRequest("PATCH", "/api/plugins/example.api", strings.NewReader(`{"enabled":true}`))
	request.SetPathValue("id", "example.api")
	w = httptest.NewRecorder()
	s.pluginsUpdate(w, request)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, tc := range []struct {
		method string
		status int
	}{{"host.version", 200}, {"host.models.list", 403}} {
		request = httptest.NewRequest("POST", "/api/plugins/example.api/invoke", strings.NewReader(`{"method":"`+tc.method+`"}`))
		request.SetPathValue("id", "example.api")
		w = httptest.NewRecorder()
		s.pluginsInvoke(w, request)
		if w.Code != tc.status {
			t.Fatal(tc.method, w.Code, w.Body.String())
		}
	}
	request = httptest.NewRequest("GET", "/api/plugins/example.api/assets/ui/index.html", nil)
	request.SetPathValue("id", "example.api")
	request.SetPathValue("path", "ui/index.html")
	w = httptest.NewRecorder()
	s.pluginsAsset(w, request)
	if w.Code != 200 || !strings.Contains(w.Header().Get("Content-Security-Policy"), "sandbox allow-scripts") || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal(w.Code, w.Header())
	}
	if !strings.Contains(w.Body.String(), "API") {
		t.Fatal(w.Body.String())
	}
	t.Log("INSTALL=201 ENABLE=200 DECLARED_RPC=200 UNDECLARED_RPC=403 ASSET=200 CSP_SANDBOX=true")
}
func TestPluginCatalogCoreProtection(t *testing.T) {
	s := pluginServerTest(t)
	w := httptest.NewRecorder()
	s.pluginsList(w, httptest.NewRequest("GET", "/api/plugins", nil))
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	var payload struct {
		Plugins []pluginhost.Info `json:"plugins"`
	}
	if e := json.Unmarshal(w.Body.Bytes(), &payload); e != nil || len(payload.Plugins) != 7 {
		t.Fatal(e, w.Body.String())
	}
	request := httptest.NewRequest("PATCH", "/api/plugins/artex.core", strings.NewReader(`{"enabled":false}`))
	request.SetPathValue("id", "artex.core")
	w = httptest.NewRecorder()
	s.pluginsUpdate(w, request)
	if w.Code != 409 {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestPluginRoutesRequireAuthentication(t *testing.T) {
	s := pluginServerTest(t)
	s.jwtKey = []byte("fixture-key-0123456789-0123456789-0123456789")
	handler := s.Handler()
	for _, path := range []string{"/api/plugins", "/api/plugins/install", "/api/plugins/example.api/assets/ui/index.html", "/api/plugins/example.api/invoke"} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 401 {
			t.Fatal(path, w.Code)
		}
	}
	token, e := signJWT(s.jwtKey)
	if e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest("GET", "/api/plugins", nil)
	r.AddCookie(&http.Cookie{Name: "shrike_token", Value: token})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
}
