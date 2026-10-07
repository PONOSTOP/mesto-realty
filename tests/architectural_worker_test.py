import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'worker'))
import room_model_worker as w

class ArchitectureWorkerTests(unittest.TestCase):
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
