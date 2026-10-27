package server

import (
	"embed"
	"encoding/json"
	"fmt"
	"github.com/Autumn-27/shrike/pluginhost"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

//go:embed plugin_builtin.json
var pluginCatalog embed.FS

func (s *Server) pluginStore() (*pluginhost.Store, error) {
	s.pluginsOnce.Do(func() {
		data, e := pluginCatalog.ReadFile("plugin_builtin.json")
		if e != nil {
			s.pluginsErr = e
			return
		}
		var builtin []pluginhost.Manifest
		if e = json.Unmarshal(data, &builtin); e != nil {
			s.pluginsErr = e
			return
		}
		root := os.Getenv("ARTEX_PLUGIN_DIR")
		if root == "" {
			root = filepath.Join(filepath.Dir(s.dataDir), ".artex-plugins")
		}
		s.pluginsStore, s.pluginsErr = pluginhost.Open(root, builtin)
	})
	return s.pluginsStore, s.pluginsErr
}
func (s *Server) pluginsList(w http.ResponseWriter, r *http.Request) {
	store, e := s.pluginStore()
	if e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"api_version": 1, "plugins": store.List()})
}
func (s *Server) pluginsInstall(w http.ResponseWriter, r *http.Request) {
	store, e := s.pluginStore()
	if e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16<<20)
	var p pluginhost.Package
	if e = json.NewDecoder(r.Body).Decode(&p); e != nil {
		writeErr(w, 400, e.Error())
		return
	}
	if e = store.Install(p); e != nil {
		writeErr(w, 400, e.Error())
		return
	}
	writeJSON(w, 201, map[string]any{"installed": p.Manifest.ID, "enabled": false, "version": p.Manifest.Version})
}
func (s *Server) pluginsUpdate(w http.ResponseWriter, r *http.Request) {
	store, e := s.pluginStore()
	if e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	var body struct {
		Enabled bool   `json:"enabled"`
		Version string `json:"version"`
	}
	if e = json.NewDecoder(http.MaxBytesReader(w, r.Body, 65536)).Decode(&body); e != nil {
		writeErr(w, 400, e.Error())
		return
	}
	if e = store.Update(r.PathValue("id"), body.Enabled, body.Version); e != nil {
		writeErr(w, 409, e.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"updated": true})
}
func (s *Server) pluginsAsset(w http.ResponseWriter, r *http.Request) {
	store, e := s.pluginStore()
	if e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	path, e := store.Asset(r.PathValue("id"), r.PathValue("path"))
	if e != nil {
		writeErr(w, 404, e.Error())
		return
	}
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	file, e := os.Open(path)
	if e != nil {
		writeErr(w, 404, e.Error())
		return
	}
	defer file.Close()
	info, e := file.Stat()
	if e != nil {
		writeErr(w, 404, e.Error())
		return
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}
func (s *Server) pluginsInvoke(w http.ResponseWriter, r *http.Request) {
	store, e := s.pluginStore()
	if e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	var call struct {
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
	}
	if e = json.NewDecoder(http.MaxBytesReader(w, r.Body, 65536)).Decode(&call); e != nil {
		writeErr(w, 400, e.Error())
		return
	}
	if e = store.Authorize(r.PathValue("id"), call.Method); e != nil {
		writeErr(w, 403, e.Error())
		return
	}
	switch call.Method {
	case "host.tasks.list":
		items := []map[string]any{}
		for _, t := range s.m.List() {
			items = append(items, map[string]any{"id": t.ID, "name": t.Name, "status": s.resolvedTaskStatus(t)})
		}
		writeJSON(w, 200, items)
	case "host.models.list":
		pg := s.pg(w)
		if pg == nil {
			return
		}
		profiles, e := pg.ListProfiles()
		if e != nil {
			writeErr(w, 500, e.Error())
			return
		}
		writeJSON(w, 200, llmProfileDTOs(profiles))
	case "host.version":
		writeJSON(w, 200, map[string]any{"plugin_api": 1, "host": "ARTEX"})
	default:
		writeErr(w, 404, fmt.Sprintf("宿主服务未注册：%s", strings.TrimSpace(call.Method)))
	}
}
