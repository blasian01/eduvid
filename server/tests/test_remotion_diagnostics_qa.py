"""Regression for terse Chromium startup failures; no actual providers."""
import asyncio
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from app import remotion


class RendererDiagnosticsQA(unittest.IsolatedAsyncioTestCase):
    async def test_structured_failure_keeps_early_icu_error_without_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stream = asyncio.StreamReader()
            early = 'FATAL:base/i18n/icu_util.cc icudtl.dat not found in bundle'
            lines = [early, *['Browser diagnostic ' + str(i) for i in range(150)],
                     json.dumps({'ok': False, 'error': 'Target closed', 'phase': 'composition', 'issues': []})]
            stream.feed_data(('\n'.join(lines) + '\n').encode())
            stream.feed_eof()
            process = AsyncMock(stdout=stream, pid=999999, returncode=1)
            process.wait = AsyncMock(return_value=1)
            with patch.object(remotion, 'ensure_available'), \
                 patch.object(asyncio, 'create_subprocess_exec', AsyncMock(return_value=process)), \
                 patch.dict(os.environ, {'ELEVENLABS_API_KEY': 'PRIVATE_PROVIDER_TEST_VALUE'}):
                result = await remotion.run(root / 'plan.json', root / 'silent.mp4')
            self.assertFalse(result.ok)
            self.assertIn('Remotion composition: Target closed', result.error)
            saved = (root / 'render-diagnostics.json').read_text()
            diagnostic = json.loads(saved)
            self.assertIn(early, diagnostic['fatal_lines'])
            self.assertLessEqual(len(diagnostic['tail']), 100)
            self.assertNotIn('PRIVATE_PROVIDER_TEST_VALUE', saved)
            self.assertNotIn('ELEVENLABS_API_KEY', saved)
            self.assertEqual(diagnostic['render_pid'], 999999)


if __name__ == '__main__':
    unittest.main()
