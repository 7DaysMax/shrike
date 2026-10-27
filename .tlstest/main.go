package main

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	utls "github.com/refraction-networking/utls"
)

func main() {
	jwt := os.Args[1]
	mid := os.Args[2]
	body := `{"model":"glm-5.3-flash","max_tokens":32,"messages":[{"role":"user","content":"回复两个字：成功"}]}`
	req, _ := http.NewRequest("POST", "https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+jwt)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("content-type", "application/json")
	req.Header.Set("User-Agent", "ZCode/3.16.2")
	req.Header.Set("X-Device-Mid", mid)

	dial := func(ctx context.Context, network, addr string) (net.Conn, error) {
		raw, err := net.DialTimeout(network, addr, 15*time.Second)
		if err != nil {
			return nil, err
		}
		host, _, _ := net.SplitHostPort(addr)
		cfg := &utls.Config{ServerName: host, NextProtos: []string{"http/1.1"}}
		u := utls.UClient(raw, cfg, utls.HelloChrome_120)
		if err := u.HandshakeContext(ctx); err != nil {
			return nil, err
		}
		return u, nil
	}
	client := &http.Client{Transport: &http.Transport{DialTLSContext: dial}, Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Println("ERR", err)
		return
	}
	defer resp.Body.Close()
	hdr := make([]byte, 500)
	n, _ := bufio.NewReader(resp.Body).Read(hdr)
	fmt.Println(resp.StatusCode, string(hdr[:n]))
}
