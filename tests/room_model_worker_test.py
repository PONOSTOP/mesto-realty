import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'worker'))
try:
    import room_model_worker as w
except ImportError:
    w = None

class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(w, 'worker implementation must exist')

    def test_origin_and_download_url_restrictions(self):
        c = w.Client('https://example.org', 'secret')
        self.assertEqual(c.url('/internal/room-models/1/images/2'), 'https://example.org/internal/room-models/1/images/2')
        for url in ['https://evil.org/a', '//evil.org/a', '/other', 'https://example.org@evil.org/a']:
            with self.assertRaises(ValueError): c.url(url)
        with self.assertRaises(ValueError): w.Client('http://example.org', 'secret')

    def test_bounded_download(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'image.jpg'
            with self.assertRaises(ValueError): w.copy_bounded(io.BytesIO(b'12345'), p, 4)
            self.assertFalse(p.exists())
            w.copy_bounded(io.BytesIO(b'1234'), p, 4)
            self.assertEqual(p.read_bytes(), b'1234')

    def test_image_signature_not_untrusted_filename(self):
        self.assertEqual(w.image_extension(b'\xff\xd8\xffabc'), '.jpg')
        self.assertEqual(w.image_extension(b'\x89PNG\r\n\x1a\n'), '.png')
        with self.assertRaises(ValueError): w.image_extension(b'<html>')

    def test_webp_converts_to_rgb_png_for_nerfstudio(self):
        from PIL import Image
        self.assertTrue(hasattr(w,'convert_photograph'), 'WebP conversion must exist')
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)/'0000.download'
            target = Path(directory)/'0000.png'
            Image.new('RGBA',(3,2),(12,34,56,255)).save(source,format='WEBP',lossless=True)
            w.convert_photograph(source,target)
            with Image.open(target) as converted:
                self.assertEqual(converted.format,'PNG')
                self.assertEqual(converted.mode,'RGB')
                self.assertEqual(converted.size,(3,2))
                self.assertEqual(converted.getpixel((0,0)),(12,34,56))
            with self.assertRaises(ValueError):
                w.convert_photograph(source,Path(directory)/'oversized.png',max_pixels=5)
            self.assertFalse((Path(directory)/'oversized.png').exists())

    def test_camera_opengl_axes_and_degenerate_rejection(self):
        camera = w.camera_from_transforms({'frames':[{'transform_matrix':[[1,0,0,2],[0,1,0,3],[0,0,1,4],[0,0,0,1]]}]})
        self.assertEqual(camera, {'position':[2.0,3.0,4.0], 'target':[2.0,3.0,3.0], 'up':[0.0,1.0,0.0]})
        for matrix in [[[0]*4]*4, [[float('nan')]*4]*4]:
            with self.assertRaises(ValueError): w.camera_from_transforms({'frames':[{'transform_matrix':matrix}]})

    def test_command_arguments_preserve_pose_coordinates(self):
        commands = w.commands(Path('/tmp/job space'))
        self.assertEqual(commands[0][:2], ['ns-process-data','images'])
        self.assertIn('--viewer.quit-on-train-completion', commands[1])
        self.assertIn('tensorboard', commands[1])
        self.assertEqual(commands[1][-7:], ['nerfstudio-data','--auto-scale-poses','False','--center-method','none','--orientation-method','none'])

    def test_selects_largest_colmap_component_instead_of_first(self):
        import struct
        self.assertTrue(hasattr(w, 'best_colmap_model'), 'worker must select the largest COLMAP component')
        with tempfile.TemporaryDirectory() as directory:
            processed = Path(directory)
            for name, cameras in [('0', 36), ('1', 60), ('2', 12)]:
                model = processed/'colmap'/'sparse'/name
                model.mkdir(parents=True)
                (model/'images.bin').write_bytes(struct.pack('<Q', cameras))
                (model/'cameras.bin').write_bytes(b'camera fixture')
                (model/'points3D.bin').write_bytes(b'point fixture')
            self.assertEqual(w.best_colmap_model(processed), Path('colmap/sparse/1'))
            # Incomplete output must not override a complete reconstruction.
            (processed/'colmap/sparse/2/images.bin').write_bytes(b'bad')
            self.assertEqual(w.best_colmap_model(processed), Path('colmap/sparse/1'))
            with self.assertRaises(ValueError): w.best_colmap_model(processed/'missing')

    def test_job_rejects_path_and_count(self):
        job = {'propertyId':1,'revision':2,'leaseToken':'12345678-1234-4234-8234-123456789abc','images':[{'id':1,'url':'/internal/room-models/1/images/1'}]}
        w.validate_job(job)
        for key, value in [('propertyId','../../x'),('revision',True),('images',job['images']*201)]:
            with self.assertRaises(ValueError): w.validate_job({**job,key:value})
        with self.assertRaises(ValueError):
            w.validate_job({**job,'images':[{'id':1,'url':'/internal/room-models/2/images/1'}]})

    def test_stale_http_stops_work(self):
        from urllib.error import HTTPError
        class Opener:
            def open(self, *args, **kwargs): raise HTTPError('url',409,'stale',{},None)
        c = w.Client('https://example.org','secret'); c.opener = Opener()
        with self.assertRaises(w.StaleJob): c.json('/internal/room-models/claim', {})

    def test_download_bearer_and_lease_headers(self):
        import threading
        from http.server import BaseHTTPRequestHandler, HTTPServer
        captured = {}
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                captured.update(self.headers)
                self.send_response(200); self.end_headers(); self.wfile.write(b'jpeg')
            def log_message(self, *args): pass
        server = HTTPServer(('127.0.0.1',0),Handler)
        thread = threading.Thread(target=server.serve_forever,daemon=True); thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                client = w.Client('http://127.0.0.1:' + str(server.server_port),'secret',True)
                client.download('/internal/room-models/1/images/1',Path(directory)/'image',2,'lease')
            self.assertEqual(captured['Authorization'],'Bearer secret')
            self.assertEqual(captured['X-Room-Model-Revision'],'2')
            self.assertEqual(captured['X-Room-Model-Lease'],'lease')
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_stale_heartbeat_terminates_running_subprocess(self):
        class FakeClient:
            def __init__(self): self.calls = 0
            def json(self, *args):
                self.calls += 1
                if self.calls > 1: raise w.StaleJob()
        job = {'propertyId':1,'revision':1,'leaseToken':'lease'}
        lease = w.Lease(FakeClient(),job,60)
        from unittest.mock import patch
        original_check = lease.check
        def check():
            lease.next_heartbeat = 0
            original_check()
        with patch.object(lease,'check',check):
            with self.assertRaises(w.StaleJob):
                lease.run([sys.executable,'-c','import time; time.sleep(30)'])

    def test_hard_timeout_removes_only_registered_temporary_directory(self):
        from unittest.mock import patch
        self.assertTrue(hasattr(w,'ACTIVE_TEMPORARY_DIRECTORIES'))
        with tempfile.TemporaryDirectory() as parent:
            owned = Path(tempfile.mkdtemp(prefix='room-model-',dir=parent))
            unrelated = Path(parent)/'unrelated'; unrelated.mkdir()
            (owned/'large-output').write_bytes(b'training data')
            w.ACTIVE_TEMPORARY_DIRECTORIES.add(owned)
            try:
                with patch.object(w.os,'_exit') as exit_process:
                    w.expire_task()
                exit_process.assert_called_once_with(1)
                self.assertFalse(owned.exists())
                self.assertTrue(unrelated.exists())
            finally:
                w.ACTIVE_TEMPORARY_DIRECTORIES.discard(owned)

if __name__ == '__main__': unittest.main()
