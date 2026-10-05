"""Loopback-only authoritative DNS for Orbit's macOS scoped resolver.
No forwarding: other domains are refused; orbit.com has no public HTTPS hints.
"""
import socket
import socketserver
import struct
import threading

PORT = 15353


def answer(packet):
    if len(packet) < 12:
        return None
    ident, flags, questions, *_ = struct.unpack('!6H', packet[:12])
    if flags & 0xF800 or questions != 1:
        return None
    offset, labels = 12, []
    try:
        while packet[offset]:
            size = packet[offset]
            if size > 63 or offset + size + 1 >= len(packet):
                return None
            labels.append(packet[offset + 1:offset + 1 + size].decode('ascii').lower())
            offset += size + 1
            if offset > 267:
                return None
        offset += 1
        kind, category = struct.unpack('!HH', packet[offset:offset + 4])
    except (IndexError, UnicodeError, struct.error):
        return None
    question = packet[12:offset + 4]
    name = '.'.join(labels)
    permitted = name == 'orbit.com' and category == 1
    data = socket.inet_pton(socket.AF_INET, '127.0.0.1') if kind == 1 else socket.inet_pton(socket.AF_INET6, '::1') if kind == 28 else b''
    record = b''
    if permitted and data:
        record = b'\xc0\x0c' + struct.pack('!HHIH', kind, 1, 60, len(data)) + data
    # Authoritative NOERROR/NODATA for HTTPS/SVCB, never relay public addresses.
    response_flags = 0x8000 | (flags & 0x0100) | (0x0400 if permitted else 5)
    return struct.pack('!6H', ident, response_flags, 1, bool(record), 0, 0) + question + record


class UDPHandler(socketserver.BaseRequestHandler):
    def handle(self):
        packet, sock = self.request
        response = answer(packet)
        if response:
            sock.sendto(response, self.client_address)


class TCPHandler(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(2)
        try:
            prefix = self.rfile.read(2)
            if len(prefix) != 2:
                return
            size = struct.unpack('!H', prefix)[0]
            if size > 4096:
                return
            response = answer(self.rfile.read(size))
            if response:
                self.wfile.write(struct.pack('!H', len(response)) + response)
        except (OSError, ValueError):
            pass


class TCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    with socketserver.UDPServer(('127.0.0.1', PORT), UDPHandler) as udp, TCPServer(('127.0.0.1', PORT), TCPHandler) as tcp:
        threading.Thread(target=tcp.serve_forever, daemon=True).start()
        udp.serve_forever()
