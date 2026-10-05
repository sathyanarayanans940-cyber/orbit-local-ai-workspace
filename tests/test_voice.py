"""Voice gating only: no audio, API credentials or external network."""
import unittest
from unittest.mock import Mock, patch
import server


class VoiceProbeTests(unittest.TestCase):
    def probe(self, status=204, body=b'', error=None):
        response = Mock(status=status)
        response.read.return_value = body
        connection = Mock()
        connection.getresponse.return_value = response
        if error:
            connection.request.side_effect = error
        factory = Mock(return_value=connection)
        clock = [0]
        probe = server.VoiceInternetProbe(factory, lambda: clock[0])
        return probe, factory, connection, clock

    def test_https_204_and_no_body_are_required(self):
        for status, body, expected in [(204, b'', True), (200, b'portal', False), (302, b'', False), (503, b'', False), (204, b'x', False)]:
            probe, factory, connection, _ = self.probe(status, body)
            self.assertIs(probe.check(), expected)
            factory.assert_called_once_with('www.gstatic.com', 443, timeout=2.5)
            self.assertEqual(connection.request.call_args.args, ('GET', '/generate_204'))
            self.assertNotIn('Authorization', connection.request.call_args.kwargs['headers'])
            connection.close.assert_called_once()

    def test_dns_tls_and_timeout_errors_fail_closed(self):
        for error in [OSError('DNS'), TimeoutError('timeout'), server.ssl.SSLError('TLS'), server.http.client.HTTPException('protocol')]:
            probe, _, connection, _ = self.probe(error=error)
            self.assertFalse(probe.check())
            self.assertFalse(probe.lock.locked())
            connection.close.assert_called_once()

    def test_positive_and_negative_results_are_cached_then_rechecked(self):
        for status in [204, 503]:
            probe, factory, _, clock = self.probe(status)
            self.assertEqual(probe.check(), status == 204)
            clock[0] = 9
            self.assertEqual(probe.check(), status == 204)
            self.assertEqual(factory.call_count, 1)
            clock[0] = 10
            probe.check()
            self.assertEqual(factory.call_count, 2)

    def test_inflight_probe_cannot_spawn_another_network_request(self):
        probe, factory, _, _ = self.probe()
        probe.lock.acquire()
        try:
            self.assertFalse(probe.check())
            factory.assert_not_called()
        finally:
            probe.lock.release()

    def test_close_failure_does_not_hold_the_probe_lock(self):
        probe, _, connection, _ = self.probe()
        connection.close.side_effect = OSError('closed')
        self.assertTrue(probe.check())
        self.assertFalse(probe.lock.locked())

    def test_local_endpoint_requires_custom_header_and_never_receives_audio(self):
        for headers, status in [({}, 403), ({'X-Orbit-Voice': '1'}, 200)]:
            handler = Mock(path='/api/voice/connectivity?ignored=1', headers=headers)
            with patch.object(server.VOICE_INTERNET, 'check', return_value=True) as probe:
                server.OrbitHandler.do_GET(handler)
                handler.web_json.assert_called_once_with(status, {'online': status == 200})
                self.assertEqual(probe.call_count, int(status == 200))


if __name__ == '__main__':
    unittest.main()
