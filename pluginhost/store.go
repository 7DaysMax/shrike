// Package pluginhost owns package inventory, compatible manifests and persisted
// activation state. UI packages run in sandboxed frames, not in the Go process.
package pluginhost

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"

	"strings"
	"sync"
)

type Contribution struct {
	Point    string `json:"point"`
	ID       string `json:"id"`
	Label    string `json:"label"`
	Renderer string `json:"renderer,omitempty"`
	Command  string `json:"command,omitempty"`
	Target   string `json:"target,omitempty"`
	When     string `json:"when,omitempty"`
	Order    int    `json:"order,omitempty"`
	Hidden   bool   `json:"hidden,omitempty"`
	Multiple bool   `json:"multiple,omitempty"`
}
type Manifest struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	Version       string         `json:"version"`
	APIVersion    int            `json:"apiVersion"`
	Description   string         `json:"description,omitempty"`
	Required      bool           `json:"required,omitempty"`
	Dependencies  []string       `json:"dependencies,omitempty"`
	Permissions   []string       `json:"permissions,omitempty"`
	Contributions []Contribution `json:"contributions"`
}
type State struct {
	Enabled bool            `json:"enabled"`
	Version string          `json:"version"`
	Config  json.RawMessage `json:"config,omitempty"`
}
type Info struct {
	Manifest Manifest `json:"manifest"`
	Source   string   `json:"source"`
	Enabled  bool     `json:"enabled"`
	Versions []string `json:"versions"`
	Error    string   `json:"error,omitempty"`
}
type Package struct {
	Manifest Manifest          `json:"manifest"`
	Files    map[string]string `json:"files"`
}
type Store struct {
	mu      sync.Mutex
	root    string
	builtin map[string]Manifest
	state   map[string]State
}

var idPattern = regexp.MustCompile(`^[a-z][a-z0-9.-]{2,79}$`)
var versionPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)
var permissions = map[string]bool{"host.tasks.list": true, "host.models.list": true, "host.version": true}
var points = map[string]bool{"panel": true, "navigation": true, "command": true, "settings": true, "message": true, "view": true}

func Open(root string, builtin []Manifest) (*Store, error) {
	s := &Store{root: root, builtin: map[string]Manifest{}, state: map[string]State{}}
	for _, m := range builtin {
		s.builtin[m.ID] = m
	}
	if e := os.MkdirAll(filepath.Join(root, "packages"), 0700); e != nil {
		return nil, e
	}
	b, e := os.ReadFile(filepath.Join(root, "state.json"))
	if e == nil {
		if e = json.Unmarshal(b, &s.state); e != nil {
			return nil, fmt.Errorf("plugin state: %w", e)
		}
	} else if !os.IsNotExist(e) {
		return nil, e
	}
	return s, nil
}
func Validate(m Manifest) error {
	if !idPattern.MatchString(m.ID) || !versionPattern.MatchString(m.Version) || m.APIVersion != 1 || m.Required || strings.TrimSpace(m.Name) == "" {
		return fmt.Errorf("插件 ID、版本、名称或 apiVersion 无效")
	}
	if len(m.Contributions) > 100 || len(m.Dependencies) > 32 {
		return fmt.Errorf("贡献或依赖数量超限")
	}
	for _, p := range m.Permissions {
		if !permissions[p] {
			return fmt.Errorf("未知权限：%s", p)
		}
	}
	seen := map[string]bool{}
	for _, c := range m.Contributions {
		if !points[c.Point] || !idPattern.MatchString(c.ID) || c.Label == "" {
			return fmt.Errorf("贡献点无效：%s/%s", c.Point, c.ID)
		}
		key := c.Point + ":" + c.ID
		if seen[key] {
			return fmt.Errorf("贡献点重复：%s", key)
		}
		seen[key] = true
		if (c.Point == "panel" || c.Point == "settings" || c.Point == "message") && !validPath(c.Renderer) {
			return fmt.Errorf("渲染入口无效：%s", c.Renderer)
		}
	}
	for _, d := range m.Dependencies {
		if !idPattern.MatchString(d) || d == m.ID {
			return fmt.Errorf("插件依赖无效：%s", d)
		}
	}
	for _, c := range m.Contributions {
		if c.Point == "command" || c.Point == "navigation" || c.Point == "view" {
			if !seen["panel:"+c.Target] {
				return fmt.Errorf("插件目标面板未声明：%s", c.Target)
			}
			if c.Point == "command" && (!strings.HasPrefix(c.Command, "/") || strings.ContainsAny(c.Command, " \t\r\n")) {
				return fmt.Errorf("命令格式无效：%s", c.Command)
			}
		}
		if c.Point == "message" && strings.TrimSpace(c.When) == "" {
			return fmt.Errorf("消息贡献缺少 when")
		}
	}
	return nil
}
func versionLess(a, b string) bool {
	aa, bb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < 3; i++ {
		if len(aa[i]) != len(bb[i]) {
			return len(aa[i]) < len(bb[i])
		}
		if aa[i] != bb[i] {
			return aa[i] < bb[i]
		}
	}
	return false
}
func validPath(p string) bool {
	return p != "" && p == filepath.ToSlash(filepath.Clean(p)) && !strings.Contains(p, "\\") && !strings.HasPrefix(p, "/") && p != "." && p != ".." && !strings.HasPrefix(filepath.ToSlash(filepath.Clean(p)), "../") && !strings.ContainsRune(p, 0)
}
func (s *Store) save(state map[string]State) error {
	data, e := json.MarshalIndent(state, "", "  ")
	if e != nil {
		return e
	}
	file, e := os.CreateTemp(s.root, ".state-*")
	if e != nil {
		return e
	}
	name := file.Name()
	defer os.Remove(name)
	if e = file.Chmod(0600); e == nil {
		_, e = file.Write(data)
	}
	if e == nil {
		e = file.Sync()
	}
	closeErr := file.Close()
	if e != nil {
		return e
	}
	if closeErr != nil {
		return closeErr
	}
	if e = os.Rename(name, filepath.Join(s.root, "state.json")); e != nil {
		return e
	}
	s.state = state
	return nil
}
func (s *Store) list() []Info {
	items := map[string]Info{}
	for id, m := range s.builtin {
		st, exists := s.state[id]
		enabled := !exists || st.Enabled
		if m.Required {
			enabled = true
		}
		items[id] = Info{Manifest: m, Source: "builtin", Enabled: enabled, Versions: []string{m.Version}}
	}
	dirs, _ := os.ReadDir(filepath.Join(s.root, "packages"))
	for _, dir := range dirs {
		if !dir.IsDir() {
			continue
		}
		id := dir.Name()
		if _, reserved := s.builtin[id]; reserved || !idPattern.MatchString(id) {
			continue
		}
		versions, _ := os.ReadDir(filepath.Join(s.root, "packages", id))
		var names []string
		for _, v := range versions {
			if v.IsDir() && versionPattern.MatchString(v.Name()) {
				names = append(names, v.Name())
			}
		}
		if len(names) == 0 {
			continue
		}
		sort.Slice(names, func(i, j int) bool { return versionLess(names[i], names[j]) })
		st := s.state[id]
		chosen := st.Version
		if chosen == "" {
			chosen = names[len(names)-1]
		}
		if !versionPattern.MatchString(chosen) {
			items[id] = Info{Manifest: Manifest{ID: id, Name: id}, Source: "local", Versions: names, Error: "插件启用版本无效"}
			continue
		}
		var m Manifest
		data, e := os.ReadFile(filepath.Join(s.root, "packages", id, chosen, "plugin.json"))
		if e == nil {
			e = json.Unmarshal(data, &m)
		}
		if e == nil {
			e = Validate(m)
		}
		if e == nil && (m.ID != id || m.Version != chosen) {
			e = fmt.Errorf("插件目录与清单不匹配")
		}
		info := Info{Manifest: m, Source: "local", Enabled: st.Enabled, Versions: names}
		if e != nil {
			info.Manifest.ID = id
			info.Manifest.Name = id
			info.Error = e.Error()
			info.Enabled = false
		}
		items[id] = info
	}
	out := make([]Info, 0, len(items))
	for _, v := range items {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Manifest.ID < out[j].Manifest.ID })
	return out
}
func (s *Store) List() []Info { s.mu.Lock(); defer s.mu.Unlock(); return s.list() }
func (s *Store) Install(p Package) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.builtin[p.Manifest.ID]; ok {
		return fmt.Errorf("内置插件 ID 已保留")
	}
	if p.Manifest.Required {
		return fmt.Errorf("外部插件不使用 required 字段")
	}
	if e := Validate(p.Manifest); e != nil {
		return e
	}
	if len(p.Files) == 0 || len(p.Files) > 128 {
		return fmt.Errorf("插件文件数量无效")
	}
	total := 0
	for name, body := range p.Files {
		if !validPath(name) || name == "plugin.json" {
			return fmt.Errorf("文件路径无效：%s", name)
		}
		total += len(body)
	}
	if total > 8<<20 {
		return fmt.Errorf("插件包超过 8 MiB")
	}
	for _, c := range p.Manifest.Contributions {
		if c.Renderer != "" {
			if _, ok := p.Files[c.Renderer]; !ok {
				return fmt.Errorf("缺少入口文件：%s", c.Renderer)
			}
		}
	}
	target := filepath.Join(s.root, "packages", p.Manifest.ID, p.Manifest.Version)
	if _, e := os.Stat(target); e == nil {
		return fmt.Errorf("该插件版本已安装")
	}
	stage, e := os.MkdirTemp(s.root, ".install-*")
	if e != nil {
		return e
	}
	defer os.RemoveAll(stage)
	for name, body := range p.Files {
		dest := filepath.Join(stage, name)
		if e = os.MkdirAll(filepath.Dir(dest), 0700); e != nil {
			return e
		}
		if e = os.WriteFile(dest, []byte(body), 0600); e != nil {
			return e
		}
	}
	data, _ := json.MarshalIndent(p.Manifest, "", "  ")
	if e = os.WriteFile(filepath.Join(stage, "plugin.json"), data, 0600); e != nil {
		return e
	}
	if e = os.MkdirAll(filepath.Dir(target), 0700); e != nil {
		return e
	}
	if e = os.Rename(stage, target); e != nil {
		return e
	}
	next := map[string]State{}
	for k, v := range s.state {
		next[k] = v
	}
	if _, ok := next[p.Manifest.ID]; !ok {
		next[p.Manifest.ID] = State{Version: p.Manifest.Version}
	}
	if e = s.save(next); e != nil {
		os.RemoveAll(target)
		return e
	}
	return nil
}
func (s *Store) Update(id string, enabled bool, version string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	all := s.list()
	byID := map[string]Info{}
	for _, i := range all {
		byID[i.Manifest.ID] = i
	}
	item, ok := byID[id]
	if !ok {
		return fmt.Errorf("插件不存在")
	}
	if item.Manifest.Required && !enabled {
		return fmt.Errorf("宿主插件保持启用")
	}
	if item.Error != "" && version == "" {
		return fmt.Errorf("%s", item.Error)
	}
	if version == "" {
		version = item.Manifest.Version
	}
	valid := false
	for _, v := range item.Versions {
		if v == version {
			valid = true
		}
	}
	if !valid {
		return fmt.Errorf("插件版本未安装")
	}
	if item.Source == "local" && (version != item.Manifest.Version || item.Error != "") {
		data, e := os.ReadFile(filepath.Join(s.root, "packages", id, version, "plugin.json"))
		if e != nil {
			return e
		}
		if e = json.Unmarshal(data, &item.Manifest); e != nil {
			return e
		}
	}
	if item.Source == "local" {
		if e := Validate(item.Manifest); e != nil {
			return e
		}
		if item.Manifest.ID != id || item.Manifest.Version != version {
			return fmt.Errorf("插件目录与清单不匹配")
		}
	}
	if enabled {
		visiting := map[string]bool{}
		var visit func(string) error
		visit = func(k string) error {
			if visiting[k] {
				return fmt.Errorf("循环依赖：%s", k)
			}
			visiting[k] = true
			entry, exists := byID[k]
			if !exists {
				return fmt.Errorf("缺少依赖：%s", k)
			}
			if k == id {
				entry = item
			}
			for _, dep := range entry.Manifest.Dependencies {
				other, exists := byID[dep]
				if !exists || (!other.Enabled && dep != id) {
					return fmt.Errorf("请先启用依赖：%s", dep)
				}
				if e := visit(dep); e != nil {
					return e
				}
			}
			delete(visiting, k)
			return nil
		}
		if e := visit(id); e != nil {
			return e
		}
	} else {
		for _, other := range all {
			if other.Enabled {
				for _, dep := range other.Manifest.Dependencies {
					if dep == id {
						return fmt.Errorf("请先停用依赖方：%s", other.Manifest.ID)
					}
				}
			}
		}
	}
	next := map[string]State{}
	for k, v := range s.state {
		next[k] = v
	}
	old := next[id]
	old.Enabled = enabled
	old.Version = version
	next[id] = old
	return s.save(next)
}
func (s *Store) Asset(id, path string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !validPath(path) {
		return "", fmt.Errorf("插件资源路径无效")
	}
	for _, i := range s.list() {
		if i.Manifest.ID == id && i.Source == "local" && i.Enabled && i.Error == "" {
			base, e := filepath.EvalSymlinks(filepath.Join(s.root, "packages", id, i.Manifest.Version))
			if e != nil {
				return "", e
			}
			target := filepath.Join(base, path)
			resolved, e := filepath.EvalSymlinks(target)
			if e != nil {
				return "", e
			}
			rel, e := filepath.Rel(base, resolved)
			if e != nil || (rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator))) {
				return "", fmt.Errorf("插件资源越界")
			}
			info, e := os.Stat(resolved)
			if e != nil {
				return "", e
			}
			if !info.Mode().IsRegular() {
				return "", fmt.Errorf("插件资源不是普通文件")
			}
			return resolved, nil
		}
	}
	return "", fmt.Errorf("插件未启用或不存在")
}
func (s *Store) Authorize(id, method string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, i := range s.list() {
		if i.Manifest.ID == id && i.Enabled && i.Error == "" {
			for _, p := range i.Manifest.Permissions {
				if p == method {
					return nil
				}
			}
			return fmt.Errorf("插件未声明权限：%s", method)
		}
	}
	return fmt.Errorf("插件未启用")
}
