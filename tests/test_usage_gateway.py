import tempfile
import unittest
import deepseek
import aicredits
import gemini


class UsageGatewayTests(unittest.TestCase):
    def test_all_streaming_gateways_request_usage_without_forwarding_untrusted_options(self):
        with tempfile.TemporaryDirectory() as directory:
            for gateway, model in [(deepseek.DeepSeekGateway(directory), 'deepseek-flash'),
                                   (aicredits.AICreditsGateway(directory), 'deepseek/deepseek-v4.1-flash'),
                                   (gemini.GeminiGateway(directory), 'gemini-2.5-flash')]:
                payload = gateway.payload({'model': model, 'messages': [{'role': 'user', 'content': 'test'}],
                                           'stream_options': {'include_usage': False, 'private': 'secret'}})
                self.assertEqual(payload['stream_options'], {'include_usage': True})

    def test_deepseek_preserves_separate_final_usage_and_stops_without_waiting_for_eof(self):
        parser = deepseek.StreamCompletion(require_usage=True)
        self.assertFalse(parser.feed(b'data: {"choices":[{"finish_reason":"stop"}]}\n\n'))
        self.assertTrue(parser.finished)
        self.assertFalse(parser.feed(b'data: {"choices":[],"usage":null}\n\n'))
        self.assertTrue(parser.feed(b'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\n'))

    def test_missing_usage_done_is_still_valid_and_malformed_counts_do_not_end_early(self):
        parser = deepseek.StreamCompletion(require_usage=True)
        self.assertFalse(parser.feed(b'data: {"choices":[{"finish_reason":"stop"}],"usage":{"total_tokens":true}}\n\n'))
        self.assertTrue(parser.feed(b'data: [DONE]\n\n'))


if __name__ == '__main__':
    unittest.main()
