import importlib.util
from pathlib import Path
import struct
import unittest
spec = importlib.util.spec_from_file_location('orbit_dns', Path(__file__).resolve().parents[1] / 'orbit-dns.py')
dns = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dns)

def query(kind, name='orbit.com'):
    return struct.pack('!6H', 4321, 0x100, 1, 0, 0, 0) + b''.join(bytes([len(s)])+s.encode() for s in name.split('.')) + b'\0' + struct.pack('!HH', kind, 1)

class LocalDNS(unittest.TestCase):
    def test_local_addresses(self):
        for kind, addr in [(1, b'\x7f\0\0\1'), (28, b'\0'*15+b'\1')]:
            result = dns.answer(query(kind))
            self.assertEqual(struct.unpack('!6H', result[:12])[3], 1)
            self.assertTrue(result.endswith(addr))
    def test_no_public_https_or_svcb(self):
        for kind in [64,65]:
            result = dns.answer(query(kind))
            self.assertEqual(struct.unpack('!6H', result[:12])[3], 0)
            self.assertEqual(result[3] & 15, 0)
    def test_no_forwarding(self):
        for name in ['example.com','static.orbit.com']:
            self.assertEqual(dns.answer(query(1,name))[3] & 15, 5)
    def test_malformed(self):
        self.assertIsNone(dns.answer(b''))
        self.assertIsNone(dns.answer(query(1)[:14]))
        self.assertIsNone(dns.answer(query(1)[:12]+b'\xc0\x0c\0\1\0\1'))
