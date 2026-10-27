package pluginhost

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func builtinTest() []Manifest {
	return []Manifest{{ID: "artex.core", Name: "Core", Version: "1.0.0", APIVersion: 1, Required: true}}
}
func packageTest(id, version string) Package {
	return Package{Manifest: Manifest{ID: id, Name: id, Version: version, APIVersion: 1, Dependencies: []string{"artex.core"}, Permissions: []string{"host.version"}, Contributions: []Contribution{{Point: "panel", ID: "board", Label: "Board", Renderer: "ui/index.html"}, {Point: "command", ID: "board", Label: "Board", Command: "/board", Target: "board"}}}, Files: map[string]string{"ui/index.html": "<!doctype html><h1>plugin</h1>"}}
}
func openTest(t *testing.T) *Store {
	t.Helper()
	s, e := Open(t.TempDir(), builtinTest())
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func findTest(t *testing.T, s *Store, id string) Info {
	t.Helper()
	for _, v := range s.List() {
		if v.Manifest.ID == id {
			return v
		}
	}
	t.Fatal("missing", id)
	return Info{}
}
func TestPluginInstallLifecyclePersistence(t *testing.T) {
	s := openTest(t)
	p := packageTest("example.board", "1.0.0")
	if e := s.Install(p); e != nil {
		t.Fatal(e)
	}
	if findTest(t, s, p.Manifest.ID).Enabled {
		t.Fatal("installed active")
	}
	if _, e := s.Asset(p.Manifest.ID, "ui/index.html"); e == nil {
		t.Fatal("disabled asset served")
	}
	if e := s.Update(p.Manifest.ID, true, ""); e != nil {
		t.Fatal(e)
	}
	asset, e := s.Asset(p.Manifest.ID, "ui/index.html")
	if e != nil {
		t.Fatal(e)
	}
	b, e := os.ReadFile(asset)
	if e != nil || string(b) != p.Files["ui/index.html"] {
		t.Fatal(e)
	}
	if e := s.Authorize(p.Manifest.ID, "host.version"); e != nil {
		t.Fatal(e)
	}
	if e := s.Authorize(p.Manifest.ID, "host.models.list"); e == nil {
		t.Fatal("undeclared call passed")
	}
	again, e := Open(s.root, builtinTest())
	if e != nil || !findTest(t, again, p.Manifest.ID).Enabled {
		t.Fatal("state not persisted", e)
	}
	if e := again.Update(p.Manifest.ID, false, ""); e != nil {
		t.Fatal(e)
	}
	if e := again.Authorize(p.Manifest.ID, "host.version"); e == nil {
		t.Fatal("disabled RPC passed")
	}
}
func TestPluginVersionRollback(t *testing.T) {
	s := openTest(t)
	for _, v := range []string{"1.0.0", "1.10.0", "1.2.0"} {
		p := packageTest("example.board", v)
		p.Files["ui/index.html"] = v
		if e := s.Install(p); e != nil {
			t.Fatal(e)
		}
	}
	if e := s.Update("example.board", true, "1.10.0"); e != nil {
		t.Fatal(e)
	}
	if e := s.Update("example.board", true, "1.0.0"); e != nil {
		t.Fatal(e)
	}
	asset, e := s.Asset("example.board", "ui/index.html")
	if e != nil {
		t.Fatal(e)
	}
	b, _ := os.ReadFile(asset)
	if string(b) != "1.0.0" {
		t.Fatal(string(b))
	}
	info := findTest(t, s, "example.board")
	if strings.Join(info.Versions, ",") != "1.0.0,1.2.0,1.10.0" {
		t.Fatal(info.Versions)
	}
	if e := s.Install(packageTest("example.board", "1.0.0")); e == nil {
		t.Fatal("duplicate installed")
	}
}
func TestPluginManifestAndPackageValidation(t *testing.T) {
	for _, kind := range []string{"path", "api", "permission", "entry", "target", "command", "message", "reserved", "required"} {
		t.Run(kind, func(t *testing.T) {
			s := openTest(t)
			p := packageTest("example.board", "1.0.0")
			switch kind {
			case "path":
				p.Files["../../escape"] = "x"
			case "api":
				p.Manifest.APIVersion = 2
			case "permission":
				p.Manifest.Permissions = []string{"host.secrets"}
			case "entry":
				delete(p.Files, "ui/index.html")
			case "target":
				p.Manifest.Contributions[1].Target = "missing"
			case "command":
				p.Manifest.Contributions[1].Command = "not-a-command"
			case "message":
				p.Manifest.Contributions = append(p.Manifest.Contributions, Contribution{Point: "message", ID: "msg", Label: "Message", Renderer: "ui/index.html"})
			case "reserved":
				p.Manifest.ID = "artex.core"
			case "required":
				p.Manifest.Required = true
			}
			if e := s.Install(p); e == nil {
				t.Fatal("accepted invalid", kind)
			}
		})
	}
}
func TestPluginDependencyAndCoreProtection(t *testing.T) {
	s := openTest(t)
	if e := s.Update("artex.core", false, ""); e == nil {
		t.Fatal("core disabled")
	}
	p := packageTest("example.board", "1.0.0")
	p.Manifest.Dependencies = append(p.Manifest.Dependencies, "example.dep")
	if e := s.Install(p); e != nil {
		t.Fatal(e)
	}
	if e := s.Update(p.Manifest.ID, true, ""); e == nil {
		t.Fatal("missing dependency accepted")
	}
	dep := packageTest("example.dep", "1.0.0")
	if e := s.Install(dep); e != nil {
		t.Fatal(e)
	}
	if e := s.Update(dep.Manifest.ID, true, ""); e != nil {
		t.Fatal(e)
	}
	if e := s.Update(p.Manifest.ID, true, ""); e != nil {
		t.Fatal(e)
	}
	if e := s.Update(dep.Manifest.ID, false, ""); e == nil {
		t.Fatal("active dependency disabled")
	}
}
func TestPluginAssetsConfinedAndManifestDirectoryBound(t *testing.T) {
	s := openTest(t)
	p := packageTest("example.board", "1.0.0")
	if e := s.Install(p); e != nil {
		t.Fatal(e)
	}
	if e := s.Update(p.Manifest.ID, true, ""); e != nil {
		t.Fatal(e)
	}
	outside := filepath.Join(t.TempDir(), "outside")
	os.WriteFile(outside, []byte("outside"), 0600)
	link := filepath.Join(s.root, "packages", p.Manifest.ID, p.Manifest.Version, "escape")
	if e := os.Symlink(outside, link); e != nil {
		t.Fatal(e)
	}
	for _, path := range []string{"../../state.json", "/etc/passwd", "escape", "..\\state.json"} {
		if _, e := s.Asset(p.Manifest.ID, path); e == nil {
			t.Fatal("escaped", path)
		}
	}
	p.Manifest.ID = "example.other"
	b, _ := json.Marshal(p.Manifest)
	os.WriteFile(filepath.Join(s.root, "packages", "example.board", "1.0.0", "plugin.json"), b, 0600)
	if findTest(t, s, "example.board").Error == "" {
		t.Fatal("manifest identity changed unnoticed")
	}
}
func TestPluginMalformedStateFailsClosed(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "state.json"), []byte("bad"), 0600)
	if _, e := Open(root, builtinTest()); e == nil {
		t.Fatal("malformed state accepted")
	}
}
func TestPluginRecoversBySwitchingFromBrokenVersion(t *testing.T) {
	s := openTest(t)
	for _, v := range []string{"1.0.0", "2.0.0"} {
		if e := s.Install(packageTest("example.board", v)); e != nil {
			t.Fatal(e)
		}
	}
	if e := s.Update("example.board", true, "2.0.0"); e != nil {
		t.Fatal(e)
	}
	os.WriteFile(filepath.Join(s.root, "packages", "example.board", "2.0.0", "plugin.json"), []byte("broken"), 0600)
	if findTest(t, s, "example.board").Enabled {
		t.Fatal("broken version enabled")
	}
	if e := s.Update("example.board", true, "1.0.0"); e != nil {
		t.Fatal(e)
	}
	if findTest(t, s, "example.board").Manifest.Version != "1.0.0" {
		t.Fatal("rollback failed")
	}
}
