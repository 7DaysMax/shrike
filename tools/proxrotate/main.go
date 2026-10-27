// Command proxrotate 是一个极小的 socks5 轮询器：对外提供一个 socks5 入口，
// 内部把你的「一条一条」代理列表按连接轮询出去。
//
// 为什么需要它：SHRIKE 的「全局代理」只接受一个地址（server/manager.go 里是单个
// 字符串），而手里往往是 N 条独立代理。把它挂在前面，平台只要填 socks5://127.0.0.1:1080。
//
// 行为：
//   - 轮询（每个连接换一条上游），失败自动换下一条重试；
//   - 连续失败 3 次的上游冷却 60s，避免一直撞死节点；
//   - 目标域名原样透传给上游解析（等价 socks5h），不在本机做 DNS。
//
// 用法：
//
//	proxrotate -file proxies.txt -listen 127.0.0.1:1080
//
// proxies.txt 支持这些写法（一行一条，# 开头是注释）：
//
//	socks5://user:pass@1.2.3.4:1080
//	1.2.3.4:1080
//	1.2.3.4:1080:user:pass
//	http://1.2.3.4:8080        （按 socks5 连——http 代理请勿用这种写法）
package main

import (
	"bufio"
	"encoding/binary"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type upstream struct {
	addr string
	user string
	pass string

	fails    int32
	coolTill atomic.Int64 // unix nano
}

type rotator struct {
	ups  []*upstream
	next atomic.Uint64
}

func (r *rotator) pick() *upstream {
	n := len(r.ups)
	if n == 0 {
		return nil
	}
	now := time.Now().UnixNano()
	start := int(r.next.Add(1) - 1)
	for i := 0; i < n; i++ {
		u := r.ups[(start+i)%n]
		if u.coolTill.Load() <= now {
			return u
		}
	}
	return r.ups[start%n] // 全在冷却：还是给一个，让它自己失败重试
}

func (u *upstream) ok() {
	atomic.StoreInt32(&u.fails, 0)
	u.coolTill.Store(0)
}

func (u *upstream) bad() {
	f := atomic.AddInt32(&u.fails, 1)
	if f >= 3 {
		u.coolTill.Store(time.Now().Add(60 * time.Second).UnixNano())
		atomic.StoreInt32(&u.fails, 0)
		log.Printf("[rotate] %s 连续失败，冷却 60s", u.addr)
	}
}

// parseLine 解析一行代理配置。
func parseLine(line string) *upstream {
	s := strings.TrimSpace(line)
	if s == "" || strings.HasPrefix(s, "#") {
		return nil
	}
	// scheme://[user:pass@]host:port
	if i := strings.Index(s, "://"); i > 0 {
		s = s[i+3:]
	}
	if at := strings.LastIndex(s, "@"); at >= 0 {
		cred, host := s[:at], s[at+1:]
		u, p, _ := strings.Cut(cred, ":")
		return &upstream{addr: host, user: u, pass: p}
	}
	// host:port:user:pass
	parts := strings.Split(s, ":")
	if len(parts) == 4 {
		return &upstream{addr: parts[0] + ":" + parts[1], user: parts[2], pass: parts[3]}
	}
	if len(parts) == 2 {
		return &upstream{addr: s}
	}
	log.Printf("[rotate] 跳过无法解析的行: %q", line)
	return nil
}

func loadFile(path string) ([]*upstream, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out []*upstream
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if u := parseLine(sc.Text()); u != nil {
			out = append(out, u)
		}
	}
	return out, sc.Err()
}

// dialUpstream 以 socks5 客户端身份连到上游并请求它连 target（域名透传）。
func dialUpstream(u *upstream, targetHost string, targetPort uint16) (net.Conn, error) {
	c, err := net.DialTimeout("tcp", u.addr, 10*time.Second)
	if err != nil {
		return nil, err
	}
	_ = c.SetDeadline(time.Now().Add(15 * time.Second))

	methods := []byte{0x00}
	if u.user != "" {
		methods = append(methods, 0x02)
	}
	greet := append([]byte{0x05, byte(len(methods))}, methods...)
	if _, err = c.Write(greet); err != nil {
		c.Close()
		return nil, err
	}
	rep := make([]byte, 2)
	if _, err = io.ReadFull(c, rep); err != nil {
		c.Close()
		return nil, err
	}
	switch rep[1] {
	case 0x00: // 无需认证
	case 0x02: // 用户名密码
		if u.user == "" {
			c.Close()
			return nil, fmt.Errorf("上游要求认证但未配置账号")
		}
		buf := []byte{0x01, byte(len(u.user))}
		buf = append(buf, u.user...)
		buf = append(buf, byte(len(u.pass)))
		buf = append(buf, u.pass...)
		if _, err = c.Write(buf); err != nil {
			c.Close()
			return nil, err
		}
		if _, err = io.ReadFull(c, rep); err != nil {
			c.Close()
			return nil, err
		}
		if rep[1] != 0x00 {
			c.Close()
			return nil, fmt.Errorf("上游认证失败")
		}
	default:
		c.Close()
		return nil, fmt.Errorf("上游不支持的无认证方式 %#x", rep[1])
	}

	// CONNECT，域名透传（不在本机解析）
	port := make([]byte, 2)
	binary.BigEndian.PutUint16(port, targetPort)
	req := []byte{0x05, 0x01, 0x00, 0x03, byte(len(targetHost))}
	req = append(req, targetHost...)
	req = append(req, port...)
	if _, err = c.Write(req); err != nil {
		c.Close()
		return nil, err
	}
	head := make([]byte, 4)
	if _, err = io.ReadFull(c, head); err != nil {
		c.Close()
		return nil, err
	}
	if head[1] != 0x00 {
		c.Close()
		return nil, fmt.Errorf("上游拒绝 CONNECT: %#x", head[1])
	}
	// 吃掉绑定地址
	switch head[3] {
	case 0x01:
		io.CopyN(io.Discard, c, 4+2)
	case 0x04:
		io.CopyN(io.Discard, c, 16+2)
	case 0x03:
		l := make([]byte, 1)
		io.ReadFull(c, l)
		io.CopyN(io.Discard, c, int64(l[0])+2)
	}
	_ = c.SetDeadline(time.Time{})
	return c, nil
}

// serveSocks 处理一个来自平台侧的 socks5 连接（只支持无认证 + CONNECT）。
func serveSocks(conn net.Conn, r *rotator) {
	defer conn.Close()
	hdr := make([]byte, 2)
	if _, err := io.ReadFull(conn, hdr); err != nil || hdr[0] != 0x05 {
		return
	}
	if _, err := io.ReadFull(conn, make([]byte, int(hdr[1]))); err != nil {
		return
	}
	if _, err := conn.Write([]byte{0x05, 0x00}); err != nil { // 不需要认证
		return
	}
	req := make([]byte, 4)
	if _, err := io.ReadFull(conn, req); err != nil || req[1] != 0x01 {
		return
	}
	var host string
	switch req[3] {
	case 0x01:
		b := make([]byte, 4)
		io.ReadFull(conn, b)
		host = net.IP(b).String()
	case 0x03:
		l := make([]byte, 1)
		io.ReadFull(conn, l)
		b := make([]byte, int(l[0]))
		io.ReadFull(conn, b)
		host = string(b)
	case 0x04:
		b := make([]byte, 16)
		io.ReadFull(conn, b)
		host = net.IP(b).String()
	default:
		return
	}
	pb := make([]byte, 2)
	io.ReadFull(conn, pb)
	port := binary.BigEndian.Uint16(pb)

	// 失败换下一条重试
	for attempt := 0; attempt < len(r.ups); attempt++ {
		u := r.pick()
		if u == nil {
			break
		}
		up, err := dialUpstream(u, host, port)
		if err != nil {
			u.bad()
			continue
		}
		u.ok()
		log.Printf("[rotate] %s:%d → via %s", host, port, u.addr)
		// 回 success（绑定地址填空）
		_, _ = conn.Write([]byte{0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
		done := make(chan struct{}, 2)
		go func() { io.Copy(up, conn); done <- struct{}{} }()
		go func() { io.Copy(conn, up); done <- struct{}{} }()
		<-done
		up.Close()
		return
	}
	_, _ = conn.Write([]byte{0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0}) // 全部失败
}

func main() {
	listen := flag.String("listen", "127.0.0.1:1080", "对外监听的 socks5 地址")
	file := flag.String("file", "proxies.txt", "代理列表文件")
	flag.Parse()

	ups, err := loadFile(*file)
	if err != nil {
		log.Fatalf("读取 %s 失败: %v", *file, err)
	}
	if len(ups) == 0 {
		log.Fatalf("%s 里没有可用代理", *file)
	}
	for i, u := range ups {
		auth := "无认证"
		if u.user != "" {
			auth = "带账号"
		}
		log.Printf("[rotate] #%d %s (%s)", i+1, u.addr, auth)
	}

	ln, err := net.Listen("tcp", *listen)
	if err != nil {
		log.Fatalf("监听 %s 失败: %v", *listen, err)
	}
	log.Printf("[rotate] 就绪：socks5://%s （%d 条上游，轮询）", *listen, len(ups))

	r := &rotator{ups: ups}
	var wg sync.WaitGroup
	for {
		c, err := ln.Accept()
		if err != nil {
			continue
		}
		wg.Add(1)
		go func() { defer wg.Done(); serveSocks(c, r) }()
	}
}
