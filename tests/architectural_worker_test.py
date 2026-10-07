import sys
import unittest
import base64
import io
import json
import os
import tempfile
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'worker'))
import room_model_worker as w

class ArchitectureWorkerTests(unittest.TestCase):
    def job(self):
        return {'propertyId':2,'revision':3,'leaseToken':'12345678-1234-4234-8234-123456789abc','dimensions':{'width':10,'depth':8,'height':3},'instructions':'Read the actual plan; return canonical scene JSON.','sceneSchema':{'type':'object'},'plan':{'url':'/internal/architectural-models/2/plan'},'images':[{'url':'/internal/architectural-models/2/photos/4'}]}

    def test_local_vision_origin_restrictions(self):
        self.assertTrue(hasattr(w,'LocalVision'),'Local vision adapter must exist')
        for origin in ['http://room-model-vision:11434','http://127.0.0.1:11434','http://localhost:11434']:
            w.LocalVision(origin,'qwen2.5vl:3b')
        for origin in ['https://external.example','http://169.254.169.254','http://room-model-vision.evil:11434','http://user@localhost:11434','http://localhost:11434/path','http://localhost:11434/?secret=1']:
            with self.assertRaises(ValueError): w.LocalVision(origin,'model')

    def test_thumbnail_is_bounded_rgb_jpeg(self):
        from PIL import Image
        self.assertTrue(hasattr(w,'vision_image'),'Vision image preparation must exist')
        with tempfile.TemporaryDirectory() as directory:
            image=Path(directory)/'input'; Image.new('RGBA',(2000,1000),(10,20,30,255)).save(image,format='PNG')
            encoded=w.vision_image(image,768)
            with Image.open(io.BytesIO(base64.b64decode(encoded))) as thumb:
                self.assertEqual(thumb.mode,'RGB'); self.assertEqual(thumb.format,'JPEG')
                self.assertEqual(thumb.size,(768,384))

    def test_local_http_payload_has_schema_and_no_site_auth(self):
        import threading
        from http.server import HTTPServer,BaseHTTPRequestHandler
        self.assertTrue(hasattr(w,'LocalVision'))
        captured={}
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                captured['headers']=dict(self.headers); captured['path']=self.path
                captured['body']=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                self.send_response(200); self.end_headers()
                self.wfile.write(json.dumps({'message':{'content':'{"walls":[]}'},'done':True}).encode())
            def log_message(self,*args): pass
        server=HTTPServer(('127.0.0.1',0),Handler); thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            scene=w.LocalVision(f'http://127.0.0.1:{server.server_port}','qwen2.5vl:3b').analyze(self.job(),['plan','photo'])
            self.assertEqual(scene,{'walls':[]});self.assertNotIn('Authorization',captured['headers'])
            body=captured['body'];self.assertEqual(body['format'],self.job()['sceneSchema'])
            self.assertFalse(body['stream']);self.assertEqual(body['keep_alive'],0)
            self.assertEqual(body['options'],{'temperature':0,'num_ctx':8192,'num_predict':6000})
            self.assertEqual(body['messages'][1]['images'],['plan','photo'])
            self.assertEqual(captured['path'],'/api/chat')
        finally: server.shutdown();server.server_close();thread.join()

    def local_fake(self, outputs):
        from PIL import Image
        class Site:
            def __init__(self): self.calls=[]
            def json(self,path,body,timeout=30): self.calls.append((path,body,timeout));return {}
            def download(self,path,destination,revision,lease):
                Image.new('RGB',(4,4),(20,30,40)).save(destination,format='PNG')
        class Vision:
            def __init__(self,*args): self.calls=[]
            def analyze(self,job,images,feedback=None):
                self.calls.append(feedback)
                output=outputs.pop(0)
                if isinstance(output,Exception): raise output
                return output
        return Site(),Vision

    def test_local_invalid_json_retries_once_and_completes(self):
        self.assertTrue(hasattr(w,'LocalVision'))
        site,vision=self.local_fake([ValueError('invalid JSON'),{'walls':[]}])
        with patch.dict(os.environ,{'ROOM_MODEL_LOCAL_VISION_URL':'http://room-model-vision:11434'}),patch.object(w,'LocalVision',vision):
            w.process_architectural_job(site,self.job())
        self.assertTrue(any(path.endswith('/complete') and body['scene']=={'walls':[]} for path,body,_ in site.calls))
        self.assertFalse(any(path.endswith('/analyze') or path.endswith('/fail') for path,_,_ in site.calls))

    def test_local_unreadable_plan_fails_without_scene(self):
        self.assertTrue(hasattr(w,'LocalVision'))
        site,vision=self.local_fake([{'error':'unreadable_plan'}])
        with patch.dict(os.environ,{'ROOM_MODEL_LOCAL_VISION_URL':'http://room-model-vision:11434'}),patch.object(w,'LocalVision',vision):
            w.process_architectural_job(site,self.job())
        self.assertTrue(any(path.endswith('/fail') and body['code']=='unreadable_plan' for path,body,_ in site.calls))
        self.assertFalse(any(path.endswith('/complete') for path,_,_ in site.calls))

    def test_local_complete_422_regenerates_once(self):
        site,vision=self.local_fake([{'walls':[]},{'walls':[{'id':'second'}]}])
        initial_json=site.json
        count=[0]
        def complete_reject(path,body,timeout=30):
            if path.endswith('/complete'):
                count[0]+=1
                if count[0]==1: raise w.APIError(422,'invalid_layout')
            return initial_json(path,body,timeout)
        site.json=complete_reject
        with patch.dict(os.environ,{'ROOM_MODEL_LOCAL_VISION_URL':'http://room-model-vision:11434'}),patch.object(w,'LocalVision',vision):
            w.process_architectural_job(site,self.job())
        self.assertEqual(count[0],2)
        self.assertFalse(any(path.endswith('/fail') for path,_,_ in site.calls))

    def test_local_repeated_invalid_json_has_no_fabricated_fallback(self):
        site,vision=self.local_fake([ValueError('invalid'),ValueError('invalid')])
        with patch.dict(os.environ,{'ROOM_MODEL_LOCAL_VISION_URL':'http://room-model-vision:11434'}),patch.object(w,'LocalVision',vision):
            w.process_architectural_job(site,self.job())
        self.assertTrue(any(path.endswith('/fail') and body['code']=='invalid_layout' for path,body,_ in site.calls))
        self.assertFalse(any(path.endswith('/complete') for path,_,_ in site.calls))

    def test_local_stale_download_stops_without_failure_callback(self):
        site,vision=self.local_fake([])
        def stale(*args): raise w.StaleJob()
        site.download=stale
        with patch.dict(os.environ,{'ROOM_MODEL_LOCAL_VISION_URL':'http://room-model-vision:11434'}),patch.object(w,'LocalVision',vision):
            w.process_architectural_job(site,self.job())
        self.assertFalse(any(path.endswith('/fail') or path.endswith('/complete') for path,_,_ in site.calls))

    def test_local_plan_route_cannot_cross_properties(self):
        job=self.job();job['plan']['url']='/internal/architectural-models/4/plan'
        with self.assertRaises(ValueError): w.validate_architectural_job(job,True)

    def test_local_response_over_limit_is_rejected(self):
        class Response(io.BytesIO):
            pass
        class Opener:
            def open(self,*args,**kwargs): return Response(b'x'*(2*1024*1024+1))
        vision=w.LocalVision('http://localhost:11434','model');vision.opener=Opener()
        with self.assertRaises(ValueError): vision.analyze(self.job(),['plan'])

    def test_background_stale_heartbeat_prevents_local_completion(self):
        import threading
        site,vision=self.local_fake([])
        stale=threading.Event()
        original_json=site.json
        heartbeat_count=[0]
        def site_json(path,body,timeout=30):
            if path.endswith('/heartbeat'):
                heartbeat_count[0]+=1
                if heartbeat_count[0]>1:
                    stale.set();raise w.StaleJob()
            return original_json(path,body,timeout)
        site.json=site_json
        class BlockingVision(vision):
            def analyze(self,*args,**kwargs):
                self_test.assertTrue(stale.wait(3),'Heartbeat must run during inference')
                return {'walls':[]}
        self_test=self
        original_check=w.Lease.check
        def immediate_check(lease):
            lease.next_heartbeat=0;original_check(lease)
        with patch.dict(os.environ,{'ROOM_MODEL_LOCAL_VISION_URL':'http://room-model-vision:11434'}),patch.object(w,'LocalVision',BlockingVision),patch.object(w.Lease,'check',immediate_check):
            w.process_architectural_job(site,self.job())
        self.assertFalse(any(path.endswith('/complete') or path.endswith('/fail') for path,_,_ in site.calls))
    def test_architecture_only_path_and_processing(self):
        self.assertEqual(w.Client('https://example.org','token').url('/internal/architectural-models/claim'),'https://example.org/internal/architectural-models/claim')
        class Fake:
            def __init__(self): self.calls=[]
            def json(self,path,body,timeout=30): self.calls.append((path,body,timeout));return {'ok':True}
        fake=Fake();job={'propertyId':2,'revision':3,'leaseToken':'12345678-1234-4234-8234-123456789abc'}
        w.process_architectural_job(fake,job)
        self.assertTrue(any(path.endswith('/heartbeat') for path,_,_ in fake.calls))
        self.assertTrue(any(path.endswith('/analyze') and timeout==240 for path,_,timeout in fake.calls))
        self.assertFalse(any('room-models/' in path for path,_,_ in fake.calls))
    def test_stale_does_not_report_failure(self):
        class Fake:
            def __init__(self): self.calls=[]
            def json(self,path,body,timeout=30):
                self.calls.append(path)
                if path.endswith('/analyze'): raise w.StaleJob()
                return {}
        fake=Fake();w.process_architectural_job(fake,{'propertyId':2,'revision':3,'leaseToken':'12345678-1234-4234-8234-123456789abc'})
        self.assertFalse(any(path.endswith('/fail') for path in fake.calls))

if __name__=='__main__': unittest.main()
