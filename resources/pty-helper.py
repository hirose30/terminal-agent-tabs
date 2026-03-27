#!/usr/bin/env python3
"""
PTY Helper for Obsidian Claude Code Tabs plugin.
Spawns a command in a pseudo-terminal and proxies I/O.

Based on clevcode/obsidian-terminal-plugin's pty-helper.py

Usage: python3 pty-helper.py <command> [args...]

I/O:
- stdin (fd 0): Input from xterm.js
- stdout (fd 1): Output to xterm.js
- stderr (fd 2): Output to xterm.js
- fd 3: Window size changes (4 x uint16: rows, cols, 0, 0)
"""

import os
import sys
import pty
import select
import struct
import fcntl
import termios
import errno

def set_winsize(fd, rows, cols):
    """Set the window size of the PTY."""
    winsize = struct.pack('HHHH', rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)

def main():
    if len(sys.argv) < 2:
        # Default to user's shell
        shell = os.environ.get('SHELL', '/bin/sh')
        cmd = [shell]
    else:
        cmd = sys.argv[1:]

    # Set TERM for xterm.js compatibility
    os.environ['TERM'] = 'xterm-256color'

    # Fork with PTY
    pid, fd = pty.fork()

    if pid == 0:
        # Child process - execute command
        try:
            os.execvp(cmd[0], cmd)
        except Exception as e:
            sys.stderr.write(f"Failed to exec {cmd[0]}: {e}\n")
            sys.exit(1)

    # Parent process - proxy I/O
    try:
        # Set initial size (default 80x24)
        set_winsize(fd, 24, 80)

        # Make stdin non-blocking
        flags = fcntl.fcntl(sys.stdin.fileno(), fcntl.F_GETFL)
        fcntl.fcntl(sys.stdin.fileno(), fcntl.F_SETFL, flags | os.O_NONBLOCK)

        # File descriptors to monitor
        fds = [fd, sys.stdin.fileno()]

        # Add fd 3 for window size if available
        winsize_fd = None
        try:
            # Check if fd 3 is available
            os.fstat(3)
            winsize_fd = 3
            fds.append(winsize_fd)
            flags = fcntl.fcntl(winsize_fd, fcntl.F_GETFL)
            fcntl.fcntl(winsize_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
        except OSError:
            pass

        while True:
            try:
                readable, _, _ = select.select(fds, [], [])
            except select.error as e:
                if e.args[0] == errno.EINTR:
                    continue
                raise

            for r in readable:
                if r == fd:
                    # PTY output -> stdout
                    try:
                        data = os.read(fd, 4096)
                        if not data:
                            return
                        os.write(sys.stdout.fileno(), data)
                        sys.stdout.flush()
                    except OSError as e:
                        if e.errno == errno.EIO:
                            return
                        if e.errno not in (errno.EINTR, errno.EAGAIN):
                            raise

                elif r == sys.stdin.fileno():
                    # stdin -> PTY
                    try:
                        data = os.read(sys.stdin.fileno(), 4096)
                        if not data:
                            # stdin closed (EOF) - parent process likely terminated
                            # Exit to prevent spin loop
                            return
                        os.write(fd, data)
                    except OSError as e:
                        if e.errno == errno.EIO:
                            return
                        if e.errno not in (errno.EINTR, errno.EAGAIN):
                            raise

                elif winsize_fd and r == winsize_fd:
                    # Window size change (8 bytes: 4 x uint16)
                    try:
                        data = os.read(winsize_fd, 8)
                        if not data:
                            # winsize fd closed - remove from monitoring
                            # to prevent spin loop
                            fds.remove(winsize_fd)
                            winsize_fd = None
                        elif len(data) == 8:
                            rows, cols, _, _ = struct.unpack('HHHH', data)
                            set_winsize(fd, rows, cols)
                    except OSError as e:
                        if e.errno not in (errno.EINTR, errno.EAGAIN):
                            raise

    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
    finally:
        try:
            os.close(fd)
        except:
            pass
        try:
            os.kill(pid, 9)
        except:
            pass
        os.waitpid(pid, 0)

if __name__ == '__main__':
    main()
