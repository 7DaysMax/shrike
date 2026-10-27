//go:build windows

package server

import (
	"fmt"
	"io"
)

func startUITerminal(dir string, cols, rows uint16) (io.ReadWriteCloser, func(uint16, uint16) error, func(), func() int, error) {
	return nil, nil, nil, nil, fmt.Errorf("当前终端适配器需要 Unix PTY，Windows ConPTY 适配尚未接入")
}
