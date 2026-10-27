// Command htunnel 把本地端口通过「HTTP CONNECT 代理（带 Basic 认证）」转发到固定目标。
//
// 用途：本机到 186.240.202.118:22 的直连被中间设备重置，但那条线路的 HTTP 代理是通的。
// 起一个本地监听（127.0.0.1:2222），把每条连接都用 CONNECT 打洞到目标，SSH 就能照常用：
//
//	go run ./tools/htunnel -listen 127.0.0.1:2222 -proxy 122.246.5.189:21254 \
//	    -user tv45 -pass tv45q -target 186.240.202.118:22
//
// 只监听回环地址，不对外暴露。
package main

import (
	"bufio"
	"encoding/base64"
	"flag"
	"io"
	"log"
	"net"
	"strings"
	"time"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:2222", "本地监听地址")
	proxy := flag.String("proxy", "", "HTTP 代理 host:port")
	user := flag.String("user", "", "代理用户名")
	pass := flag.String("pass", "", "代理密码")
	target := flag.String("target", "", "固定转发目标 host:port")
	flag.Parse()
	if *proxy == "" || *target == "" {
		log.Fatal("必须给 -proxy 和 -target")
	}

	ln, err := net.Listen("tcp", *listen)
	if err != nil {
		log.Fatalf("监听失败: %v", err)
	}
	log.Printf("[htunnel] %s → %s（经代理 %s）", *listen, *target, *proxy)

	for {
		c, err := ln.Accept()
		if err != nil {
			continue
		}
		go handle(c, *proxy, *user, *pass, *target)
	}
}

func handle(local net.Conn, proxy, user, pass, target string) {
	defer local.Close()
	up, err := net.DialTimeout("tcp", proxy, 15*time.Second)
	if err != nil {
		log.Printf("[htunnel] 连代理失败: %v", err)
		return
	}
	defer up.Close()
	_ = up.SetDeadline(time.Now().Add(20 * time.Second))

	req := "CONNECT " + target + " HTTP/1.1\r\nHost: " + target + "\r\nProxy-Connection: keep-alive\r\n"
	if user != "" {
		req += "Proxy-Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte(user+":"+pass)) + "\r\n"
	}
	req += "\r\n"
	if _, err := io.WriteString(up, req); err != nil {
		return
	}
	br := bufio.NewReader(up)
	line, err := br.ReadString('\n')
	if err != nil {
		return
	}
	if !strings.Contains(line, " 200") {
		log.Printf("[htunnel] CONNECT 被拒: %s", strings.TrimSpace(line))
		return
	}
	for { // 吃掉响应头
		l, err := br.ReadString('\n')
		if err != nil {
			return
		}
		if l == "\r\n" || l == "\n" {
			break
		}
	}
	_ = up.SetDeadline(time.Time{})
	log.Printf("[htunnel] 隧道建立 → %s", target)

	done := make(chan struct{}, 2)
	go func() { io.Copy(up, local); done <- struct{}{} }()
	go func() { io.Copy(local, br); done <- struct{}{} }()
	<-done
}
