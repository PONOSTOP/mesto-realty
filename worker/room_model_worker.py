"""Sequential, leased Nerfstudio worker. No third-party HTTP dependencies."""
import json
import math
import os
from pathlib import Path
import signal
import shutil
import subprocess
import tempfile
import threading
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit, urljoin
from urllib.request import Request, build_opener, HTTPRedirectHandler
import uuid

IMAGE_LIMIT = 8 * 1024 * 1024
SCENE_LIMIT = 100 * 1024 * 1024
ACTIVE_PROCESSES = set()
ACTIVE_TEMPORARY_DIRECTORIES = set()
PROCESS_LOCK = threading.Lock()

def stop_process(process):
    if process.poll() is None:
        try:
            if os.name != 'nt': os.killpg(process.pid, signal.SIGKILL)
            else: process.kill()
        except ProcessLookupError:
            pass

def expire_task():
    # A hard watchdog also covers a slow HTTP peer. Docker restarts the worker;
    # the server reclaims the abandoned lease instead of accepting late output.
    with PROCESS_LOCK:
        for process in ACTIVE_PROCESSES:
            stop_process(process)
            process.wait(timeout=5)
        for directory in ACTIVE_TEMPORARY_DIRECTORIES:
            # Only exact, securely allocated job directories are registered.
            # Never follow a replaced root symlink or delete a computed parent.
            if directory.name.startswith('room-model-') and not directory.is_symlink():
                shutil.rmtree(directory, ignore_errors=True)
    print('Room reconstruction reached its hard time limit', flush=True)
    os._exit(1)

class StaleJob(Exception):
    pass

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Redirects are forbidden')

class Client:
    def __init__(self, origin, token, allow_local_http=False):
        parsed = urlsplit(origin)
        local = allow_local_http and parsed.hostname in ('localhost','127.0.0.1','::1')
        if (parsed.scheme != 'https' and not (local and parsed.scheme == 'http')) or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ('','/') or parsed.query or parsed.fragment:
            raise ValueError('Site origin must be an HTTPS origin')
        if not token or '\r' in token or '\n' in token:
            raise ValueError('Worker token is required')
        self.origin = origin.rstrip('/')
        self.token = token
        self.opener = build_opener(NoRedirect())

    def url(self, path):
        parsed = urlsplit(path)
        if parsed.scheme or parsed.netloc or parsed.fragment or not parsed.path.startswith('/internal/room-models/') or '\\' in path or any(p in ('.','..') for p in parsed.path.split('/')):
            raise ValueError('Only internal relative API paths are permitted')
        return urljoin(self.origin, path)

    def request(self, path, data=None, content_type=None, extra_headers=None):
        headers = {'Authorization':'Bearer ' + self.token}
        headers.update(extra_headers or {})
        if content_type: headers['Content-Type'] = content_type
        req = Request(self.url(path), data=data, headers=headers)
        try:
            return self.opener.open(req, timeout=30)
        except HTTPError as error:
            status = error.code
            error.close()
            if status == 409: raise StaleJob() from None
            # Never include URLs, tokens or response bodies in logs.
            raise RuntimeError('Internal API request failed') from None

    def json(self, path, body):
        with self.request(path, json.dumps(body).encode(), 'application/json') as response:
            data = response.read(1024 * 1024 + 1)
            if len(data) > 1024 * 1024: raise ValueError('API response too large')
            return json.loads(data)

    def download(self, path, destination, revision, lease_token):
        with self.request(path, extra_headers={'X-Room-Model-Revision':str(revision),'X-Room-Model-Lease':lease_token}) as response:
            copy_bounded(response, destination, IMAGE_LIMIT)

    def complete(self, path, fields, scene):
        if scene.stat().st_size > SCENE_LIMIT: raise ValueError('Scene too large')
        with scene.open('rb') as source:
            header = source.read(4096)
            if not header.startswith(b'ply\nformat binary_little_endian 1.0\n'):
                raise ValueError('Expected binary little-endian PLY')
        boundary = 'room-' + uuid.uuid4().hex
        parts = []
        for key, value in fields.items():
            parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n').encode())
        parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="scene"; filename="scene.ply"\r\nContent-Type: application/octet-stream\r\n\r\n').encode())
        parts.extend([scene.read_bytes(), f'\r\n--{boundary}--\r\n'.encode()])
        with self.request(path, b''.join(parts), 'multipart/form-data; boundary=' + boundary) as response:
            response.read(4096)

def copy_bounded(source, destination, limit):
    try:
        with destination.open('xb') as target:
            total = 0
            while True:
                chunk = source.read(min(65536, limit - total + 1))
                if not chunk: break
                total += len(chunk)
                if total > limit: raise ValueError('Download too large')
                target.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise

def image_extension(header):
    if header.startswith(b'\xff\xd8\xff'): return '.jpg'
    if header.startswith(b'\x89PNG\r\n\x1a\n'): return '.png'
    if header.startswith(b'RIFF') and header[8:12] == b'WEBP': return '.webp'
    raise ValueError('Unsupported photograph')

def convert_photograph(source, destination, max_pixels=40_000_000):
    # Pillow ships in the pinned Nerfstudio image. Nerfstudio 1.1.5 does not
    # discover WebP inputs, while the website stores processed images as WebP.
    import warnings
    from PIL import Image
    if source.stat().st_size > IMAGE_LIMIT: raise ValueError('Photograph too large')
    with source.open('rb') as data: image_extension(data.read(16))
    Image.MAX_IMAGE_PIXELS = 40_000_000
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error',Image.DecompressionBombWarning)
            with Image.open(source) as image:
                if image.width <= 0 or image.height <= 0 or image.width * image.height > min(max_pixels,40_000_000):
                    raise ValueError('Photograph pixel limit exceeded')
                if getattr(image,'n_frames',1) != 1: raise ValueError('Animated photograph is unsupported')
                image.load()
                with image.convert('RGB') as rgb:
                    # 40 MP RGB bounds decoded storage and lossless PNG output.
                    rgb.save(destination,format='PNG')
    except Exception:
        destination.unlink(missing_ok=True)
        raise

def validate_job(job):
    for key in ('propertyId','revision'):
        if type(job.get(key)) is not int or job[key] <= 0: raise ValueError('Invalid job identity')
    if str(uuid.UUID(job['leaseToken'])) != job['leaseToken']: raise ValueError('Invalid lease')
    images = job.get('images')
    if not isinstance(images,list) or not 1 <= len(images) <= 200: raise ValueError('Invalid image count')
    ids = set()
    for image in images:
        if type(image.get('id')) is not int or image['id'] <= 0 or image['id'] in ids or not isinstance(image.get('url'),str): raise ValueError('Invalid image')
        expected = f"/internal/room-models/{job['propertyId']}/images/{image['id']}"
        if image['url'] != expected: raise ValueError('Invalid versioned image route')
        ids.add(image['id'])

def camera_from_transforms(data):
    frames = data.get('frames', [])
    if not frames: raise ValueError('No registered cameras')
    matrix = frames[0]['transform_matrix']
    if len(matrix) != 4 or any(len(row) != 4 for row in matrix): raise ValueError('Invalid camera matrix')
    values = [[float(x) for x in row] for row in matrix]
    if not all(math.isfinite(x) for row in values for x in row): raise ValueError('Nonfinite camera')
    # Nerfstudio transforms are OpenGL camera-to-world: +Y up, -Z forward.
    # Training explicitly disables automatic pose centering/orientation/scaling.
    position = [values[i][3] for i in range(3)]
    forward = [-values[i][2] for i in range(3)]
    up = [values[i][1] for i in range(3)]
    def norm(v): return math.sqrt(sum(x*x for x in v))
    cross = [forward[1]*up[2]-forward[2]*up[1],forward[2]*up[0]-forward[0]*up[2],forward[0]*up[1]-forward[1]*up[0]]
    if min(norm(forward),norm(up),norm(cross)) < 1e-6: raise ValueError('Degenerate camera')
    forward = [x/norm(forward) for x in forward]
    up = [x/norm(up) for x in up]
    return {'position':position,'target':[position[i]+forward[i] for i in range(3)],'up':up}

def commands(root):
    return [
        ['ns-process-data','images','--data',str(root/'images'),'--output-dir',str(root/'processed'),'--matching-method','exhaustive'],
        ['ns-train','splatfacto','--data',str(root/'processed'),'--output-dir',str(root/'outputs'),'--max-num-iterations','30000','--viewer.quit-on-train-completion','True','--vis','tensorboard','nerfstudio','--auto-scale-poses','False','--center-method','none','--orientation-method','none'],
    ]

class Lease:
    def __init__(self, client, job, timeout):
        self.client, self.job = client, job
        self.deadline = time.monotonic() + min(3600, max(60, timeout))
        self.next_heartbeat = 0
        self.path = '/internal/room-models/' + str(job['propertyId'])
        self.body = {'revision':job['revision'],'leaseToken':job['leaseToken']}

    def check(self):
        now = time.monotonic()
        if now >= self.deadline: raise TimeoutError('Task time limit reached')
        if now >= self.next_heartbeat:
            self.client.json(self.path+'/heartbeat', self.body)
            self.next_heartbeat = time.monotonic() + 60

    def run(self, command):
        self.check()
        # No shell, no inherited credentials, and no unbounded command output logs.
        env = {key:value for key,value in os.environ.items() if key not in ('ROOM_MODEL_WORKER_TOKEN','ROOM_MODEL_SITE_ORIGIN')}
        process = subprocess.Popen(command, shell=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, start_new_session=(os.name != 'nt'))
        with PROCESS_LOCK: ACTIVE_PROCESSES.add(process)
        try:
            while process.poll() is None:
                self.check()
                time.sleep(1)
            if process.returncode != 0: raise RuntimeError('Reconstruction command failed')
        finally:
            if process.poll() is None:
                stop_process(process)
                process.wait()
            with PROCESS_LOCK: ACTIVE_PROCESSES.discard(process)

def process_job(client, job, timeout=3600):
    validate_job(job)
    lease = Lease(client, job, timeout)
    watchdog = threading.Timer(min(3600, max(60, timeout)), expire_task)
    watchdog.daemon = True
    watchdog.start()
    code = 'reconstruction_failed'
    try:
        with tempfile.TemporaryDirectory(prefix='room-model-') as directory:
            root = Path(directory)
            with PROCESS_LOCK: ACTIVE_TEMPORARY_DIRECTORIES.add(root)
            (root/'images').mkdir()
            for index, image in enumerate(job['images']):
                lease.check()
                path = root/'images'/f'{index:04d}.download'
                client.download(image['url'],path,job['revision'],job['leaseToken'])
                convert_photograph(path,path.with_suffix('.png'))
                path.unlink()
            preprocess, train = commands(root)
            lease.run(preprocess)
            transforms = json.loads((root/'processed'/'transforms.json').read_text())
            # Dataset metadata can override CLI orientation; keep scene and camera
            # in the processed coordinate frame explicitly.
            transforms['orientation_override'] = 'none'
            (root/'processed'/'transforms.json').write_text(json.dumps(transforms))
            if len(transforms.get('frames',[])) < max(3, math.ceil(len(job['images'])*0.5)):
                code = 'insufficient_overlap'
                raise ValueError('Insufficient registered photographs')
            camera = camera_from_transforms(transforms)
            code = 'reconstruction_failed'
            lease.run(train)
            configs = list((root/'outputs').rglob('config.yml'))
            if len(configs) != 1: raise ValueError('Missing unique training config')
            lease.run(['ns-export','gaussian-splat','--load-config',str(configs[0]),'--output-dir',str(root/'export')])
            scenes = list((root/'export').glob('*.ply'))
            if len(scenes) != 1: raise ValueError('Missing unique exported scene')
            lease.check()
            client.complete(lease.path+'/complete',{**lease.body,'camera':json.dumps(camera,allow_nan=False)},scenes[0])
    except StaleJob:
        return
    except Exception:
        try: client.json(lease.path+'/fail',{**lease.body,'code':code})
        except StaleJob: pass
        except Exception: print('Failure notification unavailable', flush=True)
        print('Room reconstruction failed', flush=True)
    finally:
        watchdog.cancel()
        if 'root' in locals():
            with PROCESS_LOCK: ACTIVE_TEMPORARY_DIRECTORIES.discard(root)

def main():
    client = Client(os.environ['ROOM_MODEL_SITE_ORIGIN'],os.environ['ROOM_MODEL_WORKER_TOKEN'],os.environ.get('ROOM_MODEL_ALLOW_LOCAL_HTTP') == '1')
    timeout = min(3600, max(60, int(os.environ.get('ROOM_MODEL_TASK_TIMEOUT_SECONDS','3600'))))
    while True:
        try:
            job = client.json('/internal/room-models/claim',{}).get('job')
            if job: process_job(client,job,timeout)
            else: time.sleep(10)
        except KeyboardInterrupt: return
        except Exception:
            print('Worker API unavailable', flush=True)
            time.sleep(10)

if __name__ == '__main__': main()
